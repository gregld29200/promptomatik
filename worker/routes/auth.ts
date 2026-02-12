import { Hono } from "hono";
import type { Env } from "../env";
import { hashPassword, verifyPassword } from "../lib/password";
import { sendPasswordResetEmail } from "../lib/email";
import {
  createSession,
  destroySession,
  sessionCookie,
  clearSessionCookie,
} from "../lib/session";
import { requireAuth } from "../lib/auth-middleware";

const auth = new Hono<{ Bindings: Env }>();

auth.post("/login", async (c) => {
  const { email, password } = await c.req.json<{
    email: string;
    password: string;
  }>();

  if (!email || !password) {
    return c.json({ error: "Email and password are required" }, 400);
  }

  const user = await c.env.DB.prepare(
    "SELECT id, email, name, password_hash, role, language_preference, is_active FROM users WHERE email = ?"
  )
    .bind(email.toLowerCase().trim())
    .first<{
      id: string;
      email: string;
      name: string;
      password_hash: string;
      role: "teacher" | "admin";
      language_preference: "fr" | "en";
      is_active: number;
    }>();

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  if (!user.is_active) {
    return c.json({ error: "Account deactivated" }, 403);
  }

  const sessionId = await createSession(c.env, {
    userId: user.id,
    email: user.email,
    role: user.role,
    languagePreference: user.language_preference,
    createdAt: Date.now(),
  });

  return c.json(
    { user: { id: user.id, email: user.email, name: user.name, role: user.role } },
    200,
    { "Set-Cookie": sessionCookie(sessionId) }
  );
});

auth.post("/register", async (c) => {
  const { token, name, password } = await c.req.json<{
    token: string;
    name: string;
    password: string;
  }>();

  if (!token || !name || !password) {
    return c.json({ error: "Token, name, and password are required" }, 400);
  }

  if (password.length < 8) {
    return c.json({ error: "Password must be at least 8 characters" }, 400);
  }

  const invitation = await c.env.DB.prepare(
    "SELECT id, email, status, expires_at FROM invitations WHERE token = ?"
  )
    .bind(token)
    .first<{
      id: string;
      email: string;
      status: string;
      expires_at: string;
    }>();

  if (!invitation) {
    return c.json({ error: "Invalid invitation" }, 400);
  }

  if (invitation.status !== "pending") {
    return c.json({ error: "Invitation already used" }, 400);
  }

  if (new Date(invitation.expires_at) < new Date()) {
    return c.json({ error: "Invitation expired" }, 400);
  }

  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);

  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO users (id, email, name, password_hash, role, language_preference) VALUES (?, ?, ?, ?, 'teacher', 'fr')"
    ).bind(userId, invitation.email.toLowerCase().trim(), name.trim(), passwordHash),
    c.env.DB.prepare(
      "UPDATE invitations SET status = 'accepted' WHERE id = ?"
    ).bind(invitation.id),
  ]);

  const sessionId = await createSession(c.env, {
    userId,
    email: invitation.email,
    role: "teacher",
    languagePreference: "fr",
    createdAt: Date.now(),
  });

  return c.json(
    { user: { id: userId, email: invitation.email, name: name.trim(), role: "teacher" } },
    201,
    { "Set-Cookie": sessionCookie(sessionId) }
  );
});

auth.post("/forgot-password", async (c) => {
  const { email } = await c.req.json<{ email: string }>();

  if (!email) {
    return c.json({ error: "Email is required" }, 400);
  }

  const normalizedEmail = email.toLowerCase().trim();
  const user = await c.env.DB.prepare(
    "SELECT id, email, language_preference FROM users WHERE email = ?"
  )
    .bind(normalizedEmail)
    .first<{
      id: string;
      email: string;
      language_preference: "fr" | "en";
    }>();

  // Always return success to avoid account enumeration
  if (!user) {
    return c.json({ success: true });
  }

  const token = crypto.randomUUID();
  const resetId = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const appBaseUrl = c.env.APP_URL ?? new URL(c.req.url).origin;

  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL"
    ).bind(now, user.id),
    c.env.DB.prepare(
      "INSERT INTO password_resets (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(resetId, user.id, token, expiresAt, now),
  ]);

  await sendPasswordResetEmail(c.env.RESEND_API_KEY, {
    to: user.email,
    token,
    lang: user.language_preference ?? "fr",
    appBaseUrl,
  });

  return c.json({ success: true });
});

auth.post("/reset-password", async (c) => {
  const { token, password } = await c.req.json<{
    token: string;
    password: string;
  }>();

  if (!token || !password) {
    return c.json({ error: "Token and password are required" }, 400);
  }

  if (password.length < 8) {
    return c.json({ error: "Password must be at least 8 characters" }, 400);
  }

  const reset = await c.env.DB.prepare(
    `SELECT id, user_id, expires_at, used_at
     FROM password_resets
     WHERE token = ?`
  )
    .bind(token)
    .first<{
      id: string;
      user_id: string;
      expires_at: string;
      used_at: string | null;
    }>();

  if (!reset || reset.used_at) {
    return c.json({ error: "Invalid or used reset token" }, 400);
  }

  if (new Date(reset.expires_at) < new Date()) {
    return c.json({ error: "Reset token has expired" }, 400);
  }

  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();

  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?"
    ).bind(passwordHash, now, reset.user_id),
    c.env.DB.prepare(
      "UPDATE password_resets SET used_at = ? WHERE id = ?"
    ).bind(now, reset.id),
  ]);

  return c.json({ success: true });
});

auth.get("/me", requireAuth, async (c) => {
  const session = c.get("session");
  const user = await c.env.DB.prepare(
    "SELECT id, email, name, role FROM users WHERE id = ?"
  )
    .bind(session.userId)
    .first<{ id: string; email: string; name: string; role: string }>();

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json({ user });
});

auth.post("/logout", requireAuth, async (c) => {
  await destroySession(c.env, c.req.raw);
  return c.json({ success: true }, 200, {
    "Set-Cookie": clearSessionCookie(),
  });
});

export { auth };
