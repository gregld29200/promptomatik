// The transcription job router: who does the work, who pays for it, and what
// happens when something goes wrong.
//
// Three claims are defended here, and each one costs real money to get wrong:
//
//  1. AT-LEAST-ONCE DELIVERY MUST NOT MEAN AT-LEAST-ONCE BILLING. A job is
//     claimed with a single conditional UPDATE, so a redelivered message for a
//     run that is already in flight — or already completed — sends nothing to a
//     provider a second time.
//  2. A PROVIDER OUTAGE IS NOT A TEACHER'S FAILURE. `provider_unavailable` (a
//     429, a 401, any 5xx) is rethrown so the queue's retry ladder is actually
//     used, and the job is handed back in a claimable state. Every other code is
//     terminal, because retrying a mistyped URL three times just fails three
//     times.
//  3. BOOKKEEPING NEVER DESTROYS WORK. The quota charge runs after the transcript
//     is persisted, and a charge that throws cannot flip a completed row to
//     'failed' and hide the transcript from the teacher.
//
// No test in this file may reach a real provider: every run injects its
// collaborators through `TranscriptionJobDeps`.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../env";
import {
  handleTranscriptionJobBatch,
  processTranscriptionJob,
  rowToTranscriptionJob,
  transcriptionUploadKey,
  type TranscriptionJobDeps,
  type TranscriptionJobRow,
  type TranscriptionJobStatus,
} from "./transcription-jobs";
import { TRANSCRIPTION_STALE_JOB_MINUTES } from "./transcription-quota";
import { GROQ_BREAKER_KEY, openGroqBreaker } from "./transcription-budget";
import type { TranscriptionRouteReason } from "./transcription/index";
import {
  TranscriptionError,
  type NormalisedTranscript,
  type ResolvedSource,
  type TranscriptionProviderId,
  type TranscriptionRequest,
} from "./transcription/types";

const testEnv = env as unknown as Env;

/** `transcription_jobs` and its ledger, copied from migration 0017. */
const TEST_SCHEMA_STATEMENTS = [
  "PRAGMA foreign_keys = OFF",
  "DROP TABLE IF EXISTS transcription_quota_ledger",
  "DROP TABLE IF EXISTS transcription_jobs",
  "DROP TABLE IF EXISTS users",
  "PRAGMA foreign_keys = ON",
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
  `CREATE TABLE transcription_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'resolving', 'transcribing', 'completed', 'failed')),
  source_kind TEXT NOT NULL
    CHECK (source_kind IN ('upload', 'direct_url', 'podcast', 'youtube')),
  source_url TEXT,
  resolved_url TEXT,
  source_r2_key TEXT,
  source_content_type TEXT,
  source_bytes INTEGER,
  title TEXT,
  requested_provider TEXT,
  diarize_requested INTEGER NOT NULL DEFAULT 0 CHECK (diarize_requested IN (0, 1)),
  provider TEXT CHECK (provider IS NULL OR provider IN ('groq', 'deepgram', 'assemblyai')),
  provider_model TEXT,
  provider_job_id TEXT,
  provider_choice_reason TEXT,
  diarization INTEGER NOT NULL DEFAULT 0 CHECK (diarization IN (0, 1)),
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
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)`,
  `CREATE TABLE transcription_quota_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  delta_seconds INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('transcription', 'refund', 'admin_adjust')),
  provider TEXT CHECK (provider IS NULL OR provider IN ('groq', 'deepgram', 'assemblyai')),
  job_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES transcription_jobs(id) ON DELETE SET NULL
)`,
];

const TRANSCRIPT: NormalisedTranscript = {
  metadata: {
    provider: "groq",
    providerJobId: "req-fixture-1",
    model: "whisper-large-v3-turbo",
    durationSeconds: 124.4,
    detectedLanguages: ["fr"],
    diarization: false,
    speakerCount: null,
    channels: 1,
  },
  speakers: [],
  segments: [
    {
      idx: 0,
      speaker: null,
      start: 0,
      end: 2.5,
      text: "Bonjour a toutes et a tous.",
      words: [
        { text: "Bonjour", start: 0, end: 0.6, speaker: null, confidence: 0.98, language: null },
      ],
      language: "fr",
    },
  ],
  text: "Bonjour a toutes et a tous.",
};

