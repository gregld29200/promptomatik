// YouTube ingest — the Worker side of the yt-dlp sidecar.
//
// A Worker cannot extract YouTube audio itself: the signed, throttled,
// adaptive-manifest flow needs yt-dlp, a Python program that changes with
// YouTube roughly monthly. So extraction lives in a small HTTP service
// (containers/youtube-ingest/ — deployable to Fly.io with a remote build, or
// any Docker host) and this module is the ONLY caller. The service is joined
// by URL + shared secret rather than a platform-specific binding on purpose:
// where it runs is an ops decision, not an architecture one.
//
// Flow, and why each step is where it is:
//   1. POST {url, maxDurationSeconds} to <YOUTUBE_INGEST_URL>/extract.
//   2. The service probes METADATA FIRST and refuses an over-cap video with
//      413 before downloading a byte — a 4-hour stream costs one metadata
//      call, not a 4-hour download.
//   3. On 200 it streams back 16 kHz mono Opus (~13 MB/hour, so a 90-minute
//      cap sits well inside both our 64 MB ceiling and Groq's free-tier 25 MB)
//      with the duration and title in headers.
//   4. We stream that body straight into R2 via FixedLengthStream — the audio
//      never sits whole in Worker memory — then hand the stored object to the
//      normal provider cascade. A YouTube job is an ordinary job whose
//      resolveSource took a detour: quota, the 90-minute cap re-check,
//      diarization via Deepgram, retention and deletion all apply unchanged.
//
// The R2 key is persisted as `source_r2_key` (processTranscriptionJob writes
// it back after resolve), so the nightly retention sweep and per-job deletion
// remove the extracted audio exactly as they remove an upload.

import { nanoid } from "nanoid";
import type { Env } from "../env";
import {
  TRANSCRIPTION_MAX_SOURCE_SECONDS,
  TranscriptionError,
  type ResolvedSource,
} from "./transcription/types";

/**
 * Wall-clock budget for one extraction, matching the sidecar's own 10-minute
 * ceiling minus headroom for the R2 write. The queue consumer can afford this:
 * batches are size 1 and the limit is CPU time, not wall time.
 */
export const YOUTUBE_EXTRACT_TIMEOUT_MS = 9 * 60_000;

/**
 * Both halves must be present: a URL without its secret would make an
 * unauthenticated call the sidecar rejects, so treat half-configured as
 * unconfigured and keep the honest "not available right now" message.
 */
export function youtubeIngestConfigured(env: Env): boolean {
  return Boolean(env.YOUTUBE_INGEST_URL?.trim() && env.YOUTUBE_INGEST_SECRET?.trim());
}

interface ExtractRejection {
  code?: string;
  durationSeconds?: number;
}

/** UTF-8 title travels base64-encoded: HTTP headers are latin-1 territory. */
function decodeTitleHeader(value: string | null): string | null {
  if (!value) return null;
  try {
    const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
    const title = new TextDecoder("utf-8").decode(bytes).trim();
    return title.length > 0 ? title : null;
  } catch {
    return null;
  }
}

