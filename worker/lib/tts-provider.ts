import {
  PCM_BYTES_PER_SECOND,
  audioCostUsd,
  type AudioMode,
  type AudioQuality,
  type TtsModelConfig,
} from "./audio-config";

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

export interface GenerateBlockInput {
  apiKey: string;
  model: string;
  prompt: string;
  mode: AudioMode;
  voices: VoiceMap;
  fetcher?: typeof fetch;
  backoffMs?: readonly number[];
}

export interface GenerateBlockResult {
  pcm: Uint8Array;
  durationSeconds: number;
  retryCount: number;
  model: string;
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
const RETRYABLE_STATUSES = new Set([429, 500, 503]);

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

async function requestBlock(input: GenerateBlockInput): Promise<Uint8Array> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(
    `https://generativelanguage.googleapis.com/v1beta/models/${input.model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": input.apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: input.prompt }] }],
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
    return base64ToBytes(audioData);
  }

  if (typeof part?.text === "string") {
    throw new TtsProviderError("Gemini TTS returned text instead of audio.", true, response.status);
  }

  throw new TtsProviderError("Gemini TTS returned no audio.", true, response.status);
}

export async function generateBlock(input: GenerateBlockInput): Promise<GenerateBlockResult> {
  const backoffMs = input.backoffMs ?? DEFAULT_BACKOFF_MS;
  let retryCount = 0;
  let lastError: unknown;

  for (let attempt = 0; attempt <= backoffMs.length; attempt += 1) {
    try {
      const pcm = await requestBlock(input);
      return {
        pcm,
        durationSeconds: pcm.byteLength / PCM_BYTES_PER_SECOND,
        retryCount,
        model: input.model,
      };
    } catch (error) {
      lastError = error;
      const retryable = error instanceof TtsProviderError && error.retryable;
      if (!retryable || attempt === backoffMs.length) break;
      await sleep(backoffMs[attempt]);
      retryCount += 1;
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new TtsProviderError("Gemini TTS failed.", true);
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
