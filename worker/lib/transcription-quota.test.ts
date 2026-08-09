import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../env";
import { getAudioQuotaBalance } from "./audio-quota";
import {
  chargeTranscriptionQuota,
  getTranscriptionQuotaBalance,
  precheckTranscriptionQuota,
  reconcileTranscriptionQuota,
  transcriptionQuotaKey,
} from "./transcription-quota";
import {
  TRANSCRIPTION_INCLUDED_SECONDS_PER_MONTH,
  TRANSCRIPTION_MAX_SOURCE_SECONDS,
  isTranscriptionError,
} from "./transcription/types";

const testEnv = env as unknown as Env;

/**
 * `transcription_jobs` is trimmed to its NOT NULL columns plus the two the gate
 * reads (`status`, `duration_seconds`) — enough for the ledger's `job_id`
 * foreign key to be satisfied realistically and for the in-flight sum to be
 * exercised. The ledger table itself is copied verbatim from migration 0017,
 * CHECK constraints included, so these tests fail if the module ever writes an
 * out-of-vocabulary reason or provider. The two TTS tables are created and
 * seeded on purpose: several tests below assert that nothing in this module goes
 * anywhere near them.
 */
const TEST_SCHEMA_STATEMENTS = [
  "PRAGMA foreign_keys = OFF",
  "DROP TABLE IF EXISTS transcription_quota_ledger",
  "DROP TABLE IF EXISTS transcription_jobs",
  "DROP TABLE IF EXISTS quota_ledger",
  "DROP TABLE IF EXISTS credit_balances",
  "DROP TABLE IF EXISTS users",
  "PRAGMA foreign_keys = ON",
  `CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'teacher' CHECK (role IN ('teacher', 'admin')),
  language_preference TEXT NOT NULL DEFAULT 'fr',
  profile TEXT NOT NULL DEFAULT '{}',
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'participant')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE TABLE transcription_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'resolving', 'transcribing', 'completed', 'failed')),
  source_kind TEXT NOT NULL
    CHECK (source_kind IN ('upload', 'direct_url', 'podcast', 'youtube')),
  diarize_requested INTEGER NOT NULL DEFAULT 0 CHECK (diarize_requested IN (0, 1)),
  diarization INTEGER NOT NULL DEFAULT 0 CHECK (diarization IN (0, 1)),
  duration_seconds INTEGER,
  request_payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)`,
  `CREATE TABLE transcription_quota_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  delta_seconds INTEGER NOT NULL,
  reason TEXT NOT NULL
    CHECK (reason IN ('transcription', 'refund', 'admin_adjust')),
  provider TEXT
    CHECK (provider IS NULL OR provider IN ('groq', 'deepgram')),
  job_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES transcription_jobs(id) ON DELETE SET NULL
)`,
  `CREATE TABLE quota_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  delta_seconds INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('included','credit')),
  reason TEXT NOT NULL CHECK (reason IN ('generation','regeneration','credit_grant','admin_adjust')),
  job_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)`,
  `CREATE TABLE credit_balances (
  user_id TEXT PRIMARY KEY,
  seconds INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)`,
];

const HOUR = 3_600;

async function resetDb() {
  for (const statement of TEST_SCHEMA_STATEMENTS) {
    await testEnv.DB.prepare(statement).run();
  }
}

async function seedUser(userId: string) {
  await testEnv.DB.prepare(
    `INSERT INTO users (id, email, name, password_hash, tier)
     VALUES (?, ?, 'Transcription Tester', 'hash', 'participant')`
  )
    .bind(userId, `${userId}@example.com`)
    .run();
}

