import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../index";
import type { Env } from "../env";
import { createSession, type SessionData } from "./session";
import {
  createCheckoutSession,
  creditPacks,
  handleStripeWebhook,
  stripeConfigured,
  verifyStripeSignature,
} from "./audio-credits";

const testEnv = env as unknown as Env;

const TEST_SCHEMA_STATEMENTS = [
  "PRAGMA foreign_keys = OFF",
  "DROP TABLE IF EXISTS stripe_events",
  "DROP TABLE IF EXISTS quota_ledger",
  "DROP TABLE IF EXISTS credit_balances",
  "DROP TABLE IF EXISTS users",
  "PRAGMA foreign_keys = ON",
  `CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'teacher' CHECK (role IN ('teacher', 'admin')),
  language_preference TEXT NOT NULL DEFAULT 'fr',
  profile TEXT NOT NULL DEFAULT '{}',
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'participant')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE TABLE quota_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  delta_seconds INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('included','credit')),
  reason TEXT NOT NULL CHECK (reason IN ('generation','regeneration','credit_grant','credit_purchase','admin_adjust')),
  job_id TEXT,
  stripe_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
  `CREATE TABLE credit_balances (
  user_id TEXT PRIMARY KEY,
  seconds INTEGER NOT NULL DEFAULT 0
)`,
  `CREATE TABLE stripe_events (
  event_id TEXT PRIMARY KEY,
  processed_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
];

const WEBHOOK_SECRET = "whsec_test_secret";

function stripeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...testEnv,
    STRIPE_SECRET_KEY: "sk_test_x",
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_PRICE_PACK_60: "price_60",
    STRIPE_PRICE_PACK_180: "price_180",
    ...overrides,
  } as Env;
}

async function resetDb() {
  for (const statement of TEST_SCHEMA_STATEMENTS) {
    await testEnv.DB.prepare(statement).run();
  }
}

async function seedUser(userId: string, tier: "free" | "participant") {
  await testEnv.DB.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, language_preference, tier)
     VALUES (?, ?, 'Credits Tester', 'hash', 'teacher', 'fr', ?)`
  ).bind(userId, `${userId}@example.com`, tier).run();
}

async function signedPayload(payload: string, secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${hex}`;
}

