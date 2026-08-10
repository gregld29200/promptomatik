import { Hono } from "hono";
import type { Env } from "../env";
import { youtubeIngestConfigured } from "../lib/transcription-youtube";

const health = new Hono<{ Bindings: Env }>();

/**
 * Liveness, plus the one capability whose absence is otherwise invisible.
 *
 * `youtubeIngest` reports whether BOTH YOUTUBE_INGEST_URL and _SECRET are
 * present and non-empty — a boolean, never a value. It exists because a
 * half-set secret and a correctly-set one are indistinguishable from outside:
 * `wrangler secret put` reports success either way, and the only symptom is a
 * teacher being told YouTube is unavailable. This turns "guess which secret is
 * wrong" into one public GET.
 */
health.get("/", (c) =>
  c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    capabilities: { youtubeIngest: youtubeIngestConfigured(c.env) },
  })
);

export { health };
