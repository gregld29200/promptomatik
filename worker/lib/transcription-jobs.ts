// Transcription Studio — async job lifecycle.
//
// Same shape as audio-jobs / document-jobs: create the row -> enqueue -> the
// consumer resolves the source, runs the provider, stores the normalised
// transcript, charges the transcription allowance -> the frontend polls.
//
// Single-phase on purpose: unlike audio generation there is nothing to assemble
// afterwards, so one queue message carries a job from 'queued' to a terminal
// status. Wall-clock is spent awaiting the provider, not burning CPU.

import { nanoid } from "nanoid";
import { youtubeIngestConfigured } from "./transcription-youtube";
import type { Env } from "../env";
import {
  isTranscriptionProviderConfigured,
  runTranscription,
  selectTranscriptionProvider,
} from "./transcription/index";
import {
  GROQ_BREAKER_MAX_SECONDS,
  isGroqBreakerOpen,
} from "./transcription-budget";
import {
  TRANSCRIPTION_MAX_SOURCE_SECONDS,
  TranscriptionError,
  httpStatusForFailure,
  parseStoredFailure,
  publicTranscriptionFailure,
  toTranscriptionFailure,
  type NormalisedTranscript,
  type ResolvedSource,
  type TranscriptionAttempt,
  type TranscriptionFailure,
  type TranscriptionProviderId,
  type TranscriptionRouteReason,
  type TranscriptionSourceKind,
  type TranscriptionSourceRef,
} from "./transcription/types";
import { resolveSource } from "./transcription-ingest";
import { isTranscriptExpired, transcriptionExpiresAtIso } from "./transcription-retention";
import {
  TRANSCRIPTION_STALE_JOB_MINUTES,
  buildTranscriptionAdmissionGate,
  chargeTranscriptionQuota,
  precheckTranscriptionQuota,
} from "./transcription-quota";

export { httpStatusForFailure };

export type TranscriptionJobStatus =
  | "queued"
  | "resolving"
  | "transcribing"
  | "completed"
  | "failed";

