import { nanoid } from "nanoid";
import type { Env } from "../env";
import {
  getTtsModelConfig,
  modelChainForMode,
  priceForModel,
  audioCostUsd,
  type AudioDirection,
  type AudioMode,
  type AudioQuality,
} from "./audio-config";
import { compileDirection } from "./audio-direction";
import { lintAudioScript } from "../../src/lib/audio-script-rules";
import { concatPcmWithSilence, durationFromPcmBytes, mp3FromPcm, peaksFromPcm, wavFromPcm } from "./audio-assembly";
import {
  attachWaveform,
  rowToAudioJob,
  type AudioJobResponse,
  type AudioJobRow,
  type AudioSegmentRow,
  type CreateAudioJobInput,
} from "./audio-job-response";
import { estimateAudioSeconds, normalizeSpeakerDirections, normalizeSpeakerLabels, normalizeVoiceMap, splitScriptIntoBlocks } from "./audio-script";
import { chargeAudioQuota, precheckAudioQuota } from "./audio-quota";
import { generateBlock, TtsProviderError, type GenerateBlockInput, type GenerateBlockResult } from "./tts-provider";

export type { CreateAudioJobInput } from "./audio-job-response";

export interface AudioGenerationProvider {
  generateBlock(input: GenerateBlockInput): Promise<GenerateBlockResult>;
}

const DEFAULT_PROVIDER: AudioGenerationProvider = { generateBlock };
const DOWNLOAD_FILES = ["final.mp3", "final.wav", "transcript.txt"] as const;
export type AudioDownloadFile = (typeof DOWNLOAD_FILES)[number];

