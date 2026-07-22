import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../index";
import type { Env } from "../env";
import { createSession, sessionCookie, type SessionData } from "../lib/session";

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

async function postJobs(sessionId: string, body: unknown): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request("https://promptomatik.test/api/audio/jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie(sessionId).split(";")[0],
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    testEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("POST /api/audio/jobs body validation", () => {
  let sessionId: string;

  beforeEach(async () => {
    await resetDb();
    await clearSessionsKv();
    await testEnv.DB.prepare(
      "INSERT INTO users (id, email, name, password_hash, tier) VALUES ('user-1', 'u1@example.com', 'U1', 'hash', 'participant')"
    ).run();
    sessionId = await createSession(testEnv, sessionData("user-1"));
  });

  it("returns invalid_request (not a raw runtime error) when direction is missing", async () => {
    const res = await postJobs(sessionId, {
      mode: "monologue",
      quality: "draft",
      script: "Bonjour.",
      voices: { solo: "Aria" },
    });

    expect(res.status).toBe(400);
    const json = await res.json<{ error: string }>();
    expect(json.error).toBe("invalid_request");
    // The pentest finding: internals must not leak in the response.
    expect(JSON.stringify(json)).not.toMatch(/destructure|speakers|undefined/i);
  });

  it("returns invalid_request on a malformed (non-JSON) body", async () => {
    const res = await postJobs(sessionId, "not json{");
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toBe("invalid_request");
  });

  it("returns invalid_request when direction.level is not a CEFR level", async () => {
    const res = await postJobs(sessionId, {
      mode: "monologue",
      quality: "draft",
      script: "Bonjour.",
      direction: { level: "Z9", accent: "fr", pace: "normal", style: "neutral" },
      voices: { solo: "Aria" },
    });
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toBe("invalid_request");
  });

  it("still enforces auth before validation (no session → 401)", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("https://promptomatik.test/api/audio/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      testEnv,
      ctx
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });
});