/** Exactly the columns of `transcription_jobs`, snake_case, 1:1. */
export interface TranscriptionJobRow {
  id: string;
  user_id: string;
  status: TranscriptionJobStatus;
  source_kind: TranscriptionSourceKind;
  source_url: string | null;
  resolved_url: string | null;
  source_r2_key: string | null;
  source_content_type: string | null;
  source_bytes: number | null;
  title: string | null;
  requested_provider: TranscriptionProviderId | null;
  diarize_requested: number;
  provider: TranscriptionProviderId | null;
  provider_model: string | null;
  provider_job_id: string | null;
  /** `TranscriptionRouteReason` — why the cascade landed on `provider`. */
  provider_choice_reason: TranscriptionRouteReason | null;
  diarization: number;
  detected_language: string | null;
  detected_languages: string | null;
  duration_seconds: number | null;
  billed_seconds: number | null;
  request_payload: string;
  result_payload: string | null;
  error_code: string | null;
  error_payload: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  /** Completion + 7 days, stamped once. NULL until a job completes. */
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/** What lives in `request_payload`. The immutable record of what was asked. */
export interface TranscriptionRequestPayload {
  source: TranscriptionSourceRef;
  diarize: boolean;
  languageHint: string | null;
  title: string | null;
}

export const TRANSCRIPTION_DOWNLOAD_FORMATS = ["txt", "vtt"] as const;
export type TranscriptionDownloadFormat = (typeof TRANSCRIPTION_DOWNLOAD_FORMATS)[number];

export function isTranscriptionDownloadFormat(value: string): value is TranscriptionDownloadFormat {
  return TRANSCRIPTION_DOWNLOAD_FORMATS.includes(value as TranscriptionDownloadFormat);
}

/** camelCase — what the API returns and the SPA renders. */
export interface TranscriptionJobResponse {
  id: string;
  status: TranscriptionJobStatus;
  title: string | null;
  sourceKind: TranscriptionSourceKind;
  sourceUrl: string | null;
  /** What the teacher asked for. */
  diarizeRequested: boolean;
  /** What actually ran. Null until a provider accepted the job. */
  provider: TranscriptionProviderId | null;
  providerModel: string | null;
  /**
   * Why the cascade landed on `provider`. A machine value, never rendered to a
   * teacher — it exists so a fallback off the free tier is visible in the data.
   */
  providerChoiceReason: TranscriptionRouteReason | null;
  /** True only when the stored words really carry speakers. */
  diarization: boolean;
  detectedLanguage: string | null;
  detectedLanguages: string[];
  durationSeconds: number | null;
  billedSeconds: number | null;
  transcript: NormalisedTranscript | null;
  /** Machine-readable failure. The client translates `error.code`; never render it raw. */
  error: TranscriptionFailure | null;
  createdAt: string;
  completedAt: string | null;
  /** Completion + 7 days. Null on a job that never produced a transcript. */
  expiresAt: string | null;
  /** True once the 7 days are up — the transcript and the downloads are gone. */
  expired: boolean;
  /** Worker paths, attached only in the terminal 'completed' state. */
  downloads?: Record<TranscriptionDownloadFormat, string>;
}

export interface TranscriptionJobSummary {
  id: string;
  status: TranscriptionJobStatus;
  /** Derived label, or "" when nothing could be derived — see `summaryTitle`. */
  title: string;
  sourceKind: TranscriptionSourceKind;
  provider: TranscriptionProviderId | null;
  durationSeconds: number | null;
  createdAt: string;
  /** Completion + 7 days, so the row can count down. Null when nothing was stored. */
  expiresAt: string | null;
  /** True once the 7 days are up: the row reads as expired and offers no download. */
  expired: boolean;
}

export interface CreateTranscriptionJobInput {
  userId: string;
  source: TranscriptionSourceRef;
  diarize: boolean;
  languageHint?: string | null;
  title?: string | null;
  /** Media length when the client already knows it (upload). Used for the precheck. */
  durationSeconds?: number | null;
}

/**
 * Test seam. The consumer's collaborators are injected exactly the way
 * audio-jobs injects its `AudioGenerationProvider` — so the state machine can be
 * exercised with fixture transcripts and no network.
 */
export interface TranscriptionJobDeps {
  /**
   * The FAILOVER CASCADE, not a single provider: it decides which tier to try,
   * moves on when one refuses, and reports which one actually produced the
   * transcript. See worker/lib/transcription/index.ts for the policy.
   */
  runTranscription: typeof runTranscription;
  resolveSource: (env: Env, ref: TranscriptionSourceRef, fetcher?: typeof fetch) => Promise<ResolvedSource>;
  chargeQuota: typeof chargeTranscriptionQuota;
}

const DEFAULT_DEPS: TranscriptionJobDeps = {
  runTranscription,
  resolveSource,
  chargeQuota: chargeTranscriptionQuota,
};

function r2Prefix(jobId: string): string {
  return `transcription/${jobId}`;
}

/**
 * Where an uploaded file lives, and the only place that layout is written down.
 *
 * The key CANNOT live under the job's own prefix: `createTranscriptionJob` mints
 * the job id itself and needs the key inside the payload it inserts, so the
 * bytes must already be in R2 before an id exists. Hence a user-scoped prefix
 * with its own random segment — the user id in the path makes ownership
 * structural, and the random segment keeps two uploads of `audio.m4a` apart.
 *
 * `deleteTranscriptionJobForUser` sweeps `transcription/<jobId>/` (nothing is
 * written there today) and deletes `source_r2_key` outright, so an object minted
 * here is always removed with its job.
 */
export function transcriptionUploadKey(userId: string, filename: string): string {
  // Separators are trimmed off both ends after sanitising, so a name made only of
  // punctuation ("???", "...") collapses to nothing and falls back to a readable
  // leaf rather than producing a key that ends in "/_" and tells support nothing.
  const safe =
    filename
      .replace(/[^\w.-]+/g, "_")
      .replace(/^[_.-]+|[_.-]+$/g, "")
      .slice(-80) || "source";
  return `transcription/uploads/${userId}/${nanoid()}/${safe}`;
}

function downloadPaths(jobId: string): Record<TranscriptionDownloadFormat, string> {
  return {
    txt: `/api/transcriptions/jobs/${jobId}/download/txt`,
    vtt: `/api/transcriptions/jobs/${jobId}/download/vtt`,
  };
}

function parseLanguages(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseTranscript(raw: string | null): NormalisedTranscript | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as NormalisedTranscript;
  } catch {
    // A malformed stored transcript must not break the poll — the job still
    // reads as completed with nothing to show, and support can look at the row.
    return null;
  }
}