/** Keep R2 metadata and download filenames boring: ASCII, short, never empty. */
function safeFilename(title: string | null): string {
  const stem = (title ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .slice(0, 64);
  return `${stem || "youtube-audio"}.ogg`;
}

function failureForStatus(status: number, rejection: ExtractRejection): TranscriptionError {
  // 413 is the sidecar's metadata-first duration refusal. It reuses
  // `source_too_long` deliberately: the teacher-facing sentence (and its
  // link-specific variant) already exists in three languages, and the row's
  // `source_kind = 'youtube'` keeps the case countable without a bespoke code.
  if (status === 413) {
    return new TranscriptionError({
      code: "source_too_long",
      durationSeconds: Math.ceil(Math.max(0, rejection.durationSeconds ?? 0)),
      maxSeconds: TRANSCRIPTION_MAX_SOURCE_SECONDS,
    });
  }
  // The video itself cannot be served: private, deleted, geo-blocked,
  // age-gated, members-only. Only a different link will ever work.
  if (status === 404) {
    return new TranscriptionError({ code: "youtube_unavailable", status });
  }
  // A playlist or channel URL — one URL, one video is the sidecar's contract.
  if (status === 422) {
    return new TranscriptionError({ code: "unsupported_source", detail: "youtube_playlist" });
  }
  // 403/429: YouTube refused US (bot check, datacenter IP) — the §5.1 reality.
  // Everything else (including the sidecar's own 5xx and a wrong shared
  // secret's 401) is our infrastructure misbehaving. Both are retryable and
  // neither is the teacher's fault, so both map to the retryable code.
  return new TranscriptionError({ code: "youtube_blocked", status });
}

/** One short request. The sidecar answers these in milliseconds. */
const CONTROL_TIMEOUT_MS = 30_000;
/** The audio download from the sidecar — already extracted, just transfer. */
const FILE_TIMEOUT_MS = 240_000;
/** Poll cadence. Each poll is also what keeps the scale-to-zero machine alive. */
const POLL_INTERVAL_MS = 6_000;

export interface ResolveYouTubeOptions {
  /** Test seams — production always uses the defaults. */
  pollIntervalMs?: number;
  timeoutMs?: number;
}

/**
 * Extract a YouTube video's audio into R2 and return it as an ordinary
 * bytes-source. Throws `TranscriptionError` only — never a bare string.
 *
 * SUBMIT → POLL → FETCH, not one long call. The first version held a single
 * HTTP response open for the whole extraction and died in production: Fly's
 * edge kills a connection that moves no bytes for ~60 s, then auto-stops the
 * "idle" machine mid-download (measured: a 42 MiB extraction killed at 85%).
 * Polling makes every request short, and doubles as the machine's keep-alive.
 */
export async function resolveYouTube(
  env: Env,
  url: string,
  fetcher: typeof fetch = fetch,
  options: ResolveYouTubeOptions = {}
): Promise<ResolvedSource> {
  if (!youtubeIngestConfigured(env)) {
    // The classify step said "supported" because the capability exists; this
    // deployment just does not have the sidecar wired. Same honest message the
    // route returns when it can refuse earlier.
    throw new TranscriptionError({ code: "youtube_not_yet_supported", url });
  }

  const base = env.YOUTUBE_INGEST_URL!.trim().replace(/\/+$/, "");
  const headers = {
    Authorization: `Bearer ${env.YOUTUBE_INGEST_SECRET!.trim()}`,
    "Content-Type": "application/json",
  };
  const pollMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const deadline = Date.now() + (options.timeoutMs ?? YOUTUBE_EXTRACT_TIMEOUT_MS);

  // ---- 1. Submit. Answers in milliseconds with a task id.
  let submitted: Response;
  try {
    submitted = await fetcher(`${base}/extract`, {
      method: "POST",
      headers,
      body: JSON.stringify({ url, maxDurationSeconds: TRANSCRIPTION_MAX_SOURCE_SECONDS }),
      signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
    });
  } catch {
    // Timeout, DNS, connection reset: our infrastructure, transient, retryable.
    throw new TranscriptionError({ code: "youtube_blocked" });
  }
  if (!submitted.ok) {
    let rejection: ExtractRejection = {};
    try {
      rejection = (await submitted.json()) as ExtractRejection;
    } catch {
      // A body-less error page. The status alone decides.
    }
    throw failureForStatus(submitted.status, rejection);
  }
  const { taskId } = (await submitted.json()) as { taskId?: string };
  if (!taskId) {
    throw new TranscriptionError({ code: "youtube_blocked" });
  }

  // ---- 2. Poll until terminal. A single flaky poll is tolerated — only the
  // deadline or a terminal answer ends the loop.
  interface StatusBody extends ExtractRejection {
    status?: string;
    status_code?: number;
  }
  for (;;) {
    if (Date.now() >= deadline) {
      throw new TranscriptionError({ code: "youtube_blocked" });
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));

    let poll: Response;
    try {
      poll = await fetcher(`${base}/extract/${taskId}`, {
        headers,
        signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
      });
    } catch {
      continue; // transient; the deadline is the real limit
    }
    if (poll.status === 404) {
      // The machine restarted and lost the task. Retrying the whole job is the
      // only honest recovery, so: retryable.
      throw new TranscriptionError({ code: "youtube_blocked" });
    }
    if (!poll.ok) {
      throw failureForStatus(poll.status, {});
    }
    const body = (await poll.json()) as StatusBody;
    if (body.status === "working") continue;
    if (body.status === "failed") {
      throw failureForStatus(body.status_code ?? 502, body);
    }
    if (body.status === "ready") break;
    throw new TranscriptionError({ code: "youtube_blocked" });
  }

  // ---- 3. Fetch the finished audio. Bytes flow immediately, so the idle
  // timeout that killed v1 does not apply here.
  let response: Response;
  try {
    response = await fetcher(`${base}/extract/${taskId}/file`, {
      headers,
      signal: AbortSignal.timeout(FILE_TIMEOUT_MS),
    });
  } catch {
    throw new TranscriptionError({ code: "youtube_blocked" });
  }
  if (!response.ok) {
    throw failureForStatus(response.status === 404 ? 500 : response.status, {});
  }

  const length = Number(response.headers.get("content-length"));
  const durationSeconds = Number(response.headers.get("x-duration-seconds"));
  if (!response.body || !Number.isFinite(length) || length <= 0) {
    // The contract says a 200 carries sized audio. A 200 without it is a
    // sidecar bug — retryable, and loud in the logs rather than a mystery row.
    throw new TranscriptionError({ code: "youtube_blocked" });
  }

  const title = decodeTitleHeader(response.headers.get("x-title-b64"));
  const contentType = response.headers.get("content-type")?.split(";")[0].trim() || "audio/ogg";

  // Stream to R2 without ever holding the whole file: R2 needs a known length
  // for streamed puts, which is exactly what FixedLengthStream provides.
  const r2Key = `transcription/youtube/${nanoid()}/audio.ogg`;
  const { readable, writable } = new FixedLengthStream(length);
  const put = env.MEDIA.put(r2Key, readable, {
    httpMetadata: { contentType },
  });
  await response.body.pipeTo(writable);
  await put;

  const object = await env.MEDIA.get(r2Key);
  if (!object) {
    throw new TranscriptionError({ code: "internal", detail: "youtube_media_missing" });
  }

  return {
    kind: "youtube",
    audio: {
      kind: "bytes",
      blob: await object.blob(),
      sizeBytes: length,
      contentType,
      filename: safeFilename(title),
    },
    durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0
      ? Math.ceil(durationSeconds)
      : null,
    contentType,
    bytes: length,
    title,
    resolvedUrl: url,
    r2Key,
  };
}
