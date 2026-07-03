import type { Env } from "../env";
import type { AudioDirection, AudioMode, AudioQuality } from "./audio-config";

export type AudioJobStatus = "queued" | "generating" | "assembling" | "ready" | "failed";

export interface CreateAudioJobInput {
  userId: string;
  mode: AudioMode;
  quality: AudioQuality;
  script: string;
  direction: AudioDirection;
  voices: Record<string, string>;
}

export interface AudioJobRow {
  id: string;
  user_id: string;
  mode: AudioMode;
  quality: AudioQuality;
  script_raw: string;
  direction_json: string;
  voices_json: string;
  status: AudioJobStatus;
  estimated_seconds: number;
  actual_seconds: number | null;
  error: string | null;
  model_used: string | null;
  gen_ms: number | null;
  retry_count: number;
  api_cost_usd: number | null;
  r2_prefix: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface AudioSegmentRow {
  job_id: string;
  idx: number;
  text: string;
  status: "pending" | "ok" | "failed";
  duration_seconds: number | null;
  retry_count: number;
  last_error_status: number | null;
  model_used: string | null;
  r2_key: string | null;
}

export interface AudioJobResponse {
  id: string;
  mode: AudioMode;
  quality: AudioQuality;
  script: string;
  direction: AudioDirection;
  voices: Record<string, string>;
  status: AudioJobStatus;
  estimatedSeconds: number;
  actualSeconds: number | null;
  error: string | null;
  modelUsed: string | null;
  genMs: number | null;
  retryCount: number;
  apiCostUsd: number | null;
  expiresAt: string | null;
  createdAt: string;
  segments?: AudioSegmentResponse[];
  waveform?: AudioWaveformResponse;
  downloads?: {
    mp3: string;
    wav: string;
    transcript: string;
  };
}

export interface AudioSegmentResponse {
  idx: number;
  text: string;
  status: string;
  durationSeconds: number | null;
  retryCount: number;
}

export interface AudioWaveformResponse {
  peaks: number[];
  blocks: AudioBlockBoundary[];
}

export interface AudioBlockBoundary {
  idx: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
}

function r2Prefix(jobId: string): string {
  return `audio/${jobId}`;
}

export function rowToAudioJob(row: AudioJobRow, segments?: AudioSegmentRow[]): AudioJobResponse {
  const job: AudioJobResponse = {
    id: row.id,
    mode: row.mode,
    quality: row.quality,
    script: row.script_raw,
    direction: JSON.parse(row.direction_json) as AudioDirection,
    voices: JSON.parse(row.voices_json) as Record<string, string>,
    status: row.status,
    estimatedSeconds: row.estimated_seconds,
    actualSeconds: row.actual_seconds,
    error: row.error,
    modelUsed: row.model_used,
    genMs: row.gen_ms,
    retryCount: row.retry_count,
    apiCostUsd: row.api_cost_usd,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };

  if (segments) {
    job.segments = segments.map((segment) => ({
      idx: segment.idx,
      text: segment.text,
      status: segment.status,
      durationSeconds: segment.duration_seconds,
      retryCount: segment.retry_count,
    }));
  }

  if (row.status === "ready") {
    job.downloads = {
      mp3: `/api/audio/jobs/${row.id}/download/final.mp3`,
      wav: `/api/audio/jobs/${row.id}/download/final.wav`,
      transcript: `/api/audio/jobs/${row.id}/download/transcript.txt`,
    };
  }

  return job;
}

function blockBoundaries(segments: AudioSegmentRow[]): AudioBlockBoundary[] {
  let cursor = 0;
  return segments.map((segment, index) => {
    const durationSeconds = segment.duration_seconds ?? 0;
    const startSeconds = cursor;
    const endSeconds = startSeconds + durationSeconds;
    cursor = endSeconds + (index < segments.length - 1 ? 0.4 : 0);
    return {
      idx: segment.idx,
      startSeconds: Number(startSeconds.toFixed(3)),
      endSeconds: Number(endSeconds.toFixed(3)),
      durationSeconds: Number(durationSeconds.toFixed(3)),
    };
  });
}

export async function attachWaveform(
  env: Env,
  row: AudioJobRow,
  job: AudioJobResponse,
  segments: AudioSegmentRow[]
) {
  if (row.status !== "ready") return;
  const object = await env.MEDIA.get(`${row.r2_prefix ?? r2Prefix(row.id)}/peaks.json`);
  if (!object) return;
  const parsed = await object.json<{ peaks?: unknown }>().catch(() => null);
  if (!parsed || !Array.isArray(parsed.peaks)) return;
  job.waveform = {
    peaks: parsed.peaks.filter((peak): peak is number => typeof peak === "number"),
    blocks: blockBoundaries(segments),
  };
}
