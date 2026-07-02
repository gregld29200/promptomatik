import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../index";
import type { Env } from "../env";
import { createSession, type SessionData } from "./session";
import {
  AUDIO_INCLUDED_SECONDS_PER_MONTH,
  chargeAudioQuota,
  getAudioQuotaBalance,
  precheckAudioQuota,
} from "./audio-quota";

const testEnv = env as unknown as Env;

const TEST_SCHEMA_STATEMENTS = [
  "PRAGMA foreign_keys = OFF",
  "DROP TABLE IF EXISTS quota_ledger",
  "DROP TABLE IF EXISTS credit_balances",
  "DROP TABLE IF EXISTS audio_segments",
  "DROP TABLE IF EXISTS audio_jobs",
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
  `CREATE TABLE audio_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('monologue','dialogue')),
  quality TEXT NOT NULL CHECK (quality IN ('draft','final')),
  script_raw TEXT NOT NULL,
  direction_json TEXT NOT NULL,
  voices_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','generating','assembling','ready','failed')),
  estimated_seconds INTEGER NOT NULL,
  actual_seconds INTEGER,
  error TEXT,
  model_used TEXT,
  gen_ms INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  api_cost_usd REAL,
  r2_prefix TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)`,
  `CREATE TABLE quota_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  delta_seconds INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('included','credit')),
  reason TEXT NOT NULL CHECK (reason IN ('generation','regeneration','credit_grant','admin_adjust')),
  job_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES audio_jobs(id) ON DELETE SET NULL
)`,
  `CREATE TABLE credit_balances (
  user_id TEXT PRIMARY KEY,
  seconds INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)`,
];

async function resetDb() {
  for (const statement of TEST_SCHEMA_STATEMENTS) {
    await testEnv.DB.prepare(statement).run();
  }
}

