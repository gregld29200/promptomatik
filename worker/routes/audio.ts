import { Hono } from "hono";
import type { Env } from "../env";
import { requireAdmin, requireAuth, requireParticipant } from "../lib/auth-middleware";
import type { SessionData } from "../lib/session";
import { getAudioQuotaBalance } from "../lib/audio-quota";
import { getTtsModelConfig, type AudioMode } from "../lib/audio-config";
import { prepareAudioScript } from "../lib/audio-prepare";
import {
  createAudioJob,
  enqueueAudioJob,
  getAudioDownloadObject,
  getAudioJobForUser,
  isAudioDownloadFile,
  listAudioJobsForUser,
  regenerateAudioSegment,
  type CreateAudioJobInput,
} from "../lib/audio-jobs";
import { AUDIO_VOICES, isAudioVoiceName } from "../lib/audio-voices";
import { getAudioAdminMetrics, grantAudioCredits } from "../lib/audio-metrics";
import { createCheckoutSession, packsWithPrices, stripeConfigured } from "../lib/audio-credits";

type AudioEnv = { Bindings: Env; Variables: { session: SessionData } };

const audio = new Hono<AudioEnv>();

audio.use("/*", requireAuth);

function isAudioMode(value: unknown): value is AudioMode {
  return value === "monologue" || value === "dialogue";
}

async function jobAccessStatus(db: D1Database, jobId: string, userId: string): Promise<200 | 403 | 404> {
  const row = await db.prepare("SELECT user_id FROM audio_jobs WHERE id = ?")
    .bind(jobId)
    .first<{ user_id: string }>();
  if (!row) return 404;
  return row.user_id === userId ? 200 : 403;
}

audio.get("/quota", requireParticipant, async (c) => {
  const session = c.get("session");
  const balance = await getAudioQuotaBalance(c.env, session.userId);

  return c.json({
    includedRemaining: balance.includedRemaining,
    credits: balance.credits,
    monthResetsOn: balance.monthResetsOn,
  });
});

audio.get("/voices", requireParticipant, async (c) => {
  return c.json({ voices: AUDIO_VOICES });
});

audio.get("/voices/:name/preview", requireParticipant, async (c) => {
  const name = c.req.param("name");
  if (!isAudioVoiceName(name)) {
    return c.json({ error: "Voice not found." }, 404);
  }

  const object = await c.env.MEDIA.get(`voices/${name}.mp3`);
  if (!object) {
    return c.json({ error: "Preview not found." }, 404);
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "audio/mpeg",
      "Cache-Control": "public, max-age=86400",
    },
  });
});

audio.post("/prepare", requireParticipant, async (c) => {
  const body = await c.req.json<{ script?: unknown; mode?: unknown }>();
  if (typeof body.script !== "string" || !body.script.trim()) {
    return c.json({ error: "Script is required." }, 400);
  }
  if (!isAudioMode(body.mode)) {
    return c.json({ error: "Invalid audio mode." }, 400);
  }
  if (!c.env.GEMINI_API_KEY) {
    return c.json({ error: "GEMINI_API_KEY is not configured." }, 500);
  }

  try {
    const result = await prepareAudioScript({
      apiKey: c.env.GEMINI_API_KEY,
      model: getTtsModelConfig(c.env).prepModel,
      script: body.script,
      mode: body.mode,
    });
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to prepare audio script.";
    return c.json({ error: message }, 502);
  }
});