function checkoutEvent(eventId: string, userId: string, minutes: number, paymentStatus = "paid") {
  return JSON.stringify({
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_${eventId}`,
        payment_status: paymentStatus,
        client_reference_id: userId,
        metadata: { userId, packId: "pack60", minutes: String(minutes) },
      },
    },
  });
}

describe("stripe configuration and packs", () => {
  it("hides purchase entirely until secrets and prices are configured", () => {
    expect(stripeConfigured(testEnv)).toBe(false);
    expect(stripeConfigured(stripeEnv())).toBe(true);
    expect(creditPacks(stripeEnv()).map((p) => p.minutes)).toEqual([60, 180]);
    expect(creditPacks(stripeEnv({ STRIPE_PRICE_PACK_180: "" }))).toHaveLength(1);
  });
});

describe("checkout session creation", () => {
  it("posts the pack price and user reference to Stripe and returns the url", async () => {
    let captured: { url: string; body: string } | null = null;
    const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
      captured = { url: String(url), body: String(init?.body) };
      return new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/pay/cs_x" }), { status: 200 });
    }) as typeof fetch;

    const result = await createCheckoutSession(stripeEnv(), "user-1", "pack60", "https://promptomatik.com", fetcher);

    expect(result).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_x" });
    const body = captured!.body;
    expect(captured!.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(body).toContain("price_60");
    expect(body).toContain("client_reference_id=user-1");
    expect(body).toContain(encodeURIComponent("https://promptomatik.com/audio?checkout=success"));
  });

  it("rejects unknown packs and surfaces a neutral error on Stripe failure", async () => {
    const failing = (async () => new Response("{}", { status: 500 })) as typeof fetch;
    await expect(createCheckoutSession(stripeEnv(), "u", "packX", "https://x", failing))
      .resolves.toMatchObject({ status: 400 });
    const failed = await createCheckoutSession(stripeEnv(), "u", "pack60", "https://x", failing);
    expect(failed).toMatchObject({ status: 502 });
    expect(JSON.stringify(failed)).not.toContain("Stripe");
  });
});

describe("webhook signature", () => {
  it("accepts a valid signature and rejects tampering, wrong secrets, and stale timestamps", async () => {
    const payload = '{"id":"evt_1"}';
    const header = await signedPayload(payload);

    expect(await verifyStripeSignature(WEBHOOK_SECRET, payload, header)).toBe(true);
    expect(await verifyStripeSignature(WEBHOOK_SECRET, payload + " ", header)).toBe(false);
    expect(await verifyStripeSignature("whsec_other", payload, header)).toBe(false);
    expect(await verifyStripeSignature(WEBHOOK_SECRET, payload, undefined)).toBe(false);
    const stale = await signedPayload(payload, WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 3600);
    expect(await verifyStripeSignature(WEBHOOK_SECRET, payload, stale)).toBe(false);
  });
});

describe("webhook grant", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("grants credits once, writes an auditable ledger row, and ignores replays", async () => {
    await seedUser("buyer", "participant");
    const payload = checkoutEvent("evt_100", "buyer", 60);
    const header = await signedPayload(payload);
    const envWithStripe = stripeEnv();

    const first = await handleStripeWebhook(envWithStripe, payload, header);
    const replay = await handleStripeWebhook(envWithStripe, payload, header);

    expect(first).toEqual({ ok: true, granted: true });
    expect(replay).toEqual({ ok: true, granted: false });

    const balance = await testEnv.DB.prepare("SELECT seconds FROM credit_balances WHERE user_id = 'buyer'")
      .first<{ seconds: number }>();
    expect(balance?.seconds).toBe(3600);

    const { results } = await testEnv.DB.prepare(
      "SELECT delta_seconds, source, reason, stripe_ref FROM quota_ledger WHERE user_id = 'buyer'"
    ).all<{ delta_seconds: number; source: string; reason: string; stripe_ref: string }>();
    expect(results).toEqual([
      { delta_seconds: 3600, source: "credit", reason: "credit_purchase", stripe_ref: "cs_evt_100" },
    ]);
  });

  it("rejects bad signatures and grants nothing for unpaid or foreign event types", async () => {
    await seedUser("buyer", "participant");
    const payload = checkoutEvent("evt_200", "buyer", 60);

    const bad = await handleStripeWebhook(stripeEnv(), payload, "t=1,v1=deadbeef");
    expect(bad).toEqual({ ok: false, reason: "bad_signature" });

    const unpaid = checkoutEvent("evt_201", "buyer", 60, "unpaid");
    expect(await handleStripeWebhook(stripeEnv(), unpaid, await signedPayload(unpaid)))
      .toEqual({ ok: true, granted: false });

    const other = JSON.stringify({ id: "evt_202", type: "invoice.created" });
    expect(await handleStripeWebhook(stripeEnv(), other, await signedPayload(other)))
      .toEqual({ ok: true, granted: false });

    const balance = await testEnv.DB.prepare("SELECT seconds FROM credit_balances WHERE user_id = 'buyer'")
      .first<{ seconds: number }>();
    expect(balance).toBeNull();
  });
});

describe("checkout routes", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function fetchAs(userId: string, path: string, init?: RequestInit) {
    const session: SessionData = {
      userId,
      email: `${userId}@example.com`,
      role: "teacher",
      languagePreference: "fr",
      createdAt: Date.now(),
    };
    const sessionId = await createSession(testEnv, session);
    const request = new Request(`https://promptomatik.test${path}`, {
      ...init,
      headers: { Cookie: `promptomatik_session=${sessionId}`, "Content-Type": "application/json" },
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    return response;
  }

  it("keeps purchase behind the participant tier", async () => {
    await seedUser("free-user", "free");
    const packs = await fetchAs("free-user", "/api/audio/credits/packs");
    const checkout = await fetchAs("free-user", "/api/audio/credits/checkout", {
      method: "POST",
      body: JSON.stringify({ packId: "pack60" }),
    });
    expect(packs.status).toBe(403);
    expect(checkout.status).toBe(403);
  });

  it("returns no packs while Stripe is not configured", async () => {
    await seedUser("participant-user", "participant");
    const response = await fetchAs("participant-user", "/api/audio/credits/packs");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ packs: [] });
  });
});
