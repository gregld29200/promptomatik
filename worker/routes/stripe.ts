import { Hono } from "hono";
import type { Env } from "../env";
import { handleStripeWebhook } from "../lib/audio-credits";

const stripe = new Hono<{ Bindings: Env }>();

// Signature-verified, idempotent. No session auth: Stripe calls this.
stripe.post("/webhook", async (c) => {
  if (!c.env.STRIPE_WEBHOOK_SECRET) {
    return c.json({ error: "Not configured." }, 503);
  }
  const rawBody = await c.req.text();
  const outcome = await handleStripeWebhook(c.env, rawBody, c.req.header("Stripe-Signature"));
  if (!outcome.ok) {
    return c.json({ error: outcome.reason }, 400);
  }
  return c.json({ received: true });
});

export { stripe };
