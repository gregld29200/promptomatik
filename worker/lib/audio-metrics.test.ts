import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../index";
import type { Env } from "../env";
import { createSession, type SessionData } from "./session";
import { getAudioAdminMetrics, grantAudioCredits } from "./audio-metrics";
import { chargeAudioQuota } from "./audio-quota";

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
  `CREATE TABLE audio_segments (
  job_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','ok','failed')),
  duration_seconds REAL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error_status INTEGER,
  model_used TEXT,
  r2_key TEXT,
  PRIMARY KEY (job_id, idx),
  FOREIGN KEY (job_id) REFERENCES audio_jobs(id) ON DELETE CASCADE
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

async function seedUser(userId: string, role: "teacher" | "admin" = "teacher") {
  await testEnv.DB.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, language_preference, tier)
     VALUES (?, ?, 'Metrics Tester', 'hash', ?, 'fr', 'participant')`
  )
    .bind(userId, `${userId}@example.com`, role)
    .run();
}

interface SeedJobInput {
  id: string;
  userId: string;
  quality: "draft" | "final";
  status: "queued" | "generating" | "assembling" | "ready" | "failed";
  actualSeconds?: number;
  genMs?: number;
  apiCostUsd?: number;
}

async function seedJob(input: SeedJobInput) {
  await testEnv.DB.prepare(
    `INSERT INTO audio_jobs (
      id, user_id, mode, quality, script_raw, direction_json, voices_json,
      status, estimated_seconds, actual_seconds, gen_ms, api_cost_usd
    ) VALUES (?, ?, 'monologue', ?, 'Bonjour', '{}', '{"solo":"Kore"}', ?, 60, ?, ?, ?)`
  )
    .bind(
      input.id,
      input.userId,
      input.quality,
      input.status,
      input.actualSeconds ?? null,
      input.genMs ?? null,
      input.apiCostUsd ?? null
    )
    .run();
}

function sessionFor(userId: string, role: "teacher" | "admin"): SessionData {
  return {
    userId,
    email: `${userId}@example.com`,
    role,
    languagePreference: "fr",
    createdAt: Date.now(),
  };
}

