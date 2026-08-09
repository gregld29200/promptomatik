// Transcription Studio — the speech-to-text hours ledger.
//
// ---------------------------------------------------------------------------
// DO NOT MERGE THIS WITH THE TTS QUOTA. EVER.
// ---------------------------------------------------------------------------
// This module is deliberately a near-twin of `audio-quota.ts` (monthly KV
// counter + double-entry D1 ledger) and deliberately shares NOTHING with it:
//   * its own KV prefix   `transq:<userId>:<YYYY-MM>`  (never `audioq:*`)
//   * its own D1 table    `transcription_quota_ledger` (never `quota_ledger`)
//   * no credit balance at all           (never `credit_balances`)
// The reason is pricing, not tidiness: Gemini TTS costs roughly 5-15x more per
// minute than Groq/Deepgram speech-to-text. A single pooled counter would have
// to pick one price, so it would either give away TTS minutes or bill
// transcription hours at synthesis rates. Both are wrong. Two ledgers, two
// allowances, two prices. If you are here to "simplify" by unifying them,
// re-read this paragraph and don't.
//
// ---------------------------------------------------------------------------
// WHERE THE TRUTH LIVES
// ---------------------------------------------------------------------------
// `transcription_quota_ledger` is authoritative: one negative row per spend,
// positive rows for refunds and admin grants. The KV counter is a *derived
// cache* so the hot read (the Studio polls it) is a single KV get instead of an
// aggregate query.
//
// The cache is for DISPLAY ONLY. `precheckTranscriptionQuota` — the single gate
// before a paid provider call — recomputes from the ledger, because a counter
// that is missing (a KV write that never landed) or stale (KV is eventually
// consistent, ~60 s, so back-to-back submissions can read an old value) reads
// as 0 seconds used, i.e. a whole fresh 10-hour allowance. Nothing downstream
// re-checks: the charge deliberately never refuses an overshoot, so an
// over-generous gate is billed in full. Display may lag by a minute; the gate
// may not.
//
// The ledger alone is still not enough to gate on, because a spend row is only
// written once a transcript exists. Between submission and that row, the hours
// are committed (the provider will bill them) but invisible. So the gate also
// subtracts the seconds already committed by this user's jobs that are still
// queued/resolving/transcribing — otherwise burst-submitting N sources would
// pass N times against the same untouched allowance and bill N x 90 minutes.
//
// ---------------------------------------------------------------------------
// THE GATE IS TWO HALVES, AND THE SECOND ONE IS THE REAL ONE
// ---------------------------------------------------------------------------
// `precheckTranscriptionQuota` reads. Reads cannot gate concurrency: ten
// simultaneous submissions all observe the same untouched allowance, all pass,
// and all insert — the in-flight subtraction above only ever defended against
// SEQUENTIAL submissions. So admission is decided by
// `buildTranscriptionAdmissionGate`, whose predicate is evaluated INSIDE the
// job-row INSERT: one SQLite statement re-counts the in-flight seconds and
// inserts only if they still fit. A lost race inserts nothing, `changes` is 0,
// and the caller reports `quota_exceeded`. The precheck stays because it is what
// produces the specific, numbered refusal a teacher reads; it is no longer what
// keeps us solvent.
//
// Every charge rebuilds the counter from the ledger rather than incrementing it
// blindly. That buys three things:
//   1. Idempotency — the ledger insert is guarded by `WHERE NOT EXISTS`, so a
//      queue retry (consumers retry up to 3 times) inserts nothing the second
//      time and the recomputed counter is unchanged. No double-charge.
//   2. No silent consumption — the durable, atomic step is the audit row. If
//      the KV write then fails we have *under*-charged, never charged hours
//      with no trace of where they went.
//   3. Self-healing — a drifted or lost counter is corrected by the next charge
//      (or by an explicit `reconcileTranscriptionQuota` call), because the
//      counter is always *set* to the ledger sum, never nudged.

