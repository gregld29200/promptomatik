import { createMiddleware } from "hono/factory";
import type { Env } from "../env";
import { getSession, type SessionData } from "./session";
import { getUserTier } from "./tier";

type AuthEnv = { Bindings: Env; Variables: { session: SessionData } };

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const session = await getSession(c.env, c.req.raw);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("session", session);
  await next();
});

export const requireAdmin = createMiddleware<AuthEnv>(async (c, next) => {
  const session = c.get("session");
  if (session.role !== "admin") {
    return c.json({ error: "Forbidden" }, 403);
  }
  await next();
});

// Tier is read from D1 (not the KV session) so admin tier changes apply
// immediately instead of after the 7-day session expires.
// `{ error: 'tier_required' }` is a stable contract — the front renders
// upgrade gates from it, not generic error toasts.
export const requireParticipant = createMiddleware<AuthEnv>(async (c, next) => {
  const session = c.get("session");
  if (session.role === "admin") {
    await next();
    return;
  }
  const tier = await getUserTier(c.env.DB, session.userId);
  if (tier !== "participant") {
    return c.json({ error: "tier_required", required: "participant" }, 403);
  }
  await next();
});
