// Transcription Studio — the API surface.
//
// Mounted once, at `/api/transcriptions` — the prefix the SPA calls and the one
// `rowToTranscriptionJob` (worker/lib/transcription-jobs.ts) already builds its
// `downloads` links under.
//
// Three rules this file keeps, everywhere, without exception:
//
//  1. OWNERSHIP IS SQL, NOT A HANDLER CHECK. Every read and every write goes
//     through a helper whose WHERE clause carries `user_id = ?`. A job that
//     belongs to another teacher is indistinguishable from a job that does not
//     exist — a 404, never a 403, because "this id exists but is not yours"
//     leaks the existence of someone else's transcript.
//  2. EVERY INPUT IS VALIDATED AT THE BOUNDARY with zod, exactly as
//     `createAudioJobSchema` does, so a malformed request returns a clean
//     `invalid_request` instead of a runtime error escaping as a 500. That
//     includes QUERY STRINGS, not just bodies: `?limit=abc` is a string a
//     teacher's browser can produce, and `Number("abc")` is NaN, which every
//     Math clamp happily propagates all the way into `LIMIT ?`.
//  3. QUOTA IS CHECKED BEFORE ANYTHING PAID HAPPENS. `createTranscriptionJob`
//     runs `precheckTranscriptionQuota` before it inserts a row or enqueues a
//     message, so nothing reaches a provider on an empty allowance. The upload
//     route checks it a second time, up front, because writing a file the size of
//     TRANSCRIPTION_MAX_UPLOAD_BYTES into R2 is itself paid. The two read-only
//     endpoints below (`/inspect`, `/episodes`)
//     never touch a provider or the bucket, so they cost nothing and are
//     deliberately outside the gate. `/episodes` is rate-limited instead: being
//     outside the quota gate is not the same as being free, because it makes our
//     Worker fetch a third party on demand.
//
// Failures are objects, not sentences: every error response carries
// `{ error: <code>, code: <code>, failure: TranscriptionFailure }` and the
// client renders `t("transcription.error_" + code)` with the failure's extra
// fields. No provider prose ever reaches a teacher.

import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import type { SessionData } from "../lib/session";
import { requireAuth, requireParticipant } from "../lib/auth-middleware";
import {
  TRANSCRIPTION_MAX_SOURCE_SECONDS,
  TRANSCRIPTION_MAX_UPLOAD_BYTES,
  httpStatusForFailure,
  publicTranscriptionFailure,
  toTranscriptionFailure,
  type TranscriptionFailure,
  type TranscriptionSourceRef,
} from "../lib/transcription/types";
import { classifySource, listPodcastEpisodes } from "../lib/transcription-ingest";
import { youtubeIngestConfigured } from "../lib/transcription-youtube";
import {
  createTranscriptionJob,
  deleteTranscriptionJobForUser,
  getTranscriptionJobForUser,
  isTranscriptionDownloadFormat,
  listTranscriptionJobsForUser,
  renameTranscriptionJobForUser,
  transcriptionUploadKey,
} from "../lib/transcription-jobs";
import {
  getTranscriptionQuotaBalance,
  precheckTranscriptionQuota,
} from "../lib/transcription-quota";
import { isTranscriptExpired } from "../lib/transcription-retention";
import {
  isTranscriptDownloadLanguage,
  renderTranscriptDownload,
  type TranscriptDownloadLanguage,
} from "../lib/transcription-download";

type TranscriptionsEnv = { Bindings: Env; Variables: { session: SessionData } };

const transcriptions = new Hono<TranscriptionsEnv>();

transcriptions.use("/*", requireAuth);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** The one way this router reports a domain failure. Status comes from the contract. */
function failureBody(failure: TranscriptionFailure) {
  // `publicTranscriptionFailure` strips `detail`, which exists for our logs: a
  // slug like "blocked_host", or a truncated provider sentence in English. The
  // code and its numbers are what the client translates; internal prose is not
  // something a teacher should ever be shown.
  const safe = publicTranscriptionFailure(failure);
  return { error: safe.code, code: safe.code, failure: safe };
}

const urlSourceSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  diarize: z.boolean(),
  // BCP-47-ish, or absent for "let the provider detect".
  languageHint: z.string().trim().max(16).nullish(),
  title: z.string().trim().max(120).nullish(),
});

const inspectSchema = z.object({ input: z.string().max(2048) });
const feedSchema = z.object({ url: z.string().trim().min(1).max(2048) });
const renameSchema = z.object({ title: z.string().max(200) });

/**
 * Library paging, from the query string.
 *
 * `.catch()` rather than a 400: a page number is navigation, not content. An
 * absent, negative, fractional or non-numeric value all mean "the teacher did
 * not usefully say", and the honest answer to that is the first page — not an
 * error card, and certainly not a NaN bound into `LIMIT ?`, which D1 rejects
 * with a datatype mismatch that would surface as a 500.
 */
const pagingSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).catch(20),
  offset: z.coerce.number().int().min(0).catch(0),
});

/**
 * Multipart text fields. `diarize` arrives as a string because a FormData value
 * is always a string — parsed here rather than trusted anywhere downstream.
 */
const uploadFieldsSchema = z.object({
  diarize: z.enum(["true", "false"]),
  languageHint: z.string().trim().max(16).optional(),
  title: z.string().trim().max(120).optional(),
});

/**
 * `@cloudflare/workers-types` declares `FormData.get()` as `string | null`, but
 * workerd really returns a `File` for a file part. So the value is read as
 * `unknown` and narrowed with a genuine `instanceof` against the runtime class,
 * rather than trusting a signature that does not describe the runtime.
 */
function formFile(form: FormData, name: string): File | null {
  const value: unknown = form.get(name);
  return value instanceof File ? value : null;
}

function downloadLanguage(raw: string | undefined): TranscriptDownloadLanguage {
  // French is the default because it is the primary interface language; a
  // missing or unknown `lang` must never make the download fail.
  return raw && isTranscriptDownloadLanguage(raw) ? raw : "fr";
}

/**
 * Feed lookups a teacher may run per minute.
 *
 * `/episodes` is an authenticated outbound-fetch primitive: each call can chase a
 * feed, a page and a couple of redirects out of Cloudflare's address space, and
 * it sits outside the quota gate by design because it never touches a provider.
 * Ten a minute is far more than picking an episode needs and far less than a
 * useful loop against someone else's server.
 *
 * `/inspect` is deliberately NOT limited: it is `classifySource`, which is pure
 * and performs no I/O at all, so a KV counter would add a write per call to
 * something that currently costs nothing.
 */
const FEED_LOOKUPS_PER_MINUTE = 10;
const FEED_RATE_WINDOW_SECONDS = 60;

/**
 * A per-minute counter in KV, the same idiom the quota cache uses.
 *
 * Read-then-write, so two simultaneous calls can share a slot — it undercounts
 * under contention and never overcounts. That is the right direction: the job is
 * to stop a sustained loop, not to police an exact tenth request.
 */
async function withinFeedRateLimit(env: Env, userId: string): Promise<boolean> {
  const window = Math.floor(Date.now() / (FEED_RATE_WINDOW_SECONDS * 1000));
  const key = `transrate:${userId}:${window}`;
  const stored = Number.parseInt((await env.SESSIONS.get(key)) ?? "", 10);
  const used = Number.isFinite(stored) && stored > 0 ? stored : 0;
  if (used >= FEED_LOOKUPS_PER_MINUTE) return false;
  // TTL floor in KV is 60 s; two windows is enough to outlive the one it counts.
  await env.SESSIONS.put(key, String(used + 1), { expirationTtl: FEED_RATE_WINDOW_SECONDS * 2 });
  return true;
}

/**
 * Multipart framing (boundaries, part headers, the text fields) above the media
 * itself. Generous, because the header check below must never refuse a file that
 * is genuinely inside the ceiling.
 */
const UPLOAD_ENVELOPE_SLACK_BYTES = 64 * 1024;

// ---------------------------------------------------------------------------
// Quota
// ---------------------------------------------------------------------------

