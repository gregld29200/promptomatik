import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../index";
import type { Env } from "../env";
import { createSession, sessionCookie, type SessionData } from "../lib/session";

const testEnv = env as unknown as Env;

const SCHEMA = [
  "PRAGMA foreign_keys = OFF",
  "DROP TABLE IF EXISTS password_resets",
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
  `CREATE TABLE password_resets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    used_at TEXT
  )`,
];

async function resetDb() {
  for (const statement of SCHEMA) {
    await testEnv.DB.prepare(statement).run();
  }
}

async function clearSessionsKv() {
  let cursor: string | undefined;
  do {
    const listed = await testEnv.SESSIONS.list({ cursor });
    await Promise.all(listed.keys.map((k) => testEnv.SESSIONS.delete(k.name)));
    cursor = listed.list_complete ? undefined : listed.cursor;
  } while (cursor);
}

function sessionData(userId: string): SessionData {
  return {
    userId,
    email: `${userId}@example.com`,
    role: "teacher",
    languagePreference: "fr",
    createdAt: Date.now(),
  };
}

async function meStatus(sessionId: string): Promise<number> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request("https://promptomatik.test/api/auth/me", {
      headers: { Cookie: sessionCookie(sessionId).split(";")[0] },
    }),
    testEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return res.status;
}

describe("POST /api/auth/reset-password", () => {
  beforeEach(async () => {
    await resetDb();
    await clearSessionsKv();
  });

  it("invalidates existing sessions after a successful reset", async () => {
    await testEnv.DB.prepare(
      "INSERT INTO users (id, email, name, password_hash) VALUES ('user-1', 'u1@example.com', 'U1', 'oldhash')"
    ).run();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await testEnv.DB.prepare(
      "INSERT INTO password_resets (id, user_id, token, expires_at) VALUES ('r1', 'user-1', 'tok-valid', ?)"
    ).bind(expiresAt).run();

    // Two live sessions predating the reset.
    const sessionA = await createSession(testEnv, sessionData("user-1"));
    const sessionB = await createSession(testEnv, sessionData("user-1"));
    expect(await meStatus(sessionA)).toBe(200);

    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("https://promptomatik.test/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "tok-valid", password: "brand-new-pass" }),
      }),
      testEnv,
      ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);

    // Pre-reset cookies must no longer authenticate.
    expect(await meStatus(sessionA)).toBe(401);
    expect(await meStatus(sessionB)).toBe(401);
  });
});