function publicStoredFailure(code: string | null, payload: string | null): TranscriptionFailure | null {
  const failure = parseStoredFailure(code, payload);
  return failure === null ? null : publicTranscriptionFailure(failure);
}

/**
 * A row as the API returns it.
 *
 * RETENTION IS ENFORCED HERE, not only by the cron. The daily sweep frees the
 * storage; this function is what makes the 7-day promise TRUE, because between a
 * transcript expiring and the sweep running there is a window of up to 24 hours
 * in which the text is still in the column. In that window an expired job serves
 * no transcript and no download links — the same behaviour a purged row has, so
 * the interface cannot tell (and does not need to tell) whether the cron has been
 * round yet.
 */
export function rowToTranscriptionJob(
  row: TranscriptionJobRow,
  options: { now?: Date } = {}
): TranscriptionJobResponse {
  const expired = isTranscriptExpired(row.expires_at, options.now);
  const job: TranscriptionJobResponse = {
    id: row.id,
    status: row.status,
    title: row.title,
    sourceKind: row.source_kind,
    sourceUrl: row.source_url,
    diarizeRequested: row.diarize_requested === 1,
    provider: row.provider,
    providerModel: row.provider_model,
    providerChoiceReason: row.provider_choice_reason,
    diarization: row.diarization === 1,
    detectedLanguage: row.detected_language,
    detectedLanguages: parseLanguages(row.detected_languages),
    durationSeconds: row.duration_seconds,
    billedSeconds: row.billed_seconds,
    transcript: expired ? null : parseTranscript(row.result_payload),
    // Sanitised: `detail` is operator information (a slug, or a truncated
    // provider sentence) and never reaches a browser. `error_message` keeps the
    // full text for support and is not part of this response at all.
    error: publicStoredFailure(row.error_code, row.error_payload),
    createdAt: row.created_at,
    completedAt: row.completed_at,
    expiresAt: row.expires_at,
    expired,
  };
  if (row.status === "completed" && job.transcript) {
    job.downloads = downloadPaths(row.id);
  }
  return job;
}

/**
 * The label the library list shows for a job: the teacher's own title, else the
 * URL leaf or the uploaded filename.
 *
 * Returns "" when there is nothing to derive — deliberately, not an English word.
 * The Worker has no i18n runtime, so the last-resort name belongs to the client,
 * which renders `transcription.untitled_transcript` exactly as the reader does
 * for a job with no title. One fallback sentence, in three languages, in one
 * place.
 */
function summaryTitle(row: Pick<TranscriptionJobRow, "title" | "source_url" | "request_payload">): string {
  const title = row.title?.trim();
  if (title) return title;
  if (row.source_url) {
    try {
      const url = new URL(row.source_url);
      const leaf = url.pathname.split("/").filter(Boolean).pop();
      return leaf ? decodeURIComponent(leaf) : url.hostname;
    } catch {
      return row.source_url;
    }
  }
  try {
    const payload = JSON.parse(row.request_payload) as Partial<TranscriptionRequestPayload>;
    if (payload.source?.kind === "upload") return payload.source.filename;
  } catch {
    // fall through
  }
  return "";
}

// ---- Create ----