// The hot read the Studio polls while a job runs: one KV get. Display only —
// the gate before a paid call is `precheckTranscriptionQuota`, inside
// `createTranscriptionJob`.
transcriptions.get("/quota", requireParticipant, async (c) => {
  const session = c.get("session");
  const balance = await getTranscriptionQuotaBalance(c.env, session.userId);
  return c.json(balance);
});

// ---------------------------------------------------------------------------
// Read-only source inspection (no network, no provider, no quota)
// ---------------------------------------------------------------------------

/**
 * "What did I just paste?" — pure classification, so the page can say
 * "YouTube is not available yet" the moment the teacher pastes, instead of
 * after a job has been created and failed.
 */
transcriptions.post("/inspect", requireParticipant, async (c) => {
  const parsed = inspectSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid_request" }, 400);
  }
  return c.json({ source: classifySource(parsed.data.input) });
});

/**
 * The episode picker behind an RSS feed or an Apple Podcasts link. Read-only:
 * it follows the feed and lists what is in it, and never probes or bills any
 * media. The teacher picks an episode, and its enclosure URL is submitted as an
 * ordinary direct-URL job.
 */
transcriptions.post("/episodes", requireParticipant, async (c) => {
  const parsed = feedSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid_request" }, 400);
  }

  // Authenticated is not the same as unlimited: this is the one endpoint here
  // that makes our Worker fetch a third party on demand.
  const session = c.get("session");
  if (!(await withinFeedRateLimit(c.env, session.userId))) {
    return c.json({ error: "rate_limited" }, 429, {
      "Retry-After": String(FEED_RATE_WINDOW_SECONDS),
    });
  }

  try {
    const feed = await listPodcastEpisodes(c.env, parsed.data.url);
    return c.json({ feed });
  } catch (error) {
    const failure = toTranscriptionFailure(error);
    return c.json(failureBody(failure), httpStatusForFailure(failure));
  }
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

transcriptions.post("/jobs", requireParticipant, async (c) => {
  const session = c.get("session");
  const parsed = urlSourceSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid_request" }, 400);
  }

  const classified = classifySource(parsed.data.url);
  if (!classified.supported || classified.url === null) {
    const failure = classified.failure ?? { code: "unsupported_source" as const };
    return c.json(failureBody(failure), httpStatusForFailure(failure));
  }
  if (classified.kind === "youtube" && !youtubeIngestConfigured(c.env)) {
    // `classifySource` is pure and cannot see the env, so the capability check
    // happens here: with no sidecar configured, refuse at POST time with the
    // same code `resolveYouTube` would throw minutes later — an instant honest
    // answer instead of a job that exists only to fail.
    const failure: TranscriptionFailure = { code: "youtube_not_yet_supported", url: classified.url };
    return c.json(failureBody(failure), httpStatusForFailure(failure));
  }
  if (classified.kind === "upload") {
    // Unreachable — `classifySource` never returns "upload" for a pasted string.
    // Kept so the union narrows without a cast rather than by assertion.
    const failure: TranscriptionFailure = { code: "unsupported_source", detail: "upload_via_url" };
    return c.json(failureBody(failure), httpStatusForFailure(failure));
  }

  const source: TranscriptionSourceRef = { kind: classified.kind, url: classified.url };
  try {
    const jobId = await createTranscriptionJob(c.env, {
      userId: session.userId,
      source,
      diarize: parsed.data.diarize,
      languageHint: parsed.data.languageHint ?? null,
      title: parsed.data.title ?? null,
    });
    return c.json({ jobId }, 202);
  } catch (error) {
    const failure = toTranscriptionFailure(error);
    return c.json(failureBody(failure), httpStatusForFailure(failure));
  }
});

/**
 * Content types we refuse before spending R2 on them.
 *
 * `transcription-ingest` remains the authority on what a provider can actually
 * take — this is only a cheap boundary guard so an accidentally-picked PDF or
 * photo is not stored, then queued, then failed. Anything ambiguous
 * (`application/octet-stream`, an empty type from a mobile picker) is allowed
 * through and judged by ingest.
 */
const REFUSED_UPLOAD_PREFIXES = ["image/", "text/", "application/pdf", "application/zip"];