function nowSql(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function expiresAtIso(): string {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

function r2Prefix(jobId: string): string {
  return `audio/${jobId}`;
}

function isMode(value: unknown): value is AudioMode {
  return value === "monologue" || value === "dialogue";
}

function isQuality(value: unknown): value is AudioQuality {
  return value === "draft" || value === "final";
}

export function isAudioDownloadFile(value: string): value is AudioDownloadFile {
  return DOWNLOAD_FILES.includes(value as AudioDownloadFile);
}

function speakerLabels(script: string): string[] {
  const labels = new Set<string>();
  for (const match of script.matchAll(/^(Speaker|Locuteur)\s+(\d+)\s*:/gim)) {
    labels.add(`Speaker ${match[2]}`);
  }
  return [...labels];
}

function validateCreateInput(input: CreateAudioJobInput): string | null {
  if (!isMode(input.mode)) return "Invalid audio mode.";
  if (!isQuality(input.quality)) return "Invalid audio quality.";
  if (!input.script.trim()) return "Script is required.";

  const labels = input.mode === "dialogue" ? speakerLabels(input.script) : [];
  if (labels.length > 2) return "2 speakers maximum in this version";

  if (input.mode === "monologue") {
    if (!input.voices.solo && Object.keys(input.voices).length !== 1) {
      return "A monologue requires exactly one voice.";
    }
  } else {
    const speakers = labels.length > 0 ? labels : ["Speaker 1", "Speaker 2"];
    for (const speaker of speakers) {
      if (!input.voices[speaker]) return `Missing voice for ${speaker}.`;
    }
  }

  return null;
}

async function getJobRow(db: D1Database, jobId: string): Promise<AudioJobRow | null> {
  return db.prepare("SELECT * FROM audio_jobs WHERE id = ?")
    .bind(jobId)
    .first<AudioJobRow>();
}

async function getSegments(db: D1Database, jobId: string): Promise<AudioSegmentRow[]> {
  const { results } = await db.prepare(
    "SELECT * FROM audio_segments WHERE job_id = ? ORDER BY idx"
  )
    .bind(jobId)
    .all<AudioSegmentRow>();
  return results ?? [];
}

async function markJobFailed(db: D1Database, jobId: string, error: string): Promise<void> {
  await db.prepare(
    `UPDATE audio_jobs
     SET status = 'failed',
         error = ?,
         gen_ms = COALESCE(gen_ms, 0),
         retry_count = (
           SELECT COALESCE(SUM(retry_count), 0) FROM audio_segments WHERE job_id = ?
         )
     WHERE id = ?`
  )
    .bind(error, jobId, jobId)
    .run();
}

export async function createAudioJob(env: Env, input: CreateAudioJobInput): Promise<AudioJobResponse> {
  const normalizedInput: CreateAudioJobInput = {
    ...input,
    script: normalizeSpeakerLabels(input.script),
    voices: normalizeVoiceMap(input.voices),
    direction: normalizeSpeakerDirections(input.direction, input.mode),
  };
  const validationError = validateCreateInput(normalizedInput);
  if (validationError) {
    throw new Error(validationError);
  }
  const blockingFindings = lintAudioScript(normalizedInput.script, normalizedInput.mode)
    .filter((finding) => finding.severity === "blocking");
  if (blockingFindings.length > 0) {
    throw new Error(blockingFindings[0].message);
  }

  const estimatedSeconds = estimateAudioSeconds(normalizedInput.script);
  const precheck = await precheckAudioQuota(env, normalizedInput.userId, estimatedSeconds);
  if (!precheck.ok) {
    throw new Error("audio_quota_exceeded");
  }

  const id = nanoid();
  const now = nowSql();
  const prefix = r2Prefix(id);
  const segments = splitScriptIntoBlocks(normalizedInput.script, normalizedInput.mode);

  const statements = [
    env.DB.prepare(
      `INSERT INTO audio_jobs (
        id,
        user_id,
        mode,
        quality,
        script_raw,
        direction_json,
        voices_json,
        status,
        estimated_seconds,
        r2_prefix,
        expires_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`
    ).bind(
      id,
      normalizedInput.userId,
      normalizedInput.mode,
      normalizedInput.quality,
      normalizedInput.script.trim(),
      JSON.stringify(normalizedInput.direction),
      JSON.stringify(normalizedInput.voices),
      estimatedSeconds,
      prefix,
      expiresAtIso(),
      now
    ),
    ...segments.map((segment) => env.DB.prepare(
      `INSERT INTO audio_segments (job_id, idx, text)
       VALUES (?, ?, ?)`
    ).bind(id, segment.idx, segment.text)),
  ];

  await env.DB.batch(statements);
  const row = await getJobRow(env.DB, id);
  if (!row) throw new Error("Audio job was not persisted.");
  return rowToAudioJob(row, await getSegments(env.DB, id));
}

export async function enqueueAudioJob(
  env: Env,
  jobId: string,
  segmentIdx?: number,
  action: "generate" | "assemble" = "generate"
): Promise<void> {
  await env.AUDIO_GENERATION_QUEUE.send({ jobId, segmentIdx, action }, { contentType: "json" });
}

export async function getAudioJobForUser(
  env: Env,
  jobId: string,
  userId: string
): Promise<AudioJobResponse | null> {
  const row = await env.DB.prepare("SELECT * FROM audio_jobs WHERE id = ? AND user_id = ?")
    .bind(jobId, userId)
    .first<AudioJobRow>();
  if (!row) return null;
  const segments = await getSegments(env.DB, jobId);
  const job = rowToAudioJob(row, segments);
  await attachWaveform(env, row, job, segments);
  return job;
}

export async function listAudioJobsForUser(
  db: D1Database,
  userId: string,
  limit: number,
  offset: number
): Promise<AudioJobResponse[]> {
  const { results } = await db.prepare(
    `SELECT * FROM audio_jobs
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  )
    .bind(userId, limit, offset)
    .all<AudioJobRow>();
  return (results ?? []).map((row) => rowToAudioJob(row));
}

async function generateSegment(
  env: Env,
  row: AudioJobRow,
  segment: AudioSegmentRow,
  provider: AudioGenerationProvider
): Promise<void> {
  if (segment.status === "ok") return;
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured.");

  const config = getTtsModelConfig(env);
  const chain = modelChainForMode(config, row.mode);
  const direction = JSON.parse(row.direction_json) as AudioDirection;
  const voices = JSON.parse(row.voices_json) as Record<string, string>;
  const speakers = row.mode === "dialogue" ? Object.keys(voices) : ["solo"];
  const prompt = compileDirection({
    direction,
    mode: row.mode,
    speakers,
    script: segment.text,
  });

  let lastError: unknown;
  for (let i = 0; i < chain.length; i += 1) {
    const isLast = i === chain.length - 1;
    try {
      const result = await provider.generateBlock({
        apiKey: env.GEMINI_API_KEY,
        model: chain[i].model,
        prompt,
        mode: row.mode,
        voices,
        // Non-final models fail fast on a rate/quota 429 so we switch to the
        // next model immediately; the final model keeps its normal backoff.
        fastFailStatuses: isLast ? undefined : [429],
      });
      const key = `${row.r2_prefix ?? r2Prefix(row.id)}/seg-${segment.idx}.pcm`;
      await env.MEDIA.put(key, result.pcm, {
        httpMetadata: { contentType: "audio/L16" },
      });
      await env.DB.prepare(
        `UPDATE audio_segments
         SET status = 'ok',
             duration_seconds = ?,
             retry_count = ?,
             last_error_status = ?,
             model_used = ?,
             r2_key = ?
         WHERE job_id = ? AND idx = ?`
      )
        .bind(result.durationSeconds, result.retryCount, result.lastErrorStatus ?? null, result.model, key, row.id, segment.idx)
        .run();
      return;
    } catch (error) {
      lastError = error;
      const is429 = error instanceof TtsProviderError && error.status === 429;
      if (is429 && !isLast) continue;
      throw error;
    }
  }
  throw lastError;
}

async function assembleFinal(env: Env, row: AudioJobRow, regeneratedSegmentIdx?: number): Promise<void> {
  const segments = await getSegments(env.DB, row.id);
  if (segments.some((segment) => segment.status !== "ok" || !segment.r2_key)) {
    return;
  }

  await env.DB.prepare("UPDATE audio_jobs SET status = 'assembling' WHERE id = ?")
    .bind(row.id)
    .run();

  const pcmBlocks: Uint8Array[] = [];
  for (const segment of segments) {
    const object = await env.MEDIA.get(segment.r2_key as string);
    if (!object) throw new Error(`Missing generated audio block ${segment.idx}.`);
    pcmBlocks.push(new Uint8Array(await object.arrayBuffer()));
  }

  const pcm = concatPcmWithSilence(pcmBlocks);
  const wav = wavFromPcm(pcm);
  const mp3 = mp3FromPcm(pcm);
  const peaks = peaksFromPcm(pcm);
  const actualSeconds = durationFromPcmBytes(pcm.byteLength);
  const chargeSeconds = regeneratedSegmentIdx === undefined
    ? actualSeconds
    : segments.find((segment) => segment.idx === regeneratedSegmentIdx)?.duration_seconds ?? actualSeconds;
  const retryCount = segments.reduce((sum, segment) => sum + segment.retry_count, 0);
  const config = getTtsModelConfig(env);
  // Cost is summed per segment using each segment's actual model — a job may mix
  // Pro ($20/1M) and Flash ($10/1M) blocks when the fallback chain kicked in.
  // Silence inserted between blocks isn't billed, so we sum segment durations
  // rather than the concatenated total.
  const primaryModel = modelChainForMode(config, row.mode)[0].model;
  const apiCostUsd = segments.reduce((sum, segment) => {
    const segModel = segment.model_used ?? primaryModel;
    return sum + audioCostUsd(segment.duration_seconds ?? 0, priceForModel(config, segModel));
  }, 0);
  const model = segments.find((segment) => segment.model_used)?.model_used ?? primaryModel;
  const prefix = row.r2_prefix ?? r2Prefix(row.id);

  await Promise.all([
    env.MEDIA.put(`${prefix}/final.wav`, wav, { httpMetadata: { contentType: "audio/wav" } }),
    env.MEDIA.put(`${prefix}/final.mp3`, mp3, { httpMetadata: { contentType: "audio/mpeg" } }),
    env.MEDIA.put(`${prefix}/peaks.json`, JSON.stringify({ peaks }), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
    }),
    env.MEDIA.put(`${prefix}/transcript.txt`, row.script_raw, {
      httpMetadata: { contentType: "text/plain; charset=utf-8" },
    }),
  ]);

  await chargeAudioQuota(
    env,
    row.user_id,
    row.id,
    chargeSeconds,
    regeneratedSegmentIdx === undefined ? "generation" : "regeneration"
  );
  await env.DB.prepare(
    `UPDATE audio_jobs
     SET status = 'ready',
         actual_seconds = ?,
         error = NULL,
         model_used = ?,
         retry_count = ?,
         api_cost_usd = ?,
         expires_at = COALESCE(expires_at, ?)
     WHERE id = ?`
  )
    .bind(Math.ceil(actualSeconds), model, retryCount, apiCostUsd, expiresAtIso(), row.id)
    .run();
}

export async function processAudioJob(
  env: Env,
  jobId: string,
  provider: AudioGenerationProvider = DEFAULT_PROVIDER,
  regeneratedSegmentIdx?: number
): Promise<void> {
  const row = await getJobRow(env.DB, jobId);
  if (!row || row.status === "ready" || row.status === "failed") return;

  const startedAt = Date.now();
  await env.DB.prepare("UPDATE audio_jobs SET status = 'generating', error = NULL WHERE id = ?")
    .bind(jobId)
    .run();

  try {
    const segments = await getSegments(env.DB, jobId);
    for (const segment of segments) {
      try {
        await generateSegment(env, row, segment, provider);
      } catch (error) {
        const status = error instanceof TtsProviderError ? error.status ?? null : null;
        await env.DB.prepare(
          "UPDATE audio_segments SET status = 'failed', last_error_status = ? WHERE job_id = ? AND idx = ?"
        )
          .bind(status, jobId, segment.idx)
          .run();
        throw error;
      }
    }
    await env.DB.prepare("UPDATE audio_jobs SET status = 'assembling', gen_ms = ? WHERE id = ?")
      .bind(Date.now() - startedAt, jobId)
      .run();
    await enqueueAudioJob(env, jobId, regeneratedSegmentIdx, "assemble");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Audio generation failed.";
    await markJobFailed(env.DB, jobId, message);
  }
}

export async function assembleAudioJob(
  env: Env,
  jobId: string,
  regeneratedSegmentIdx?: number
): Promise<void> {
  const row = await getJobRow(env.DB, jobId);
  if (!row || row.status === "ready" || row.status === "failed") return;

  const startedAt = Date.now();
  try {
    await assembleFinal(env, row, regeneratedSegmentIdx);
    const current = await getJobRow(env.DB, jobId);
    if (!current || current.status !== "ready") return;
    await env.DB.prepare("UPDATE audio_jobs SET gen_ms = COALESCE(gen_ms, 0) + ? WHERE id = ?")
      .bind(Date.now() - startedAt, jobId)
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Audio assembly failed.";
    await markJobFailed(env.DB, jobId, message);
  }
}

export async function regenerateAudioSegment(
  env: Env,
  jobId: string,
  userId: string,
  segmentIdx: number
): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT id FROM audio_jobs WHERE id = ? AND user_id = ?"
  )
    .bind(jobId, userId)
    .first<{ id: string }>();
  if (!row) return false;

  await env.DB.prepare(
    `UPDATE audio_segments
     SET status = 'pending',
         duration_seconds = NULL,
         retry_count = 0,
         last_error_status = NULL,
         model_used = NULL,
         r2_key = NULL
     WHERE job_id = ? AND idx = ?`
  )
    .bind(jobId, segmentIdx)
    .run();
  await env.DB.prepare("UPDATE audio_jobs SET status = 'queued', error = NULL WHERE id = ?")
    .bind(jobId)
    .run();
  await enqueueAudioJob(env, jobId, segmentIdx);
  return true;
}

// Rename a take. Empty/whitespace title clears back to NULL (the UI then
// falls back to the derived script excerpt). Returns the stored value,
// or undefined when the job does not belong to the user.
export async function renameAudioJobForUser(
  env: Env,
  jobId: string,
  userId: string,
  title: string
): Promise<{ title: string | null } | undefined> {
  const trimmed = title.trim().slice(0, 120);
  const stored = trimmed.length > 0 ? trimmed : null;
  const result = await env.DB.prepare(
    "UPDATE audio_jobs SET title = ? WHERE id = ? AND user_id = ?"
  )
    .bind(stored, jobId, userId)
    .run();
  if ((result.meta.changes ?? 0) === 0) return undefined;
  return { title: stored };
}

// Permanently delete a take: every R2 object under its prefix (final files
// AND raw segment PCMs), then the DB row. audio_segments cascade with the
// row; quota_ledger rows survive with job_id set to NULL — deleting audio
// is storage cleanup, never a quota refund.
export async function deleteAudioJobForUser(
  env: Env,
  jobId: string,
  userId: string
): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT r2_prefix FROM audio_jobs WHERE id = ? AND user_id = ?"
  )
    .bind(jobId, userId)
    .first<{ r2_prefix: string | null }>();
  if (!row) return false;

  const prefix = `${row.r2_prefix ?? r2Prefix(jobId)}/`;
  let cursor: string | undefined;
  do {
    const listed = await env.MEDIA.list({ prefix, cursor });
    if (listed.objects.length > 0) {
      await env.MEDIA.delete(listed.objects.map((object) => object.key));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  await env.DB.prepare("DELETE FROM audio_jobs WHERE id = ? AND user_id = ?")
    .bind(jobId, userId)
    .run();
  return true;
}

export async function getAudioDownloadObject(
  env: Env,
  jobId: string,
  userId: string,
  file: AudioDownloadFile
): Promise<R2ObjectBody | null> {
  const row = await env.DB.prepare(
    "SELECT r2_prefix, status FROM audio_jobs WHERE id = ? AND user_id = ?"
  )
    .bind(jobId, userId)
    .first<{ r2_prefix: string | null; status: string }>();
  if (!row || row.status !== "ready") return null;
  return env.MEDIA.get(`${row.r2_prefix ?? r2Prefix(jobId)}/${file}`);
}

export async function handleAudioJobBatch(
  batch: MessageBatch<{ jobId: string; segmentIdx?: number; action?: "generate" | "assemble" }>,
  env: Env
): Promise<void> {
  for (const message of batch.messages) {
    try {
      if (message.body.action === "assemble") {
        await assembleAudioJob(env, message.body.jobId, message.body.segmentIdx);
      } else {
        await processAudioJob(env, message.body.jobId, DEFAULT_PROVIDER, message.body.segmentIdx);
      }
      message.ack();
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Audio job processing failed.";
      console.error("Audio job consumer failure", {
        jobId: message.body.jobId,
        attempts: message.attempts,
        error: messageText,
      });

      if (message.attempts < 3) {
        message.retry({ delaySeconds: Math.min(30, message.attempts * 5) });
        continue;
      }

      await markJobFailed(env.DB, message.body.jobId, "Background audio processing failed. Please try again.");
      message.ack();
    }
  }
}
