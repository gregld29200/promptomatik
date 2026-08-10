// Route-level guarantees for the Transcription Studio.
//
// The claim these tests defend is the one that matters most: a teacher can
// never reach another teacher's transcript, on ANY verb, and a foreign job is
// a 404 rather than a 403 — a 403 would confirm the id exists.

import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../index";
import type { Env } from "../env";
import { createSession, sessionCookie, type SessionData } from "../lib/session";
import {
  TRANSCRIPTION_MAX_UPLOAD_BYTES,
  type NormalisedTranscript,
} from "../lib/transcription/types";

const testEnv = env as unknown as Env;

const SCHEMA = [
  "PRAGMA foreign_keys = OFF",
  "DROP TABLE IF EXISTS users",
  `CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'teacher',
    language_preference TEXT NOT NULL DEFAULT 'fr',
    tier TEXT NOT NULL DEFAULT 'free',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "DROP TABLE IF EXISTS transcription_jobs",
  `CREATE TABLE transcription_jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    source_kind TEXT NOT NULL,
    source_url TEXT,
    resolved_url TEXT,
    source_r2_key TEXT,
    source_content_type TEXT,
    source_bytes INTEGER,
    title TEXT,
    requested_provider TEXT,
    diarize_requested INTEGER NOT NULL DEFAULT 0,
    provider TEXT,
    provider_model TEXT,
    provider_job_id TEXT,
    provider_choice_reason TEXT,
    diarization INTEGER NOT NULL DEFAULT 0,
    detected_language TEXT,
    detected_languages TEXT,
    duration_seconds INTEGER,
    billed_seconds INTEGER,
    request_payload TEXT NOT NULL,
    result_payload TEXT,
    error_code TEXT,
    error_payload TEXT,
    error_message TEXT,
    started_at TEXT,
    completed_at TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "DROP TABLE IF EXISTS transcription_quota_ledger",
  `CREATE TABLE transcription_quota_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    delta_seconds INTEGER NOT NULL,
    reason TEXT NOT NULL,
    provider TEXT,
    job_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];

const TRANSCRIPT: NormalisedTranscript = {
  metadata: {
    provider: "deepgram",
    providerJobId: "req-fixture",
    model: "nova-3",
    durationSeconds: 6,
    detectedLanguages: ["fr"],
    diarization: true,
    speakerCount: 1,
    channels: 1,
  },
  speakers: [{ id: "0", index: 0, label: "speaker_0", seconds: 2 }],
  segments: [
    {
      idx: 0,
      speaker: "0",
      start: 0,
      end: 2,
      text: "Bonjour tout le monde.",
      words: [
        { text: "Bonjour", start: 0, end: 0.8, speaker: "0", confidence: 0.95, language: "fr" },
        { text: "tout", start: 0.9, end: 1.1, speaker: "0", confidence: 0.94, language: "fr" },
        { text: "le", start: 1.2, end: 1.3, speaker: "0", confidence: 0.94, language: "fr" },
        { text: "monde.", start: 1.4, end: 2, speaker: "0", confidence: 0.93, language: "fr" },
      ],
      language: "fr",
    },
  ],
  text: "Bonjour tout le monde.",
};

async function resetDb() {
  for (const statement of SCHEMA) {
    await testEnv.DB.prepare(statement).run();
  }
}

async function clearSessionsKv() {
  let cursor: string | undefined;
  do {
    const listed = await testEnv.SESSIONS.list({ cursor });
    await Promise.all(listed.keys.map((key) => testEnv.SESSIONS.delete(key.name)));
    cursor = listed.list_complete ? undefined : listed.cursor;
  } while (cursor);
}

function sessionData(userId: string): SessionData {
  return {
    userId,
    email: `${userId}@example.com`,
    role: "teacher",
    languagePreference: "fr",
    createdAt: Date.now(),
  };
}

async function call(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    sessionId?: string;
    /** Extra request headers — `Range`, for the media endpoint. */
    headers?: Record<string, string>;
  } = {}
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...init.headers };
  if (init.sessionId) headers.Cookie = sessionCookie(init.sessionId).split(";")[0];

  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`https://promptomatik.test${path}`, {
      method: init.method ?? "GET",
      headers,
      body:
        init.body === undefined
          ? undefined
          : typeof init.body === "string"
            ? init.body
            : JSON.stringify(init.body),
    }),
    testEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function insertCompletedJob(id: string, userId: string) {
  await testEnv.DB.prepare(
    `INSERT INTO transcription_jobs
       (id, user_id, status, source_kind, source_url, title, requested_provider,
        diarize_requested, provider, provider_model, diarization, detected_language,
        detected_languages, duration_seconds, billed_seconds, request_payload,
        result_payload, completed_at)
     VALUES (?, ?, 'completed', 'direct_url', 'https://example.com/a.mp3', 'Mon entretien',
             'deepgram', 1, 'deepgram', 'nova-3', 1, 'fr', '["fr"]', 6, 6, ?, ?, datetime('now'))`
  )
    .bind(
      id,
      userId,
      JSON.stringify({
        source: { kind: "direct_url", url: "https://example.com/a.mp3" },
        diarize: true,
        languageHint: null,
        title: "Mon entretien",
      }),
      JSON.stringify(TRANSCRIPT)
    )
    .run();
}