function refusedContentType(contentType: string): boolean {
  const normalised = contentType.toLowerCase();
  return REFUSED_UPLOAD_PREFIXES.some((prefix) => normalised.startsWith(prefix));
}

/**
 * A file from the teacher's machine.
 *
 * The R2 key comes from `transcriptionUploadKey` — see the comment there for why
 * an upload cannot live under the job's own prefix. Two gates run before the
 * bytes are written, in this order:
 *   1. size and content type, from the request headers alone;
 *   2. the monthly allowance, assuming the 90-minute cap, because an R2 write of
 *      up to TRANSCRIPTION_MAX_UPLOAD_BYTES is itself a paid operation and a
 *      teacher with no hours left must not be able to loop this endpoint and
 *      generate unbounded Class A writes. `createTranscriptionJob` re-checks with
 *      the real number a moment later, which is harmless: a KV/D1 read is nothing
 *      next to a 64 MB write.
 * If job creation still fails (a burst that fills the allowance between the two
 * checks) the object is deleted straight away rather than left orphaned.
 */
transcriptions.post("/jobs/upload", requireParticipant, async (c) => {
  const session = c.get("session");

  // BEFORE `formData()`, which parses the entire body. A 300 MB upload would
  // otherwise be materialised only to be rejected on the next line — or would
  // make `formData()` throw and turn a `source_too_large` (413, with a translated
  // sentence naming the real ceiling) into a bare `invalid_request` (400). The
  // header can lie or be absent, so `file.size` below stays the authority.
  const declaredBytes = Number.parseInt(c.req.header("content-length") ?? "", 10);
  if (
    Number.isFinite(declaredBytes) &&
    declaredBytes > TRANSCRIPTION_MAX_UPLOAD_BYTES + UPLOAD_ENVELOPE_SLACK_BYTES
  ) {
    const failure: TranscriptionFailure = {
      code: "source_too_large",
      bytes: declaredBytes,
      maxBytes: TRANSCRIPTION_MAX_UPLOAD_BYTES,
    };
    return c.json(failureBody(failure), httpStatusForFailure(failure));
  }

  const form = await c.req.formData().catch(() => null);
  if (!form) {
    return c.json({ error: "invalid_request" }, 400);
  }

  const file = formFile(form, "file");
  if (!file || file.size === 0) {
    return c.json({ error: "invalid_request" }, 400);
  }

  const fields = uploadFieldsSchema.safeParse({
    diarize: form.get("diarize") ?? undefined,
    languageHint: form.get("languageHint") ?? undefined,
    title: form.get("title") ?? undefined,
  });
  if (!fields.success) {
    return c.json({ error: "invalid_request" }, 400);
  }

  if (file.size > TRANSCRIPTION_MAX_UPLOAD_BYTES) {
    const failure: TranscriptionFailure = {
      code: "source_too_large",
      bytes: file.size,
      maxBytes: TRANSCRIPTION_MAX_UPLOAD_BYTES,
    };
    return c.json(failureBody(failure), httpStatusForFailure(failure));
  }

  const contentType = file.type || null;
  if (contentType && refusedContentType(contentType)) {
    const failure: TranscriptionFailure = { code: "unsupported_media_type", contentType };
    return c.json(failureBody(failure), httpStatusForFailure(failure));
  }

  // The paid-work gate, before the paid work. An upload's length is unknown at
  // this point, so it is gated as the longest file we would accept — the same
  // assumption `createTranscriptionJob` makes.
  try {
    const precheck = await precheckTranscriptionQuota(
      c.env,
      session.userId,
      TRANSCRIPTION_MAX_SOURCE_SECONDS
    );
    if (!precheck.ok) {
      const failure: TranscriptionFailure = {
        code: "quota_exceeded",
        requestedSeconds: precheck.estimatedSeconds,
        remainingSeconds: precheck.balance.includedRemaining,
      };
      return c.json(failureBody(failure), httpStatusForFailure(failure));
    }
  } catch (error) {
    const failure = toTranscriptionFailure(error);
    return c.json(failureBody(failure), httpStatusForFailure(failure));
  }

  const filename = file.name || "audio";
  const r2Key = transcriptionUploadKey(session.userId, filename);

  // Stream into R2 rather than buffering: a Worker has 128 MB of memory for
  // everything else it is doing too, which is the same reason
  // TRANSCRIPTION_MAX_UPLOAD_BYTES is what it is.
  await c.env.MEDIA.put(r2Key, file.stream(), {
    httpMetadata: contentType ? { contentType } : undefined,
  });

  try {
    const jobId = await createTranscriptionJob(c.env, {
      userId: session.userId,
      source: { kind: "upload", r2Key, filename, contentType, bytes: file.size },
      diarize: fields.data.diarize === "true",
      languageHint: fields.data.languageHint ?? null,
      title: fields.data.title ?? null,
    });
    return c.json({ jobId }, 202);
  } catch (error) {
    await c.env.MEDIA.delete(r2Key).catch(() => undefined);
    const failure = toTranscriptionFailure(error);
    return c.json(failureBody(failure), httpStatusForFailure(failure));
  }
});

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

