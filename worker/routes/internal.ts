import { Hono } from "hono";
import type { Env } from "../env";
import { grantAudioCredits } from "../lib/audio-metrics";

// Machine-to-machine routes for TeachInspire's own services. No user session:
// callers authenticate with a shared secret (X-Internal-Secret). Routes stay
// disabled (404) until the secret is configured, so an unconfigured deploy
// exposes nothing.
const internal = new Hono<{ Bindings: Env }>();

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

// Called by temoignages.teachinspire.me when a testimonial-form response is
// recorded. The form is itself gated behind a Studio login and allows a single
// response per account, so at most one call per user ever happens; the caller
// also keeps a credited_at marker and never retries a success.
internal.post("/testimonial-grant", async (c) => {
  const secret = c.env.TESTIMONIAL_GRANT_SECRET;
  if (!secret) return c.json({ error: "Not found" }, 404);

  const provided = c.req.header("X-Internal-Secret") ?? "";
  if (!timingSafeEqual(provided, secret)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const body = await c.req.json<{ userId?: unknown; seconds?: unknown }>().catch(() => null);
  if (!body || typeof body.userId !== "string" || !body.userId.trim()) {
    return c.json({ error: "userId is required." }, 400);
  }
  const seconds = body.seconds;
  if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds <= 0 || seconds > 3600) {
    return c.json({ error: "seconds must be a positive integer (max 3600)." }, 400);
  }

  const result = await grantAudioCredits(c.env, body.userId.trim(), seconds);
  if (!result) {
    return c.json({ error: "User not found." }, 404);
  }
  return c.json({ success: true, credits: result.credits });
});

export { internal };
