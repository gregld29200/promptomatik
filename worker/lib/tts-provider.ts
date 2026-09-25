import {
  PCM_BYTES_PER_SECOND,
  PCM_SAMPLE_RATE,
  audioCostUsd,
  isOpenRouterTtsModel,
  type AudioDirection,
  type AudioMode,
  type AudioQuality,
  type TtsModelConfig,
} from "./audio-config";
import { concatPcmWithSilence } from "./audio-assembly";
import { compileDirection } from "./audio-direction";
import { planSpeechRuns, type SpeechRun } from "./speech-runs";

type VoiceMap = Record<string, string>;

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inlineData?: { data?: string };
        text?: string;
      }>;
    };
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
  error?: {
    message?: string;
    status?: string;
  };
}

interface OpenRouterErrorBody {
  error?: {
    message?: string;
  };
}

export interface GenerateBlockInput {
  /** Key of the model's provider: OpenRouter for "google/…" ids, Gemini otherwise. */
  apiKey: string;
  model: string;
  /** The block's transcript: plain text, or "Speaker N:" lines in a dialogue. */
  script: string;
  /** Performance direction; without one the script is spoken as written. */
  direction?: AudioDirection;
  mode: AudioMode;
  voices: VoiceMap;
  fetcher?: typeof fetch;
  backoffMs?: readonly number[];
  // Statuses that should throw immediately instead of backing off — used by the
  // model-fallback chain so a 429 switches to the next model without waiting out
  // a backoff that a per-day quota limit would never clear anyway.
  fastFailStatuses?: readonly number[];
}

export interface GenerateBlockResult {
  pcm: Uint8Array;
  durationSeconds: number;
  retryCount: number;
  model: string;
  /** HTTP status of the last retried-away error, if any (e.g. 429, 524). */
  lastErrorStatus?: number;
}

export class TtsProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number
  ) {
    super(message);
    this.name = "TtsProviderError";
  }
}

const DEFAULT_BACKOFF_MS = [2_000, 8_000, 30_000] as const;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504, 524]);
const GEMINI_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const OPENROUTER_SPEECH_URL = "https://openrouter.ai/api/v1/audio/speech";
// OpenRouter forwards only the options keyed by the provider that serves the
// request, so both Google routes carry the same speech metadata.
const OPENROUTER_GOOGLE_PROVIDERS = ["google-ai-studio", "google-vertex"] as const;
// Through OpenRouter a dialogue is voiced turn by turn: the pause between two
// turns, and how many requests of one block are in flight at once.
const TURN_GAP_MS = 300;
const RUN_CONCURRENCY = 3;

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProhibitedContent(value: unknown): boolean {
  return JSON.stringify(value).includes("PROHIBITED_CONTENT");
}

function generationConfig(mode: AudioMode, voices: VoiceMap): Record<string, unknown> {
  if (mode === "monologue") {
    const voiceName = voices.solo ?? Object.values(voices)[0];
    return {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    };
  }

  return {
    responseModalities: ["AUDIO"],
    speechConfig: {
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: Object.entries(voices).map(([speaker, voiceName]) => ({
          speaker,
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        })),
      },
    },
  };
}