const RESOLVED: ResolvedSource = {
  kind: "direct_url",
  audio: { kind: "url", url: "https://cdn.example.test/episode-12.mp3" },
  durationSeconds: 124,
  contentType: "audio/mpeg",
  bytes: 2_400_000,
  title: "Episode 12",
  resolvedUrl: "https://cdn.example.test/episode-12.mp3",
  r2Key: null,
};

/** What each run of the router actually did, without touching a network. */
interface Recorder {
  submits: TranscriptionRequest[];
  charges: { jobId: string; seconds: number; provider: TranscriptionProviderId }[];
  deps: TranscriptionJobDeps;
}

/**
 * The cascade is stubbed here on purpose: which of the three providers a job
 * lands on is `worker/lib/transcription/router.test.ts`'s subject. What this file
 * defends is what the JOB does with the answer, so the seam records the request
 * it was handed and returns a fixture — or throws the failure under test.
 */
function recorder(
  overrides: {
    submit?: (request: TranscriptionRequest) => Promise<void>;
    resolve?: () => Promise<ResolvedSource>;
    charge?: () => Promise<void>;
    /** What the provider comes back with. Defaults to the two-minute fixture. */
    transcript?: NormalisedTranscript;
    /** Which tier "ran", and why. Defaults to Groq on the free tier. */
    ran?: { provider: TranscriptionProviderId; reason: TranscriptionRouteReason };
    fellBackFrom?: TranscriptionProviderId[];
  } = {}
): Recorder {
  const submits: TranscriptionRequest[] = [];
  const charges: { jobId: string; seconds: number; provider: TranscriptionProviderId }[] = [];
  const ran = overrides.ran ?? { provider: "groq" as const, reason: "groq_free_tier" as const };

  return {
    submits,
    charges,
    deps: {
      runTranscription: async (_env, request) => {
        submits.push(request);
        if (overrides.submit) await overrides.submit(request);
        const transcript = overrides.transcript ?? TRANSCRIPT;
        return {
          transcript,
          handle: {
            provider: ran.provider,
            providerJobId: "req-fixture-1",
            model: transcript.metadata.model,
            ready: true,
            raw: {},
          },
          provider: ran.provider,
          model: transcript.metadata.model,
          reason: ran.reason,
          fellBackFrom: overrides.fellBackFrom ?? [],
        };
      },
      resolveSource: overrides.resolve ? () => overrides.resolve!() : async () => RESOLVED,
      chargeQuota: async (_env, _userId, jobId, seconds, provider) => {
        charges.push({ jobId, seconds, provider });
        if (overrides.charge) await overrides.charge();
        return {
          includedLimit: 36_000,
          includedUsed: seconds,
          includedRemaining: 36_000 - seconds,
          month: "2026-08",
          monthResetsOn: "2026-09-01T00:00:00.000Z",
        };
      },
    },
  };
}

async function resetDb() {
  // The breaker is global state in KV: a 429 written by one test must not decide
  // the retry delay another one asserts.
  await testEnv.SESSIONS.delete(GROQ_BREAKER_KEY);
  for (const statement of TEST_SCHEMA_STATEMENTS) {
    await testEnv.DB.prepare(statement).run();
  }
  await testEnv.DB.prepare(
    `INSERT INTO users (id, email, name, password_hash, tier)
     VALUES ('teacher-1', 'teacher-1@example.com', 'Teacher', 'hash', 'participant')`
  ).run();
}

async function seedJob(
  jobId: string,
  options: { status?: TranscriptionJobStatus; updatedMinutesAgo?: number } = {}
) {
  const payload = JSON.stringify({
    source: { kind: "direct_url", url: "https://example.test/episode-12.mp3" },
    diarize: false,
    languageHint: null,
    title: null,
  });
  await testEnv.DB.prepare(
    `INSERT INTO transcription_jobs
       (id, user_id, status, source_kind, source_url, requested_provider, request_payload, updated_at)
     VALUES (?, 'teacher-1', ?, 'direct_url', 'https://example.test/episode-12.mp3', 'groq', ?,
             datetime('now', ?))`
  )
    .bind(jobId, options.status ?? "queued", payload, `-${options.updatedMinutesAgo ?? 0} minutes`)
    .run();
}

