// Transcription Studio — 7-day retention.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS AT ALL (the Audio Studio has no equivalent)
// ---------------------------------------------------------------------------
// The mp3s the Audio Studio produces expire after 7 days, and NO code deletes
// them: they are bytes in R2, and an R2 lifecycle rule configured in the
// Cloudflare dashboard removes them. `expiresAtIso()` in audio-jobs.ts only
// STAMPS the date so the interface can count down to it.
//
// That works for bytes in a bucket. It does not work here, because the thing
// being retained is a transcript — TEXT in a D1 column — and no bucket lifecycle
// rule can reach a D1 row. So this module is the deletion the audio path gets for
// free, plus the read-time check that makes the promise true regardless of when
// the cron last ran.
//
// TWO ENFORCEMENT POINTS, BOTH REQUIRED:
//
//   1. `purgeExpiredTranscriptions` — the daily cron (wrangler.jsonc `triggers`,
//      dispatched by `scheduled` in worker/index.ts). It is what actually frees
//      the storage: the transcript out of D1 and the uploaded source out of R2.
//   2. `isTranscriptExpired` — checked on every read of a job. A cron runs once a
//      day; a transcript expires at a precise timestamp. Between the two there is
//      a window of up to 24 hours in which the row still holds the text, and in
//      that window the API must already behave as if it did not. Retention that
//      depends on a scheduler's punctuality is not retention.
//
// WHAT SURVIVES A PURGE. The ROW does. Title, duration, provider, status and the
// ledger stay, exactly as an expired audio take keeps its row after R2 has
// removed its files — so the library can still say "this existed, it expired"
// instead of silently losing an entry the teacher remembers making. What goes is
// `result_payload` (the transcript itself) and the stored media.

import type { Env } from "../env";
import { TRANSCRIPTION_RETENTION_DAYS } from "./transcription/types";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Rows touched per statement.
 *
 * THE CEILING IS D1's, AND IT IS 100 BOUND PARAMETERS PER QUERY. The purge's
 * `UPDATE ... WHERE id IN (?, ?, …)` binds one parameter per row, so a batch of
 * 200 threw `D1_ERROR: too many SQL variables` the moment more than ~100
 * transcripts expired on the same day — and because the sweep swallowed that and
 * ran under `waitUntil`, the cron still reported success while deleting nothing.
 * 90 leaves headroom for the handful of non-id parameters and for a future
 * column in the same statement. R2's own 1000-keys-per-delete limit is nowhere
 * near binding at this size.
 *
 * Raising this number is only safe together with chunking the `IN (...)` list.
 */
export const TRANSCRIPTION_PURGE_BATCH_SIZE = 90;

/**
 * Ceiling on batches per invocation, so one run cannot spend a whole cron budget
 * on a backlog. Hitting it is not a failure: the rows that are left still match
 * the same query tomorrow, and every read already refuses to serve them.
 *
 * `BATCH_SIZE * MAX_BATCHES` is the rows-per-day ceiling — 5,400, deliberately
 * unchanged when the batch size came down to fit D1's parameter limit.
 */
export const TRANSCRIPTION_PURGE_MAX_BATCHES = 60;

export interface TranscriptionPurgeResult {
  /** Rows whose transcript was cleared. */
  purged: number;
  /** Stored source objects removed from R2. */
  mediaDeleted: number;
  batches: number;
  /** True when the batch ceiling stopped us with work still queued for tomorrow. */
  truncated: boolean;
}

export interface TranscriptionRetentionOptions {
  /** Injected clock. Nothing here reads the ambient one. */
  now?: Date;
}

/**
 * When a transcript completed now would expire.
 *
 * Deliberately the same shape as `expiresAtIso()` in audio-jobs.ts — an ISO
 * timestamp, +7 days — because `src/lib/transcription-display.ts` renders it with
 * the same arithmetic `audio-display.ts` uses, and two date formats for one idea
 * is how a countdown ends up off by a day.
 */
export function transcriptionExpiresAtIso(from: Date = new Date()): string {
  return new Date(from.getTime() + TRANSCRIPTION_RETENTION_DAYS * DAY_MS).toISOString();
}

/**
 * Has this transcript's 7 days run out?
 *
 * Mirrors `isExpired` in src/lib/audio-display.ts so the Worker and the browser
 * can never disagree about which side of the line a job is on. An unparseable
 * stored value reads as NOT expired: a corrupt date must not be able to hide a
 * teacher's transcript, and the cron would leave it alone too.
 */
export function isTranscriptExpired(expiresAt: string | null, now: Date = new Date()): boolean {
  if (expiresAt === null) return false;
  const at = new Date(expiresAt).getTime();
  if (!Number.isFinite(at)) return false;
  return at <= now.getTime();
}

interface ExpiredRow {
  id: string;
  source_r2_key: string | null;
}