transcriptions.get("/jobs", requireParticipant, async (c) => {
  const session = c.get("session");
  const paging = pagingSchema.parse({
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });
  const jobs = await listTranscriptionJobsForUser(
    c.env,
    session.userId,
    paging.limit,
    paging.offset
  );
  return c.json({ jobs });
});

transcriptions.get("/jobs/:id", requireParticipant, async (c) => {
  const session = c.get("session");
  const job = await getTranscriptionJobForUser(c.env, c.req.param("id"), session.userId);
  if (!job) {
    return c.json({ error: "not_found" }, 404);
  }
  return c.json({ job });
});

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/**
 * The audio behind a transcript, so a flagged uncertain word can be listened to
 * instead of merely doubted.
 *
 * Two shapes, one URL:
 *   * an upload lives in R2, which is not publicly readable, so the bytes are
 *     streamed through here — ranged, or `<audio>` cannot seek;
 *   * a link the teacher pasted is already public, so we redirect to the
 *     resolved enclosure rather than paying to proxy a podcast.
 *
 * Ownership is the same scoped SELECT as everywhere else in this file: someone
 * else's media is indistinguishable from media that does not exist.
 */
transcriptions.get("/jobs/:id/media", requireParticipant, async (c) => {
  const session = c.get("session");
  const row = await c.env.DB.prepare(
    `SELECT source_url, resolved_url, source_r2_key, source_content_type, expires_at
       FROM transcription_jobs WHERE id = ? AND user_id = ?`
  )
    .bind(c.req.param("id"), session.userId)
    .first<{
      source_url: string | null;
      resolved_url: string | null;
      source_r2_key: string | null;
      source_content_type: string | null;
      expires_at: string | null;
    }>();
  if (!row) {
    return c.json({ error: "not_found" }, 404);
  }
  // The player is part of the transcript, so it expires with it. Enforced on the
  // read, not left to the cron: an uploaded object may still be in R2 for a few
  // hours after the deadline, and a pasted podcast link never was ours to expire.
  if (isTranscriptExpired(row.expires_at)) {
    return c.json({ error: "media_unavailable" }, 404);
  }

  if (row.source_r2_key) {
    return streamStoredMedia(c.env, row.source_r2_key, row.source_content_type, c.req.raw);
  }

  const url = row.resolved_url ?? row.source_url;
  if (!url) {
    // The transcript survives its media; the player is told so and goes quiet.
    return c.json({ error: "media_unavailable" }, 404);
  }
  return c.redirect(url, 302);
});

/** `bytes=1000-` / `bytes=1000-1999`. Anything else is served whole. */
function parseByteRange(header: string | null, size: number): { offset: number; length: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const offset = Number(match[1]);
  if (!Number.isFinite(offset) || offset >= size) return null;
  const last = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (!Number.isFinite(last) || last < offset) return null;
  return { offset, length: last - offset + 1 };
}

