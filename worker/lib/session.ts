import type { Env } from "../env";
import type { Language } from "./language";

export interface SessionData {
  userId: string;
  email: string;
  role: "teacher" | "admin";
  languagePreference: Language;
  createdAt: number;
}

const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days
const COOKIE_NAME = "promptomatik_session";
// Per-user index of live sessions, so a password reset can revoke every
// session a user holds. Keyed `usersession:${userId}:${sessionId}` with an
// empty value; enumerated via KV list() in destroyUserSessions.
const USER_INDEX_PREFIX = "usersession:";

function sessionKey(sessionId: string): string {
  return `session:${sessionId}`;
}

function userIndexKey(userId: string, sessionId: string): string {
  return `${USER_INDEX_PREFIX}${userId}:${sessionId}`;
}

export async function createSession(
  env: Env,
  data: SessionData
): Promise<string> {
  const sessionId = crypto.randomUUID();
  await Promise.all([
    env.SESSIONS.put(sessionKey(sessionId), JSON.stringify(data), {
      expirationTtl: SESSION_TTL,
    }),
    env.SESSIONS.put(userIndexKey(data.userId, sessionId), "", {
      expirationTtl: SESSION_TTL,
    }),
  ]);
  return sessionId;
}

export async function getSession(
  env: Env,
  request: Request
): Promise<SessionData | null> {
  const cookie = request.headers.get("Cookie") ?? "";
  const sessionId = parseCookie(cookie, COOKIE_NAME);
  if (!sessionId) return null;

  const raw = await env.SESSIONS.get(sessionKey(sessionId));
  if (!raw) return null;

  return JSON.parse(raw) as SessionData;
}

export async function destroySession(
  env: Env,
  request: Request
): Promise<void> {
  const cookie = request.headers.get("Cookie") ?? "";
  const sessionId = parseCookie(cookie, COOKIE_NAME);
  if (!sessionId) return;

  const raw = await env.SESSIONS.get(sessionKey(sessionId));
  const userId = raw ? (JSON.parse(raw) as SessionData).userId : null;
  await Promise.all([
    env.SESSIONS.delete(sessionKey(sessionId)),
    userId
      ? env.SESSIONS.delete(userIndexKey(userId, sessionId))
      : Promise.resolve(),
  ]);
}

// Revoke every session belonging to a user (e.g. after a password reset).
// Walks the per-user KV index and deletes both the session record and its
// index entry. Like all KV writes, deletes propagate within ~60s globally.
export async function destroyUserSessions(
  env: Env,
  userId: string
): Promise<void> {
  const prefix = `${USER_INDEX_PREFIX}${userId}:`;
  let cursor: string | undefined;
  do {
    const listed = await env.SESSIONS.list({ prefix, cursor });
    await Promise.all(
      listed.keys.flatMap((key) => {
        const sessionId = key.name.slice(prefix.length);
        return [
          env.SESSIONS.delete(sessionKey(sessionId)),
          env.SESSIONS.delete(key.name),
        ];
      })
    );
    cursor = listed.list_complete ? undefined : listed.cursor;
  } while (cursor);
}

export function sessionCookie(sessionId: string): string {
  return `${COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function updateSession(
  env: Env,
  request: Request,
  data: SessionData
): Promise<void> {
  const sessionId = getSessionId(request);
  if (!sessionId) return;
  await env.SESSIONS.put(`session:${sessionId}`, JSON.stringify(data), {
    expirationTtl: SESSION_TTL,
  });
}

function parseCookie(header: string, name: string): string | null {
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}

function getSessionId(request: Request): string | null {
  const cookie = request.headers.get("Cookie") ?? "";
  return parseCookie(cookie, COOKIE_NAME);
}
