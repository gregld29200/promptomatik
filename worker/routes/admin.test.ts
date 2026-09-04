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
    is_active INTEGER NOT NULL DEFAULT 1,
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
  for (const statement of SCHEMA) await testEnv.DB.prepare(statement).run();
}

async function clearSessionsKv() {
  let cursor: string | undefined;
  do {
    const listed = await testEnv.SESSIONS.list({ cursor });
    await Promise.all(listed.keys.map((key) => testEnv.SESSIONS.delete(key.name)));
    cursor = listed.list_complete ? undefined : listed.cursor;
  } while (cursor);
}

async function adminCookie() {
  const session: SessionData = {
    userId: "admin-1",
    email: "admin@example.com",
    role: "admin",
    languagePreference: "fr",
    createdAt: Date.now(),
  };
  const id = await createSession(testEnv, session);
  return sessionCookie(id).split(";")[0];
}

describe("POST /api/admin/users/:id/access-link", () => {
  beforeEach(async () => {
    await resetDb();
    await clearSessionsKv();
  });

  it("lets an admin resend access to an existing user and invalidates their older reset links", async () => {
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        "INSERT INTO users (id, email, name, password_hash, role) VALUES ('admin-1', 'admin@example.com', 'Admin', 'hash', 'admin')"
      ),
      testEnv.DB.prepare(
        "INSERT INTO users (id, email, name, password_hash) VALUES ('teacher-1', 'teacher@example.com', 'Teacher', 'hash')"
      ),
      testEnv.DB.prepare(
        "INSERT INTO password_resets (id, user_id, token, expires_at) VALUES ('old-reset', 'teacher-1', 'old-token', ?)"
      ).bind(new Date(Date.now() + 60 * 60 * 1000).toISOString()),
    ]);

    const ctx = createExecutionContext();
    const response = await worker.fetch(
      new Request("https://studio.test/api/admin/users/teacher-1/access-link", {
        method: "POST",
        headers: { Cookie: await adminCookie() },
      }),
      { ...testEnv, RESEND_API_KEY: "" },
      ctx
    );
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const resets = await testEnv.DB.prepare(
      "SELECT token, used_at FROM password_resets WHERE user_id = 'teacher-1' ORDER BY id"
    ).all<{ token: string; used_at: string | null }>();
    expect(resets.results).toHaveLength(2);
    expect(resets.results.find((reset) => reset.token === "old-token")?.used_at).not.toBeNull();
    expect(resets.results.find((reset) => reset.token !== "old-token")?.used_at).toBeNull();
  });
});