export async function createTranscriptionJob(
  env: Env,
  input: CreateTranscriptionJobInput
): Promise<string> {
  // Defence in depth for YouTube, kept honest since the sidecar shipped: the
  // route refuses an unconfigured deployment before calling this, but this
  // layer cannot assume every caller is that route. THE BUG THIS COMMENT
  // REPLACES: activation day, this check was still unconditional, so
  // /api/health said "youtubeIngest: true" while every POST died here with
  // 501 — two honest answers from two layers reading different rules. If the
  // capability is off, refuse kindly; if it is on, a YouTube job is ordinary.
  if (input.source.kind === "youtube" && !youtubeIngestConfigured(env)) {
    throw new TranscriptionError({
      code: "youtube_not_yet_supported",
      url: input.source.url,
    });
  }

  const known = input.durationSeconds ?? null;
  if (known !== null && known > TRANSCRIPTION_MAX_SOURCE_SECONDS) {
    throw new TranscriptionError({
      code: "source_too_long",
      durationSeconds: Math.ceil(known),
      maxSeconds: TRANSCRIPTION_MAX_SOURCE_SECONDS,
    });
  }

  // Precheck against the *known or assumed* length. When we do not yet know the
  // duration we assume the cap, so a user with 4 minutes left cannot start a
  // 90-minute job and discover the problem after we already paid the provider.
  //
  // This read produces the numbered refusal a teacher reads. It does NOT decide
  // admission — see the gate below.
  const now = new Date();
  const estimatedSeconds = Math.ceil(known ?? TRANSCRIPTION_MAX_SOURCE_SECONDS);
  const precheck = await precheckTranscriptionQuota(env, input.userId, estimatedSeconds, { now });
  if (!precheck.ok) {
    throw new TranscriptionError({
      code: "quota_exceeded",
      requestedSeconds: precheck.estimatedSeconds,
      remainingSeconds: precheck.balance.includedRemaining,
    });
  }

  const id = nanoid();
  const payload: TranscriptionRequestPayload = {
    source: input.source,
    diarize: input.diarize,
    languageHint: input.languageHint ?? null,
    title: input.title?.trim() || null,
  };
  // The tier-1 rule has ONE definition, in the router. Re-writing `input.diarize
  // ? "deepgram" : "groq"` here is how `requested_provider` ends up disagreeing
  // with the plan the cascade actually builds.
  const requestedProvider: TranscriptionProviderId = selectTranscriptionProvider({
    diarize: input.diarize,
  });
  // Bound locally so the discriminant narrows in each column expression below.
  const source = input.source;

  // ATOMIC ADMISSION. The insert carries its own quota check: the same in-flight
  // sum the precheck just reported is recomputed inside this one statement, and
  // the row appears only if it still fits. Two teachers' worth of parallel
  // submissions therefore cannot all pass against one untouched allowance — the
  // reservation IS the admission, which is the only thing that works without a
  // transaction we do not have.
  const gate = buildTranscriptionAdmissionGate(
    input.userId,
    estimatedSeconds,
    precheck.balance.includedRemaining,
    now
  );

  const inserted = await env.DB.prepare(
    `INSERT INTO transcription_jobs (
       id, user_id, source_kind, source_url, source_r2_key,
       source_content_type, source_bytes, title,
       requested_provider, diarize_requested, duration_seconds, request_payload
     )
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE ${gate.predicate}`
  )
    .bind(
      id,
      input.userId,
      source.kind,
      source.kind === "upload" ? null : source.url,
      source.kind === "upload" ? source.r2Key : null,
      source.kind === "upload" ? source.contentType : null,
      source.kind === "upload" ? source.bytes : null,
      payload.title,
      requestedProvider,
      input.diarize ? 1 : 0,
      known,
      JSON.stringify(payload),
      ...gate.binds
    )
    .run();

  if ((inserted.meta.changes ?? 0) === 0) {
    // We lost the race to a concurrent submission of this teacher's own. The id
    // is fresh, so nothing else can have blocked the insert.
    throw new TranscriptionError({
      code: "quota_exceeded",
      requestedSeconds: estimatedSeconds,
      remainingSeconds: precheck.balance.includedRemaining,
    });
  }

  // Insert then enqueue, never the other way round.
  await env.TRANSCRIPTION_JOBS_QUEUE.send({ jobId: id }, { contentType: "json" });
  return id;
}

// ---- Read ----

export async function getTranscriptionJobForUser(
  env: Env,
  jobId: string,
  userId: string
): Promise<TranscriptionJobResponse | null> {
  const row = await env.DB.prepare("SELECT * FROM transcription_jobs WHERE id = ? AND user_id = ?")
    .bind(jobId, userId)
    .first<TranscriptionJobRow>();
  return row ? rowToTranscriptionJob(row) : null;
}