async function readJob(jobId: string): Promise<TranscriptionJobRow> {
  const row = await testEnv.DB.prepare("SELECT * FROM transcription_jobs WHERE id = ?")
    .bind(jobId)
    .first<TranscriptionJobRow>();
  if (!row) throw new Error(`missing test row ${jobId}`);
  return row;
}

/** A one-message batch, as the queue consumer sees it. */
function batchOf(jobId: string, attempts: number) {
  const calls = { acked: 0, retried: [] as (number | undefined)[] };
  const message = {
    id: `msg-${jobId}-${attempts}`,
    timestamp: new Date(),
    body: { jobId },
    attempts,
    ack: () => {
      calls.acked += 1;
    },
    retry: (options?: { delaySeconds?: number }) => {
      calls.retried.push(options?.delaySeconds);
    },
  };
  const batch = {
    queue: "transcription-jobs",
    messages: [message],
    ackAll: () => undefined,
    retryAll: () => undefined,
  } as unknown as MessageBatch<{ jobId: string }>;
  return { batch, calls };
}

describe("processTranscriptionJob — the happy path", () => {
  beforeEach(resetDb);

  it("stores the transcript, bills what the provider measured, and charges once", async () => {
    await seedJob("job-ok");
    const run = recorder();

    await processTranscriptionJob(testEnv, "job-ok", run.deps);

    const row = await readJob("job-ok");
    expect(row.status).toBe("completed");
    expect(row.provider).toBe("groq");
    expect(row.provider_model).toBe("whisper-large-v3-turbo");
    expect(row.provider_job_id).toBe("req-fixture-1");
    expect(row.diarization).toBe(0);
    expect(row.detected_language).toBe("fr");
    expect(row.resolved_url).toBe(RESOLVED.resolvedUrl);
    expect(row.title).toBe("Episode 12");
    // 124.4 measured seconds, billed as whole seconds, rounded up.
    expect(row.billed_seconds).toBe(125);
    expect(row.error_code).toBeNull();
    // The provider BILLED is the one the cascade actually ran, never the requested one.
    expect(run.charges).toEqual([{ jobId: "job-ok", seconds: 125, provider: "groq" }]);

    const job = rowToTranscriptionJob(row);
    expect(job.transcript?.text).toBe(TRANSCRIPT.text);
    expect(job.downloads?.srt).toBe("/api/transcriptions/jobs/job-ok/download/srt");
  });

  it("stamps the seven-day deadline once, on completion", async () => {
    await seedJob("job-expiry");
    const before = Date.now();

    await processTranscriptionJob(testEnv, "job-expiry", recorder().deps);

    const first = await readJob("job-expiry");
    expect(first.expires_at).not.toBeNull();
    const deadline = new Date(first.expires_at ?? "").getTime();
    // Seven days out, give or take the test's own wall clock.
    expect(deadline - before).toBeGreaterThan(6.9 * 86_400_000);
    expect(deadline - before).toBeLessThan(7.1 * 86_400_000);

    // Re-running the job (a requeued failure, an operator replay) must not move a
    // teacher's deadline. `COALESCE(expires_at, ?)` is what guarantees it — the
    // same idiom audio_jobs uses.
    await testEnv.DB.prepare("UPDATE transcription_jobs SET status = 'queued' WHERE id = ?")
      .bind("job-expiry")
      .run();
    await processTranscriptionJob(testEnv, "job-expiry", recorder().deps);
    expect((await readJob("job-expiry")).expires_at).toBe(first.expires_at);
  });

  it("records the tier that actually ran and why, so a fallback is never silent", async () => {
    // Requested Groq (no diarization asked), served by Deepgram after a 429. The
    // row has to explain that, or a paid transcript for a free-tier job is an
    // unexplained cost in the admin view.
    await seedJob("job-fellback");
    const run = recorder({
      ran: { provider: "deepgram", reason: "groq_rate_limited" },
      fellBackFrom: ["groq"],
    });

    await processTranscriptionJob(testEnv, "job-fellback", run.deps);

    const row = await readJob("job-fellback");
    expect(row.requested_provider).toBe("groq");
    expect(row.provider).toBe("deepgram");
    expect(row.provider_choice_reason).toBe("groq_rate_limited");
    expect(run.charges[0].provider).toBe("deepgram");
    expect(rowToTranscriptionJob(row).providerChoiceReason).toBe("groq_rate_limited");
  });
});

