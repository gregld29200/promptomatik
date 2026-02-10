import { Hono } from "hono";
import type { Env } from "../env";
import { hashPassword, verifyPassword } from "../lib/password";
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
    "SELECT id, email, name, password_hash, role, language_preference FROM users WHERE email = ?"
  )
    .bind(email.toLowerCase().trim())
    .first<{
      id: string;
      email: string;
      name: string;
      password_hash: string;
      role: "teacher" | "admin";
      language_preference: "fr" | "en";
    }>();

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: "Invalid credentials" }, 401);
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

auth.post("/logout", requireAuth, async (c) => {
  await destroySession(c.env, c.req.raw);
  return c.json({ success: true }, 200, {
    "Set-Cookie": clearSessionCookie(),
  });
});

export { auth };
