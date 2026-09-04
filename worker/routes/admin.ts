import { Hono } from "hono";
import type { Env } from "../env";
import type { SessionData } from "../lib/session";
import { requireAuth, requireAdmin } from "../lib/auth-middleware";
import { sendInvitationEmail, sendPasswordResetEmail } from "../lib/email";
import { isTier } from "../lib/tier";

const admin = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

admin.use("*", requireAuth, requireAdmin);

// ---- Invitations ----

admin.post("/invitations", async (c) => {
  const { email, tier: rawTier } = await c.req.json<{ email: string; tier?: string }>();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: "Valid email is required" }, 400);
  }

  const tier = isTier(rawTier) ? rawTier : "participant";

  const normalizedEmail = email.toLowerCase().trim();

  // Check for existing user
  const existingUser = await c.env.DB.prepare(
    "SELECT id FROM users WHERE email = ?"
  )
    .bind(normalizedEmail)
    .first();

  if (existingUser) {
    return c.json({ error: "A user with this email already exists" }, 409);
  }

  // Check for pending invitation
  const existingInvite = await c.env.DB.prepare(
    "SELECT id FROM invitations WHERE email = ? AND status = 'pending'"
  )
    .bind(normalizedEmail)
    .first();

  if (existingInvite) {
    return c.json({ error: "A pending invitation already exists for this email" }, 409);
  }

  const session = c.get("session");
  const inviter = await c.env.DB.prepare("SELECT name FROM users WHERE id = ?")
    .bind(session.userId)
    .first<{ name: string }>();

  const token = crypto.randomUUID();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await c.env.DB.prepare(
    "INSERT INTO invitations (id, email, token, status, invited_by, tier, kind, expires_at, created_at) VALUES (?, ?, ?, 'pending', ?, ?, 'admin', ?, ?)"
  ).bind(id, normalizedEmail, token, session.userId, tier, expiresAt, now).run();

  const emailResult = await sendInvitationEmail(c.env.RESEND_API_KEY, {
    to: normalizedEmail,
    inviterName: inviter?.name ?? "Admin",
    token,
    lang: session.languagePreference,
    appBaseUrl: c.env.APP_URL ?? new URL(c.req.url).origin,
  });

  const invitation = { id, email: normalizedEmail, token, status: "pending", tier, kind: "admin", expires_at: expiresAt, created_at: now };

  return c.json({ invitation, email_sent: emailResult.success }, 201);
});

admin.get("/invitations", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, email, token, status, tier, kind, expires_at, created_at FROM invitations ORDER BY created_at DESC"
  ).all<{
    id: string;
    email: string;
    token: string;
    status: string;
    tier: string;
    kind: string;
    expires_at: string;
    created_at: string;
  }>();

  return c.json({ invitations: results });
});

// ---- Users ----

admin.get("/users", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, email, name, role, tier, is_active, created_at FROM users ORDER BY created_at DESC"
  ).all<{
    id: string;
    email: string;
    name: string;
    role: string;
    tier: string;
    is_active: number;
    created_at: string;
  }>();

  return c.json({ users: results });
});

admin.post("/users/:id/tier", async (c) => {
  const userId = c.req.param("id");
  const { tier } = await c.req.json<{ tier?: string }>();

  if (!isTier(tier)) {
    return c.json({ error: "Invalid tier" }, 400);
  }

  const result = await c.env.DB.prepare(
    "UPDATE users SET tier = ?, updated_at = datetime('now') WHERE id = ?"
  )
    .bind(tier, userId)
    .run();

  if (!result.meta.changes) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json({ success: true });
});

// Existing accounts must never receive another invitation: its registration
// token would be unusable. This sends a fresh password-reset link instead,
// which is the safe way to restore access without touching their work.
admin.post("/users/:id/access-link", async (c) => {
  const userId = c.req.param("id");
  const user = await c.env.DB.prepare(
    "SELECT id, email, language_preference, is_active FROM users WHERE id = ?"
  )
    .bind(userId)
    .first<{ id: string; email: string; language_preference: string; is_active: number }>();

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  if (!user.is_active) {
    return c.json({ error: "Cannot send an access link to a deactivated user" }, 409);
  }

  const resetId = crypto.randomUUID();
  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  // A new link supersedes every older one, even if delivery then fails. The
  // token stays secret in D1 and the admin can issue another link safely.
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO password_resets (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(resetId, user.id, token, expiresAt, now),
    c.env.DB.prepare(
      "UPDATE password_resets SET used_at = ? WHERE user_id = ? AND id != ? AND used_at IS NULL"
    ).bind(now, user.id, resetId),
  ]);

  const emailResult = c.env.RESEND_API_KEY
    ? await sendPasswordResetEmail(c.env.RESEND_API_KEY, {
      to: user.email,
      token,
      lang: user.language_preference === "en" || user.language_preference === "es" ? user.language_preference : "fr",
      appBaseUrl: c.env.APP_URL ?? new URL(c.req.url).origin,
    })
    : { success: false, error: "Email service is not configured" };

  if (!emailResult.success) {
    console.error("admin access-link email failed", {
      userId: user.id,
      resetId,
      error: emailResult.error ?? "unknown",
    });
  }

  return c.json({ email_sent: emailResult.success });
});