import type { Env } from "../env";
import {
  TRANSCRIPTION_INCLUDED_SECONDS_PER_MONTH,
  TRANSCRIPTION_MAX_SOURCE_SECONDS,
  TranscriptionError,
  type TranscriptionProviderId,
  type TranscriptionQuotaBalance,
  type TranscriptionQuotaPrecheck,
} from "./transcription/types";

/** 45 days: long enough that a month's counter outlives the month it counts. */
const TRANSCRIPTION_QUOTA_TTL_SECONDS = 60 * 60 * 24 * 45;

/**
 * How long a job that has actually STARTED is believed to still be running.
 *
 * A queue-consumer invocation cannot outlive 15 minutes of wall clock, so a row
 * still sitting in 'resolving'/'transcribing' whose `updated_at` is older than
 * that was killed mid-flight (isolate eviction, wall-clock limit) and is not
 * running any more. Two places must agree on that number, which is why it lives
 * here and `transcription-jobs.ts` imports it:
 *   * the gate below stops subtracting a dead job's hours, so one eviction cannot
 *     quietly cost a teacher 90 minutes of allowance for the rest of the month;
 *   * `processTranscriptionJob` may re-claim such a row on a later delivery
 *     instead of treating it as "in flight" forever.
 *
 * A row still 'queued' is NEVER aged out. It has not started, so its silence
 * proves nothing about whether anyone will run it, and a queue that is merely
 * backed up must keep counting against the allowance — otherwise the burst this
 * gate exists to stop gets through by waiting.
 */
export const TRANSCRIPTION_STALE_JOB_MINUTES = 15;

/** Mirrors the `reason` CHECK in migration 0017. */
export type TranscriptionQuotaReason = "transcription" | "refund" | "admin_adjust";

interface TranscriptionQuotaOptions {
  /** Injected clock. Every month boundary below is computed in UTC. */
  now?: Date;
}

function monthKey(now: Date): string {
  // toISOString is UTC by definition, so YYYY-MM is a UTC month key.
  return now.toISOString().slice(0, 7);
}

/** `transq:<userId>:<YYYY-MM>`. Exported so tests and admin tooling agree on it. */
export function transcriptionQuotaKey(userId: string, now: Date): string {
  return `transq:${userId}:${monthKey(now)}`;
}

function utcMonthStart(now: Date, monthOffset = 0): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, 1));
}

