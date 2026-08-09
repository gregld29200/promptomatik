// 7-day retention: the countdown, the purge, and the promise being true even
// when the cron is late.
//
// Three claims:
//
//  1. THE DEADLINE IS STAMPED ONCE. A transcript expires 7 days after it was
//     completed, and re-completing a row cannot move that date — the same
//     `COALESCE(expires_at, ?)` guarantee audio_jobs relies on.
//  2. THE PURGE ACTUALLY DELETES, and is safe to run twice. Unlike the Audio
//     Studio's mp3s, no R2 lifecycle rule can reach a transcript: it is TEXT in
//     D1, so if this code does not remove it, nothing does.
//  3. AN EXPIRED TRANSCRIPT IS NEVER SERVED, cron or no cron. A daily sweep
//     leaves a window of up to 24 hours in which the row still holds the text,
//     and in that window the API must already behave as if it did not.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../env";
import {
  TRANSCRIPTION_PURGE_BATCH_SIZE,
  isTranscriptExpired,
  purgeExpiredTranscriptions,
  runTranscriptionRetentionSweep,
  transcriptionExpiresAtIso,
} from "./transcription-retention";
import { rowToTranscriptionJob, type TranscriptionJobRow } from "./transcription-jobs";
import { TRANSCRIPTION_RETENTION_DAYS, type NormalisedTranscript } from "./transcription/types";

const testEnv = env as unknown as Env;
const DAY_MS = 24 * 60 * 60 * 1000;

const SCHEMA = [
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
];

const TRANSCRIPT: NormalisedTranscript = {
  metadata: {
    provider: "deepgram",
    providerJobId: "dg-1",
    model: "nova-3",
    durationSeconds: 600,
    detectedLanguages: ["fr"],
    diarization: true,
    speakerCount: 2,
    channels: 1,
  },
  speakers: [],
  segments: [],
  text: "Bonjour a toutes et a tous.",
};

async function resetDb(): Promise<void> {
  for (const statement of SCHEMA) {
    await testEnv.DB.prepare(statement).run();
  }
}

interface SeedOptions {
  expiresAt: string | null;
  r2Key?: string | null;
  transcript?: boolean;
  status?: string;
  /** Whole days in the past. Defaults to "just now". */
  createdDaysAgo?: number;
}

function seedStatement(id: string, options: SeedOptions): D1PreparedStatement {
  return testEnv.DB.prepare(
    `INSERT INTO transcription_jobs
       (id, user_id, status, source_kind, source_url, source_r2_key, request_payload,
        result_payload, expires_at, completed_at, created_at, updated_at)
     VALUES (?, 'teacher-1', ?, 'upload', NULL, ?, '{}', ?, ?, datetime('now'),
             datetime('now', ?), datetime('now', ?))`
  ).bind(
    id,
    options.status ?? "completed",
    options.r2Key ?? null,
    options.transcript === false ? null : JSON.stringify(TRANSCRIPT),
    options.expiresAt,
    `-${options.createdDaysAgo ?? 0} days`,
    `-${options.createdDaysAgo ?? 0} days`
  );
}

async function seed(id: string, options: SeedOptions): Promise<void> {
  await seedStatement(id, options).run();
}

async function readRow(id: string): Promise<TranscriptionJobRow> {
  const row = await testEnv.DB.prepare("SELECT * FROM transcription_jobs WHERE id = ?")
    .bind(id)
    .first<TranscriptionJobRow>();
  if (!row) throw new Error(`missing test row ${id}`);
  return row;
}

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

describe("transcriptionExpiresAtIso", () => {
  it("lands exactly seven days out, in the same ISO shape the audio takes use", () => {
    const from = new Date("2026-08-09T10:00:00.000Z");
    expect(transcriptionExpiresAtIso(from)).toBe("2026-08-16T10:00:00.000Z");
    expect(TRANSCRIPTION_RETENTION_DAYS).toBe(7);
  });
});

describe("isTranscriptExpired", () => {
  const now = new Date("2026-08-09T10:00:00.000Z");

  it("is false while the deadline is ahead, true once it has passed", () => {
    expect(isTranscriptExpired("2026-08-09T10:00:01.000Z", now)).toBe(false);
    expect(isTranscriptExpired("2026-08-09T09:59:59.000Z", now)).toBe(true);
  });

  it("treats a job with no deadline as alive — nothing was stored to expire", () => {
    expect(isTranscriptExpired(null, now)).toBe(false);
  });

  it("treats an unreadable stored date as alive, never as expired", () => {
    // A corrupt column must not be able to hide a teacher's transcript.
    expect(isTranscriptExpired("not-a-date", now)).toBe(false);
  });
});