describe("processTranscriptionJob — a provider outage is retryable", () => {
  beforeEach(resetDb);

  it("rethrows provider_unavailable so the queue can retry", async () => {
    // The failure the old code swallowed: one Groq rate-limit blip at the end of a
    // 90-minute transcription terminally killed the job, and the teacher had to
    // start over. Nothing was billed — the provider refused the request.
    await seedJob("job-busy");
    const run = recorder({
      submit: async () => {
        throw new TranscriptionError({ code: "provider_unavailable", provider: "groq", status: 429 });
      },
    });

    await expect(processTranscriptionJob(testEnv, "job-busy", run.deps)).rejects.toMatchObject({
      failure: { code: "provider_unavailable" },
    });

    // Not terminal, and claimable again: no error was written to the row.
    const row = await readJob("job-busy");
    expect(row.status).toBe("queued");
    expect(row.error_code).toBeNull();
    expect(row.completed_at).toBeNull();
  });

  it("completes on the retry, without having billed anything twice", async () => {
    await seedJob("job-busy-then-ok");
    const failing = recorder({
      submit: async () => {
        throw new TranscriptionError({ code: "provider_unavailable", provider: "groq", status: 503 });
      },
    });
    await expect(
      processTranscriptionJob(testEnv, "job-busy-then-ok", failing.deps)
    ).rejects.toBeInstanceOf(TranscriptionError);

    const succeeding = recorder();
    await processTranscriptionJob(testEnv, "job-busy-then-ok", succeeding.deps);

    expect(failing.submits).toHaveLength(1);
    expect(succeeding.submits).toHaveLength(1);
    expect((await readJob("job-busy-then-ok")).status).toBe("completed");
    expect(succeeding.charges).toEqual([
      { jobId: "job-busy-then-ok", seconds: 125, provider: "groq" },
    ]);
  });

  // A failed row has to be as auditable as a completed one. Without this, a job
  // that burned a Groq 429 and then died on Deepgram recorded nothing about
  // either, and the fallback survived only as a console line — which is the one
  // place a Deepgram bill cannot be explained from.
  it("records which tier the cascade died on, and why it was that tier", async () => {
    await seedJob("job-cascade-dead");
    const run = recorder({
      submit: async () => {
        const error = new TranscriptionError({
          code: "provider_failed",
          provider: "deepgram",
          status: 500,
        });
        error.attempt = { provider: "deepgram", reason: "groq_rate_limited" };
        throw error;
      },
    });

    await processTranscriptionJob(testEnv, "job-cascade-dead", run.deps);

    const row = await readJob("job-cascade-dead");
    expect(row.status).toBe("failed");
    expect(row.provider).toBe("deepgram");
    expect(row.provider_choice_reason).toBe<TranscriptionRouteReason>("groq_rate_limited");
  });

  it("leaves the provider columns alone when no tier ever ran", async () => {
    await seedJob("job-no-tier");
    const run = recorder({
      resolve: async () => {
        throw new TranscriptionError({ code: "no_audio_found" });
      },
    });

    await processTranscriptionJob(testEnv, "job-no-tier", run.deps);

    const row = await readJob("job-no-tier");
    expect(row.status).toBe("failed");
    expect(row.provider).toBeNull();
    expect(row.provider_choice_reason).toBeNull();
  });

  it("hands the router the size ingest measured, not just an upload's own", async () => {
    // Only the `bytes` audio variant carries a size, so without this a link or a
    // podcast episode reached the router looking size-less — and Groq's
    // free-tier 25 MB pre-skip could never fire on the common case.
    await seedJob("job-url-size");
    const run = recorder();

    await processTranscriptionJob(testEnv, "job-url-size", run.deps);

    expect(run.submits[0].sizeBytes).toBe(RESOLVED.bytes);
  });

  it("keeps a teacher-caused failure terminal and never reaches a provider", async () => {
    await seedJob("job-bad-url");
    const run = recorder({
      resolve: async () => {
        throw new TranscriptionError({ code: "source_unreachable", status: 404 });
      },
    });

    // Resolves, not rejects: retrying a mistyped URL three times just fails
    // three times.
    await processTranscriptionJob(testEnv, "job-bad-url", run.deps);

    const row = await readJob("job-bad-url");
    expect(row.status).toBe("failed");
    expect(row.error_code).toBe("source_unreachable");
    expect(JSON.parse(row.error_payload ?? "{}")).toMatchObject({
      code: "source_unreachable",
      status: 404,
    });
    expect(run.submits).toHaveLength(0);
    expect(run.charges).toHaveLength(0);
  });
});