audio.post("/jobs", requireParticipant, async (c) => {
  const session = c.get("session");
  const body = await c.req.json<Omit<CreateAudioJobInput, "userId">>();

  try {
    const job = await createAudioJob(c.env, {
      ...body,
      userId: session.userId,
    });
    await enqueueAudioJob(c.env, job.id);
    return c.json({ jobId: job.id, estimatedSeconds: job.estimatedSeconds }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create audio job.";
    if (message === "audio_quota_exceeded") {
      return c.json({ error: message, code: "audio_quota_exceeded" }, 402);
    }
    return c.json({ error: message }, 400);
  }
});

audio.get("/jobs", requireParticipant, async (c) => {
  const session = c.get("session");
  const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") ?? 20)));
  const offset = Math.max(0, Number(c.req.query("offset") ?? 0));
  const jobs = await listAudioJobsForUser(c.env.DB, session.userId, limit, offset);
  return c.json({ jobs });
});

audio.get("/jobs/:id", requireParticipant, async (c) => {
  const session = c.get("session");
  const jobId = c.req.param("id");
  const access = await jobAccessStatus(c.env.DB, jobId, session.userId);
  if (access === 403) return c.json({ error: "Forbidden." }, 403);
  if (access === 404) return c.json({ error: "Job not found." }, 404);

  const job = await getAudioJobForUser(c.env, jobId, session.userId);
  if (!job) {
    return c.json({ error: "Job not found." }, 404);
  }
  return c.json({ job });
});

audio.post("/jobs/:id/segments/:idx/regenerate", requireParticipant, async (c) => {
  const session = c.get("session");
  const idx = Number(c.req.param("idx"));
  if (!Number.isInteger(idx) || idx < 0) {
    return c.json({ error: "Invalid segment index." }, 400);
  }

  const jobId = c.req.param("id");
  const access = await jobAccessStatus(c.env.DB, jobId, session.userId);
  if (access === 403) return c.json({ error: "Forbidden." }, 403);
  if (access === 404) return c.json({ error: "Job not found." }, 404);

  const ok = await regenerateAudioSegment(c.env, jobId, session.userId, idx);
  if (!ok) {
    return c.json({ error: "Job not found." }, 404);
  }
  return c.json({ accepted: true }, 202);
});

audio.get("/jobs/:id/download/:file", requireParticipant, async (c) => {
  const session = c.get("session");
  const file = c.req.param("file");
  if (!isAudioDownloadFile(file)) {
    return c.json({ error: "File not found." }, 404);
  }

  const jobId = c.req.param("id");
  const access = await jobAccessStatus(c.env.DB, jobId, session.userId);
  if (access === 403) return c.json({ error: "Forbidden." }, 403);
  if (access === 404) return c.json({ error: "File not found." }, 404);

  const object = await getAudioDownloadObject(c.env, jobId, session.userId, file);
  if (!object) {
    return c.json({ error: "File not found." }, 404);
  }

  const contentType = file.endsWith(".mp3")
    ? "audio/mpeg"
    : file.endsWith(".wav")
      ? "audio/wav"
      : "text/plain; charset=utf-8";
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? contentType,
      "Content-Disposition": `attachment; filename="${file}"`,
    },
  });
});

// ---- Credit purchases (Stripe Checkout, V1.5) ----

audio.get("/credits/packs", requireParticipant, async (c) => {
  if (!stripeConfigured(c.env)) {
    return c.json({ packs: [] });
  }
  return c.json({ packs: await packsWithPrices(c.env) });
});

audio.post("/credits/checkout", requireParticipant, async (c) => {
  if (!stripeConfigured(c.env)) {
    return c.json({ error: "Credit purchase is not available yet." }, 503);
  }
  const session = c.get("session");
  const body = await c.req.json<{ packId?: unknown }>().catch(() => ({} as { packId?: unknown }));
  if (typeof body.packId !== "string") {
    return c.json({ error: "packId is required." }, 400);
  }

  const origin = c.env.APP_URL ?? new URL(c.req.url).origin;
  const result = await createCheckoutSession(c.env, session.userId, body.packId, origin);
  if ("error" in result) {
    return c.json({ error: result.error }, result.status);
  }
  return c.json({ url: result.url });
});

// ---- Admin (PRD §7.8) ----
// Metrics expose ids, numbers, and statuses only — never script contents.

audio.get("/admin/metrics", requireAdmin, async (c) => {
  const metrics = await getAudioAdminMetrics(c.env);
  return c.json({ metrics });
});

audio.post("/admin/credits", requireAdmin, async (c) => {
  const body = await c.req.json<{ userId?: unknown; seconds?: unknown }>();
  if (typeof body.userId !== "string" || !body.userId.trim()) {
    return c.json({ error: "userId is required." }, 400);
  }
  if (typeof body.seconds !== "number" || !Number.isInteger(body.seconds) || body.seconds <= 0) {
    return c.json({ error: "seconds must be a positive integer." }, 400);
  }

  const result = await grantAudioCredits(c.env, body.userId.trim(), body.seconds);
  if (!result) {
    return c.json({ error: "User not found." }, 404);
  }
  return c.json({ success: true, credits: result.credits });
});

export { audio };
