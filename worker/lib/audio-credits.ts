// Stripe credit purchases (V1.5). Everything Stripe-specific lives here:
// pack catalog, Checkout Session creation, webhook signature verification,
// and the idempotent credit grant. No card data ever touches this worker -
// payment happens on Stripe-hosted Checkout.

import type { Env } from "../env";

export interface CreditPack {
  id: string;
  minutes: number;
  priceId: string;
}

const STRIPE_API = "https://api.stripe.com/v1";
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export function stripeConfigured(env: Env): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && creditPacks(env).length > 0);
}

// Pack minutes are fixed here; prices live in Stripe (changing a price in the
// Stripe dashboard requires no redeploy - the price id stays the same).
export function creditPacks(env: Env): CreditPack[] {
  const packs: CreditPack[] = [];
  if (env.STRIPE_PRICE_PACK_60?.trim()) {
    packs.push({ id: "pack60", minutes: 60, priceId: env.STRIPE_PRICE_PACK_60.trim() });
  }
  if (env.STRIPE_PRICE_PACK_180?.trim()) {
    packs.push({ id: "pack180", minutes: 180, priceId: env.STRIPE_PRICE_PACK_180.trim() });
  }
  return packs;
}

export interface CreditPackDisplay {
  id: string;
  minutes: number;
  amountCents: number | null;
  currency: string | null;
}

// Prices are read live from Stripe so the UI never contradicts the
// dashboard. A price lookup failure degrades to minutes-only display.
export async function packsWithPrices(env: Env, fetcher: typeof fetch = fetch): Promise<CreditPackDisplay[]> {
  return Promise.all(creditPacks(env).map(async (pack) => {
    try {
      const response = await fetcher(`${STRIPE_API}/prices/${pack.priceId}`, {
        headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
      });
      const price = await response.json() as { unit_amount?: number; currency?: string };
      return {
        id: pack.id,
        minutes: pack.minutes,
        amountCents: response.ok && typeof price.unit_amount === "number" ? price.unit_amount : null,
        currency: response.ok && typeof price.currency === "string" ? price.currency : null,
      };
    } catch {
      return { id: pack.id, minutes: pack.minutes, amountCents: null, currency: null };
    }
  }));
}

export async function createCheckoutSession(
  env: Env,
  userId: string,
  packId: string,
  origin: string,
  fetcher: typeof fetch = fetch
): Promise<{ url: string } | { error: string; status: 400 | 502 }> {
  const pack = creditPacks(env).find((candidate) => candidate.id === packId);
  if (!pack) return { error: "Unknown credit pack.", status: 400 };

  const body = new URLSearchParams({
    mode: "payment",
    "line_items[0][price]": pack.priceId,
    "line_items[0][quantity]": "1",
    success_url: `${origin}/audio?checkout=success`,
    cancel_url: `${origin}/audio?checkout=cancelled`,
    client_reference_id: userId,
    "metadata[userId]": userId,
    "metadata[packId]": pack.id,
    "metadata[minutes]": String(pack.minutes),
    "automatic_tax[enabled]": "true",
  });

  const response = await fetcher(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const payload = await response.json().catch(() => null) as { url?: string; error?: { message?: string } } | null;
  if (!response.ok || !payload?.url) {
    // Never surface Stripe internals to the client; log id-free context only.
    console.error("Stripe checkout session creation failed", { status: response.status });
    return { error: "Unable to start the payment. Please try again.", status: 502 };
  }
  return { url: payload.url };
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyStripeSignature(
  secret: string,
  payload: string,
  signatureHeader: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<boolean> {
  if (!signatureHeader) return false;
  const parts = new Map(
    signatureHeader.split(",").map((part) => {
      const index = part.indexOf("=");
      return [part.slice(0, index), part.slice(index + 1)] as const;
    })
  );
  const timestamp = Number(parts.get("t"));
  const expected = parts.get("v1");
  if (!Number.isFinite(timestamp) || !expected) return false;
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const computed = await hmacSha256Hex(secret, `${timestamp}.${payload}`);
  return timingSafeEqualHex(computed, expected);
}

interface CheckoutCompletedEvent {
  id?: string;
  type?: string;
  data?: {
    object?: {
      id?: string;
      payment_status?: string;
      client_reference_id?: string;
      metadata?: { userId?: string; packId?: string; minutes?: string };
    };
  };
}

export type WebhookOutcome =
  | { ok: true; granted: boolean }
  | { ok: false; reason: "bad_signature" | "malformed" };

// Idempotent: the stripe_events insert is the lock - a redelivered event
// changes nothing. Grants are seconds (minutes * 60) as credit_purchase
// ledger rows carrying the Checkout Session id for audit.
export async function handleStripeWebhook(
  env: Env,
  rawBody: string,
  signatureHeader: string | undefined,
  nowSeconds?: number
): Promise<WebhookOutcome> {
  const valid = await verifyStripeSignature(env.STRIPE_WEBHOOK_SECRET ?? "", rawBody, signatureHeader, nowSeconds);
  if (!valid) return { ok: false, reason: "bad_signature" };

  let event: CheckoutCompletedEvent;
  try {
    event = JSON.parse(rawBody) as CheckoutCompletedEvent;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!event.id) return { ok: false, reason: "malformed" };

  if (event.type !== "checkout.session.completed") {
    return { ok: true, granted: false };
  }

  const session = event.data?.object;
  const userId = session?.metadata?.userId ?? session?.client_reference_id;
  const minutes = Number(session?.metadata?.minutes);
  if (!userId || !Number.isInteger(minutes) || minutes <= 0 || session?.payment_status !== "paid") {
    // Paid-but-unattributable events must not be silently dropped.
    console.error("Stripe checkout.session.completed with unusable payload", { eventId: event.id });
    return { ok: true, granted: false };
  }

  const claim = await env.DB.prepare(
    "INSERT OR IGNORE INTO stripe_events (event_id) VALUES (?)"
  ).bind(event.id).run();
  if (!claim.meta.changes) {
    return { ok: true, granted: false };
  }

  const seconds = minutes * 60;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO credit_balances (user_id, seconds)
       VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET seconds = seconds + excluded.seconds`
    ).bind(userId, seconds),
    env.DB.prepare(
      `INSERT INTO quota_ledger (user_id, delta_seconds, source, reason, job_id, stripe_ref)
       VALUES (?, ?, 'credit', 'credit_purchase', NULL, ?)`
    ).bind(userId, seconds, session?.id ?? event.id),
  ]);

  return { ok: true, granted: true };
}
