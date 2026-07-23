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

// Relais de notification : temoignages.teachinspire.me n'a pas de clé Resend
// propre ; ce worker en a déjà une (domaine promptomatik.com vérifié). Le
// contenu est fourni par l'appelant, mais le destinataire est verrouillé sur
// les adresses TeachInspire : ce relais ne peut pas servir à spammer des tiers.
const NOTIFY_ALLOWED_RECIPIENTS = new Set([
  "greg@teachinspire.me",
  "contact@teachinspire.me",
]);

internal.post("/notify", async (c) => {
  const secret = c.env.TESTIMONIAL_GRANT_SECRET;
  if (!secret) return c.json({ error: "Not found" }, 404);

  const provided = c.req.header("X-Internal-Secret") ?? "";
  if (!timingSafeEqual(provided, secret)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const body = await c.req
    .json<{ to?: unknown; subject?: unknown; text?: unknown; replyTo?: unknown }>()
    .catch(() => null);
  if (!body || typeof body.to !== "string" || !NOTIFY_ALLOWED_RECIPIENTS.has(body.to)) {
    return c.json({ error: "Recipient not allowed." }, 400);
  }
  if (typeof body.subject !== "string" || !body.subject.trim() || body.subject.length > 200) {
    return c.json({ error: "subject is required." }, 400);
  }
  if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 20000) {
    return c.json({ error: "text is required." }, 400);
  }

  if (!c.env.RESEND_API_KEY) {
    return c.json({ error: "Email not configured." }, 503);
  }

  const payload: Record<string, unknown> = {
    from: "TeachInspire Témoignages <noreply@promptomatik.com>",
    to: [body.to],
    subject: body.subject.trim(),
    text: body.text,
  };
  if (typeof body.replyTo === "string" && /^[^@\s]+@[^@\s]+$/.test(body.replyTo)) {
    payload.reply_to = body.replyTo;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("internal notify failed", res.status, detail);
    return c.json({ error: "Send failed." }, 502);
  }
  return c.json({ success: true });
});

// Liste des participants actifs, pour que temoignages.teachinspire.me puisse
// préparer les invitations sans CSV : la source de vérité est le tier du
// Studio, toujours à jour. Même garde par secret partagé que ci-dessus.
internal.get("/participants", async (c) => {
  const secret = c.env.TESTIMONIAL_GRANT_SECRET;
  if (!secret) return c.json({ error: "Not found" }, 404);

  const provided = c.req.header("X-Internal-Secret") ?? "";
  if (!timingSafeEqual(provided, secret)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT id, email, name FROM users
     WHERE tier = 'participant' AND is_active = 1
     ORDER BY created_at ASC
     LIMIT 1000`
  ).all<{ id: string; email: string; name: string }>();

  return c.json({ participants: results ?? [] });
});

export { internal };