/** `YYYY-MM-DD HH:MM:SS` — the shape SQLite's `datetime('now')` default writes. */
function sqlTimestamp(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

function normalizeSeconds(value: unknown): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

/**
 * Whole, non-negative seconds — or `fallback` when the caller handed us a
 * number that cannot mean a duration (NaN from a provider that returned no
 * duration field, Infinity from a division, a negative from arithmetic).
 *
 * `delta_seconds` is a NOT NULL INTEGER column: passing NaN through would raise
 * a raw D1 constraint error, and the charge runs *after* the transcript is
 * saved — a bookkeeping glitch must never be able to fail a job whose work
 * already exists. Each caller picks the fallback that errs in the teacher's
 * favour: the precheck assumes the 90-minute cap (unknown length is gated as if
 * it were the longest allowed), the charge bills nothing.
 */
function usableSeconds(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.ceil(Math.max(0, value));
}

function buildBalance(includedUsed: number, now: Date): TranscriptionQuotaBalance {
  return {
    includedLimit: TRANSCRIPTION_INCLUDED_SECONDS_PER_MONTH,
    includedUsed,
    includedRemaining: Math.max(0, TRANSCRIPTION_INCLUDED_SECONDS_PER_MONTH - includedUsed),
    month: monthKey(now),
    monthResetsOn: utcMonthStart(now, 1).toISOString(),
  };
}

/**
 * Seconds spent this UTC month according to the ledger. Negative deltas are
 * spends, positive ones (refunds, admin grants) offset them. A month whose
 * grants exceed its spends reads as zero used — a grant offsets consumption, it
 * does not raise the monthly ceiling.
 */
async function sumMonthlySpend(env: Env, userId: string, now: Date): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(delta_seconds), 0) AS net_seconds
     FROM transcription_quota_ledger
     WHERE user_id = ? AND created_at >= ? AND created_at < ?`
  )
    .bind(userId, sqlTimestamp(utcMonthStart(now)), sqlTimestamp(utcMonthStart(now, 1)))
    .first<{ net_seconds: number }>();

  const net = Number(row?.net_seconds ?? 0);
  return Number.isFinite(net) && net < 0 ? Math.ceil(-net) : 0;
}

/**
 * Seconds this user has already committed but not yet been charged for: jobs
 * accepted and still queued / resolving / transcribing. The provider will bill
 * them, so the gate must treat them as spent even though no ledger row exists
 * yet (the spend row is written only once a transcript is persisted).
 *
 * A row whose `duration_seconds` is still NULL (the common case for a URL we
 * have not measured) is assumed to be the longest source we allow, exactly as
 * the precheck assumes the cap for an unknown estimate. Under-assuming here
 * would let the burst it exists to stop through.
 *
 * A started row that has gone quiet for longer than
 * TRANSCRIPTION_STALE_JOB_MINUTES is excluded: it was killed mid-flight and is
 * not going to bill anything, so continuing to subtract its assumed 90 minutes
 * would silently shrink this teacher's month for a run that no longer exists.
 *
 * Bounded to the same UTC month bucket as the spend sum: hours are allowed per
 * month, so a still-running job from a previous month is not this month's
 * problem, and a stuck row cannot eat every future allowance forever.
 *
 * Indexed either way — `EXPLAIN QUERY PLAN` against migration 0017 picks
 * `idx_transcription_jobs_user (user_id, created_at)`, which is the tighter
 * choice here because the sum is user-scoped; `idx_transcription_jobs_active`
 * covers the same statuses unscoped, for ops queries.
 */
const IN_FLIGHT_SECONDS_SUBQUERY = `SELECT COALESCE(SUM(COALESCE(duration_seconds, ?)), 0)
     FROM transcription_jobs
     WHERE user_id = ?
       AND status IN ('queued', 'resolving', 'transcribing')
       AND (status = 'queued' OR updated_at > ?)
       AND created_at >= ? AND created_at < ?`;

/**
 * The five binds `IN_FLIGHT_SECONDS_SUBQUERY` expects, in order. Shared so the
 * number a teacher is shown and the number the INSERT enforces are computed by
 * the same SQL against the same clock — a gate that disagrees with its own
 * explanation is worse than no gate.
 */
function inFlightBinds(userId: string, now: Date): (string | number)[] {
  return [
    TRANSCRIPTION_MAX_SOURCE_SECONDS,
    userId,
    sqlTimestamp(new Date(now.getTime() - TRANSCRIPTION_STALE_JOB_MINUTES * 60_000)),
    sqlTimestamp(utcMonthStart(now)),
    sqlTimestamp(utcMonthStart(now, 1)),
  ];
}

async function sumInFlightSeconds(env: Env, userId: string, now: Date): Promise<number> {
  const row = await env.DB.prepare(`SELECT (${IN_FLIGHT_SECONDS_SUBQUERY}) AS committed_seconds`)
    .bind(...inFlightBinds(userId, now))
    .first<{ committed_seconds: number }>();

  const committed = Number(row?.committed_seconds ?? 0);
  return Number.isFinite(committed) && committed > 0 ? Math.ceil(committed) : 0;
}

/**
 * The hot read: one KV get. Cheap enough for the Studio to poll while a job
 * runs, which is exactly why the counter exists.
 *
 * Display only — it can under-report (lost or stale counter). Never gate a paid
 * call on it; call `precheckTranscriptionQuota`, which reads the ledger.
 */
export async function getTranscriptionQuotaBalance(
  env: Env,
  userId: string,
  options: TranscriptionQuotaOptions = {}
): Promise<TranscriptionQuotaBalance> {
  const now = options.now ?? new Date();
  const raw = await env.SESSIONS.get(transcriptionQuotaKey(userId, now));
  return buildBalance(normalizeSeconds(raw), now);
}

/**
 * Rebuilds the KV counter from the ledger and returns the corrected balance.
 * Call this after inserting a ledger row by hand (an admin grant or refund) —
 * the counter is a cache and this is how you invalidate it.
 */
export async function reconcileTranscriptionQuota(
  env: Env,
  userId: string,
  options: TranscriptionQuotaOptions = {}
): Promise<TranscriptionQuotaBalance> {
  const now = options.now ?? new Date();
  const includedUsed = await sumMonthlySpend(env, userId, now);
  await env.SESSIONS.put(transcriptionQuotaKey(userId, now), String(includedUsed), {
    expirationTtl: TRANSCRIPTION_QUOTA_TTL_SECONDS,
  });
  return buildBalance(includedUsed, now);
}

/**
 * The gate before any paid provider call.
 *
 * Two rejections, deliberately different in kind because the teacher-facing
 * sentence is different:
 *
 *   * "this one file is too long" — THROWS `source_too_long` (HTTP 413). It is
 *     a property of the media, not of the account: buying nothing and waiting
 *     for next month both fail to fix it. The teacher must split or trim.
 *   * "you are out of hours this month" — RETURNS `{ ok: false }` with
 *     `reason: "transcription_quota_exceeded"`, which the caller turns into a
 *     `quota_exceeded` failure (HTTP 402). Nothing is wrong with the file; the
 *     allowance resets on `balance.monthResetsOn`.
 *
 * Callers that do not know the duration yet must pass
 * TRANSCRIPTION_MAX_SOURCE_SECONDS, so a teacher with four minutes left cannot
 * start a 90-minute job and discover the problem after we have paid a provider.
 * An unusable `estimatedSeconds` (NaN because the resolver could not measure the
 * media) is treated as exactly that case rather than as zero.
 *
 * No fudge factor is applied (unlike TTS, which estimates seconds from script
 * length and pads by 1.2). Media duration is measured, not guessed, so padding
 * would only reject jobs we can actually afford.
 *
 * This is the one function that must NOT read the KV counter: see "WHERE THE
 * TRUTH LIVES" above. It recomputes from the ledger and repairs the cache on the
 * way past — two aggregate queries per submission, not per poll.
 *
 * `allowedSeconds` is the ledger remainder MINUS the hours this user's still-
 * running jobs have already committed. Without that subtraction the gate only
 * knows about finished work, and a teacher who submits three 90-minute podcasts
 * back to back with thirty minutes left passes all three checks and we pay for
 * 4 h 30. The returned `balance` keeps reporting the ledger truth (that is what
 * has actually been spent); only the gate's headroom shrinks.
 */
export async function precheckTranscriptionQuota(
  env: Env,
  userId: string,
  estimatedSeconds: number,
  options: TranscriptionQuotaOptions = {}
): Promise<TranscriptionQuotaPrecheck> {
  const requestedSeconds = usableSeconds(estimatedSeconds, TRANSCRIPTION_MAX_SOURCE_SECONDS);

  if (requestedSeconds > TRANSCRIPTION_MAX_SOURCE_SECONDS) {
    throw new TranscriptionError({
      code: "source_too_long",
      durationSeconds: requestedSeconds,
      maxSeconds: TRANSCRIPTION_MAX_SOURCE_SECONDS,
    });
  }

  // One clock for both aggregates, so the ledger window and the in-flight
  // window can never land in different months.
  const now = options.now ?? new Date();
  const balance = await reconcileTranscriptionQuota(env, userId, { now });
  const inFlightSeconds = await sumInFlightSeconds(env, userId, now);
  const allowedSeconds = Math.max(0, balance.includedRemaining - inFlightSeconds);

  if (requestedSeconds > allowedSeconds) {
    return {
      ok: false,
      balance,
      estimatedSeconds: requestedSeconds,
      allowedSeconds,
      reason: "transcription_quota_exceeded",
    };
  }

  return { ok: true, balance };
}

/**
 * The atomic half of the gate: a boolean SQL expression that re-counts this
 * user's in-flight seconds and is meant to be used as the `WHERE` of the
 * `INSERT … SELECT` that creates the job row.
 *
 * Why it has to be SQL and not a number: `precheckTranscriptionQuota` above does
 * three awaits, all of them reads, and the caller then inserts in a fourth round
 * trip. Ten concurrent submissions therefore all observe the same untouched
 * allowance and all insert — the in-flight subtraction only ever stopped a
 * teacher who submitted one at a time. Folding the count into the insert makes
 * reservation and admission the same statement, and a single statement is atomic
 * in SQLite, so the loser of a race inserts nothing at all.
 *
 * The caller treats `changes === 0` as `quota_exceeded`. Nothing else can cause
 * it: the row's id is freshly minted, so there is no conflict to lose to.
 */
export interface TranscriptionAdmissionGate {
  /** Drop straight into `INSERT … SELECT ? , ? … WHERE <predicate>`. */
  readonly predicate: string;
  /** Append after the column values, in this order. */
  readonly binds: readonly (string | number)[];
}

export function buildTranscriptionAdmissionGate(
  userId: string,
  requestedSeconds: number,
  allowanceSeconds: number,
  now: Date
): TranscriptionAdmissionGate {
  return {
    predicate: `(${IN_FLIGHT_SECONDS_SUBQUERY}) + ? <= ?`,
    binds: [
      ...inFlightBinds(userId, now),
      usableSeconds(requestedSeconds, TRANSCRIPTION_MAX_SOURCE_SECONDS),
      Math.max(0, Math.floor(allowanceSeconds)),
    ],
  };
}

/**
 * Books what a completed job actually cost. Called AFTER the transcript is
 * persisted: the provider has already billed us and the teacher's work already
 * exists, so this is bookkeeping and must never destroy either.
 *
 * Consequences of that ordering, both intentional:
 *   * Idempotent per `jobId` — a requeue re-charges nothing.
 *   * It does NOT refuse an overshoot. If the media turned out longer than the
 *     precheck assumed, the full spend is recorded and `includedRemaining`
 *     bottoms out at 0 (`includedUsed` may exceed the limit, which is exactly
 *     what an honest audit trail should show). The precheck is the gate; this
 *     is the receipt.
 *   * The 90-minute cap is not re-checked here. We bill what the provider
 *     measured — pretending a 91-minute file cost 90 would put us out of pocket
 *     and hide the ingest bug that let it through.
 */
export async function chargeTranscriptionQuota(
  env: Env,
  userId: string,
  jobId: string,
  seconds: number,
  provider: TranscriptionProviderId,
  options: TranscriptionQuotaOptions = {}
): Promise<TranscriptionQuotaBalance> {
  const now = options.now ?? new Date();
  const chargeSeconds = usableSeconds(seconds, 0);

  // A zero-second job leaves no row: an empty audit entry is noise, not audit.
  // An unusable duration lands here too — better to under-bill than to throw a
  // constraint error at a job whose transcript is already saved.
  if (chargeSeconds === 0) {
    return getTranscriptionQuotaBalance(env, userId, { now });
  }

  // The idempotency guard, and the only durable write. `INSERT ... SELECT ...
  // WHERE NOT EXISTS` is one atomic SQLite statement, so a retry cannot slip
  // between a read and a write. `created_at` is written explicitly from the
  // injected clock so the ledger month always agrees with the KV month key.
  await env.DB.prepare(
    `INSERT INTO transcription_quota_ledger
       (user_id, delta_seconds, reason, provider, job_id, created_at)
     SELECT ?, ?, 'transcription', ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM transcription_quota_ledger
       WHERE job_id = ? AND reason = 'transcription'
     )`
  )
    .bind(userId, -chargeSeconds, provider, jobId, sqlTimestamp(now), jobId)
    .run();

  return reconcileTranscriptionQuota(env, userId, { now });
}