async function seedParticipant(userId: string, role: "teacher" | "admin" = "teacher") {
  await testEnv.DB.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, language_preference, tier)
     VALUES (?, ?, 'Audio Tester', 'hash', ?, 'fr', 'participant')`
  )
    .bind(userId, `${userId}@example.com`, role)
    .run();
}

async function seedCredits(userId: string, seconds: number) {
  await testEnv.DB.prepare(
    `INSERT INTO credit_balances (user_id, seconds)
     VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET seconds = excluded.seconds`
  )
    .bind(userId, seconds)
    .run();
}

async function seedAudioJob(userId: string, jobId: string) {
  await testEnv.DB.prepare(
    `INSERT INTO audio_jobs (
      id,
      user_id,
      mode,
      quality,
      script_raw,
      direction_json,
      voices_json,
      estimated_seconds
    ) VALUES (?, ?, 'monologue', 'draft', 'Bonjour', '{}', '{"solo":"Kore"}', 1)`
  )
    .bind(jobId, userId)
    .run();
}

async function ledgerForJob(jobId: string) {
  const { results } = await testEnv.DB.prepare(
    `SELECT source, reason, delta_seconds
     FROM quota_ledger
     WHERE job_id = ?
     ORDER BY id`
  )
    .bind(jobId)
    .all<{ source: string; reason: string; delta_seconds: number }>();
  return results;
}

async function creditsForUser(userId: string) {
  const row = await testEnv.DB.prepare("SELECT seconds FROM credit_balances WHERE user_id = ?")
    .bind(userId)
    .first<{ seconds: number }>();
  return row?.seconds ?? 0;
}

describe("audio quota service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("resets included usage by UTC month key", async () => {
    const userId = "month-rollover-user";
    await seedParticipant(userId);
    await seedAudioJob(userId, "job-jan");

    await chargeAudioQuota(testEnv, userId, "job-jan", 600, "generation", {
      now: new Date("2026-01-15T12:00:00.000Z"),
    });

    const january = await getAudioQuotaBalance(testEnv, userId, {
      now: new Date("2026-01-20T12:00:00.000Z"),
    });
    const february = await getAudioQuotaBalance(testEnv, userId, {
      now: new Date("2026-02-01T00:00:00.000Z"),
    });

    expect(january.includedUsed).toBe(600);
    expect(january.includedRemaining).toBe(AUDIO_INCLUDED_SECONDS_PER_MONTH - 600);
    expect(february.includedUsed).toBe(0);
    expect(february.includedRemaining).toBe(AUDIO_INCLUDED_SECONDS_PER_MONTH);
  });

  it("splits charges across included seconds first, then credits", async () => {
    const userId = "split-user";
    await seedParticipant(userId);
    await seedCredits(userId, 300);
    await seedAudioJob(userId, "warmup-job");
    await seedAudioJob(userId, "split-job");

    const now = new Date("2026-03-10T08:00:00.000Z");
    await chargeAudioQuota(testEnv, userId, "warmup-job", 3_500, "generation", { now });
    const balance = await chargeAudioQuota(testEnv, userId, "split-job", 250, "generation", { now });

    expect(balance.includedUsed).toBe(3_600);
    expect(balance.includedRemaining).toBe(0);
    expect(balance.credits).toBe(150);
    expect(await ledgerForJob("split-job")).toEqual([
      { source: "included", reason: "generation", delta_seconds: -100 },
      { source: "credit", reason: "generation", delta_seconds: -150 },
    ]);
  });

  it("straddles the included-credit boundary exactly and updates credits", async () => {
    const userId = "exact-straddle-user";
    await seedParticipant(userId);
    await seedCredits(userId, 100);
    await seedAudioJob(userId, "setup-job");
    await seedAudioJob(userId, "straddle-job");

    const now = new Date("2026-03-12T08:00:00.000Z");
    await chargeAudioQuota(testEnv, userId, "setup-job", 3_570, "generation", { now });
    const balance = await chargeAudioQuota(testEnv, userId, "straddle-job", 100, "generation", { now });

    expect(balance.includedUsed).toBe(AUDIO_INCLUDED_SECONDS_PER_MONTH);
    expect(balance.includedRemaining).toBe(0);
    expect(balance.credits).toBe(30);
    expect(await creditsForUser(userId)).toBe(30);
    expect(await ledgerForJob("straddle-job")).toEqual([
      { source: "included", reason: "generation", delta_seconds: -30 },
      { source: "credit", reason: "generation", delta_seconds: -70 },
    ]);
  });

  it("prechecks estimates against included plus credits with the 1.2 margin", async () => {
    const userId = "precheck-user";
    await seedParticipant(userId);
    await seedCredits(userId, 100);
    await seedAudioJob(userId, "precheck-setup-job");

    const now = new Date("2026-03-20T08:00:00.000Z");
    await chargeAudioQuota(testEnv, userId, "precheck-setup-job", 3_550, "generation", { now });

    await expect(precheckAudioQuota(testEnv, userId, 180, { now })).resolves.toMatchObject({
      ok: true,
    });
    await expect(precheckAudioQuota(testEnv, userId, 181, { now })).resolves.toMatchObject({
      ok: false,
      allowedSeconds: 180,
      reason: "audio_quota_exceeded",
    });
  });

  it("rounds actual generated seconds up before charging", async () => {
    const userId = "rounding-user";
    await seedParticipant(userId);
    await seedAudioJob(userId, "rounding-job");

    const balance = await chargeAudioQuota(
      testEnv,
      userId,
      "rounding-job",
      12.2,
      "generation",
      { now: new Date("2026-04-01T00:00:00.000Z") }
    );

    expect(balance.includedUsed).toBe(13);
    expect(await ledgerForJob("rounding-job")).toEqual([
      { source: "included", reason: "generation", delta_seconds: -13 },
    ]);
  });

  it("records regeneration charges as auditable ledger rows", async () => {
    const userId = "regeneration-user";
    await seedParticipant(userId);
    await seedAudioJob(userId, "regen-job");

    await chargeAudioQuota(testEnv, userId, "regen-job", 42, "regeneration", {
      now: new Date("2026-05-15T00:00:00.000Z"),
    });

    expect(await ledgerForJob("regen-job")).toEqual([
      { source: "included", reason: "regeneration", delta_seconds: -42 },
    ]);
  });
});

describe("GET /api/audio/quota", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns the current participant audio quota", async () => {
    const userId = "quota-route-user";
    await seedParticipant(userId);
    await seedCredits(userId, 180);
    await seedAudioJob(userId, "existing-job");
    await chargeAudioQuota(testEnv, userId, "existing-job", 120, "generation");

    const session: SessionData = {
      userId,
      email: `${userId}@example.com`,
      role: "teacher",
      languagePreference: "fr",
      createdAt: Date.now(),
    };
    const sessionId = await createSession(testEnv, session);
    const request = new Request("https://promptomatik.test/api/audio/quota", {
      headers: {
        Cookie: `promptomatik_session=${sessionId}`,
      },
    });
    const ctx = createExecutionContext();

    const response = await worker.fetch(request, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      includedRemaining: AUDIO_INCLUDED_SECONDS_PER_MONTH - 120,
      credits: 180,
    });
  });
});