describe("processTranscriptionJob — one delivery, one provider bill", () => {
  beforeEach(resetDb);

  it("does nothing for a job another delivery is already running", async () => {
    // The row is mid-flight and was touched a moment ago. A redelivered message
    // must not send the same media to the provider a second time.
    await seedJob("job-inflight", { status: "transcribing", updatedMinutesAgo: 1 });
    const run = recorder();

    await processTranscriptionJob(testEnv, "job-inflight", run.deps);

    expect(run.submits).toHaveLength(0);
    expect(run.charges).toHaveLength(0);
    expect((await readJob("job-inflight")).status).toBe("transcribing");
  });

  it("does nothing for a job we have already completed and paid for", async () => {
    await seedJob("job-done", { status: "completed" });
    const run = recorder();

    await processTranscriptionJob(testEnv, "job-done", run.deps);

    expect(run.submits).toHaveLength(0);
    expect((await readJob("job-done")).status).toBe("completed");
  });

  it("does nothing at all for a job id that does not exist", async () => {
    const run = recorder();
    await processTranscriptionJob(testEnv, "job-missing", run.deps);
    expect(run.submits).toHaveLength(0);
  });

  it("takes over a job abandoned mid-flight, once it cannot still be running", async () => {
    // No queue-consumer invocation outlives TRANSCRIPTION_STALE_JOB_MINUTES, so a
    // row still 'transcribing' after that was killed by an eviction and would
    // otherwise be stuck forever.
    await seedJob("job-abandoned", {
      status: "transcribing",
      updatedMinutesAgo: TRANSCRIPTION_STALE_JOB_MINUTES + 5,
    });
    const run = recorder();

    await processTranscriptionJob(testEnv, "job-abandoned", run.deps);

    expect(run.submits).toHaveLength(1);
    expect((await readJob("job-abandoned")).status).toBe("completed");
  });
});

describe("processTranscriptionJob — internal errors stay internal", () => {
  beforeEach(resetDb);

  it("keeps a raw exception message for support and never puts it in the response", async () => {
    // A D1 constraint message, a KV fault, a TypeError from an unexpected payload:
    // all operator information. The teacher gets a translatable code; the text goes
    // to `error_message`, which no response ever carries.
    const secret = "D1_ERROR: no such column: teacher_secret_column";
    const run = recorder({
      resolve: async () => {
        throw new Error(secret);
      },
    });
    await seedJob("job-internal");

    await processTranscriptionJob(testEnv, "job-internal", run.deps);

    const row = await readJob("job-internal");
    expect(row.status).toBe("failed");
    expect(row.error_code).toBe("internal");
    // Stored for us...
    expect(row.error_message).toBe(secret);
    // ...and absent from everything the client sees.
    expect(row.error_payload).toBe(JSON.stringify({ code: "internal" }));
    const job = rowToTranscriptionJob(row);
    expect(job.error).toEqual({ code: "internal" });
    expect(JSON.stringify(job)).not.toMatch(/D1_ERROR|teacher_secret_column/);
  });

  it("strips an authored detail from a failure on its way out, but keeps the numbers", async () => {
    const run = recorder({
      resolve: async () => {
        throw new TranscriptionError({ code: "internal", detail: "upload_missing" });
      },
    });
    await seedJob("job-detail");

    await processTranscriptionJob(testEnv, "job-detail", run.deps);

    const row = await readJob("job-detail");
    // The detail is stored — support needs to know which internal case it was.
    expect(row.error_payload).toBe(JSON.stringify({ code: "internal", detail: "upload_missing" }));
    // It is not published.
    expect(rowToTranscriptionJob(row).error).toEqual({ code: "internal" });
  });
});