admin.post("/users/:id/deactivate", async (c) => {
  const userId = c.req.param("id");

  const session = c.get("session");
  if (userId === session.userId) {
    return c.json({ error: "Cannot deactivate yourself" }, 400);
  }

  await c.env.DB.prepare("UPDATE users SET is_active = 0 WHERE id = ?")
    .bind(userId)
    .run();

  return c.json({ success: true });
});

admin.post("/users/:id/reactivate", async (c) => {
  const userId = c.req.param("id");

  await c.env.DB.prepare("UPDATE users SET is_active = 1 WHERE id = ?")
    .bind(userId)
    .run();

  return c.json({ success: true });
});

// ---- Templates ----

admin.get("/templates", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.name, p.tags, p.updated_at, p.template_kind, p.template_status, u.name AS author_name
     FROM prompts p
     JOIN users u ON u.id = p.user_id
     WHERE p.is_template = 1
       AND p.template_status = 'approved'
     ORDER BY p.updated_at DESC`
  ).all<{
    id: string;
    name: string;
    tags: string;
    updated_at: string;
    template_kind: string;
    template_status: string;
    author_name: string;
  }>();

  const templates = (results ?? []).map((r) => ({
    ...r,
    tags: JSON.parse(r.tags),
  }));

  return c.json({ templates });
});

admin.get("/templates/submissions", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.name, p.tags, p.updated_at, p.template_kind, p.template_status, u.name AS author_name
     FROM prompts p
     JOIN users u ON u.id = p.user_id
     WHERE p.template_status = 'pending'
       AND p.template_kind = 'community'
     ORDER BY p.updated_at DESC`
  ).all<{
    id: string;
    name: string;
    tags: string;
    updated_at: string;
    template_kind: string;
    template_status: string;
    author_name: string;
  }>();

  const submissions = (results ?? []).map((r) => ({
    ...r,
    tags: JSON.parse(r.tags),
  }));

  return c.json({ submissions });
});

admin.post("/templates/:id/publish", async (c) => {
  const promptId = c.req.param("id");

  const existing = await c.env.DB.prepare(
    "SELECT id FROM prompts WHERE id = ?"
  )
    .bind(promptId)
    .first<{ id: string }>();

  if (!existing) {
    return c.json({ error: "Prompt not found" }, 404);
  }

  await c.env.DB.prepare(
    `UPDATE prompts
     SET is_template = 1,
         template_kind = 'official',
         template_status = 'approved',
         updated_at = datetime('now')
     WHERE id = ?`
  )
    .bind(promptId)
    .run();

  return c.json({ success: true });
});

admin.post("/templates/:id/unpublish", async (c) => {
  const promptId = c.req.param("id");

  await c.env.DB.prepare(
    "UPDATE prompts SET is_template = 0, updated_at = datetime('now') WHERE id = ?"
  )
    .bind(promptId)
    .run();

  return c.json({ success: true });
});

admin.post("/templates/:id/approve", async (c) => {
  const promptId = c.req.param("id");

  const existing = await c.env.DB.prepare(
    "SELECT id FROM prompts WHERE id = ? AND template_status = 'pending' AND template_kind = 'community'"
  )
    .bind(promptId)
    .first<{ id: string }>();

  if (!existing) {
    return c.json({ error: "Pending submission not found" }, 404);
  }

  await c.env.DB.prepare(
    `UPDATE prompts
     SET is_template = 1,
         template_kind = 'community',
         template_status = 'approved',
         updated_at = datetime('now')
     WHERE id = ?`
  )
    .bind(promptId)
    .run();

  return c.json({ success: true });
});

admin.post("/templates/:id/reject", async (c) => {
  const promptId = c.req.param("id");

  const existing = await c.env.DB.prepare(
    "SELECT id FROM prompts WHERE id = ? AND template_status = 'pending' AND template_kind = 'community'"
  )
    .bind(promptId)
    .first<{ id: string }>();

  if (!existing) {
    return c.json({ error: "Pending submission not found" }, 404);
  }

  await c.env.DB.prepare(
    `UPDATE prompts
     SET is_template = 0,
         template_kind = 'community',
         template_status = 'rejected',
         updated_at = datetime('now')
     WHERE id = ?`
  )
    .bind(promptId)
    .run();

  return c.json({ success: true });
});

export { admin };
