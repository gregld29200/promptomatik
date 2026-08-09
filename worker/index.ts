import { Hono } from "hono";
import type { Env } from "./env";
import { health } from "./routes/health";
import { auth } from "./routes/auth";
import { interview } from "./routes/interview";
import { prompts } from "./routes/prompts";
import { admin } from "./routes/admin";
import { profile } from "./routes/profile";
import { templates } from "./routes/templates";
import { jobs } from "./routes/jobs";
import { audio } from "./routes/audio";
import { stripe } from "./routes/stripe";
import { documents } from "./routes/documents";
import { internal } from "./routes/internal";
import { transcriptions } from "./routes/transcriptions";
import { handleDocumentJobBatch } from "./lib/document-jobs";
import { handleInterviewJobBatch } from "./lib/interview-jobs";
import { handleAudioJobBatch } from "./lib/audio-jobs";
import { handleTranscriptionJobBatch } from "./lib/transcription-jobs";
import { runTranscriptionRetentionSweep } from "./lib/transcription-retention";

const app = new Hono<{ Bindings: Env }>();

// Legacy domain: permanent redirect to the Studio, path and query preserved
// (ecosystem plan Phase 4). The custom domain stays attached to this Worker —
// it is what serves the 301.
const LEGACY_HOSTS = new Set(["promptomatik.com", "www.promptomatik.com"]);
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  if (LEGACY_HOSTS.has(url.hostname)) {
    url.hostname = "studio.teachinspire.me";
    return c.redirect(url.toString(), 301);
  }
  await next();
});

app.route("/api/health", health);
app.route("/api/auth", auth);
app.route("/api/interview", interview);
app.route("/api/prompts", prompts);
app.route("/api/profile", profile);
app.route("/api/admin", admin);
app.route("/api/templates", templates);
app.route("/api/jobs", jobs);
app.route("/api/audio", audio);
app.route("/api/stripe", stripe);
app.route("/api/documents", documents);
app.route("/api/internal", internal);
// Transcription Studio. ONE prefix: `/api/transcriptions`, matching the module
// family (`worker/lib/transcription*`) and the `downloads` links that
// `rowToTranscriptionJob` puts on a completed job.
app.route("/api/transcriptions", transcriptions);

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

// With run_worker_first: true every request reaches the Worker; anything
// that is not an API route falls through to the static assets (SPA).
app.all("*", (c) => {
  if (!c.env.ASSETS) return c.json({ error: "Not found" }, 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,
  /**
   * Cron. One trigger today: the transcription retention sweep (7 days), declared
   * under `triggers.crons` in wrangler.jsonc.
   *
   * The Audio Studio has no equivalent because an mp3 is bytes in R2 and a bucket
   * lifecycle rule removes it. A transcript is TEXT in a D1 column, which no
   * lifecycle rule can reach, so the deletion has to be code.
   *
   * AWAITED, not handed to `ctx.waitUntil`. The sweep rethrows on failure, and a
   * rejected `scheduled` handler is what the platform records as a failed cron
   * invocation — the only alert surface this feature has. Under `waitUntil` the
   * handler's own promise resolves immediately, so the rethrow would land
   * somewhere we are not looking and a sweep that throws every night would be
   * indistinguishable from one that ran clean. Awaiting costs nothing: the sweep
   * is capped at `TRANSCRIPTION_PURGE_MAX_BATCHES` and stops there.
   *
   * Nothing is lost by failing: retention is resumable tomorrow — the rows that
   * were not purged match the same query on the next run — and every read
   * already refuses to serve an expired transcript in the meantime.
   */
  async scheduled(_controller: ScheduledController, env: Env) {
    await runTranscriptionRetentionSweep(env);
  },
  async queue(batch: MessageBatch, env: Env) {
    if (batch.queue === "document-jobs") {
      return handleDocumentJobBatch(batch as MessageBatch<{ jobId: string }>, env);
    }
    if (batch.queue === "transcription-jobs") {
      return handleTranscriptionJobBatch(batch as MessageBatch<{ jobId: string }>, env);
    }
    if (batch.queue === "audio-generation") {
      return handleAudioJobBatch(
        batch as MessageBatch<{ jobId: string; segmentIdx?: number; action?: "generate" | "assemble" }>,
        env
      );
    }
    return handleInterviewJobBatch(batch as MessageBatch<{ jobId: string }>, env);
  },
};
