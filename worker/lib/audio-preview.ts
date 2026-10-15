import type { Env } from "../env";
import type { AudioDirection, AudioMode } from "./audio-config";
import { validateTranscriptForTts } from "./audio-direction";
import { mp3FromPcm } from "./audio-assembly";
import {
  DEFAULT_PROVIDER,
  briefedDirection,
  prepareAudioInput,
  ttsModelChain,
  voiceWithModelChain,
  type AudioGenerationProvider,
} from "./audio-jobs";
import { isSlowDelivery, previewExcerpt } from "./audio-preview-excerpt";
import {
  completePreview,
  logTtsUsage,
  previewUsage,
  releasePreview,
  reservePreview,
  type PreviewUsage,
} from "./tts-usage";

// Free previews: the opening seconds of a take, voiced by the same models
// with the same voices and direction, outside the monthly quota and credits.
// The caps only stop someone from voicing a whole script excerpt by excerpt.
export const PREVIEW_DAILY_LIMIT = 30;
export const PREVIEW_MONTHLY_LIMIT = 150;
// Under the R2 `audio/` prefix, whose bucket lifecycle rule deletes after 7 days.
const PREVIEW_PREFIX = "audio/previews";
// The teacher waits on the answer: one short retry, not the queue's backoff.
const PREVIEW_BACKOFF_MS = [1_000] as const;
// Bump to orphan every cached preview (e.g. after a change in how a take is voiced).
const PREVIEW_CACHE_VERSION = 1;

export interface AudioPreviewInput {
  userId: string;
  mode: AudioMode;
  script: string;
  direction: AudioDirection;
  voices: Record<string, string>;
}

export interface PreviewLimitsInfo {
  dailyLimit: number;
  monthlyLimit: number;
}

export type AudioPreviewResult =
  | ({ ok: true; mp3: ArrayBuffer; cached: boolean; excerpt: string } & PreviewUsage & PreviewLimitsInfo)
  | ({ ok: false; code: "preview_daily_limit" | "preview_monthly_limit" } & PreviewUsage & PreviewLimitsInfo);

const LIMITS_INFO: PreviewLimitsInfo = { dailyLimit: PREVIEW_DAILY_LIMIT, monthlyLimit: PREVIEW_MONTHLY_LIMIT };

// JSON with object keys sorted, so the same settings always hash the same.
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function previewCacheKey(parts: {
  mode: AudioMode;
  excerpt: string;
  voices: Record<string, string>;
  direction: AudioDirection;
  models: string[];
}): Promise<string> {
  const hash = await sha256Hex(stableJson({ v: PREVIEW_CACHE_VERSION, ...parts }));
  return `${PREVIEW_PREFIX}/${hash}.mp3`;
}

// The request itself is wrong (empty script, missing voice, lint code): the
// route answers 400 with the message, as POST /jobs does.
export class AudioPreviewInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioPreviewInputError";
  }
}

// Validates like a full take (quality does not exist for a preview) and cuts
// the excerpt before anything is sent to a model: only it is ever voiced.
function prepareExcerpt(input: AudioPreviewInput) {
  try {
    const prepared = prepareAudioInput({ ...input, quality: "final" });
    const excerpt = previewExcerpt(prepared.script, prepared.mode, { slow: isSlowDelivery(prepared.direction) });
    if (!excerpt) throw new Error("Script is required.");
    validateTranscriptForTts(prepared.mode, excerpt);
    return { prepared, excerpt };
  } catch (error) {
    throw new AudioPreviewInputError(error instanceof Error ? error.message : "Invalid preview request.");
  }
}

export async function createAudioPreview(
  env: Env,
  input: AudioPreviewInput,
  provider: AudioGenerationProvider = DEFAULT_PROVIDER
): Promise<AudioPreviewResult> {
  const { prepared, excerpt } = prepareExcerpt(input);

  const chain = ttsModelChain(env, prepared.direction, prepared.mode);
  if (chain.length === 0) throw new Error("No text-to-speech API key is configured.");
  const key = await previewCacheKey({
    mode: prepared.mode,
    excerpt,
    voices: prepared.voices,
    direction: prepared.direction,
    models: chain.map((step) => step.model),
  });

  const cached = await env.MEDIA.get(key);
  if (cached) {
    await logTtsUsage(env.DB, {
      userId: input.userId,
      kind: "preview",
      status: "ok",
      model: cached.customMetadata?.model ?? null,
      audioSeconds: Number(cached.customMetadata?.seconds ?? 0),
      charsSent: 0,
      cacheHit: true,
    });
    const usage = await previewUsage(env.DB, input.userId);
    return { ok: true, mp3: await cached.arrayBuffer(), cached: true, excerpt, ...usage, ...LIMITS_INFO };
  }

  const reservation = await reservePreview(env.DB, input.userId, excerpt.length, {
    daily: PREVIEW_DAILY_LIMIT,
    monthly: PREVIEW_MONTHLY_LIMIT,
  });
  if (!reservation.ok) {
    return { ok: false, code: reservation.reason, ...reservation.usage, ...LIMITS_INFO };
  }

  try {
    const direction = await briefedDirection(env, prepared.direction, prepared.mode, provider);
    const result = await voiceWithModelChain(provider, {
      chain,
      script: excerpt,
      direction,
      mode: prepared.mode,
      voices: prepared.voices,
      backoffMs: PREVIEW_BACKOFF_MS,
      logContext: { preview: true, userId: input.userId },
      // The reservation row records the request that succeeds; each model
      // that failed on the way gets its own failed row.
      onAttempt: async (model, outcome) => {
        if (outcome.ok) return;
        await logTtsUsage(env.DB, {
          userId: input.userId,
          kind: "preview",
          status: "failed",
          model,
          audioSeconds: 0,
          charsSent: excerpt.length,
        });
      },
    });
    const mp3 = mp3FromPcm(result.pcm);
    await env.MEDIA.put(key, mp3, {
      httpMetadata: { contentType: "audio/mpeg" },
      customMetadata: { model: result.model, seconds: result.durationSeconds.toFixed(2) },
    });
    await completePreview(env.DB, reservation.id, result.model, result.durationSeconds);
    const buffer = mp3.buffer.slice(mp3.byteOffset, mp3.byteOffset + mp3.byteLength) as ArrayBuffer;
    return { ok: true, mp3: buffer, cached: false, excerpt, ...reservation.usage, ...LIMITS_INFO };
  } catch (error) {
    await releasePreview(env.DB, reservation.id);
    throw error;
  }
}
