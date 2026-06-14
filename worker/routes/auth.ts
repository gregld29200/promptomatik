import { Hono } from "hono";
import type { Env } from "../env";
import { hashPassword, verifyPassword } from "../lib/password";
import { sendPasswordResetEmail, sendSignupConfirmationEmail } from "../lib/email";
import {
  createSession,
  destroySession,
  sessionCookie,
  clearSessionCookie,
  updateSession,
} from "../lib/session";
import { requireAuth } from "../lib/auth-middleware";
import { DEFAULT_LANGUAGE, isLanguage, normalizeLanguage, type Language } from "../lib/language";
import { normalizeTier, type Tier } from "../lib/tier";
import { DAILY_INTERVIEW_LIMIT, getInterviewQuotaUsed } from "../lib/quota";

const auth = new Hono<{ Bindings: Env }>();

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: "teacher" | "admin";
  language_preference: Language;
  tier: Tier;
}

function userResponse(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    languagePreference: normalizeLanguage(user.language_preference),
    tier: normalizeTier(user.tier),
  };
}

auth.post("/login", async (c) => {
  const { email, password } = await c.req.json<{
    email: string;
    password: string;
  }>();

  if (!email || !password) {
    return c.json({ error: "Email and password are required" }, 400);
  }

  const user = await c.env.DB.prepare(
    "SELECT id, email, name, password_hash, role, language_preference, tier, is_active FROM users WHERE email = ?"
  )
    .bind(email.toLowerCase().trim())
    .first<{
      id: string;
      email: string;
      name: string;
      password_hash: string;
      role: "teacher" | "admin";
      language_preference: Language;
      tier: Tier;
      is_active: number;
    }>();

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  if (!user.is_active) {
    return c.json({ error: "Account deactivated" }, 403);
  }

  const languagePreference = normalizeLanguage(user.language_preference);
  const sessionId = await createSession(c.env, {
    userId: user.id,
    email: user.email,
    role: user.role,
    languagePreference,
    createdAt: Date.now(),
  });

  return c.json(
    {
      user: userResponse({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        language_preference: languagePreference,
        tier: user.tier,
      }),
    },
    200,
    { "Set-Cookie": sessionCookie(sessionId) }
  );
});

const SIGNUP_RATE_LIMIT = 5; // attempts per hour per IP
const SIGNUP_RATE_TTL_SECONDS = 3600;
const SIGNUP_INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