describe("rowToTranscriptionJob — expiry is enforced on the read", () => {
  beforeEach(resetDb);

  it("withholds the transcript and the downloads once the deadline has passed", async () => {
    // The row still HOLDS the text: this is the window between expiry and the
    // next nightly sweep, and it is exactly when a read must not serve it.
    await seed("job-late", { expiresAt: isoDaysFromNow(-1), r2Key: "transcription/uploads/x/a.mp3" });
    const job = rowToTranscriptionJob(await readRow("job-late"));

    expect(job.expired).toBe(true);
    expect(job.transcript).toBeNull();
    expect(job.downloads).toBeUndefined();
    // The row itself survives, so the library can still say it existed.
    expect(job.status).toBe("completed");
    expect(job.expiresAt).not.toBeNull();
  });

  it("serves a transcript that is still inside its seven days", async () => {
    await seed("job-fresh", { expiresAt: isoDaysFromNow(3) });
    const job = rowToTranscriptionJob(await readRow("job-fresh"));

    expect(job.expired).toBe(false);
    expect(job.transcript?.text).toBe(TRANSCRIPT.text);
    expect(job.downloads?.txt).toBe("/api/transcriptions/jobs/job-fresh/download/txt");
  });
});

describe("purgeExpiredTranscriptions", () => {
  beforeEach(resetDb);

  it("clears the transcript text and the stored media, and leaves the row", async () => {
    await testEnv.MEDIA.put("transcription/uploads/t/expired.mp3", "audio-bytes");
    await seed("job-old", {
      expiresAt: isoDaysFromNow(-2),
      r2Key: "transcription/uploads/t/expired.mp3",
    });

    const outcome = await purgeExpiredTranscriptions(testEnv);
    expect(outcome).toMatchObject({ purged: 1, mediaDeleted: 1, batches: 1, truncated: false });

    const row = await readRow("job-old");
    expect(row.result_payload).toBeNull();
    expect(row.source_r2_key).toBeNull();
    expect(row.status).toBe("completed");
    expect(await testEnv.MEDIA.head("transcription/uploads/t/expired.mp3")).toBeNull();
  });

  it("leaves everything that has not expired yet alone", async () => {
    await seed("job-alive", { expiresAt: isoDaysFromNow(2) });
    await seed("job-never", { expiresAt: null });

    const outcome = await purgeExpiredTranscriptions(testEnv);
    expect(outcome.purged).toBe(0);
    expect((await readRow("job-alive")).result_payload).not.toBeNull();
    expect((await readRow("job-never")).result_payload).not.toBeNull();
  });

  it("is safe to run twice — the second pass finds nothing to do", async () => {
    await seed("job-old", { expiresAt: isoDaysFromNow(-1), r2Key: null });

    expect((await purgeExpiredTranscriptions(testEnv)).purged).toBe(1);
    const second = await purgeExpiredTranscriptions(testEnv);
    expect(second.purged).toBe(0);
    expect(second.batches).toBe(0);
  });

  it("sweeps stored media for a row whose transcript was already cleared", async () => {
    // Half-purged by an earlier run whose R2 call failed. The object is not
    // orphaned: the row still matches, so the next sweep finishes the job.
    await testEnv.MEDIA.put("transcription/uploads/t/left.mp3", "audio-bytes");
    await seed("job-half", {
      expiresAt: isoDaysFromNow(-1),
      r2Key: "transcription/uploads/t/left.mp3",
      transcript: false,
    });

    const outcome = await purgeExpiredTranscriptions(testEnv);
    expect(outcome.mediaDeleted).toBe(1);
    expect((await readRow("job-half")).source_r2_key).toBeNull();
    expect(await testEnv.MEDIA.head("transcription/uploads/t/left.mp3")).toBeNull();
  });

  it("honours the injected clock rather than the ambient one", async () => {
    await seed("job-tomorrow", { expiresAt: isoDaysFromNow(1) });

    expect((await purgeExpiredTranscriptions(testEnv)).purged).toBe(0);
    const later = new Date(Date.now() + 2 * DAY_MS);
    expect((await purgeExpiredTranscriptions(testEnv, { now: later })).purged).toBe(1);
  });

  // The regression that matters most in this file. D1 refuses more than 100 bound
  // parameters in one statement, and the purge binds one per row, so a batch size
  // above that made the whole sweep throw — deleting NOTHING — the first day more
  // than a hundred transcripts expired together. Steady state for any real usage
  // is well past a hundred a day, so this is the normal case, not the edge one.
  //
  // THIS is the assertion that fails on a return to 200. The bulk test below
  // cannot catch it: it sizes its fixture off the constant, so raising the
  // constant raises the fixture with it and the batch count is unchanged. And the
  // limit itself is never exercised here — these tests run against miniflare's
  // SQLite, whose variable ceiling is ~32k, not D1's documented 100. So the bound
  // is pinned directly, as a number, rather than left to a comment.
  it("stays under D1's 100-bound-parameter ceiling, which the purge binds one of per row", () => {
    expect(TRANSCRIPTION_PURGE_BATCH_SIZE).toBeLessThanOrEqual(100);
  });

  it("clears every expired row when far more than one D1 parameter batch is due", async () => {
    const total = TRANSCRIPTION_PURGE_BATCH_SIZE * 2 + 11;
    const statements = Array.from({ length: total }, (_unused, index) =>
      seedStatement(`bulk-${index}`, { expiresAt: isoDaysFromNow(-1) })
    );
    await testEnv.DB.batch(statements);

    const outcome = await purgeExpiredTranscriptions(testEnv);

    expect(outcome.purged).toBe(total);
    expect(outcome.batches).toBe(3);
    expect(outcome.truncated).toBe(false);
    const left = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM transcription_jobs WHERE result_payload IS NOT NULL"
    ).first<{ n: number }>();
    expect(left?.n).toBe(0);
  });

  // A job that never completed never gets an `expires_at`, so the deadline branch
  // can never reach it — and the teacher's uploaded recording would sit in R2
  // forever. No bucket lifecycle rule covers this data.
  it("deletes the upload of a job that failed, even though it has no deadline", async () => {
    await testEnv.MEDIA.put("transcription/uploads/leak/old.mp3", "audio-bytes");
    await seed("job-failed-old", {
      expiresAt: null,
      r2Key: "transcription/uploads/leak/old.mp3",
      transcript: false,
      status: "failed",
      createdDaysAgo: 90,
    });

    const outcome = await purgeExpiredTranscriptions(testEnv);

    expect(outcome.mediaDeleted).toBe(1);
    expect((await readRow("job-failed-old")).source_r2_key).toBeNull();
    expect(await testEnv.MEDIA.head("transcription/uploads/leak/old.mp3")).toBeNull();
    // The row survives, as it does on the deadline branch.
    expect((await readRow("job-failed-old")).status).toBe("failed");
  });

  it("leaves the upload of a job that failed yesterday alone", async () => {
    await testEnv.MEDIA.put("transcription/uploads/leak/fresh.mp3", "audio-bytes");
    await seed("job-failed-fresh", {
      expiresAt: null,
      r2Key: "transcription/uploads/leak/fresh.mp3",
      transcript: false,
      status: "failed",
      createdDaysAgo: 1,
    });

    expect((await purgeExpiredTranscriptions(testEnv)).purged).toBe(0);
    expect((await readRow("job-failed-fresh")).source_r2_key).toBe(
      "transcription/uploads/leak/fresh.mp3"
    );
    expect(await testEnv.MEDIA.head("transcription/uploads/leak/fresh.mp3")).not.toBeNull();
  });
});

describe("runTranscriptionRetentionSweep", () => {
  beforeEach(resetDb);

  it("reports what it did", async () => {
    await seed("job-swept", { expiresAt: isoDaysFromNow(-1) });
    expect((await runTranscriptionRetentionSweep(testEnv)).purged).toBe(1);
  });

  // A swallowed failure is why a broken sweep could delete nothing for months
  // while the cron invocation kept reporting success. The throw IS the alert.
  it("rethrows so the cron invocation is recorded as failed", async () => {
    await testEnv.DB.prepare("DROP TABLE transcription_jobs").run();
    await expect(runTranscriptionRetentionSweep(testEnv)).rejects.toThrow();
  });
});