async function fetchAs(userId: string, role: "teacher" | "admin", path: string, init?: RequestInit) {
  const sessionId = await createSession(testEnv, sessionFor(userId, role));
  const request = new Request(`https://promptomatik.test${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Cookie: `promptomatik_session=${sessionId}`,
      "Content-Type": "application/json",
    },
  });
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe("audio admin metrics", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("aggregates failure rate, median speed, and cost split by quality", async () => {
    await seedUser("metrics-user");
    await seedJob({ id: "d1", userId: "metrics-user", quality: "draft", status: "ready", actualSeconds: 10, genMs: 5_000, apiCostUsd: 0.0025 });
    await seedJob({ id: "d2", userId: "metrics-user", quality: "draft", status: "ready", actualSeconds: 20, genMs: 30_000, apiCostUsd: 0.005 });
    await seedJob({ id: "d3", userId: "metrics-user", quality: "draft", status: "failed" });
    await seedJob({ id: "d4", userId: "metrics-user", quality: "draft", status: "generating" });
    await seedJob({ id: "f1", userId: "metrics-user", quality: "final", status: "ready", actualSeconds: 120, genMs: 90_000, apiCostUsd: 0.06 });

    const metrics = await getAudioAdminMetrics(testEnv);

    expect(metrics.jobs.draft).toMatchObject({ total: 4, ready: 2, failed: 1, active: 1 });
    expect(metrics.jobs.draft.failureRate).toBeCloseTo(1 / 3);
    expect(metrics.jobs.final).toMatchObject({ total: 1, ready: 1, failed: 0, active: 0, failureRate: 0 });
    expect(metrics.jobs.overall).toMatchObject({ total: 5, ready: 3, failed: 1 });
    expect(metrics.jobs.overall.failureRate).toBeCloseTo(1 / 4);

    // draft samples: 5000/10=500 and 30000/20=1500 -> median 1000
    expect(metrics.speed.draft).toEqual({ medianMsPerAudioSecond: 1_000, sampleCount: 2 });
    expect(metrics.speed.final).toEqual({ medianMsPerAudioSecond: 750, sampleCount: 1 });

    expect(metrics.cost.cumulativeApiCostUsd).toBeCloseTo(0.0675);
    // final: $0.06 for 120s -> $1.80 per generated hour
    expect(metrics.cost.costPerGeneratedHourUsd.final).toBeCloseTo(1.8);
    expect(metrics.cost.costPerGeneratedHourUsd.draft).toBeCloseTo(0.0075 / (30 / 3600));
  });

  it("surfaces rate-limit and gateway-error pressure from recent segment attempts", async () => {
    await seedUser("pressure-user");
    await seedJob({ id: "recent-job", userId: "pressure-user", quality: "final", status: "ready" });
    await seedJob({ id: "stale-job", userId: "pressure-user", quality: "final", status: "ready" });
    await testEnv.DB.prepare(
      "UPDATE audio_jobs SET created_at = ? WHERE id = 'stale-job'"
    ).bind("2020-01-01 00:00:00").run();

    await testEnv.DB.batch([
      testEnv.DB.prepare(
        "INSERT INTO audio_segments (job_id, idx, text, status, last_error_status) VALUES ('recent-job', 0, 'a', 'ok', 429)"
      ),
      testEnv.DB.prepare(
        "INSERT INTO audio_segments (job_id, idx, text, status, last_error_status) VALUES ('recent-job', 1, 'b', 'failed', 524)"
      ),
      testEnv.DB.prepare(
        "INSERT INTO audio_segments (job_id, idx, text, status, last_error_status) VALUES ('recent-job', 2, 'c', 'ok', NULL)"
      ),
      // Outside the 24h window — must not count.
      testEnv.DB.prepare(
        "INSERT INTO audio_segments (job_id, idx, text, status, last_error_status) VALUES ('stale-job', 0, 'd', 'ok', 429)"
      ),
    ]);

    const metrics = await getAudioAdminMetrics(testEnv);

    expect(metrics.rateLimitPressure).toEqual({
      windowHours: 24,
      segmentsAttempted: 3,
      rateLimited: 1,
      gatewayErrors: 1,
    });
  });

  it("reports charged seconds and per-user usage from the ledger", async () => {
    await seedUser("usage-user");
    await seedUser("idle-user");
    await seedJob({ id: "u1", userId: "usage-user", quality: "draft", status: "ready", actualSeconds: 50 });

    const now = new Date();
    await chargeAudioQuota(testEnv, "usage-user", "u1", 50, "generation", { now });
    await grantAudioCredits(testEnv, "usage-user", 600);

    const metrics = await getAudioAdminMetrics(testEnv, now);

    expect(metrics.cost.chargedSeconds).toBe(50);
    const usage = metrics.users.find((user) => user.userId === "usage-user");
    expect(usage).toMatchObject({
      includedUsedMonth: 50,
      creditsUsed: 0,
      creditsRemaining: 600,
    });
    const idle = metrics.users.find((user) => user.userId === "idle-user");
    expect(idle).toMatchObject({ includedUsedMonth: 0, creditsUsed: 0, creditsRemaining: 0 });
  });

  it("counts only current-month included consumption in the per-user table", async () => {
    await seedUser("rollover-user");
    await seedJob({ id: "old-job", userId: "rollover-user", quality: "draft", status: "ready", actualSeconds: 100 });
    await seedJob({ id: "new-job", userId: "rollover-user", quality: "draft", status: "ready", actualSeconds: 40 });

    await chargeAudioQuota(testEnv, "rollover-user", "old-job", 100, "generation", {
      now: new Date("2026-05-15T12:00:00.000Z"),
    });
    // Backdate the first ledger row: chargeAudioQuota stamps rows with datetime('now').
    await testEnv.DB.prepare(
      "UPDATE quota_ledger SET created_at = '2026-05-15 12:00:00' WHERE job_id = 'old-job'"
    ).run();
    const now = new Date("2026-06-10T12:00:00.000Z");
    await chargeAudioQuota(testEnv, "rollover-user", "new-job", 40, "generation", { now });

    const metrics = await getAudioAdminMetrics(testEnv, now);
    const usage = metrics.users.find((user) => user.userId === "rollover-user");

    expect(metrics.month).toBe("2026-06");
    expect(usage?.includedUsedMonth).toBe(40);
    // Cumulative charged seconds stay all-time.
    expect(metrics.cost.chargedSeconds).toBe(140);
  });
});

describe("audio admin credit grants", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("grants credits with an auditable credit_grant ledger row", async () => {
    await seedUser("grantee");

    const first = await grantAudioCredits(testEnv, "grantee", 300);
    const second = await grantAudioCredits(testEnv, "grantee", 120);

    expect(first).toEqual({ credits: 300 });
    expect(second).toEqual({ credits: 420 });

    const { results } = await testEnv.DB.prepare(
      `SELECT delta_seconds, source, reason, job_id FROM quota_ledger WHERE user_id = 'grantee' ORDER BY id`
    ).all<{ delta_seconds: number; source: string; reason: string; job_id: string | null }>();
    expect(results).toEqual([
      { delta_seconds: 300, source: "credit", reason: "credit_grant", job_id: null },
      { delta_seconds: 120, source: "credit", reason: "credit_grant", job_id: null },
    ]);
  });

  it("returns null for unknown users", async () => {
    await expect(grantAudioCredits(testEnv, "ghost", 60)).resolves.toBeNull();
  });
});

describe("audio admin routes", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("rejects non-admin users with 403", async () => {
    await seedUser("plain-user");

    const metricsResponse = await fetchAs("plain-user", "teacher", "/api/audio/admin/metrics");
    const creditsResponse = await fetchAs("plain-user", "teacher", "/api/audio/admin/credits", {
      method: "POST",
      body: JSON.stringify({ userId: "plain-user", seconds: 60 }),
    });

    expect(metricsResponse.status).toBe(403);
    expect(creditsResponse.status).toBe(403);
  });

  it("returns metrics without any script content", async () => {
    await seedUser("admin-user", "admin");
    await seedUser("watched-user");
    await seedJob({ id: "m1", userId: "watched-user", quality: "final", status: "ready", actualSeconds: 30, genMs: 20_000, apiCostUsd: 0.015 });

    const response = await fetchAs("admin-user", "admin", "/api/audio/admin/metrics");

    expect(response.status).toBe(200);
    const payload = await response.text();
    expect(payload).not.toContain("Bonjour");
    const body = JSON.parse(payload) as { metrics: { jobs: { final: { ready: number } } } };
    expect(body.metrics.jobs.final.ready).toBe(1);
  });

  it("grants credits through the route and reflects them in the user quota", async () => {
    await seedUser("admin-user", "admin");
    await seedUser("credited-user");

    const grantResponse = await fetchAs("admin-user", "admin", "/api/audio/admin/credits", {
      method: "POST",
      body: JSON.stringify({ userId: "credited-user", seconds: 900 }),
    });
    expect(grantResponse.status).toBe(200);
    await expect(grantResponse.json()).resolves.toEqual({ success: true, credits: 900 });

    const quotaResponse = await fetchAs("credited-user", "teacher", "/api/audio/quota");
    expect(quotaResponse.status).toBe(200);
    await expect(quotaResponse.json()).resolves.toMatchObject({ credits: 900 });
  });

  it("validates the credit grant payload", async () => {
    await seedUser("admin-user", "admin");

    const missingUser = await fetchAs("admin-user", "admin", "/api/audio/admin/credits", {
      method: "POST",
      body: JSON.stringify({ userId: "", seconds: 60 }),
    });
    const negative = await fetchAs("admin-user", "admin", "/api/audio/admin/credits", {
      method: "POST",
      body: JSON.stringify({ userId: "someone", seconds: -5 }),
    });
    const fractional = await fetchAs("admin-user", "admin", "/api/audio/admin/credits", {
      method: "POST",
      body: JSON.stringify({ userId: "someone", seconds: 1.5 }),
    });
    const unknown = await fetchAs("admin-user", "admin", "/api/audio/admin/credits", {
      method: "POST",
      body: JSON.stringify({ userId: "ghost", seconds: 60 }),
    });

    expect(missingUser.status).toBe(400);
    expect(negative.status).toBe(400);
    expect(fractional.status).toBe(400);
    expect(unknown.status).toBe(404);
  });
});
