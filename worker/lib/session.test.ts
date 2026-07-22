import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../env";
import {
  createSession,
  destroySession,
  destroyUserSessions,
  getSession,
  sessionCookie,
  type SessionData,
} from "./session";

const testEnv = env as unknown as Env;

function sessionData(userId: string): SessionData {
  return {
    userId,
    email: `${userId}@example.com`,
    role: "teacher",
    languagePreference: "fr",
    createdAt: Date.now(),
  };
}

function requestWithSession(sessionId: string): Request {
  return new Request("https://promptomatik.com/api/auth/me", {
    headers: { Cookie: sessionCookie(sessionId).split(";")[0] },
  });
}

async function clearSessionsKv() {
  let cursor: string | undefined;
  do {
    const listed = await testEnv.SESSIONS.list({ cursor });
    await Promise.all(listed.keys.map((k) => testEnv.SESSIONS.delete(k.name)));
    cursor = listed.list_complete ? undefined : listed.cursor;
  } while (cursor);
}

describe("session lifecycle", () => {
  beforeEach(async () => {
    await clearSessionsKv();
  });

  it("creates a session that resolves back to its data", async () => {
    const id = await createSession(testEnv, sessionData("user-1"));
    const resolved = await getSession(testEnv, requestWithSession(id));
    expect(resolved?.userId).toBe("user-1");
  });

  it("destroyUserSessions revokes every session a user holds", async () => {
    const first = await createSession(testEnv, sessionData("user-1"));
    const second = await createSession(testEnv, sessionData("user-1"));
    const other = await createSession(testEnv, sessionData("user-2"));

    await destroyUserSessions(testEnv, "user-1");

    expect(await getSession(testEnv, requestWithSession(first))).toBeNull();
    expect(await getSession(testEnv, requestWithSession(second))).toBeNull();
    // A different user's session is untouched.
    expect(await getSession(testEnv, requestWithSession(other))).not.toBeNull();
  });

  it("destroyUserSessions also clears the per-user index entries", async () => {
    await createSession(testEnv, sessionData("user-1"));
    await destroyUserSessions(testEnv, "user-1");

    const remaining = await testEnv.SESSIONS.list({ prefix: "usersession:user-1:" });
    expect(remaining.keys).toHaveLength(0);
  });

  it("destroySession removes both the session and its index entry", async () => {
    const id = await createSession(testEnv, sessionData("user-1"));
    await destroySession(testEnv, requestWithSession(id));

    expect(await getSession(testEnv, requestWithSession(id))).toBeNull();
    const index = await testEnv.SESSIONS.list({ prefix: "usersession:user-1:" });
    expect(index.keys).toHaveLength(0);
  });
});