describe("processTranscriptionJob — the duration cap has a backstop", () => {
  beforeEach(resetDb);

  /** The same fixture, restated as a four-hour media. */
  function fourHourTranscript(): NormalisedTranscript {
    return {
      ...TRANSCRIPT,
      metadata: { ...TRANSCRIPT.metadata, durationSeconds: 4 * 60 * 60 },
    };
  }

  it("refuses a transcript longer than the cap instead of storing it", async () => {
    // Ingest measures the container header before submitting, so reaching here
    // means a source got past every pre-submit check (an Ogg whose length only its
    // last page states, a feed that lied). The cap is a promise the product makes,
    // so the job fails with the specific code and the length that broke it.
    await seedJob("job-too-long");
    const run = recorder({ transcript: fourHourTranscript() });

    await processTranscriptionJob(testEnv, "job-too-long", run.deps);

    const row = await readJob("job-too-long");
    expect(row.status).toBe("failed");
    expect(row.error_code).toBe("source_too_long");
    expect(row.result_payload).toBeNull();
    expect(rowToTranscriptionJob(row).error).toEqual({
      code: "source_too_long",
      durationSeconds: 14_400,
      maxSeconds: 5_400,
    });
  });

  it("still books what the provider billed us, so the breach cannot repeat for free", async () => {
    await seedJob("job-too-long-2");
    const run = recorder({ transcript: fourHourTranscript() });

    await processTranscriptionJob(testEnv, "job-too-long-2", run.deps);

    // Skipping the charge would make an over-long source cost the teacher nothing
    // and us four hours of provider time, on every retry, forever.
    expect(run.charges).toEqual([{ jobId: "job-too-long-2", seconds: 14_400, provider: "groq" }]);
  });

  it("leaves a media exactly at the cap alone", async () => {
    await seedJob("job-at-cap");
    const run = recorder({
      transcript: { ...TRANSCRIPT, metadata: { ...TRANSCRIPT.metadata, durationSeconds: 5_400 } },
    });

    await processTranscriptionJob(testEnv, "job-at-cap", run.deps);

    const row = await readJob("job-at-cap");
    expect(row.status).toBe("completed");
    expect(row.billed_seconds).toBe(5_400);
  });
});

describe("processTranscriptionJob — bookkeeping never destroys work", () => {
  beforeEach(resetDb);

  it("keeps a saved transcript when the quota charge throws", async () => {
    await seedJob("job-charge-fails");
    const run = recorder({
      charge: async () => {
        throw new Error("D1 write failed");
      },
    });

    await processTranscriptionJob(testEnv, "job-charge-fails", run.deps);

    const row = await readJob("job-charge-fails");
    // The charge is a receipt, not a gate: losing it costs us money, never the
    // teacher's transcript.
    expect(row.status).toBe("completed");
    expect(row.result_payload).toContain("Bonjour");
    expect(row.error_code).toBeNull();
  });
});