export async function listTranscriptionJobsForUser(
  env: Env,
  userId: string,
  limit = 20,
  offset = 0
): Promise<TranscriptionJobSummary[]> {
  // `Math.min`/`Math.max` are transparent to NaN, so a non-numeric argument would
  // reach `LIMIT ?` intact. Every clamp here starts by proving the input is a
  // number: the route validates its query string, and this is the second lock on
  // the same door because the next caller might not.
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.floor(limit))) : 20;
  const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
  const { results } = await env.DB.prepare(
    `SELECT id, status, title, source_kind, source_url, provider, duration_seconds,
            request_payload, created_at, expires_at
     FROM transcription_jobs
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  )
    .bind(userId, safeLimit, safeOffset)
    .all<
      Pick<
        TranscriptionJobRow,
        | "id"
        | "status"
        | "title"
        | "source_kind"
        | "source_url"
        | "provider"
        | "duration_seconds"
        | "request_payload"
        | "created_at"
        | "expires_at"
      >
    >();

  const now = new Date();
  return (results ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    title: summaryTitle(row),
    sourceKind: row.source_kind,
    provider: row.provider,
    durationSeconds: row.duration_seconds,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    // Same clock for every row in one response, so a list cannot show two
    // neighbouring transcripts on opposite sides of the same second.
    expired: isTranscriptExpired(row.expires_at, now),
  }));
}

// ---- Mutate ----

/** Empty/whitespace clears back to NULL and the UI falls back to the derived label. */
export async function renameTranscriptionJobForUser(
  env: Env,
  jobId: string,
  userId: string,
  title: string
): Promise<{ title: string | null } | undefined> {
  const trimmed = title.trim().slice(0, 120);
  const stored = trimmed.length > 0 ? trimmed : null;
  const result = await env.DB.prepare(
    "UPDATE transcription_jobs SET title = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?"
  )
    .bind(stored, jobId, userId)
    .run();
  if ((result.meta.changes ?? 0) === 0) return undefined;
  return { title: stored };
}

/**
 * Delete a transcript: every R2 object under its prefix (uploaded media), then
 * the row. Ledger rows survive with job_id set to NULL — deleting a transcript
 * is storage cleanup, never a quota refund.
 */
export async function deleteTranscriptionJobForUser(
  env: Env,
  jobId: string,
  userId: string
): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT id FROM transcription_jobs WHERE id = ? AND user_id = ?"
  )
    .bind(jobId, userId)
    .first<{ id: string }>();
  if (!row) return false;

  const prefix = `${r2Prefix(jobId)}/`;
  let cursor: string | undefined;
  do {
    const listed = await env.MEDIA.list({ prefix, cursor });
    if (listed.objects.length > 0) {
      await env.MEDIA.delete(listed.objects.map((object) => object.key));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  await env.DB.prepare("DELETE FROM transcription_jobs WHERE id = ? AND user_id = ?")
    .bind(jobId, userId)
    .run();
  return true;
}

// ---- Consumer ----

async function markStatus(env: Env, jobId: string, status: TranscriptionJobStatus): Promise<void> {
  await env.DB.prepare(
    `UPDATE transcription_jobs
     SET status = ?,
         started_at = COALESCE(started_at, datetime('now')),
         updated_at = datetime('now')
     WHERE id = ?`
  )
    .bind(status, jobId)
    .run();
}

/**
 * Takes ownership of a job, atomically, and reports whether this delivery got it.
 *
 * Queue delivery is at-least-once, so the ROW — not a preceding read — has to be
 * what decides who does the work. A single conditional UPDATE closes the window a
 * read-then-write leaves open: `changes = 0` means "not mine", and every reason
 * for that is correct behaviour.
 *   * 'completed'  — already done and already paid for. Never re-submit.
 *   * 'resolving' / 'transcribing' touched within the stale window — another
 *     delivery is running it right now. Re-submitting would bill the provider a
 *     second time for the same media.
 * Two statuses ARE claimable:
 *   * 'queued'  — the normal first delivery, and the release-and-retry path below.
 *   * 'failed'  — never a billed state (see `markFailed`, which refuses to
 *     overwrite a completed row), so a requeued failure may legitimately re-run.
 * A live status that has not been touched for TRANSCRIPTION_STALE_JOB_MINUTES is
 * also claimable: no queue-consumer invocation outlives that window, so the run
 * that owned it is dead and its row would otherwise be stuck forever.
 */
async function claimTranscriptionJob(env: Env, jobId: string): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE transcription_jobs
     SET status = 'resolving',
         started_at = COALESCE(started_at, datetime('now')),
         updated_at = datetime('now')
     WHERE id = ?
       AND (
         status IN ('queued', 'failed')
         OR (status IN ('resolving', 'transcribing') AND updated_at <= datetime('now', ?))
       )`
  )
    .bind(jobId, `-${TRANSCRIPTION_STALE_JOB_MINUTES} minutes`)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/**
 * Hands the job back to the queue: the provider refused to work, so this attempt
 * owns nothing. Without the release the claim above would see a fresh live status
 * on the retry a few seconds later and no-op, which would make the retry ladder
 * useless a second time.
 */