// Public self-serve signup: creates a free-tier invitation and emails the
// confirmation link. Always answers { ok: true } once past validation and
// rate limiting — no account enumeration.
auth.post("/signup", async (c) => {
  const body = await c.req.json<{ email?: string; language?: string }>().catch(() => ({} as { email?: string; language?: string }));
  const normalizedEmail = (body.email ?? "").toLowerCase().trim();
  const lang = normalizeLanguage(body.language);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return c.json({ error: "invalid_email" }, 400);
  }

  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const rateKey = `ratelimit:signup:${ip}`;
  const attempts = Number.parseInt((await c.env.SESSIONS.get(rateKey)) ?? "0", 10) || 0;
  if (attempts >= SIGNUP_RATE_LIMIT) {
    return c.json({ error: "rate_limited" }, 429);
  }
  await c.env.SESSIONS.put(rateKey, String(attempts + 1), {
    expirationTtl: SIGNUP_RATE_TTL_SECONDS,
  });

  const existingUser = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(normalizedEmail)
    .first<{ id: string }>();
  if (existingUser) {
    return c.json({ ok: true });
  }

  const appBaseUrl = c.env.APP_URL ?? new URL(c.req.url).origin;
  const expiresAt = new Date(Date.now() + SIGNUP_INVITE_EXPIRY_MS).toISOString();

  const pending = await c.env.DB.prepare(
    "SELECT id FROM invitations WHERE email = ? AND kind = 'self' AND status = 'pending'"
  )
    .bind(normalizedEmail)
    .first<{ id: string }>();

  // Re-request (including after expiry): rotate the token and extend the
  // expiry on the existing row, then resend.
  const token = crypto.randomUUID();
  if (pending) {
    await c.env.DB.prepare(
      "UPDATE invitations SET token = ?, expires_at = ?, language = ? WHERE id = ?"
    )
      .bind(token, expiresAt, lang, pending.id)
      .run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO invitations (id, email, token, invited_by, status, tier, kind, language, expires_at, created_at)
       VALUES (?, ?, ?, NULL, 'pending', 'free', 'self', ?, ?, ?)`
    )
      .bind(crypto.randomUUID(), normalizedEmail, token, lang, expiresAt, new Date().toISOString())
      .run();
  }

  const emailResult = await sendSignupConfirmationEmail(c.env.RESEND_API_KEY, {
    to: normalizedEmail,
    token,
    lang,
    appBaseUrl,
  });
  if (!emailResult.success) {
    console.error("signup confirmation email failed", {
      email: normalizedEmail,
      error: emailResult.error ?? "unknown",
    });
  }

  return c.json({ ok: true });
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
    `SELECT i.id, i.email, i.status, i.expires_at, i.tier, i.kind, i.language, u.language_preference AS inviter_language_preference
     FROM invitations i
     LEFT JOIN users u ON u.id = i.invited_by
     WHERE i.token = ?`
  )
    .bind(token)
    .first<{
      id: string;
      email: string;
      status: string;
      expires_at: string;
      tier: string;
      kind: string;
      language: string;
      inviter_language_preference: Language | null;
    }>();

  if (!invitation) {
    return c.json({ error: "Invalid invitation" }, 400);
  }

  if (invitation.status !== "pending") {
    return c.json({ error: "Invitation already used" }, 400);
  }

  if (new Date(invitation.expires_at) < new Date()) {
    // The _SELF variant lets the front offer "request a new link" → /signup
    return c.json(
      {
        error: "Invitation expired",
        code: invitation.kind === "self" ? "INVITE_EXPIRED_SELF" : "INVITE_EXPIRED",
      },
      400
    );
  }

  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  // Self signups carry the language chosen on the form; admin invitations
  // inherit the inviter's preference (existing behavior).
  const languagePreference = invitation.kind === "self"
    ? normalizeLanguage(invitation.language)
    : normalizeLanguage(invitation.inviter_language_preference ?? DEFAULT_LANGUAGE);
  const tier = normalizeTier(invitation.tier);

  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO users (id, email, name, password_hash, role, language_preference, tier) VALUES (?, ?, ?, ?, 'teacher', ?, ?)"
    ).bind(userId, invitation.email.toLowerCase().trim(), name.trim(), passwordHash, languagePreference, tier),
    c.env.DB.prepare(
      "UPDATE invitations SET status = 'accepted' WHERE id = ?"
    ).bind(invitation.id),
  ]);

  // Marketing webhook — fire-and-forget, must never block activation.
  if (invitation.kind === "self" && c.env.MARKETING_WEBHOOK_URL) {
    const webhookUrl = c.env.MARKETING_WEBHOOK_URL;
    c.executionCtx.waitUntil(
      fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: invitation.email.toLowerCase().trim(),
          language: languagePreference,
          source: "promptomatik_free",
          created_at: new Date().toISOString(),
        }),
      }).catch((err) => {
        console.error("marketing webhook failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      })
    );
  }

  const sessionId = await createSession(c.env, {
    userId,
    email: invitation.email,
    role: "teacher",
    languagePreference,
    createdAt: Date.now(),
  });

  return c.json(
    {
      user: userResponse({
        id: userId,
        email: invitation.email,
        name: name.trim(),
        role: "teacher",
        language_preference: languagePreference,
        tier,
      }),
    },
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
      language_preference: Language;
    }>();

  if (!user) {
    return c.json({ success: true });
  }

  const token = crypto.randomUUID();
  const resetId = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const appBaseUrl = c.env.APP_URL ?? new URL(c.req.url).origin;

  await c.env.DB.prepare(
    "INSERT INTO password_resets (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(resetId, user.id, token, expiresAt, now).run();

  const emailResult = await sendPasswordResetEmail(c.env.RESEND_API_KEY, {
    to: user.email,
    token,
    lang: normalizeLanguage(user.language_preference),
    appBaseUrl,
  });

  if (!emailResult.success) {
    await c.env.DB.prepare(
      "UPDATE password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL"
    ).bind(new Date().toISOString(), resetId).run();

    console.error("forgot-password email send failed", {
      userId: user.id,
      email: user.email,
      resetId,
      error: emailResult.error ?? "unknown",
    });

    return c.json({ success: true });
  }

  await c.env.DB.prepare(
    "UPDATE password_resets SET used_at = ? WHERE user_id = ? AND id != ? AND used_at IS NULL"
  ).bind(new Date().toISOString(), user.id, resetId).run();

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

  if (!reset) {
    return c.json({ error: "Invalid reset token", code: "RESET_TOKEN_INVALID" }, 400);
  }

  if (reset.used_at) {
    return c.json({ error: "Reset token has already been used", code: "RESET_TOKEN_USED" }, 400);
  }

  if (Date.parse(reset.expires_at) <= Date.now()) {
    return c.json({ error: "Reset token has expired", code: "RESET_TOKEN_EXPIRED" }, 400);
  }

  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();

  const claimResult = await c.env.DB.prepare(
    `UPDATE password_resets
     SET used_at = ?
     WHERE id = ?
       AND used_at IS NULL
       AND unixepoch(expires_at) > unixepoch(?)`
  ).bind(now, reset.id, now).run();

  if ((claimResult.meta.changes ?? 0) !== 1) {
    const latestState = await c.env.DB.prepare(
      "SELECT expires_at, used_at FROM password_resets WHERE id = ?"
    ).bind(reset.id).first<{ expires_at: string; used_at: string | null }>();

    if (!latestState) {
      return c.json({ error: "Invalid reset token", code: "RESET_TOKEN_INVALID" }, 400);
    }

    if (latestState.used_at) {
      return c.json({ error: "Reset token has already been used", code: "RESET_TOKEN_USED" }, 400);
    }

    if (Date.parse(latestState.expires_at) <= Date.now()) {
      return c.json({ error: "Reset token has expired", code: "RESET_TOKEN_EXPIRED" }, 400);
    }

    return c.json({ error: "Invalid reset token", code: "RESET_TOKEN_INVALID" }, 400);
  }

  await c.env.DB.prepare(
    "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?"
  ).bind(passwordHash, now, reset.user_id).run();

  return c.json({ success: true });
});

auth.get("/me", requireAuth, async (c) => {
  const session = c.get("session");
  const user = await c.env.DB.prepare(
    "SELECT id, email, name, role, language_preference, tier FROM users WHERE id = ?"
  )
    .bind(session.userId)
    .first<UserRow>();

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  const isFreeTier = normalizeTier(user.tier) === "free" && user.role !== "admin";
  const quota = isFreeTier
    ? {
        used: await getInterviewQuotaUsed(c.env, user.id),
        limit: DAILY_INTERVIEW_LIMIT,
      }
    : null;

  return c.json({ user: userResponse(user), quota });
});

auth.put("/language", requireAuth, async (c) => {
  const session = c.get("session");
  const body = await c.req.json<{ language?: string }>();
  if (!isLanguage(body.language)) {
    return c.json({ error: "Invalid language" }, 400);
  }
  const language = body.language;

  const existingUser = await c.env.DB.prepare(
    "SELECT id, email, name, role, language_preference, tier FROM users WHERE id = ?"
  )
    .bind(session.userId)
    .first<UserRow>();

  if (!existingUser) {
    return c.json({ error: "User not found" }, 404);
  }

  await c.env.DB.prepare(
    "UPDATE users SET language_preference = ?, updated_at = datetime('now') WHERE id = ?"
  )
    .bind(language, session.userId)
    .run();

  await updateSession(c.env, c.req.raw, {
    ...session,
    languagePreference: language,
  });

  return c.json({
    user: userResponse({
      ...existingUser,
      language_preference: language,
    }),
  });
});

auth.post("/logout", requireAuth, async (c) => {
  await destroySession(c.env, c.req.raw);
  return c.json({ success: true }, 200, {
    "Set-Cookie": clearSessionCookie(),
  });
});

export { auth };
