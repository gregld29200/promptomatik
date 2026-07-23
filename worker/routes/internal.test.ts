import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../index";
import type { Env } from "../env";

const testEnv = env as unknown as Env;

const SCHEMA = [
  "PRAGMA foreign_keys = OFF",
  "DROP TABLE IF EXISTS users",
  `CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'teacher',
    language_preference TEXT NOT NULL DEFAULT 'fr',
    tier TEXT NOT NULL DEFAULT 'free',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "DROP TABLE IF EXISTS credit_balances",
  `CREATE TABLE credit_balances (
    user_id TEXT PRIMARY KEY,
    seconds INTEGER NOT NULL DEFAULT 0
  )`,
  "DROP TABLE IF EXISTS quota_ledger",
  `CREATE TABLE quota_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    delta_seconds INTEGER NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('included','credit')),
    reason TEXT NOT NULL CHECK (reason IN ('generation','regeneration','credit_grant','credit_purchase','admin_adjust')),
    job_id TEXT,
    stripe_ref TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];

async function resetDb() {
  for (const statement of SCHEMA) {
    await testEnv.DB.prepare(statement).run();
  }
  await testEnv.DB.prepare(
    "INSERT INTO users (id, email, name, password_hash) VALUES ('u1', 'marie@inst.fr', 'Marie', 'x')"
  ).run();
}

const SECRET = "test-internal-secret";

function grantRequest(headers: Record<string, string>, body: unknown): Request {
  return new Request("https://studio.teachinspire.me/api/internal/testimonial-grant", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function run(request: Request, envOverride?: Partial<Env>): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    request,
    { ...testEnv, TESTIMONIAL_GRANT_SECRET: SECRET, ...envOverride } as Env,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return response;
}

describe("POST /api/internal/testimonial-grant", () => {
  beforeEach(resetDb);

  it("is disabled (404) when the secret is not configured", async () => {
    const res = await run(
      grantRequest({ "X-Internal-Secret": SECRET }, { userId: "u1", seconds: 1800 }),
      { TESTIMONIAL_GRANT_SECRET: undefined }
    );
    expect(res.status).toBe(404);
  });

  it("rejects a missing or wrong secret", async () => {
    const noHeader = await run(grantRequest({}, { userId: "u1", seconds: 1800 }));
    expect(noHeader.status).toBe(403);

    const wrong = await run(
      grantRequest({ "X-Internal-Secret": "nope" }, { userId: "u1", seconds: 1800 })
    );
    expect(wrong.status).toBe(403);
  });

  it("validates userId and seconds", async () => {
    const noUser = await run(grantRequest({ "X-Internal-Secret": SECRET }, { seconds: 1800 }));
    expect(noUser.status).toBe(400);

    for (const seconds of [0, -5, 1.5, 3601, "1800"]) {
      const bad = await run(
        grantRequest({ "X-Internal-Secret": SECRET }, { userId: "u1", seconds })
      );
      expect(bad.status).toBe(400);
    }
  });

  it("returns 404 for an unknown user", async () => {
    const res = await run(
      grantRequest({ "X-Internal-Secret": SECRET }, { userId: "ghost", seconds: 1800 })
    );
    expect(res.status).toBe(404);
  });

  it("credits the user and writes the ledger", async () => {
    const res = await run(
      grantRequest({ "X-Internal-Secret": SECRET }, { userId: "u1", seconds: 1800 })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, credits: 1800 });

    const balance = await testEnv.DB.prepare(
      "SELECT seconds FROM credit_balances WHERE user_id = 'u1'"
    ).first<{ seconds: number }>();
    expect(balance?.seconds).toBe(1800);

    const ledger = await testEnv.DB.prepare(
      "SELECT delta_seconds, source, reason FROM quota_ledger WHERE user_id = 'u1'"
    ).first<{ delta_seconds: number; source: string; reason: string }>();
    expect(ledger).toEqual({ delta_seconds: 1800, source: "credit", reason: "credit_grant" });
  });
});
