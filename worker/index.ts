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
import { handleDocumentJobBatch } from "./lib/document-jobs";
import { handleInterviewJobBatch } from "./lib/interview-jobs";
import { handleAudioJobBatch } from "./lib/audio-jobs";

const app = new Hono<{ Bindings: Env }>();

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

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch, env: Env) {
    if (batch.queue === "document-jobs") {
      return handleDocumentJobBatch(batch as MessageBatch<{ jobId: string }>, env);
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