async function streamStoredMedia(
  env: Env,
  key: string,
  storedContentType: string | null,
  request: Request
): Promise<Response> {
  // HEAD first, so the 206 headers are built from real numbers rather than from
  // whatever shape R2 chose to report the served slice in.
  const head = await env.MEDIA.head(key);
  if (!head) {
    return new Response(JSON.stringify({ error: "media_unavailable" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const wanted = parseByteRange(request.headers.get("range"), head.size);
  const object = await env.MEDIA.get(key, wanted ? { range: wanted } : undefined);
  if (!object) {
    return new Response(JSON.stringify({ error: "media_unavailable" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const headers = new Headers({
    "Content-Type": head.httpMetadata?.contentType ?? storedContentType ?? "audio/mpeg",
    "Accept-Ranges": "bytes",
    // The teacher's own recording: cacheable in their browser, never shared.
    "Cache-Control": "private, max-age=3600",
  });
  if (wanted) {
    headers.set("Content-Length", String(wanted.length));
    headers.set(
      "Content-Range",
      `bytes ${wanted.offset}-${wanted.offset + wanted.length - 1}/${head.size}`
    );
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(head.size));
  return new Response(object.body, { status: 200, headers });
}

// ---------------------------------------------------------------------------
// Mutate
// ---------------------------------------------------------------------------

transcriptions.patch("/jobs/:id", requireParticipant, async (c) => {
  const session = c.get("session");
  const parsed = renameSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid_request" }, 400);
  }

  const renamed = await renameTranscriptionJobForUser(
    c.env,
    c.req.param("id"),
    session.userId,
    parsed.data.title
  );
  if (!renamed) {
    return c.json({ error: "not_found" }, 404);
  }
  return c.json({ title: renamed.title });
});

transcriptions.delete("/jobs/:id", requireParticipant, async (c) => {
  const session = c.get("session");
  const jobId = c.req.param("id");

  // Read the row first, scoped to this teacher, so we know which uploaded object
  // to remove. `deleteTranscriptionJobForUser` sweeps the job's own prefix; an
  // upload lives under a user-scoped prefix instead (see `transcriptionUploadKey`)
  // so it is deleted here or it leaks. Deleting the key unconditionally is
  // deliberate: R2 deletes are idempotent, and the alternative is this route
  // knowing the other module's prefix layout — the duplication that let the two
  // schemes drift apart in the first place.
  const row = await c.env.DB.prepare(
    "SELECT source_r2_key FROM transcription_jobs WHERE id = ? AND user_id = ?"
  )
    .bind(jobId, session.userId)
    .first<{ source_r2_key: string | null }>();
  if (!row) {
    return c.json({ error: "not_found" }, 404);
  }
  if (row.source_r2_key) {
    await c.env.MEDIA.delete(row.source_r2_key).catch(() => undefined);
  }

  const deleted = await deleteTranscriptionJobForUser(c.env, jobId, session.userId);
  if (!deleted) {
    return c.json({ error: "not_found" }, 404);
  }
  return c.json({ deleted: true });
});

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

// txt / srt / vtt / json. Why those four and not Markdown: see the header of
// worker/lib/transcription-download.ts.
transcriptions.get("/jobs/:id/download/:format", requireParticipant, async (c) => {
  const session = c.get("session");
  const format = c.req.param("format");
  if (!isTranscriptionDownloadFormat(format)) {
    return c.json({ error: "not_found" }, 404);
  }

  const job = await getTranscriptionJobForUser(c.env, c.req.param("id"), session.userId);
  if (!job) {
    return c.json({ error: "not_found" }, 404);
  }
  // 410, not 404 and not "not ready": this transcript existed, its 7 days ran
  // out, and saying so is what lets the client show the honest sentence instead of
  // a generic error. `job.transcript` is already null for an expired row — this
  // branch is only here to name the reason.
  if (job.expired) {
    return c.json({ error: "transcript_expired", code: "transcript_expired" }, 410);
  }
  if (job.status !== "completed" || !job.transcript) {
    return c.json({ error: "job_not_ready" }, 409);
  }

  const rendered = renderTranscriptDownload(
    format,
    job.transcript,
    job.title ?? "",
    downloadLanguage(c.req.query("lang"))
  );
  return new Response(rendered.body, {
    headers: {
      "Content-Type": rendered.contentType,
      "Content-Disposition": `attachment; filename="${rendered.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
});

export { transcriptions };
