import type { Env } from "../env";

export interface SessionData {
  userId: string;
  email: string;
  role: "teacher" | "admin";
  languagePreference: "fr" | "en";
  createdAt: number;
}

const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days
const COOKIE_NAME = "promptomatik_session";

export async function createSession(
  env: Env,
  data: SessionData
): Promise<string> {
  const sessionId = crypto.randomUUID();
  await env.SESSIONS.put(`session:${sessionId}`, JSON.stringify(data), {
    expirationTtl: SESSION_TTL,
  });
  return sessionId;
}

export async function getSession(
  env: Env,
  request: Request
): Promise<SessionData | null> {
  const cookie = request.headers.get("Cookie") ?? "";
  const sessionId = parseCookie(cookie, COOKIE_NAME);
  if (!sessionId) return null;

  const raw = await env.SESSIONS.get(`session:${sessionId}`);
  if (!raw) return null;

  return JSON.parse(raw) as SessionData;
}

export async function destroySession(
  env: Env,
  request: Request
): Promise<void> {
  const cookie = request.headers.get("Cookie") ?? "";
  const sessionId = parseCookie(cookie, COOKIE_NAME);
  if (sessionId) {
    await env.SESSIONS.delete(`session:${sessionId}`);
  }
}

export function sessionCookie(sessionId: string): string {
  return `${COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function parseCookie(header: string, name: string): string | null {
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}