/**
 * Deletes what has expired: the transcript text from D1, the stored source from
 * R2.
 *
 * TWO WAYS A ROW QUALIFIES, and the second one is not optional.
 *
 *   1. `expires_at` has passed. That column is stamped ONCE, in the completion
 *      UPDATE, so this branch only ever sees jobs that finished.
 *   2. The row still names an uploaded object and was created more than
 *      TRANSCRIPTION_RETENTION_DAYS ago. A job that FAILED — a provider that
 *      refused, a container nothing could read, a length only measurable after
 *      the upload — never reaches the completion UPDATE, so it never gets an
 *      `expires_at`, and branch 1 can never see it. Without this branch that
 *      teacher's recording of their learners stays in R2 forever, with no bucket
 *      lifecycle rule behind it and no other code path that would ever remove
 *      it. The same is true of a job abandoned in 'queued'.
 *
 * Idempotent and safe to run twice, by construction rather than by a flag — the
 * selection requires that the row still HOLDS something, so a purged row cannot
 * match again. R2 deletes are idempotent on their own.
 *
 * MEDIA FIRST, THEN THE ROW. If the R2 call fails we clear the transcript anyway
 * (that is the sensitive part, and the deadline has passed) but leave
 * `source_r2_key` in place, so the object is retried tomorrow instead of being
 * orphaned by a bookkeeping write that outran the storage delete.
 */
export async function purgeExpiredTranscriptions(
  env: Env,
  options: TranscriptionRetentionOptions = {}
): Promise<TranscriptionPurgeResult> {
  const cutoff = (options.now ?? new Date()).toISOString();
  const result: TranscriptionPurgeResult = {
    purged: 0,
    mediaDeleted: 0,
    batches: 0,
    truncated: false,
  };

  for (let batch = 0; batch < TRANSCRIPTION_PURGE_MAX_BATCHES; batch += 1) {
    const { results } = await env.DB.prepare(
      // `datetime(?, ?)` rather than a string built here: `created_at` is written
      // by `datetime('now')` ("YYYY-MM-DD HH:MM:SS") while the cutoff is an ISO
      // instant, and comparing those two spellings as text is off by the 'T'.
      // SQLite reads the ISO cutoff and hands back `created_at`'s own format.
      `SELECT id, source_r2_key
         FROM transcription_jobs
        WHERE (result_payload IS NOT NULL OR source_r2_key IS NOT NULL)
          AND (
            (expires_at IS NOT NULL AND expires_at <= ?1)
            OR (source_r2_key IS NOT NULL AND created_at <= datetime(?1, ?2))
          )
        -- NULLs first in SQLite, which puts the orphaned uploads (no deadline,
        -- so nothing else will ever remove them) ahead of transcripts a reader
        -- already refuses to serve. created_at breaks the tie deterministically,
        -- so a backlog drains oldest-first across days instead of shuffling.
        ORDER BY expires_at, created_at
        LIMIT ?3`
    )
      .bind(cutoff, `-${TRANSCRIPTION_RETENTION_DAYS} days`, TRANSCRIPTION_PURGE_BATCH_SIZE)
      .all<ExpiredRow>();

    const rows = results ?? [];
    if (rows.length === 0) return result;

    result.batches += 1;

    const keys = rows
      .map((row) => row.source_r2_key)
      .filter((key): key is string => typeof key === "string" && key.length > 0);

    let mediaGone = true;
    if (keys.length > 0) {
      try {
        await env.MEDIA.delete(keys);
        result.mediaDeleted += keys.length;
      } catch (error) {
        // Storage is having a bad day. The transcript still goes; the key stays so
        // tomorrow's run finishes the job.
        mediaGone = false;
        console.error("Transcription retention could not delete stored media", {
          keys: keys.length,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }

    const ids = rows.map((row) => row.id);
    const placeholders = ids.map(() => "?").join(", ");
    await env.DB.prepare(
      `UPDATE transcription_jobs
          SET result_payload = NULL,
              ${mediaGone ? "source_r2_key = NULL," : ""}
              updated_at = datetime('now')
        WHERE id IN (${placeholders})`
    )
      .bind(...ids)
      .run();
    result.purged += ids.length;

    // A short batch means we drained the queue; anything else and we go round.
    if (rows.length < TRANSCRIPTION_PURGE_BATCH_SIZE) return result;

    if (!mediaGone) {
      // The same rows would come back forever: their `source_r2_key` is still set
      // and R2 is refusing. Stop for today rather than spin.
      result.truncated = true;
      return result;
    }
  }

  result.truncated = true;
  return result;
}

/**
 * The cron entry point. Logs what it did — a retention sweep that leaves no trace
 * is indistinguishable from one that never ran — and RETHROWS when it fails.
 *
 * The throw is the point. This function used to swallow everything and return a
 * zeroed result, and `ctx.waitUntil` in the scheduled handler then recorded the
 * invocation as successful whatever happened. That is exactly how a broken sweep
 * (D1 refusing an over-long `IN (...)` list, for one) can delete nothing for
 * months while the interface still shows correct countdowns, because the
 * read-time check hides it. Cloudflare marks a cron invocation as failed when the
 * handler rejects, and that is the only alert surface this feature has.
 *
 * Throwing costs nothing operationally: retention is resumable, the rows still
 * match the same query tomorrow, and every read already refuses to serve an
 * expired transcript in the meantime.
 *
 * Every run logs, including the quiet one. "Nothing to purge" and "never ran" are
 * different facts and the log has to be able to tell them apart.
 */
export async function runTranscriptionRetentionSweep(env: Env): Promise<TranscriptionPurgeResult> {
  try {
    const outcome = await purgeExpiredTranscriptions(env);
    console.log("Transcription retention sweep", {
      retentionDays: TRANSCRIPTION_RETENTION_DAYS,
      purged: outcome.purged,
      mediaDeleted: outcome.mediaDeleted,
      batches: outcome.batches,
      truncated: outcome.truncated,
    });
    return outcome;
  } catch (error) {
    console.error("Transcription retention sweep failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    throw error;
  }
}