async function releaseTranscriptionJob(env: Env, jobId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE transcription_jobs
     SET status = 'queued', updated_at = datetime('now')
     WHERE id = ? AND status IN ('resolving', 'transcribing')`
  )
    .bind(jobId)
    .run();
}

/**
 * Which tier was running when this error was thrown, if any tier was.
 *
 * Stamped by the cascade (`withAttempt` in transcription/index.ts) and carried on
 * the error itself rather than on the failure payload, because it is operator
 * information: the failure is serialised to the row AND to the browser, and
 * "Deepgram, because Groq rate-limited us" is ours, not the teacher's.
 */
function attemptFrom(error: unknown): TranscriptionAttempt | null {
  return error instanceof TranscriptionError ? error.attempt : null;
}

/**
 * `AND status != 'completed'` is load-bearing: the quota charge runs after the
 * transcript is persisted, so a failing charge must not be able to flip a row
 * that already holds the teacher's transcript into 'failed' and hide it. A
 * bookkeeping glitch costs us money, never their work.
 *
 * A FAILED ROW IS AS AUDITABLE AS A COMPLETED ONE. `provider` and
 * `provider_choice_reason` are written here too, from the tier the cascade died
 * on, so a job that burned a Groq 429 and then a Deepgram 500 says so in the two
 * columns built for exactly that question. `COALESCE(?, provider)` keeps whatever
 * a previous attempt already recorded when this failure never reached a provider
 * at all (a dead link, an over-long source), rather than blanking it.
 */
async function markFailed(
  env: Env,
  jobId: string,
  failure: TranscriptionFailure,
  detail?: string,
  attempt: TranscriptionAttempt | null = null
): Promise<void> {
  await env.DB.prepare(
    `UPDATE transcription_jobs
     SET status = 'failed',
         provider = COALESCE(?, provider),
         provider_choice_reason = COALESCE(?, provider_choice_reason),
         error_code = ?,
         error_payload = ?,
         error_message = ?,
         completed_at = datetime('now'),
         updated_at = datetime('now')
     WHERE id = ? AND status != 'completed'`
  )
    .bind(
      attempt?.provider ?? null,
      attempt?.reason ?? null,
      failure.code,
      JSON.stringify(failure),
      detail ?? null,
      jobId
    )
    .run();
}

/**
 * Runs one job to a terminal status.
 *
 * Failures are split in two, because they are not the same kind of thing:
 *
 *   * TEACHER-CAUSED and durable — a mistyped URL, a feed with no audio, a file
 *     over the cap. Swallowed into a 'failed' row exactly like processDocumentJob:
 *     retrying three times just fails three times, and for a code that reached a
 *     provider it would bill three times too.
 *   * `provider_unavailable` — a 429, a 401, or any 5xx. The provider REFUSED the
 *     request, so nothing was billed and nothing is wrong with the media. This one
 *     is rethrown, so the queue's configured ladder (max_retries 3) actually gets
 *     used instead of a rate-limit blip terminally killing a 90-minute job the
 *     teacher would then have to resubmit from scratch.
 *
 * Note what the cascade changed about that second bullet. `runTranscription`
 * already walked EVERY configured tier before it threw, so by the time this sees
 * `provider_unavailable` the answer really is "nobody could take it right now" —
 * which is exactly when a queue retry is the honest next move. A Groq rate limit
 * no longer reaches here at all: it is handled one layer down, by moving the job
 * to Deepgram inside the same invocation.
 */
export async function processTranscriptionJob(
  env: Env,
  jobId: string,
  deps: TranscriptionJobDeps = DEFAULT_DEPS
): Promise<void> {
  // Claim before reading: an unclaimable job (missing, completed, or in flight
  // elsewhere) must cost nothing and do nothing.
  if (!(await claimTranscriptionJob(env, jobId))) return;

  const row = await env.DB.prepare("SELECT * FROM transcription_jobs WHERE id = ?")
    .bind(jobId)
    .first<TranscriptionJobRow>();
  if (!row) return;

  try {
    const payload = JSON.parse(row.request_payload) as TranscriptionRequestPayload;

    const resolved = await deps.resolveSource(env, payload.source);

    const duration = resolved.durationSeconds;
    if (duration !== null && duration > TRANSCRIPTION_MAX_SOURCE_SECONDS) {
      throw new TranscriptionError({
        code: "source_too_long",
        durationSeconds: Math.ceil(duration),
        maxSeconds: TRANSCRIPTION_MAX_SOURCE_SECONDS,
      });
    }

    await env.DB.prepare(
      `UPDATE transcription_jobs
       SET resolved_url = ?, source_content_type = COALESCE(?, source_content_type),
           source_bytes = COALESCE(?, source_bytes),
           duration_seconds = COALESCE(?, duration_seconds),
           title = COALESCE(title, ?),
           source_r2_key = COALESCE(source_r2_key, ?),
           updated_at = datetime('now')
       WHERE id = ?`
    )
      .bind(
        resolved.resolvedUrl,
        resolved.contentType,
        resolved.bytes,
        duration === null ? null : Math.ceil(duration),
        resolved.title,
        // Uploads set this at creation; a YouTube extraction mints its R2
        // object DURING resolve, and without this write-back neither the
        // nightly purge nor per-job deletion would ever find the audio.
        resolved.r2Key,
        jobId
      )
      .run();

    await markStatus(env, jobId, "transcribing");

    // ONE call, THREE possible providers. The cascade may quietly move the job
    // from Groq to Deepgram to AssemblyAI; what it must never do is move it
    // silently, so `run.provider` and `run.reason` are persisted below.
    const run = await deps.runTranscription(env, {
      audio: resolved.audio,
      diarize: payload.diarize,
      languageHint: payload.languageHint,
      durationSeconds: duration,
      // Forwarded for the SAME reason `durationSeconds` is: the router needs it to
      // skip Groq for a source over its free-tier 25 MB ceiling without paying a
      // round trip to be told 413. Ingest measured it for links and podcast
      // episodes too, which is most of them.
      sizeBytes: resolved.bytes,
    });
    const transcript = run.transcript;

    if (run.fellBackFrom.length > 0) {
      console.warn("Transcription completed on a fallback tier", {
        jobId,
        requested: row.requested_provider,
        ran: run.provider,
        fellBackFrom: run.fellBackFrom,
        reason: run.reason,
      });
    }

    // Bill the transcript's own measured duration: it is what the provider
    // charged us for, and it is the only number we can defend to a teacher.
    const billedSeconds = Math.ceil(Math.max(0, transcript.metadata.durationSeconds));

    // BACKSTOP. Ingest measures the container header before submitting, so this
    // branch means a source got past every pre-submit check — an Ogg whose length
    // only its last page states, a feed that lied. It cannot un-spend the first
    // bill, but it does two things that matter: the spend is recorded (a breach
    // that costs nothing is a breach that repeats), and the job is refused rather
    // than quietly stored, so the 90-minute promise stays true and the row's
    // `duration_seconds` makes the breach visible to us.
    if (billedSeconds > TRANSCRIPTION_MAX_SOURCE_SECONDS) {
      console.error("Transcription source exceeded the cap and was only measurable after submission", {
        jobId,
        provider: run.provider,
        providerJobId: run.handle.providerJobId,
        durationSeconds: billedSeconds,
        maxSeconds: TRANSCRIPTION_MAX_SOURCE_SECONDS,
      });
      await deps.chargeQuota(env, row.user_id, jobId, billedSeconds, run.provider);
      throw new TranscriptionError({
        code: "source_too_long",
        durationSeconds: billedSeconds,
        maxSeconds: TRANSCRIPTION_MAX_SOURCE_SECONDS,
      });
    }

    await env.DB.prepare(
      `UPDATE transcription_jobs
       SET status = 'completed',
           provider = ?,
           provider_model = ?,
           provider_job_id = ?,
           provider_choice_reason = ?,
           diarization = ?,
           detected_language = ?,
           detected_languages = ?,
           duration_seconds = ?,
           billed_seconds = ?,
           result_payload = ?,
           error_code = NULL,
           error_payload = NULL,
           error_message = NULL,
           completed_at = datetime('now'),
           -- Stamped ONCE, exactly like audio_jobs: COALESCE keeps the first
           -- deadline if this row is ever completed twice, so a re-run cannot
           -- silently extend a teacher's 7 days (or shorten them).
           expires_at = COALESCE(expires_at, ?),
           updated_at = datetime('now')
       WHERE id = ?`
    )
      .bind(
        run.provider,
        run.model,
        run.handle.providerJobId,
        run.reason,
        transcript.metadata.diarization ? 1 : 0,
        transcript.metadata.detectedLanguages[0] ?? null,
        JSON.stringify(transcript.metadata.detectedLanguages),
        billedSeconds,
        billedSeconds,
        JSON.stringify(transcript),
        transcriptionExpiresAtIso(),
        jobId
      )
      .run();

    // Charge last: the transcript is already safe on the row, so a quota write
    // that fails costs us money but never costs the teacher their work. The
    // provider charged is the one that RAN, not the one that was requested.
    await deps.chargeQuota(env, row.user_id, jobId, billedSeconds, run.provider);
  } catch (error) {
    const failure = toTranscriptionFailure(error);
    if (failure.code === "provider_unavailable" || failure.code === "youtube_blocked") {
      // youtube_blocked joins the retryable club for the same reason: YouTube
      // (or our sidecar) refused THIS attempt, nothing was billed, and nothing
      // is wrong with the link — a retry in a few seconds is the honest move.
      // Not terminal, and not the teacher's fault. Give the row back and let the
      // queue try again in a few seconds.
      await releaseTranscriptionJob(env, jobId);
      throw error;
    }
    await markFailed(
      env,
      jobId,
      failure,
      error instanceof Error ? error.message : undefined,
      attemptFrom(error)
    );
  }
}

/** Matches the `max_retries` configured for the transcription-jobs queue. */
const TRANSCRIPTION_MAX_ATTEMPTS = 3;

/** The plain ladder: 5 s, then 10 s. Enough for a blip, cheap for the queue. */
function ladderDelaySeconds(attempts: number): number {
  return Math.min(30, attempts * 5);
}

/**
 * How long to wait before the next delivery.
 *
 * Normally the ladder. The exception is the one case where the ladder is
 * GUARANTEED to fail: a deployment with no Deepgram and no AssemblyAI key, where
 * Groq is the only tier. A Groq 429 opens the breaker for up to an hour, and the
 * breaker then removes Groq from the plan — so a retry 5 seconds later comes back
 * with an empty plan and `provider_unavailable`, and so does the one after it,
 * and the job is marked failed minutes before Groq would have been eligible
 * again. The retries cannot succeed by construction.
 *
 * So when the breaker is what is holding us back and there is nothing else to
 * fall back to, we wait for the breaker instead of against it. Clamped to the
 * breaker's own hour ceiling, and never shorter than the ladder.
 *
 * The check is skipped entirely — no KV read — whenever another tier is
 * configured, because then the retry has somewhere to go and should be prompt.
 */
async function retryDelaySeconds(
  env: Env,
  failure: TranscriptionFailure,
  attempts: number
): Promise<number> {
  const ladder = ladderDelaySeconds(attempts);
  if (failure.code !== "provider_unavailable") return ladder;
  if (
    isTranscriptionProviderConfigured(env, "deepgram") ||
    isTranscriptionProviderConfigured(env, "assemblyai")
  ) {
    return ladder;
  }
  const breaker = await isGroqBreakerOpen(env);
  if (!breaker.open) return ladder;
  // +1 s so the delivery lands after the pause has elapsed, not exactly on it.
  return Math.min(GROQ_BREAKER_MAX_SECONDS, Math.max(ladder, breaker.retryInSeconds + 1));
}

export async function handleTranscriptionJobBatch(
  batch: MessageBatch<{ jobId: string }>,
  env: Env,
  deps: TranscriptionJobDeps = DEFAULT_DEPS
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processTranscriptionJob(env, message.body.jobId, deps);
      message.ack();
    } catch (error) {
      const failure = toTranscriptionFailure(error);
      console.error("Transcription job consumer failure", {
        jobId: message.body.jobId,
        attempts: message.attempts,
        code: failure.code,
        error: error instanceof Error ? error.message : "unknown",
      });

      if (message.attempts < TRANSCRIPTION_MAX_ATTEMPTS) {
        message.retry({ delaySeconds: await retryDelaySeconds(env, failure, message.attempts) });
        continue;
      }

      // Out of attempts: write a terminal row so the poller stops, then ack —
      // never leave a poison message on the queue. The REAL failure is stored,
      // not a generic 'internal': a teacher whose provider was busy for three
      // attempts should read "the service is busy, try again shortly", which is
      // both true and actionable.
      await markFailed(
        env,
        message.body.jobId,
        failure,
        error instanceof Error ? error.message : "Background processing failed.",
        attemptFrom(error)
      );
      message.ack();
    }
  }
}
