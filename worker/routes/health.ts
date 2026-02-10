import { Hono } from "hono";
import type { Env } from "../env";

const health = new Hono<{ Bindings: Env }>();

health.get("/", (c) =>
  c.json({ status: "ok", timestamp: new Date().toISOString() })
);

export { health };