describe("handleTranscriptionJobBatch", () => {
  beforeEach(resetDb);

  it("retries while attempts remain instead of failing the job", async () => {
    await seedJob("job-retry");
    const run = recorder({
      submit: async () => {
        throw new TranscriptionError({ code: "provider_unavailable", provider: "groq", status: 502 });
      },
    });

    const first = batchOf("job-retry", 1);
    await handleTranscriptionJobBatch(first.batch, testEnv, run.deps);
    expect(first.calls.retried).toHaveLength(1);
    expect(first.calls.acked).toBe(0);
    expect((await readJob("job-retry")).status).toBe("queued");

    const second = batchOf("job-retry", 2);
    await handleTranscriptionJobBatch(second.batch, testEnv, run.deps);
    expect(second.calls.retried).toHaveLength(1);
    expect((await readJob("job-retry")).status).toBe("queued");
  });

  it("stores the real failure on the last attempt, not a generic internal error", async () => {
    // The teacher should read "the service is busy, try again shortly" — which is
    // true and actionable — rather than transcription.error_internal.
    await seedJob("job-exhausted");
    const run = recorder({
      submit: async () => {
        throw new TranscriptionError({ code: "provider_unavailable", provider: "groq", status: 503 });
      },
    });

    const last = batchOf("job-exhausted", 3);
    await handleTranscriptionJobBatch(last.batch, testEnv, run.deps);

    expect(last.calls.acked).toBe(1);
    expect(last.calls.retried).toHaveLength(0);
    const row = await readJob("job-exhausted");
    expect(row.status).toBe("failed");
    expect(row.error_code).toBe("provider_unavailable");
    expect(JSON.parse(row.error_payload ?? "{}")).toMatchObject({
      code: "provider_unavailable",
      provider: "groq",
      status: 503,
    });
  });

  // The ladder is 5 s then 10 s. A Groq 429 opens the breaker for up to an hour,
  // and the breaker removes Groq from the plan — so in a Groq-only deployment
  // both retries come back with an empty plan and the job dies minutes before
  // Groq would have been eligible again. They cannot succeed by construction.
  it("waits for the Groq breaker when Groq is the only tier there is", async () => {
    await seedJob("job-groq-only");
    const groqOnly = { ...testEnv, DEEPGRAM_API_KEY: undefined, ASSEMBLYAI_API_KEY: undefined } as Env;
    await openGroqBreaker(groqOnly, 180);

    const run = recorder({
      submit: async () => {
        throw new TranscriptionError({ code: "provider_unavailable", provider: "groq", status: 429 });
      },
    });
    const first = batchOf("job-groq-only", 1);
    await handleTranscriptionJobBatch(first.batch, groqOnly, run.deps);

    expect(first.calls.retried).toHaveLength(1);
    // Past the pause, not five seconds into it.
    expect(first.calls.retried[0]).toBeGreaterThan(170);
  });

  it("keeps the prompt ladder when another tier is configured", async () => {
    await seedJob("job-has-fallback");
    await openGroqBreaker(testEnv, 180);

    const run = recorder({
      submit: async () => {
        throw new TranscriptionError({ code: "provider_unavailable", provider: "groq", status: 429 });
      },
    });
    const first = batchOf("job-has-fallback", 1);
    await handleTranscriptionJobBatch(first.batch, testEnv, run.deps);

    // Deepgram and AssemblyAI are configured in this env, so the next delivery
    // has somewhere to go and should be prompt.
    expect(first.calls.retried[0]).toBe(5);
  });

  it("acks a job that finished normally", async () => {
    await seedJob("job-batch-ok");
    const run = recorder();

    const only = batchOf("job-batch-ok", 1);
    await handleTranscriptionJobBatch(only.batch, testEnv, run.deps);

    expect(only.calls.acked).toBe(1);
    expect(only.calls.retried).toHaveLength(0);
    expect((await readJob("job-batch-ok")).status).toBe("completed");
  });
});

describe("transcriptionUploadKey", () => {
  it("puts the teacher's id in the path and keeps two uploads of one name apart", () => {
    const first = transcriptionUploadKey("teacher-1", "Cours n°3 (final).m4a");
    const second = transcriptionUploadKey("teacher-1", "Cours n°3 (final).m4a");

    expect(first.startsWith("transcription/uploads/teacher-1/")).toBe(true);
    expect(first).not.toBe(second);
    // Sanitised: no spaces, parentheses or accents can reach an R2 key.
    expect(first.split("/").pop()).toMatch(/^[\w.-]+$/);
  });

  it("never produces an empty leaf, whatever the browser sent", () => {
    expect(transcriptionUploadKey("teacher-1", "???").endsWith("/source")).toBe(true);
  });
});