async function requestGeminiBlock(input: GenerateBlockInput, prompt: string): Promise<Uint8Array> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(
    `${GEMINI_MODELS_URL}/${input.model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": input.apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: generationConfig(input.mode, input.voices),
      }),
    }
  );

  const body = await response.json().catch(() => null) as GeminiGenerateContentResponse | null;

  if (!response.ok) {
    if (isProhibitedContent(body)) {
      throw new TtsProviderError(
        "The model rejected this script as ambiguous — run Prepare for audio and retry.",
        false,
        response.status
      );
    }
    throw new TtsProviderError(
      body?.error?.message ?? `Gemini TTS request failed with HTTP ${response.status}.`,
      RETRYABLE_STATUSES.has(response.status),
      response.status
    );
  }

  if (isProhibitedContent(body)) {
    throw new TtsProviderError(
      "The model rejected this script as ambiguous — run Prepare for audio and retry.",
      false,
      response.status
    );
  }

  const part = body?.candidates?.[0]?.content?.parts?.[0];
  const audioData = part?.inlineData?.data;
  if (typeof audioData === "string" && audioData.length > 0) {
    return pcmFromAudioBytes(base64ToBytes(audioData));
  }

  if (typeof part?.text === "string") {
    throw new TtsProviderError("Gemini TTS returned text instead of audio.", true, response.status);
  }

  throw new TtsProviderError("Gemini TTS returned no audio.", true, response.status);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function alignedCopy(bytes: Uint8Array, start: number, end: number): Uint8Array {
  // A fresh buffer, trimmed to whole samples, so Int16Array views line up.
  return bytes.slice(start, end - ((end - start) % 2));
}

// OpenRouter answers response_format "pcm" with headerless samples, while a
// unary Gemini 3.8 response is a RIFF/WAV file. Accept both, but only in the
// 24 kHz mono 16-bit layout every other block of the take is in.
export function pcmFromAudioBytes(bytes: Uint8Array): Uint8Array {
  const isWav = bytes.byteLength >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE";
  if (!isWav) return alignedCopy(bytes, 0, bytes.byteLength);

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt " && body + 16 <= bytes.byteLength) {
      const format = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      const sampleRate = view.getUint32(body + 4, true);
      const bitsPerSample = view.getUint16(body + 14, true);
      const isPcm = format === 1 || format === 0xfffe;
      if (!isPcm || channels !== 1 || sampleRate !== PCM_SAMPLE_RATE || bitsPerSample !== 16) {
        throw new TtsProviderError(
          `Unexpected audio format: ${sampleRate} Hz, ${channels} channel(s), ${bitsPerSample}-bit.`,
          false
        );
      }
    } else if (id === "data") {
      // A streamed WAV leaves the data size at 0 or 0xFFFFFFFF.
      const end = size === 0 || body + size > bytes.byteLength ? bytes.byteLength : body + size;
      return alignedCopy(bytes, body, end);
    }
    offset = body + size + (size % 2);
  }
  throw new TtsProviderError("The audio file had no sound data.", true);
}

interface Take<T> {
  value: T;
  retryCount: number;
  lastErrorStatus?: number;
}

async function withRetries<T>(
  attempt: () => Promise<T>,
  input: Pick<GenerateBlockInput, "backoffMs" | "fastFailStatuses">
): Promise<Take<T>> {
  const backoffMs = input.backoffMs ?? DEFAULT_BACKOFF_MS;
  const fastFail = new Set(input.fastFailStatuses ?? []);
  let retryCount = 0;
  let lastError: unknown;

  for (let i = 0; i <= backoffMs.length; i += 1) {
    try {
      const value = await attempt();
      return {
        value,
        retryCount,
        lastErrorStatus: lastError instanceof TtsProviderError ? lastError.status : undefined,
      };
    } catch (error) {
      lastError = error;
      const status = error instanceof TtsProviderError ? error.status : undefined;
      if (status !== undefined && fastFail.has(status)) break;
      const retryable = error instanceof TtsProviderError && error.retryable;
      if (!retryable || i === backoffMs.length) break;
      await sleep(backoffMs[i]);
      retryCount += 1;
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new TtsProviderError("Text-to-speech failed.", true);
}

// Runs `task` over `items` with at most `limit` in flight, keeping order.
// After the first failure no new task starts; the ones in flight settle
// before the failure is rethrown.
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const state: { next: number; failed: boolean; error?: unknown } = { next: 0, failed: false };
  const worker = async () => {
    while (!state.failed && state.next < items.length) {
      const index = state.next;
      state.next += 1;
      try {
        results[index] = await task(items[index]);
      } catch (error) {
        if (!state.failed) {
          state.failed = true;
          state.error = error;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (state.failed) throw state.error;
  return results;
}

async function generateGeminiBlock(input: GenerateBlockInput): Promise<GenerateBlockResult> {
  const prompt = input.direction
    ? compileDirection({
      direction: input.direction,
      mode: input.mode,
      speakers: input.mode === "dialogue" ? Object.keys(input.voices) : ["solo"],
      script: input.script,
    })
    : input.script;
  const take = await withRetries(() => requestGeminiBlock(input, prompt), input);
  return {
    pcm: take.value,
    durationSeconds: take.value.byteLength / PCM_BYTES_PER_SECOND,
    retryCount: take.retryCount,
    model: input.model,
    lastErrorStatus: take.lastErrorStatus,
  };
}

async function requestOpenRouterRun(input: GenerateBlockInput, run: SpeechRun): Promise<Uint8Array> {
  const fetcher = input.fetcher ?? fetch;
  const payload: Record<string, unknown> = {
    model: input.model,
    input: run.text,
    voice: run.voice,
    response_format: "pcm",
  };
  if (run.style) {
    const options = { speech_metadata: { style: run.style } };
    payload.provider = {
      options: Object.fromEntries(OPENROUTER_GOOGLE_PROVIDERS.map((slug) => [slug, options])),
    };
  }

  const response = await fetcher(OPENROUTER_SPEECH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
      "HTTP-Referer": "https://promptomatik.com",
      "X-Title": "Promptomatik",
    },
    body: JSON.stringify(payload),
  });

  // Errors come back as JSON, sometimes even behind a 200.
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!response.ok || /json|^text\//i.test(contentType)) {
    const body = await response.json().catch(() => null) as OpenRouterErrorBody | null;
    throw new TtsProviderError(
      body?.error?.message ?? `OpenRouter TTS request failed with HTTP ${response.status}.`,
      response.ok || RETRYABLE_STATUSES.has(response.status),
      response.status
    );
  }

  // Headerless PCM cannot tell its sample rate, but its content type may:
  // any rate other than 24 kHz would play at the wrong speed in the take.
  const rate = contentType.match(/rate=(\d+)/i)?.[1];
  if (rate && Number(rate) !== PCM_SAMPLE_RATE) {
    throw new TtsProviderError(`Unexpected audio sample rate: ${rate} Hz.`, false, response.status);
  }
  const pcm = pcmFromAudioBytes(new Uint8Array(await response.arrayBuffer()));
  if (pcm.byteLength === 0) {
    throw new TtsProviderError("OpenRouter TTS returned no audio.", true, response.status);
  }
  return pcm;
}

// OpenRouter's speech endpoint takes one voice per request, so the block is
// voiced run by run (see planSpeechRuns) and stitched back together.
async function generateOpenRouterBlock(input: GenerateBlockInput): Promise<GenerateBlockResult> {
  const runs = planSpeechRuns(input);
  if (runs.length === 0) {
    throw new TtsProviderError("This block has nothing to read aloud.", false);
  }

  const takes = await mapWithConcurrency(runs, RUN_CONCURRENCY, (run) =>
    withRetries(() => requestOpenRouterRun(input, run), input)
  );
  const turns: Uint8Array[][] = [];
  takes.forEach((take, index) => {
    if (index === 0 || runs[index].turn !== runs[index - 1].turn) turns.push([]);
    turns[turns.length - 1].push(take.value);
  });
  const pcm = concatPcmWithSilence(turns.map((parts) => concatPcmWithSilence(parts, 0)), TURN_GAP_MS);

  return {
    pcm,
    durationSeconds: pcm.byteLength / PCM_BYTES_PER_SECOND,
    retryCount: takes.reduce((sum, take) => sum + take.retryCount, 0),
    model: input.model,
    lastErrorStatus: takes.findLast((take) => take.lastErrorStatus !== undefined)?.lastErrorStatus,
  };
}

export async function generateBlock(input: GenerateBlockInput): Promise<GenerateBlockResult> {
  return isOpenRouterTtsModel(input.model)
    ? generateOpenRouterBlock(input)
    : generateGeminiBlock(input);
}

export function costForQuality(
  config: TtsModelConfig,
  quality: AudioQuality,
  seconds: number
): number {
  const price = quality === "draft"
    ? config.draftPricePer1MTokens
    : config.finalPricePer1MTokens;
  return audioCostUsd(seconds, price);
}