/** `YYYY-MM-DD HH:MM:SS`, the shape SQLite's `datetime('now')` default writes. */
function sqlTime(date: Date) {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

/**
 * A job whose spend is (about to be) in the ledger, i.e. finished. Charging
 * setup jobs are seeded as 'completed' on purpose: a row left 'queued' would be
 * counted as in-flight by the gate, which is exactly the behaviour the tests at
 * the bottom of this file pin down.
 */
async function seedJob(userId: string, jobId: string) {
  await testEnv.DB.prepare(
    `INSERT INTO transcription_jobs (id, user_id, status, source_kind, request_payload)
     VALUES (?, ?, 'completed', 'direct_url', '{"kind":"direct_url","url":"https://example.test/a.mp3"}')`
  )
    .bind(jobId, userId)
    .run();
}

/**
 * A job the teacher has already submitted that has not finished: the provider
 * will bill it, but no ledger row exists yet. `durationSeconds: null` is the
 * common real case — a pasted URL we have not measured.
 *
 * `updatedAt` defaults to `createdAt` and is written explicitly, because the gate
 * reads it: a started row that has gone quiet for longer than
 * TRANSCRIPTION_STALE_JOB_MINUTES was killed mid-flight and stops counting.
 * Leaving the column on its `datetime('now')` default would pin every fixture to
 * real wall-clock time while these tests run on an injected clock.
 */
async function seedRunningJob(
  userId: string,
  jobId: string,
  options: {
    status?: "queued" | "resolving" | "transcribing" | "completed" | "failed";
    createdAt: Date;
    updatedAt?: Date;
    durationSeconds?: number | null;
  }
) {
  await testEnv.DB.prepare(
    `INSERT INTO transcription_jobs
       (id, user_id, status, source_kind, duration_seconds, request_payload, created_at, updated_at)
     VALUES (?, ?, ?, 'direct_url', ?, '{"kind":"direct_url","url":"https://example.test/a.mp3"}', ?, ?)`
  )
    .bind(
      jobId,
      userId,
      options.status ?? "transcribing",
      options.durationSeconds ?? null,
      sqlTime(options.createdAt),
      sqlTime(options.updatedAt ?? options.createdAt)
    )
    .run();
}

async function ledgerRows(userId: string) {
  const { results } = await testEnv.DB.prepare(
    `SELECT job_id, reason, provider, delta_seconds
     FROM transcription_quota_ledger
     WHERE user_id = ?
     ORDER BY id`
  )
    .bind(userId)
    .all<{ job_id: string | null; reason: string; provider: string | null; delta_seconds: number }>();
  return results;
}

async function counterValue(userId: string, now: Date) {
  return testEnv.SESSIONS.get(transcriptionQuotaKey(userId, now));
}

/** A user id unique per test, so a shared KV namespace cannot leak across them. */
function uid(name: string) {
  return `trans-${name}`;
}

describe("transcription quota — balance", () => {
  beforeEach(resetDb);

  it("reports a fresh 10-hour allowance when nothing has been spent", async () => {
    const userId = uid("fresh");
    await seedUser(userId);

    const balance = await getTranscriptionQuotaBalance(testEnv, userId, {
      now: new Date("2026-03-04T09:30:00.000Z"),
    });

    expect(TRANSCRIPTION_INCLUDED_SECONDS_PER_MONTH).toBe(10 * HOUR);
    expect(balance).toEqual({
      includedLimit: 10 * HOUR,
      includedUsed: 0,
      includedRemaining: 10 * HOUR,
      month: "2026-03",
      monthResetsOn: "2026-04-01T00:00:00.000Z",
    });
  });

  it("reports partial usage after a charge", async () => {
    const userId = uid("partial");
    const now = new Date("2026-03-10T11:00:00.000Z");
    await seedUser(userId);
    await seedJob(userId, "partial-job");

    await chargeTranscriptionQuota(testEnv, userId, "partial-job", 2 * HOUR, "groq", { now });
    const balance = await getTranscriptionQuotaBalance(testEnv, userId, { now });

    expect(balance.includedUsed).toBe(2 * HOUR);
    expect(balance.includedRemaining).toBe(8 * HOUR);
    expect(await ledgerRows(userId)).toEqual([
      { job_id: "partial-job", reason: "transcription", provider: "groq", delta_seconds: -7_200 },
    ]);
  });

  it("rounds fractional provider durations up to whole seconds", async () => {
    const userId = uid("rounding");
    const now = new Date("2026-03-11T11:00:00.000Z");
    await seedUser(userId);
    await seedJob(userId, "rounding-job");

    const balance = await chargeTranscriptionQuota(testEnv, userId, "rounding-job", 191.2, "deepgram", {
      now,
    });

    expect(balance.includedUsed).toBe(192);
    expect(await ledgerRows(userId)).toEqual([
      { job_id: "rounding-job", reason: "transcription", provider: "deepgram", delta_seconds: -192 },
    ]);
  });

  it("writes no ledger row for a zero-second charge", async () => {
    const userId = uid("zero");
    const now = new Date("2026-03-12T11:00:00.000Z");
    await seedUser(userId);
    await seedJob(userId, "zero-job");

    const balance = await chargeTranscriptionQuota(testEnv, userId, "zero-job", 0, "groq", { now });

    expect(balance.includedUsed).toBe(0);
    expect(await ledgerRows(userId)).toEqual([]);
  });
});

describe("transcription quota — precheck", () => {
  beforeEach(resetDb);

  it("allows a job that lands exactly on the remaining allowance", async () => {
    const userId = uid("exact-limit");
    const now = new Date("2026-04-05T08:00:00.000Z");
    await seedUser(userId);
    await seedJob(userId, "exact-setup");

    // 9 h 30 spent, so exactly 1 800 s remain.
    await chargeTranscriptionQuota(testEnv, userId, "exact-setup", 9.5 * HOUR, "groq", { now });

    const exact = await precheckTranscriptionQuota(testEnv, userId, 1_800, { now });
    expect(exact).toMatchObject({ ok: true });
    expect(exact.balance.includedRemaining).toBe(1_800);
  });

  it("rejects the second the estimate passes the remaining allowance", async () => {
    const userId = uid("over-limit");
    const now = new Date("2026-04-06T08:00:00.000Z");
    await seedUser(userId);
    await seedJob(userId, "over-setup");

    await chargeTranscriptionQuota(testEnv, userId, "over-setup", 9.5 * HOUR, "groq", { now });

    const rejected = await precheckTranscriptionQuota(testEnv, userId, 1_801, { now });
    expect(rejected).toMatchObject({
      ok: false,
      estimatedSeconds: 1_801,
      allowedSeconds: 1_800,
      reason: "transcription_quota_exceeded",
    });
  });

  it("rejects an unknown-duration job when the 90-minute assumption does not fit", async () => {
    // The caller passes the cap when duration is unknown, so a teacher with four
    // minutes left cannot start a long job and find out after we have paid.
    const userId = uid("unknown-duration");
    const now = new Date("2026-04-07T08:00:00.000Z");
    await seedUser(userId);
    await seedJob(userId, "unknown-setup");

    await chargeTranscriptionQuota(
      testEnv,
      userId,
      "unknown-setup",
      TRANSCRIPTION_INCLUDED_SECONDS_PER_MONTH - 240,
      "groq",
      { now }
    );

    await expect(
      precheckTranscriptionQuota(testEnv, userId, TRANSCRIPTION_MAX_SOURCE_SECONDS, { now })
    ).resolves.toMatchObject({ ok: false, allowedSeconds: 240 });
  });

  it("accepts a source of exactly 90 minutes on a fresh allowance", async () => {
    const userId = uid("cap-boundary-ok");
    await seedUser(userId);

    await expect(
      precheckTranscriptionQuota(testEnv, userId, TRANSCRIPTION_MAX_SOURCE_SECONDS, {
        now: new Date("2026-04-08T08:00:00.000Z"),
      })
    ).resolves.toMatchObject({ ok: true });
  });

  it("throws source_too_long past 90 minutes — a distinct rejection, not 'out of hours'", async () => {
    // Different cause, different teacher-facing sentence, different HTTP status:
    // the file must be split, and next month's reset will not help.
    const userId = uid("cap-exceeded");
    await seedUser(userId);
    const now = new Date("2026-04-09T08:00:00.000Z");

    let caught: unknown;
    try {
      await precheckTranscriptionQuota(testEnv, userId, TRANSCRIPTION_MAX_SOURCE_SECONDS + 1, { now });
    } catch (error) {
      caught = error;
    }

    expect(isTranscriptionError(caught)).toBe(true);
    if (!isTranscriptionError(caught)) throw new Error("expected a TranscriptionError");
    expect(caught.failure).toEqual({
      code: "source_too_long",
      durationSeconds: TRANSCRIPTION_MAX_SOURCE_SECONDS + 1,
      maxSeconds: TRANSCRIPTION_MAX_SOURCE_SECONDS,
    });
    // The over-long file is rejected on its own terms, with the whole month still
    // untouched — never reported as a spent allowance.
    const balance = await getTranscriptionQuotaBalance(testEnv, userId, { now });
    expect(balance.includedRemaining).toBe(TRANSCRIPTION_INCLUDED_SECONDS_PER_MONTH);
  });

  it("gates on the ledger, so a lost KV counter does not hand back the month", async () => {
    // The failure this exists to prevent: one KV write that never landed would
    // re-open a fully spent allowance for every job that followed, and nothing
    // downstream re-checks before we pay the provider.
    const userId = uid("lost-counter");
    const now = new Date("2026-09-11T08:00:00.000Z");
    await seedUser(userId);
    await seedJob(userId, "lost-counter-setup");
    await chargeTranscriptionQuota(
      testEnv,
      userId,
      "lost-counter-setup",
      TRANSCRIPTION_INCLUDED_SECONDS_PER_MONTH,
      "groq",
      { now }
    );

    // The audit row survives; only the derived cache is gone.
    await testEnv.SESSIONS.delete(transcriptionQuotaKey(userId, now));
    expect((await getTranscriptionQuotaBalance(testEnv, userId, { now })).includedUsed).toBe(0);

    const rejected = await precheckTranscriptionQuota(testEnv, userId, 1_800, { now });

    expect(rejected).toMatchObject({
      ok: false,
      estimatedSeconds: 1_800,
      allowedSeconds: 0,
      reason: "transcription_quota_exceeded",
    });
    expect(rejected.balance.includedUsed).toBe(TRANSCRIPTION_INCLUDED_SECONDS_PER_MONTH);
    // Having read the truth, it also leaves the cache correct for the next poll.
    expect(await counterValue(userId, now)).toBe(String(TRANSCRIPTION_INCLUDED_SECONDS_PER_MONTH));
  });

  it("gates on the ledger when the counter is merely stale, not missing", async () => {
    // KV is eventually consistent (~60 s), so a teacher submitting several files
    // back to back can read a counter from before the previous charge.
    const userId = uid("stale-counter");
    const now = new Date("2026-09-12T08:00:00.000Z");
    await seedUser(userId);
    await seedJob(userId, "stale-counter-setup");
    await chargeTranscriptionQuota(
      testEnv,
      userId,
      "stale-counter-setup",
      TRANSCRIPTION_INCLUDED_SECONDS_PER_MONTH - 600,
      "groq",
      { now }
    );
    // Rewind the cache to an earlier, smaller reading.
    await testEnv.SESSIONS.put(transcriptionQuotaKey(userId, now), "600");

    await expect(
      precheckTranscriptionQuota(testEnv, userId, 1_800, { now })
    ).resolves.toMatchObject({ ok: false, allowedSeconds: 600 });
  });

  it("treats an unmeasurable duration as the 90-minute cap, never as zero", async () => {
    // A resolver that could not read the media length yields NaN. Gating that as
    // 0 s would wave through the most expensive job we allow.
    const userId = uid("unusable-estimate");
    const now = new Date("2026-09-13T08:00:00.000Z");
    await seedUser(userId);
    await seedJob(userId, "unusable-estimate-setup");
    await chargeTranscriptionQuota(
      testEnv,
      userId,
      "unusable-estimate-setup",
      TRANSCRIPTION_INCLUDED_SECONDS_PER_MONTH - 240,
      "groq",
      { now }
    );

    await expect(
      precheckTranscriptionQuota(testEnv, userId, Number.NaN, { now })
    ).resolves.toMatchObject({
      ok: false,
      estimatedSeconds: TRANSCRIPTION_MAX_SOURCE_SECONDS,
      allowedSeconds: 240,
      reason: "transcription_quota_exceeded",
    });
    await expect(
      precheckTranscriptionQuota(testEnv, userId, Number.POSITIVE_INFINITY, { now })
    ).resolves.toMatchObject({ ok: false, estimatedSeconds: TRANSCRIPTION_MAX_SOURCE_SECONDS });
  });

  it("throws the length rejection before spending a KV read on an empty account", async () => {
    const userId = uid("cap-precedence");
    const now = new Date("2026-04-10T08:00:00.000Z");
    await seedUser(userId);
    await seedJob(userId, "cap-precedence-setup");
    // Out of hours AND over the length cap: length wins, because it is the fact
    // the teacher can act on.
    await chargeTranscriptionQuota(
      testEnv,
      userId,
      "cap-precedence-setup",
      TRANSCRIPTION_INCLUDED_SECONDS_PER_MONTH,
      "groq",
      { now }
    );

    await expect(
      precheckTranscriptionQuota(testEnv, userId, 7_200, { now })
    ).rejects.toMatchObject({ failure: { code: "source_too_long" } });
  });
});

describe("transcription quota — precheck counts jobs still in flight", () => {
  beforeEach(resetDb);

  it("subtracts a running job's hours, which the ledger cannot see yet", async () => {
    // The spend row is written only once a transcript exists, so a ledger-only
    // gate reads a fully committed 90-minute job as zero seconds used and hands
    // out the same headroom twice.
    const userId = uid("in-flight-one");
    const now = new Date("2026-10-05T09:00:00.000Z");
    await seedUser(userId);
    await seedJob(userId, "in-flight-one-setup");
    // 8 h billed, so 2 h of allowance is left…
    await chargeTranscriptionQuota(testEnv, userId, "in-flight-one-setup", 8 * HOUR, "groq", { now });
    // …and a 90-minute job accepted a moment ago is already spending 1 h 30 of it.
    await seedRunningJob(userId, "in-flight-one-job", {
      status: "transcribing",
      createdAt: new Date("2026-10-05T08:55:00.000Z"),
      durationSeconds: TRANSCRIPTION_MAX_SOURCE_SECONDS,
    });

    const rejected = await precheckTranscriptionQuota(
      testEnv,
      userId,
      TRANSCRIPTION_MAX_SOURCE_SECONDS,
      { now }
    );

    expect(rejected).toMatchObject({
      ok: false,
      estimatedSeconds: TRANSCRIPTION_MAX_SOURCE_SECONDS,
      allowedSeconds: 2 * HOUR - TRANSCRIPTION_MAX_SOURCE_SECONDS,
      reason: "transcription_quota_exceeded",
    });
    // The reported balance still tells the ledger truth — the running job has
    // not been billed yet. Only the gate's headroom shrank.
    expect(rejected.balance.includedUsed).toBe(8 * HOUR);
    expect(rejected.balance.includedRemaining).toBe(2 * HOUR);
  });

  it("stops a burst instead of accepting every submission against the same allowance", async () => {
    // The real failure: a teacher pastes seven 90-minute podcasts in a row. Each
    // precheck happens before its row exists (createTranscriptionJob's ordering),
    // so the gate has to see the previous six.
    const userId = uid("burst");
    const now = new Date("2026-10-06T09:00:00.000Z");
    await seedUser(userId);

    const accepted: number[] = [];
    let lastRejection: Awaited<ReturnType<typeof precheckTranscriptionQuota>> | null = null;

    for (let attempt = 0; attempt < 7; attempt += 1) {
      const result = await precheckTranscriptionQuota(
        testEnv,
        userId,
        TRANSCRIPTION_MAX_SOURCE_SECONDS,
        { now }
      );
      if (!result.ok) {
        lastRejection = result;
        break;
      }
      accepted.push(attempt);
      await seedRunningJob(userId, `burst-job-${attempt}`, {
        status: "queued",
        createdAt: now,
        durationSeconds: TRANSCRIPTION_MAX_SOURCE_SECONDS,
      });
    }

    // 6 x 90 min = 9 h fits inside 10 h; the seventh does not.
    expect(accepted).toHaveLength(6);
    expect(lastRejection).toMatchObject({
      ok: false,
      allowedSeconds: TRANSCRIPTION_INCLUDED_SECONDS_PER_MONTH - 6 * TRANSCRIPTION_MAX_SOURCE_SECONDS,
      reason: "transcription_quota_exceeded",
    });
  });

  it("assumes the 90-minute cap for a running job of unmeasured length", async () => {
    // duration_seconds is NULL until something measures the media. Counting that
    // as zero would wave through exactly the burst this gate exists to stop.
    const userId = uid("in-flight-unknown");
    const now = new Date("2026-10-07T09:00:00.000Z");
    await seedUser(userId);
    await seedJob(userId, "in-flight-unknown-setup");
    // 8 h 30 already billed, so 90 minutes of allowance remain…
    await chargeTranscriptionQuota(
      testEnv,
      userId,
      "in-flight-unknown-setup",
      TRANSCRIPTION_INCLUDED_SECONDS_PER_MONTH - TRANSCRIPTION_MAX_SOURCE_SECONDS,
      "groq",
      { now }
    );
    // …and one unmeasured job is already using them.
    await seedRunningJob(userId, "in-flight-unknown-job", {
      status: "resolving",
      createdAt: now,
      durationSeconds: null,
    });

    await expect(
      precheckTranscriptionQuota(testEnv, userId, 1_800, { now })
    ).resolves.toMatchObject({ ok: false, allowedSeconds: 0 });
  });

  it("does not double-count finished jobs, whose hours are already in the ledger", async () => {
    // If terminal rows counted, every completed transcript would be charged
    // twice — once by its ledger row and once by the gate.
    const userId = uid("in-flight-terminal");
    const now = new Date("2026-10-08T09:00:00.000Z");
    await seedUser(userId);
    await seedRunningJob(userId, "terminal-completed", {
      status: "completed",
      createdAt: now,
      durationSeconds: TRANSCRIPTION_MAX_SOURCE_SECONDS,
    });
    await seedRunningJob(userId, "terminal-failed", {
      status: "failed",
      createdAt: now,
      durationSeconds: TRANSCRIPTION_MAX_SOURCE_SECONDS,
    });
    await chargeTranscriptionQuota(
      testEnv,
      userId,
      "terminal-completed",
      TRANSCRIPTION_MAX_SOURCE_SECONDS,
      "groq",
      { now }
    );

    const result = await precheckTranscriptionQuota(
      testEnv,
      userId,
      TRANSCRIPTION_MAX_SOURCE_SECONDS,
      { now }
    );

    expect(result).toMatchObject({ ok: true });
    expect(result.balance.includedUsed).toBe(TRANSCRIPTION_MAX_SOURCE_SECONDS);
  });

  it("lets a new month start clean even while last month's job is still running", async () => {
    // Hours are allowed per month, and a stuck row must not eat every future
    // allowance forever.
    const userId = uid("in-flight-rollover");
    const october = new Date("2026-10-31T23:55:00.000Z");
    await seedUser(userId);
    await seedJob(userId, "in-flight-rollover-setup");
    await chargeTranscriptionQuota(testEnv, userId, "in-flight-rollover-setup", 8 * HOUR, "groq", {
      now: october,
    });
    await seedRunningJob(userId, "stuck-october-job", {
      status: "transcribing",
      createdAt: new Date("2026-10-31T23:50:00.000Z"),
      durationSeconds: TRANSCRIPTION_MAX_SOURCE_SECONDS,
    });

    await expect(
      precheckTranscriptionQuota(testEnv, userId, TRANSCRIPTION_MAX_SOURCE_SECONDS, { now: october })
    ).resolves.toMatchObject({
      ok: false,
      allowedSeconds: 2 * HOUR - TRANSCRIPTION_MAX_SOURCE_SECONDS,
    });

    await expect(
      precheckTranscriptionQuota(testEnv, userId, TRANSCRIPTION_MAX_SOURCE_SECONDS, {
        now: new Date("2026-11-01T00:05:00.000Z"),
      })
    ).resolves.toMatchObject({ ok: true });
  });

  it("stops counting a started job that was killed mid-flight", async () => {
    // An isolate eviction or a wall-clock kill leaves the row in a live status
    // with nothing running behind it. No consumer invocation lives 15 minutes, so
    // a 'transcribing' row untouched for an hour is dead — and a dead row must not
    // keep 90 minutes of this teacher's month reserved for the rest of the month.
    const userId = uid("in-flight-stale");
    const now = new Date("2026-10-10T12:00:00.000Z");
    await seedUser(userId);
    await seedJob(userId, "in-flight-stale-setup");
    // 8 h 30 billed: exactly 90 minutes of allowance left.
    await chargeTranscriptionQuota(
      testEnv,
      userId,
      "in-flight-stale-setup",
      TRANSCRIPTION_INCLUDED_SECONDS_PER_MONTH - TRANSCRIPTION_MAX_SOURCE_SECONDS,
      "groq",
      { now }
    );
    await seedRunningJob(userId, "abandoned-job", {
      status: "transcribing",
      createdAt: new Date("2026-10-10T11:00:00.000Z"),
      updatedAt: new Date("2026-10-10T11:00:00.000Z"),
      durationSeconds: TRANSCRIPTION_MAX_SOURCE_SECONDS,
    });

    // The teacher's remaining 90 minutes are still theirs.
    await expect(
      precheckTranscriptionQuota(testEnv, userId, TRANSCRIPTION_MAX_SOURCE_SECONDS, { now })
    ).resolves.toMatchObject({ ok: true });

    // …but a job that reported progress a minute ago is genuinely running and
    // still counts.
    await seedRunningJob(userId, "live-job", {
      status: "transcribing",
      createdAt: new Date("2026-10-10T11:55:00.000Z"),
      updatedAt: new Date("2026-10-10T11:59:00.000Z"),
      durationSeconds: TRANSCRIPTION_MAX_SOURCE_SECONDS,
    });
    await expect(
      precheckTranscriptionQuota(testEnv, userId, TRANSCRIPTION_MAX_SOURCE_SECONDS, { now })
    ).resolves.toMatchObject({ ok: false, allowedSeconds: 0 });
  });

  it("keeps counting a job that is still only queued, however long the wait", async () => {
    // Never age out a row that has not started: a backed-up queue is not a dead
    // job, and waving those through would let a burst pass by simply being slow.
    const userId = uid("in-flight-queued-old");
    const now = new Date("2026-10-11T12:00:00.000Z");
    await seedUser(userId);
    await seedRunningJob(userId, "long-queued-job", {
      status: "queued",
      createdAt: new Date("2026-10-11T09:00:00.000Z"),
      updatedAt: new Date("2026-10-11T09:00:00.000Z"),
      durationSeconds: TRANSCRIPTION_INCLUDED_SECONDS_PER_MONTH,
    });

    await expect(
      precheckTranscriptionQuota(testEnv, userId, TRANSCRIPTION_MAX_SOURCE_SECONDS, { now })
    ).resolves.toMatchObject({ ok: false, allowedSeconds: 0 });
  });

  it("counts only this teacher's running jobs", async () => {
    const userId = uid("in-flight-mine");
    const otherId = uid("in-flight-theirs");
    const now = new Date("2026-10-09T09:00:00.000Z");
    await seedUser(userId);
    await seedUser(otherId);
    // Another teacher is mid-transcription; it must not touch this allowance.
    await seedRunningJob(otherId, "someone-elses-job", {
      status: "transcribing",
      createdAt: now,
      durationSeconds: TRANSCRIPTION_MAX_SOURCE_SECONDS,
    });

    await expect(
      precheckTranscriptionQuota(testEnv, userId, TRANSCRIPTION_MAX_SOURCE_SECONDS, { now })
    ).resolves.toMatchObject({ ok: true });
  });
});

describe("transcription quota — charging", () => {
  beforeEach(resetDb);

  it("is idempotent per job id, so a queue retry cannot double-charge", async () => {
    const userId = uid("retry");
    const now = new Date("2026-05-02T10:00:00.000Z");
    await seedUser(userId);
    await seedJob(userId, "retry-job");

    const first = await chargeTranscriptionQuota(testEnv, userId, "retry-job", 900, "deepgram", { now });
    const second = await chargeTranscriptionQuota(testEnv, userId, "retry-job", 900, "deepgram", { now });
    const third = await chargeTranscriptionQuota(testEnv, userId, "retry-job", 900, "deepgram", { now });

    expect(first.includedUsed).toBe(900);
    expect(second.includedUsed).toBe(900);
    expect(third.includedUsed).toBe(900);
    expect(await ledgerRows(userId)).toHaveLength(1);
    expect(await counterValue(userId, now)).toBe("900");
  });

  it("charges two different jobs independently", async () => {
    const userId = uid("two-jobs");
    const now = new Date("2026-05-03T10:00:00.000Z");
    await seedUser(userId);
    await seedJob(userId, "job-a");
    await seedJob(userId, "job-b");

    await chargeTranscriptionQuota(testEnv, userId, "job-a", 600, "groq", { now });
    const balance = await chargeTranscriptionQuota(testEnv, userId, "job-b", 300, "deepgram", { now });

    expect(balance.includedUsed).toBe(900);
    expect(await ledgerRows(userId)).toHaveLength(2);
  });

  it("records an overshoot in full and floors remaining at zero", async () => {
    // Charging happens after the transcript is saved. The provider has already
    // billed us, so the receipt must be honest even when it exceeds the plan.
    const userId = uid("overshoot");
    const now = new Date("2026-05-04T10:00:00.000Z");
    await seedUser(userId);
    await seedJob(userId, "overshoot-job");

    const balance = await chargeTranscriptionQuota(
      testEnv,
      userId,
      "overshoot-job",
      TRANSCRIPTION_INCLUDED_SECONDS_PER_MONTH + 600,
      "deepgram",
      { now }
    );

    expect(balance.includedUsed).toBe(TRANSCRIPTION_INCLUDED_SECONDS_PER_MONTH + 600);
    expect(balance.includedRemaining).toBe(0);
    expect(await ledgerRows(userId)).toEqual([
      {
        job_id: "overshoot-job",
        reason: "transcription",
        provider: "deepgram",
        delta_seconds: -(TRANSCRIPTION_INCLUDED_SECONDS_PER_MONTH + 600),
      },
    ]);
  });

  it("books nothing for an unusable duration instead of failing the job", async () => {
    // `delta_seconds` is NOT NULL INTEGER, and this runs after the transcript is
    // saved. A NaN or Infinity duration must under-bill quietly, never raise a
    // constraint error that would mark a finished job failed.
    const userId = uid("unusable-charge");
    const now = new Date("2026-05-08T10:00:00.000Z");
    await seedUser(userId);
    await seedJob(userId, "unusable-nan");
    await seedJob(userId, "unusable-infinity");
    await seedJob(userId, "unusable-negative");
    await seedJob(userId, "unusable-real");

    const afterNan = await chargeTranscriptionQuota(testEnv, userId, "unusable-nan", Number.NaN, "groq", {
      now,
    });
    const afterInfinity = await chargeTranscriptionQuota(
      testEnv,
      userId,
      "unusable-infinity",
      Number.POSITIVE_INFINITY,
      "deepgram",
      { now }
    );
    const afterNegative = await chargeTranscriptionQuota(
      testEnv,
      userId,
      "unusable-negative",
      -900,
      "groq",
      { now }
    );

    expect(afterNan.includedUsed).toBe(0);
    expect(afterInfinity.includedUsed).toBe(0);
    expect(afterNegative.includedUsed).toBe(0);
    expect(await ledgerRows(userId)).toEqual([]);

    // And the ledger is still healthy for the next real charge.
    const afterReal = await chargeTranscriptionQuota(testEnv, userId, "unusable-real", 300, "groq", {
      now,
    });
    expect(afterReal.includedUsed).toBe(300);
    expect(await ledgerRows(userId)).toHaveLength(1);
  });

  it("rebuilds a drifted counter from the ledger instead of nudging it", async () => {
    // The failure this guards: a KV write that never landed (or landed twice)
    // must not permanently mis-state the allowance.
    const userId = uid("drift");
    const now = new Date("2026-05-05T10:00:00.000Z");
    await seedUser(userId);
    await seedJob(userId, "drift-job-1");
    await seedJob(userId, "drift-job-2");

    await chargeTranscriptionQuota(testEnv, userId, "drift-job-1", 600, "groq", { now });
    // Simulate a lost KV write: the audit row exists, the cache does not.
    await testEnv.SESSIONS.delete(transcriptionQuotaKey(userId, now));
    expect((await getTranscriptionQuotaBalance(testEnv, userId, { now })).includedUsed).toBe(0);

    const balance = await chargeTranscriptionQuota(testEnv, userId, "drift-job-2", 300, "groq", { now });

    expect(balance.includedUsed).toBe(900);
    expect(await counterValue(userId, now)).toBe("900");
  });

  it("self-heals a counter inflated beyond the ledger", async () => {
    const userId = uid("inflated");
    const now = new Date("2026-05-06T10:00:00.000Z");
    await seedUser(userId);
    await seedJob(userId, "inflated-job");
    await testEnv.SESSIONS.put(transcriptionQuotaKey(userId, now), "99999");

    const balance = await reconcileTranscriptionQuota(testEnv, userId, { now });

    expect(balance.includedUsed).toBe(0);
    expect(balance.includedRemaining).toBe(TRANSCRIPTION_INCLUDED_SECONDS_PER_MONTH);
  });

  it("lets an admin_adjust grant hand time back", async () => {
    const userId = uid("grant");
    const now = new Date("2026-05-07T10:00:00.000Z");
    await seedUser(userId);
    await seedJob(userId, "grant-job");
    await chargeTranscriptionQuota(testEnv, userId, "grant-job", 3_000, "groq", { now });

    await testEnv.DB.prepare(
      `INSERT INTO transcription_quota_ledger (user_id, delta_seconds, reason, job_id, created_at)
       VALUES (?, 1200, 'admin_adjust', NULL, ?)`
    )
      .bind(userId, "2026-05-07 11:00:00")
      .run();
    const balance = await reconcileTranscriptionQuota(testEnv, userId, { now });

    expect(balance.includedUsed).toBe(1_800);
    expect(balance.includedRemaining).toBe(TRANSCRIPTION_INCLUDED_SECONDS_PER_MONTH - 1_800);
  });
});

describe("transcription quota — UTC month boundaries", () => {
  beforeEach(resetDb);

  it("keeps December and January in separate buckets and resets across the year", async () => {
    const userId = uid("rollover");
    await seedUser(userId);
    await seedJob(userId, "december-job");
    await seedJob(userId, "january-job");

    const december = new Date("2026-12-31T23:59:59.000Z");
    const january = new Date("2027-01-01T00:00:00.000Z");

    const afterDecember = await chargeTranscriptionQuota(
      testEnv,
      userId,
      "december-job",
      4 * HOUR,
      "groq",
      { now: december }
    );
    expect(afterDecember).toMatchObject({
      includedUsed: 4 * HOUR,
      month: "2026-12",
      monthResetsOn: "2027-01-01T00:00:00.000Z",
    });

    // One second later, in a new UTC month: a clean allowance.
    const januaryBalance = await getTranscriptionQuotaBalance(testEnv, userId, { now: january });
    expect(januaryBalance).toMatchObject({
      includedUsed: 0,
      includedRemaining: TRANSCRIPTION_INCLUDED_SECONDS_PER_MONTH,
      month: "2027-01",
      monthResetsOn: "2027-02-01T00:00:00.000Z",
    });

    // A January charge must not disturb December's closed books.
    await chargeTranscriptionQuota(testEnv, userId, "january-job", 600, "deepgram", { now: january });
    expect(await counterValue(userId, december)).toBe(String(4 * HOUR));
    expect(await counterValue(userId, january)).toBe("600");
    expect(
      (await getTranscriptionQuotaBalance(testEnv, userId, { now: december })).includedUsed
    ).toBe(4 * HOUR);
  });

  it("treats the last instant of a month as that month, not the next", async () => {
    const userId = uid("boundary-instant");
    await seedUser(userId);
    await seedJob(userId, "boundary-job");

    const lastInstant = new Date("2026-06-30T23:59:59.999Z");
    await chargeTranscriptionQuota(testEnv, userId, "boundary-job", 60, "groq", { now: lastInstant });

    expect(await counterValue(userId, lastInstant)).toBe("60");
    expect(
      (await getTranscriptionQuotaBalance(testEnv, userId, { now: new Date("2026-07-01T00:00:00.000Z") }))
        .includedUsed
    ).toBe(0);
  });
});

describe("transcription quota — isolation from the TTS ledger", () => {
  beforeEach(resetDb);

  /**
   * Fails the test the moment this module so much as names a TTS table or key.
   * A post-hoc state check would miss a stray read; this catches both.
   */
  function ttsTripwireEnv(base: Env): Env {
    const assertSql = (query: string) => {
      // Blank out our own table name first, so a statement naming both is still
      // caught rather than excused by the presence of the legitimate one.
      const withoutOwnTable = query.replace(/transcription_quota_ledger/gi, "");
      if (/quota_ledger|credit_balances/i.test(withoutOwnTable)) {
        throw new Error(`transcription quota touched a TTS table: ${query}`);
      }
    };
    const assertKey = (key: string) => {
      if (key.startsWith("audioq:")) {
        throw new Error(`transcription quota touched a TTS KV key: ${key}`);
      }
    };

    const db = {
      prepare: (query: string) => {
        assertSql(query);
        return base.DB.prepare(query);
      },
    } as unknown as D1Database;

    const kv = {
      get: (key: string) => {
        assertKey(key);
        return base.SESSIONS.get(key);
      },
      put: (key: string, value: string, options?: KVNamespacePutOptions) => {
        assertKey(key);
        return base.SESSIONS.put(key, value, options);
      },
      delete: (key: string) => base.SESSIONS.delete(key),
    } as unknown as KVNamespace;

    return { ...base, DB: db, SESSIONS: kv };
  }

  it("never reads or writes quota_ledger, credit_balances, or audioq:* keys", async () => {
    const userId = uid("isolation");
    const now = new Date("2026-07-15T10:00:00.000Z");
    await seedUser(userId);
    await seedJob(userId, "isolation-job");
    await testEnv.DB.prepare("INSERT INTO credit_balances (user_id, seconds) VALUES (?, 600)")
      .bind(userId)
      .run();

    const guarded = ttsTripwireEnv(testEnv);
    await getTranscriptionQuotaBalance(guarded, userId, { now });
    await precheckTranscriptionQuota(guarded, userId, 1_200, { now });
    await chargeTranscriptionQuota(guarded, userId, "isolation-job", 1_200, "groq", { now });
    await reconcileTranscriptionQuota(guarded, userId, { now });

    // The transcription side moved…
    expect((await getTranscriptionQuotaBalance(testEnv, userId, { now })).includedUsed).toBe(1_200);
    // …and the TTS side did not, by any measure.
    const ttsLedger = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM quota_ledger WHERE user_id = ?"
    )
      .bind(userId)
      .first<{ n: number }>();
    const credits = await testEnv.DB.prepare(
      "SELECT seconds FROM credit_balances WHERE user_id = ?"
    )
      .bind(userId)
      .first<{ seconds: number }>();
    expect(ttsLedger?.n).toBe(0);
    expect(credits?.seconds).toBe(600);

    const audioBalance = await getAudioQuotaBalance(testEnv, userId, { now });
    expect(audioBalance.includedUsed).toBe(0);
    expect(audioBalance.credits).toBe(600);
  });

  it("stores its counter under transq: and leaves no audioq: key behind", async () => {
    const userId = uid("kv-prefix");
    const now = new Date("2026-07-16T10:00:00.000Z");
    await seedUser(userId);
    await seedJob(userId, "kv-prefix-job");

    await chargeTranscriptionQuota(testEnv, userId, "kv-prefix-job", 300, "groq", { now });

    expect(transcriptionQuotaKey(userId, now)).toBe(`transq:${userId}:2026-07`);
    expect(await testEnv.SESSIONS.get(`transq:${userId}:2026-07`)).toBe("300");
    const audioKeys = await testEnv.SESSIONS.list({ prefix: "audioq:" });
    expect(audioKeys.keys).toEqual([]);
  });
});
