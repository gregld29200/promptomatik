import { createMiddleware } from "hono/factory";
import type { Env } from "../env";
import { getSession, type SessionData } from "./session";

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