describe("Transcription routes", () => {
  let ownerSession: string;
  let intruderSession: string;

  beforeEach(async () => {
    await resetDb();
    await clearSessionsKv();
    await testEnv.DB.prepare(
      `INSERT INTO users (id, email, name, password_hash, tier) VALUES
         ('owner', 'owner@example.com', 'Owner', 'hash', 'participant'),
         ('intruder', 'intruder@example.com', 'Intruder', 'hash', 'participant')`
    ).run();
    ownerSession = await createSession(testEnv, sessionData("owner"));
    intruderSession = await createSession(testEnv, sessionData("intruder"));
    await insertCompletedJob("job-owned", "owner");
  });

  describe("auth", () => {
    it("refuses every entry point without a session", async () => {
      for (const path of ["/api/transcriptions/quota", "/api/transcriptions/jobs", "/api/transcriptions/jobs/job-owned"]) {
        expect((await call(path)).status).toBe(401);
      }
      expect((await call("/api/transcriptions/jobs", { method: "POST", body: {} })).status).toBe(401);
    });
  });

  describe("ownership", () => {
    it("hides another teacher's job behind a 404 on read, rename, delete and download", async () => {
      const reads = [
        await call("/api/transcriptions/jobs/job-owned", { sessionId: intruderSession }),
        await call("/api/transcriptions/jobs/job-owned/download/txt", { sessionId: intruderSession }),
        await call("/api/transcriptions/jobs/job-owned", {
          method: "PATCH",
          body: { title: "voler" },
          sessionId: intruderSession,
        }),
        await call("/api/transcriptions/jobs/job-owned", { method: "DELETE", sessionId: intruderSession }),
      ];
      for (const res of reads) {
        // 404, never 403: a 403 would confirm the id exists.
        expect(res.status).toBe(404);
      }

      // And nothing was actually changed or removed.
      const still = await call("/api/transcriptions/jobs/job-owned", { sessionId: ownerSession });
      expect(still.status).toBe(200);
      const body = await still.json<{ job: { title: string } }>();
      expect(body.job.title).toBe("Mon entretien");
    });

    it("lists only the caller's own jobs", async () => {
      const res = await call("/api/transcriptions/jobs", { sessionId: intruderSession });
      expect(res.status).toBe(200);
      expect((await res.json<{ jobs: unknown[] }>()).jobs).toHaveLength(0);

      const mine = await call("/api/transcriptions/jobs", { sessionId: ownerSession });
      expect((await mine.json<{ jobs: unknown[] }>()).jobs).toHaveLength(1);
    });
  });

  describe("body validation", () => {
    it("returns invalid_request rather than leaking a runtime error", async () => {
      for (const body of ["not json{", {}, { url: "https://x.test/a.mp3" }, { url: 3, diarize: true }]) {
        const res = await call("/api/transcriptions/jobs", {
          method: "POST",
          body,
          sessionId: ownerSession,
        });
        expect(res.status).toBe(400);
        const json = await res.json<{ error: string }>();
        expect(json.error).toBe("invalid_request");
        expect(JSON.stringify(json)).not.toMatch(/undefined|destructure|Cannot read/i);
      }
    });
  });

  describe("query validation", () => {
    it("falls back to the first page instead of 500ing on junk paging", async () => {
      // `Number("abc")` is NaN, every Math clamp propagates it, and D1 answers a
      // NaN bound into `LIMIT ?` with a datatype mismatch — a 500 in the
      // teacher's face for a mistyped URL.
      for (const query of [
        "?limit=abc&offset=-1",
        "?limit=&offset=",
        "?limit=NaN",
        "?limit=1e999",
        "?limit=0&offset=abc",
        "?limit=2.5",
        "?limit=999",
      ]) {
        const res = await call(`/api/transcriptions/jobs${query}`, { sessionId: ownerSession });
        expect(res.status, query).toBe(200);
        expect((await res.json<{ jobs: unknown[] }>()).jobs).toHaveLength(1);
      }
    });

    it("still honours a usable limit and offset", async () => {
      await insertCompletedJob("job-second", "owner");

      const limited = await call("/api/transcriptions/jobs?limit=1", { sessionId: ownerSession });
      expect((await limited.json<{ jobs: unknown[] }>()).jobs).toHaveLength(1);

      const skipped = await call("/api/transcriptions/jobs?offset=2", { sessionId: ownerSession });
      expect((await skipped.json<{ jobs: unknown[] }>()).jobs).toHaveLength(0);
    });
  });

  describe("uploads", () => {
    async function upload(sessionId: string): Promise<Response> {
      const form = new FormData();
      form.append("file", new File([new Uint8Array(2048)], "cours.mp3", { type: "audio/mpeg" }));
      form.append("diarize", "false");

      const ctx = createExecutionContext();
      const res = await worker.fetch(
        new Request("https://promptomatik.test/api/transcriptions/jobs/upload", {
          method: "POST",
          headers: { Cookie: sessionCookie(sessionId).split(";")[0] },
          body: form,
        }),
        testEnv,
        ctx
      );
      await waitOnExecutionContext(ctx);
      return res;
    }

    async function storedUploads(): Promise<number> {
      const listed = await testEnv.MEDIA.list({ prefix: "transcription/uploads/" });
      return listed.objects.length;
    }

    it("refuses an empty allowance before writing a single byte to R2", async () => {
      // An R2 write of up to 64 MB is itself billed, so the quota gate has to
      // run before `MEDIA.put`, not inside the job creation that follows it.
      // Otherwise a teacher with no hours left can loop this endpoint and
      // generate unbounded write operations.
      await testEnv.DB.prepare(
        `INSERT INTO transcription_quota_ledger (user_id, delta_seconds, reason, provider, created_at)
         VALUES ('owner', -36000, 'transcription', 'groq', datetime('now'))`
      ).run();

      const res = await upload(ownerSession);
      expect(res.status).toBe(402);
      const json = await res.json<{ code: string; failure: { code: string } }>();
      expect(json.code).toBe("quota_exceeded");
      expect(json.failure.code).toBe("quota_exceeded");
      expect(await storedUploads()).toBe(0);
    });

    it("refuses an over-ceiling upload from its header, before parsing the body", async () => {
      // `formData()` materialises the whole request. A 300 MB upload must be
      // refused from the header, with the 413 the contract defines and the UI has
      // a translated sentence for — not an OOM, and not a bare invalid_request.
      const ctx = createExecutionContext();
      const res = await worker.fetch(
        new Request("https://promptomatik.test/api/transcriptions/jobs/upload", {
          method: "POST",
          headers: {
            Cookie: sessionCookie(ownerSession).split(";")[0],
            "Content-Type": "multipart/form-data; boundary=----x",
            "Content-Length": String(300 * 1024 * 1024),
          },
          // The body is never read, which is the point of the test.
          body: "------x\r\n",
        }),
        testEnv,
        ctx
      );
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(413);
      const json = await res.json<{ code: string; failure: { maxBytes: number } }>();
      expect(json.code).toBe("source_too_large");
      // The constant, not a literal: the ceiling is decimal megabytes so the number
      // the interface says ("64 Mo") is the number Finder shows for the same file.
      expect(json.failure.maxBytes).toBe(TRANSCRIPTION_MAX_UPLOAD_BYTES);
      expect(await storedUploads()).toBe(0);
    });

    it("deletes the uploaded media with the job, wherever its key lives", async () => {
      // Uploads live under a user-scoped prefix, not the job's own — so DELETE has
      // to remove `source_r2_key` itself rather than rely on the job-prefix sweep.
      // This is asserted without going through the upload endpoint on purpose: a
      // real submission enqueues a job, and no test in this suite may end up
      // talking to a provider.
      const key = "transcription/uploads/owner/abc123/cours.mp3";
      await testEnv.MEDIA.put(key, new Uint8Array(64));
      await testEnv.DB.prepare(
        `INSERT INTO transcription_jobs
           (id, user_id, status, source_kind, source_r2_key, request_payload)
         VALUES ('job-uploaded', 'owner', 'completed', 'upload', ?, '{}')`
      )
        .bind(key)
        .run();

      const deleted = await call("/api/transcriptions/jobs/job-uploaded", {
        method: "DELETE",
        sessionId: ownerSession,
      });
      expect(deleted.status).toBe(200);
      expect(await storedUploads()).toBe(0);
    });
  });

  describe("admission is atomic", () => {
    /** Spend all but `remainingSeconds` of this month's allowance. */
    async function leaveOnly(remainingSeconds: number): Promise<void> {
      await testEnv.DB.prepare(
        `INSERT INTO transcription_quota_ledger (user_id, delta_seconds, reason, provider, created_at)
         VALUES ('owner', ?, 'transcription', 'groq', datetime('now'))`
      )
        .bind(-(36_000 - remainingSeconds))
        .run();
    }

    function submit(url: string): Promise<Response> {
      return call("/api/transcriptions/jobs", {
        method: "POST",
        body: { url, diarize: false },
        sessionId: ownerSession,
      });
    }

    it("admits one of three simultaneous submissions when only one fits", async () => {
      // An unmeasured URL is gated as the 90-minute maximum, so exactly one job
      // fits in 90 minutes of allowance. The quota precheck is three reads, and
      // reads cannot serialise anything: without the check inside the INSERT all
      // three of these pass and we pay for four and a half hours.
      await leaveOnly(5_400);

      const responses = await Promise.all([
        submit("https://cdn.example.test/a.mp3"),
        submit("https://cdn.example.test/b.mp3"),
        submit("https://cdn.example.test/c.mp3"),
      ]);
      const statuses = responses.map((res) => res.status).sort();
      expect(statuses).toEqual([202, 402, 402]);

      // And the row count agrees with the verdicts: one new job, not three.
      const rows = await testEnv.DB.prepare(
        "SELECT COUNT(*) AS n FROM transcription_jobs WHERE user_id = 'owner' AND status = 'queued'"
      ).first<{ n: number }>();
      expect(rows?.n).toBe(1);
    });

    it("reports the refusal as quota_exceeded, not as a 500", async () => {
      await leaveOnly(0);
      const res = await submit("https://cdn.example.test/a.mp3");
      expect(res.status).toBe(402);
      expect((await res.json<{ code: string }>()).code).toBe("quota_exceeded");
    });
  });

  describe("failures never carry internal prose", () => {
    it("strips the operator-only detail from a domain failure", async () => {
      const res = await call("/api/transcriptions/jobs", {
        method: "POST",
        body: { url: "http://127.0.0.1/secret.mp3", diarize: false },
        sessionId: ownerSession,
      });
      expect(res.status).toBe(400);
      const json = await res.json<{ code: string; failure: Record<string, unknown> }>();
      expect(json.code).toBe("unsupported_source");
      // "blocked_host" is for our logs. A teacher reads the translated code.
      expect(json.failure).toEqual({ code: "unsupported_source" });
      expect(JSON.stringify(json)).not.toMatch(/blocked_host/);
    });
  });

  describe("feed lookups are rate-limited", () => {
    it("refuses the eleventh lookup in a minute with a 429 and a Retry-After", async () => {
      // `/episodes` is outside the quota gate because it never touches a provider
      // — but it does make our Worker fetch a third party, so it cannot be
      // unlimited. The input below is refused before any network call, which is
      // exactly what makes this test safe to run offline.
      const statuses: number[] = [];
      for (let i = 0; i < 11; i += 1) {
        const res = await call("/api/transcriptions/episodes", {
          method: "POST",
          body: { url: "pas-une-url" },
          sessionId: ownerSession,
        });
        statuses.push(res.status);
        if (res.status === 429) {
          expect(res.headers.get("Retry-After")).toBe("60");
          expect((await res.json<{ error: string }>()).error).toBe("rate_limited");
        } else {
          await res.body?.cancel();
        }
      }
      expect(statuses.slice(0, 10).every((status) => status === 400)).toBe(true);
      expect(statuses[10]).toBe(429);
    });

    it("counts per teacher, so one loop cannot lock another out", async () => {
      for (let i = 0; i < 11; i += 1) {
        const res = await call("/api/transcriptions/episodes", {
          method: "POST",
          body: { url: "pas-une-url" },
          sessionId: ownerSession,
        });
        await res.body?.cancel();
      }
      const other = await call("/api/transcriptions/episodes", {
        method: "POST",
        body: { url: "pas-une-url" },
        sessionId: intruderSession,
      });
      expect(other.status).toBe(400);
    });
  });

  describe("platform gating at POST time", () => {
    // The test env has no YOUTUBE_INGEST_URL/_SECRET, so this exercises the
    // unconfigured deployment: classification says "supported", the route's
    // capability gate says "not here, not yet" — instantly, with the honest
    // code, instead of minting a job that exists only to fail in the queue.
    it("answers YouTube with the not-yet code while the sidecar is unconfigured", async () => {
      const res = await call("/api/transcriptions/jobs", {
        method: "POST",
        body: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", diarize: false },
        sessionId: ownerSession,
      });
      expect(res.status).toBe(501);
      const json = await res.json<{ code: string; failure: { code: string } }>();
      expect(json.code).toBe("youtube_not_yet_supported");
      expect(json.failure.code).toBe("youtube_not_yet_supported");

      // And no job row was created for it.
      const listed = await call("/api/transcriptions/jobs", { sessionId: ownerSession });
      expect((await listed.json<{ jobs: unknown[] }>()).jobs).toHaveLength(1);
    });

    it("answers Spotify with its own code", async () => {
      const res = await call("/api/transcriptions/jobs", {
        method: "POST",
        body: { url: "https://open.spotify.com/episode/abc123", diarize: false },
        sessionId: ownerSession,
      });
      expect(res.status).toBe(501);
      expect((await res.json<{ code: string }>()).code).toBe("spotify_not_supported");
    });

    it("classifies without creating anything, so the page can warn on paste", async () => {
      const res = await call("/api/transcriptions/inspect", {
        method: "POST",
        body: { input: "https://youtu.be/dQw4w9WgXcQ" },
        sessionId: ownerSession,
      });
      expect(res.status).toBe(200);
      const json = await res.json<{ source: { kind: string; supported: boolean; failure: { code: string } } }>();
      expect(json.source.kind).toBe("youtube");
      // Classification says "supported" — capability is a deployment question,
      // answered by POST /jobs (501 when the sidecar is unconfigured, below).
      expect(json.source.supported).toBe(true);

      const listed = await call("/api/transcriptions/jobs", { sessionId: ownerSession });
      expect((await listed.json<{ jobs: unknown[] }>()).jobs).toHaveLength(1);
    });
  });

  describe("downloads", () => {
    it("renders each format with its own type and filename", async () => {
      const expected = {
        txt: "text/plain",
        vtt: "text/vtt",
      } as const;

      for (const [format, type] of Object.entries(expected)) {
        const res = await call(`/api/transcriptions/jobs/job-owned/download/${format}`, {
          sessionId: ownerSession,
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toContain(type);
        expect(res.headers.get("Content-Disposition")).toContain(`mon-entretien.${format}`);
      }
    });

    it("localises the one string it renders via ?lang=", async () => {
      const fr = await call("/api/transcriptions/jobs/job-owned/download/txt?lang=fr", {
        sessionId: ownerSession,
      });
      expect(await fr.text()).toContain("Intervenant 1");

      const es = await call("/api/transcriptions/jobs/job-owned/download/txt?lang=es", {
        sessionId: ownerSession,
      });
      expect(await es.text()).toContain("Interlocutor 1");
    });

    it("refuses an unknown format and a job that is not finished", async () => {
      expect(
        (await call("/api/transcriptions/jobs/job-owned/download/docx", { sessionId: ownerSession })).status
      ).toBe(404);

      // srt and json were removed on 2026-08-10. They are the formats most likely
      // to be requested by a stale bookmark or a cached job payload, so they must
      // refuse cleanly rather than reach the renderer and throw.
      for (const gone of ["srt", "json"]) {
        expect(
          (await call(`/api/transcriptions/jobs/job-owned/download/${gone}`, { sessionId: ownerSession }))
            .status
        ).toBe(404);
      }

      await testEnv.DB.prepare("UPDATE transcription_jobs SET status = 'transcribing' WHERE id = ?")
        .bind("job-owned")
        .run();
      const res = await call("/api/transcriptions/jobs/job-owned/download/txt", { sessionId: ownerSession });
      expect(res.status).toBe(409);
      expect((await res.json<{ error: string }>()).error).toBe("job_not_ready");
    });

    it("refuses an expired transcript with 410, even before the nightly sweep runs", async () => {
      // The row still holds the text — this is the window between the deadline
      // and the cron. Retention that only works when the scheduler is punctual is
      // not retention, so the read enforces it too.
      await testEnv.DB.prepare("UPDATE transcription_jobs SET expires_at = ? WHERE id = ?")
        .bind(new Date(Date.now() - 60_000).toISOString(), "job-owned")
        .run();

      const res = await call("/api/transcriptions/jobs/job-owned/download/txt", {
        sessionId: ownerSession,
      });
      expect(res.status).toBe(410);
      expect((await res.json<{ code: string }>()).code).toBe("transcript_expired");

      // And the job read stops advertising a download it would not honour.
      const job = await call("/api/transcriptions/jobs/job-owned", { sessionId: ownerSession });
      const body = await job.json<{
        job: { expired: boolean; transcript: unknown; downloads?: unknown };
      }>();
      expect(body.job.expired).toBe(true);
      expect(body.job.transcript).toBeNull();
      expect(body.job.downloads).toBeUndefined();
    });

    it("serves the exact download links the job payload advertises", async () => {
      // `rowToTranscriptionJob` builds them; nothing rebuilds them client-side,
      // so the advertised href has to be the href this router answers on.
      const res = await call("/api/transcriptions/jobs/job-owned", { sessionId: ownerSession });
      const job = await res.json<{ job: { downloads: Record<string, string> } }>();
      expect(job.job.downloads.txt).toBe("/api/transcriptions/jobs/job-owned/download/txt");

      const followed = await call(job.job.downloads.txt, { sessionId: ownerSession });
      expect(followed.status).toBe(200);
    });
  });

  // The reading UI flags words the engine hesitated on; without the audio behind
  // them that flag is a dead end, so the transcript's media has to be reachable
  // — and only by the teacher it belongs to.
  describe("media", () => {
    it("hides another teacher's media behind the same 404", async () => {
      const res = await call("/api/transcriptions/jobs/job-owned/media", {
        sessionId: intruderSession,
      });
      expect(res.status).toBe(404);
    });

    it("redirects a link job to the audio it resolved, rather than proxying it", async () => {
      await testEnv.DB.prepare(
        "UPDATE transcription_jobs SET resolved_url = ? WHERE id = 'job-owned'"
      )
        .bind("https://cdn.example.fr/episode-12.mp3")
        .run();

      const res = await call("/api/transcriptions/jobs/job-owned/media", { sessionId: ownerSession });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://cdn.example.fr/episode-12.mp3");
    });

    it("streams an upload out of R2, and honours a Range so the player can seek", async () => {
      const key = "transcription/uploads/owner/job-upload/cours.mp3";
      await testEnv.MEDIA.put(key, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), {
        httpMetadata: { contentType: "audio/mpeg" },
      });
      await testEnv.DB.prepare(
        `INSERT INTO transcription_jobs
           (id, user_id, status, source_kind, source_r2_key, source_content_type,
            diarize_requested, request_payload)
         VALUES ('job-upload', 'owner', 'completed', 'upload', ?, 'audio/mpeg', 0, '{}')`
      )
        .bind(key)
        .run();

      const whole = await call("/api/transcriptions/jobs/job-upload/media", {
        sessionId: ownerSession,
      });
      expect(whole.status).toBe(200);
      expect(whole.headers.get("content-type")).toBe("audio/mpeg");
      expect(whole.headers.get("accept-ranges")).toBe("bytes");
      expect(new Uint8Array(await whole.arrayBuffer())).toHaveLength(8);

      const part = await call("/api/transcriptions/jobs/job-upload/media", {
        sessionId: ownerSession,
        headers: { Range: "bytes=2-4" },
      });
      expect(part.status).toBe(206);
      expect(part.headers.get("content-range")).toBe("bytes 2-4/8");
      expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([3, 4, 5]);
    });

    it("says the media is gone rather than pretending, when nothing is left", async () => {
      await testEnv.DB.prepare(
        "UPDATE transcription_jobs SET source_url = NULL, resolved_url = NULL WHERE id = 'job-owned'"
      ).run();
      const res = await call("/api/transcriptions/jobs/job-owned/media", { sessionId: ownerSession });
      expect(res.status).toBe(404);
      expect((await res.json<{ error: string }>()).error).toBe("media_unavailable");
    });
  });

  describe("quota", () => {
    it("reports the transcription allowance, in its own ledger", async () => {
      const res = await call("/api/transcriptions/quota", { sessionId: ownerSession });
      expect(res.status).toBe(200);
      const balance = await res.json<{ includedLimit: number; includedRemaining: number }>();
      // 10 hours a month, never pooled with the TTS minute ledger.
      expect(balance.includedLimit).toBe(36_000);
      expect(balance.includedRemaining).toBe(36_000);
    });
  });

  describe("rename", () => {
    it("renames the caller's own job and clears back to the derived label", async () => {
      const renamed = await call("/api/transcriptions/jobs/job-owned", {
        method: "PATCH",
        body: { title: "  Podcast FLE  " },
        sessionId: ownerSession,
      });
      expect(renamed.status).toBe(200);
      expect((await renamed.json<{ title: string | null }>()).title).toBe("Podcast FLE");

      const cleared = await call("/api/transcriptions/jobs/job-owned", {
        method: "PATCH",
        body: { title: "   " },
        sessionId: ownerSession,
      });
      expect((await cleared.json<{ title: string | null }>()).title).toBeNull();
    });
  });
});
