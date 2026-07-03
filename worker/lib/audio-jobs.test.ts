import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../index";
import type { Env } from "../env";
import { createSession, type SessionData } from "./session";
import { AUDIO_INCLUDED_SECONDS_PER_MONTH } from "./audio-quota";
import { PCM_BYTES_PER_SECOND, getTtsModelConfig } from "./audio-config";
import { TtsProviderError } from "./tts-provider";
import {
  assembleAudioJob,
  createAudioJob,
  getAudioJobForUser,
  processAudioJob,
  type AudioGenerationProvider,
} from "./audio-jobs";

const testEnv = env as unknown as Env;

const TEST_SCHEMA_STATEMENTS = [
  "PRAGMA foreign_keys = OFF",
  "DROP TABLE IF EXISTS quota_ledger",
  "DROP TABLE IF EXISTS credit_balances",
  "DROP TABLE IF EXISTS audio_segments",
  "DROP TABLE IF EXISTS audio_jobs",
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
  `CREATE TABLE audio_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('monologue','dialogue')),
  quality TEXT NOT NULL CHECK (quality IN ('draft','final')),
  script_raw TEXT NOT NULL,
  direction_json TEXT NOT NULL,
  voices_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','generating','assembling','ready','failed')),
  estimated_seconds INTEGER NOT NULL,
  actual_seconds INTEGER,
  error TEXT,
  model_used TEXT,
  gen_ms INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  api_cost_usd REAL,
  r2_prefix TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)`,
  "CREATE INDEX idx_jobs_user ON audio_jobs(user_id, created_at DESC)",
  `CREATE TABLE audio_segments (
  job_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','ok','failed')),
  duration_seconds REAL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error_status INTEGER,
  model_used TEXT,
  r2_key TEXT,
  PRIMARY KEY (job_id, idx),
  FOREIGN KEY (job_id) REFERENCES audio_jobs(id) ON DELETE CASCADE
)`,
  `CREATE TABLE quota_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  delta_seconds INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('included','credit')),
  reason TEXT NOT NULL CHECK (reason IN ('generation','regeneration','credit_grant','admin_adjust')),
  job_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES audio_jobs(id) ON DELETE SET NULL
)`,
  `CREATE TABLE credit_balances (
  user_id TEXT PRIMARY KEY,
  seconds INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
)`,
];

async function resetDb() {
  for (const statement of TEST_SCHEMA_STATEMENTS) {
    await testEnv.DB.prepare(statement).run();
  }
  (testEnv as unknown as { GEMINI_API_KEY: string }).GEMINI_API_KEY = "test-gemini-key";
}

async function seedParticipant(userId: string) {
  await testEnv.DB.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, language_preference, tier)
     VALUES (?, ?, 'Audio Tester', 'hash', 'teacher', 'fr', 'participant')`
  )
    .bind(userId, `${userId}@example.com`)
    .run();
}

function pcm(seconds: number): Uint8Array {
  return new Uint8Array(PCM_BYTES_PER_SECOND * seconds);
}

function providerWithSeconds(seconds: number): AudioGenerationProvider {
  return {
    async generateBlock() {
      return {
        pcm: pcm(seconds),
        durationSeconds: seconds,
        retryCount: 0,
        model: "test-model",
      };
    },
  };
}

function failingProvider(): AudioGenerationProvider {
  return {
    async generateBlock() {
      throw new Error("Synthetic TTS failure.");
    },
  };
}

function words(count: number): string {
  return Array.from({ length: count }, (_, index) => `word${index}`).join(" ");
}

async function ledgerRows(jobId: string) {
  const { results } = await testEnv.DB.prepare(
    "SELECT source, reason, delta_seconds FROM quota_ledger WHERE job_id = ? ORDER BY id"
  )
    .bind(jobId)
    .all<{ source: string; reason: string; delta_seconds: number }>();
  return results;
}

async function createBasicJob(userId: string, script = "Bonjour tout le monde.") {
  return createAudioJob(testEnv, {
    userId,
    mode: "monologue",
    quality: "draft",
    script,
    direction: {
      level: "A2",
      accent: "Slow classroom French",
      pace: "Slow learner-friendly",
      style: "Warm and encouraging",
    },
    voices: { solo: "Kore" },
  });
}

async function sessionCookie(userId: string) {
  const session: SessionData = {
    userId,
    email: `${userId}@example.com`,
    role: "teacher",
    languagePreference: "fr",
    createdAt: Date.now(),
  };
  const sessionId = await createSession(testEnv, session);
  return `promptomatik_session=${sessionId}`;
}

describe("audio job lifecycle", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("processes a job to ready, stores downloads, and charges actual seconds", async () => {
    const userId = "happy-user";
    await seedParticipant(userId);
    const job = await createBasicJob(userId);

    await processAudioJob(testEnv, job.id, providerWithSeconds(2));
    await assembleAudioJob(testEnv, job.id);

    const row = await testEnv.DB.prepare(
      "SELECT status, actual_seconds, retry_count, api_cost_usd FROM audio_jobs WHERE id = ?"
    )
      .bind(job.id)
      .first<{ status: string; actual_seconds: number; retry_count: number; api_cost_usd: number }>();
    const mp3 = await testEnv.MEDIA.get(`audio/${job.id}/final.mp3`);
    const wav = await testEnv.MEDIA.get(`audio/${job.id}/final.wav`);
    const transcript = await testEnv.MEDIA.get(`audio/${job.id}/transcript.txt`);
    const peaks = await testEnv.MEDIA.get(`audio/${job.id}/peaks.json`);
    const readyJob = await getAudioJobForUser(testEnv, job.id, userId);

    expect(row).toMatchObject({ status: "ready", actual_seconds: 2, retry_count: 0 });
    expect(row?.api_cost_usd).toBeGreaterThan(0);
    expect(mp3).not.toBeNull();
    expect(wav).not.toBeNull();
    expect(peaks).not.toBeNull();
    expect(readyJob?.waveform?.peaks).toHaveLength(200);
    expect(readyJob?.waveform?.blocks).toEqual([
      { idx: 0, startSeconds: 0, endSeconds: 2, durationSeconds: 2 },
    ]);
    expect(await transcript?.text()).toContain("Bonjour");
    expect(await ledgerRows(job.id)).toEqual([
      { source: "included", reason: "generation", delta_seconds: -2 },
    ]);
  });

  it("falls back to the next model when the primary is rate-limited (429)", async () => {
    const userId = "fallback-user";
    await seedParticipant(userId);
    const job = await createBasicJob(userId);

    const config = getTtsModelConfig(testEnv);
    const attempted: string[] = [];
    const provider: AudioGenerationProvider = {
      async generateBlock(input) {
        attempted.push(input.model);
        // The monologue primary (3.1 Flash) is over quota; the 2.5 Flash
        // fallback has headroom.
        if (input.model === config.monologueModel) {
          throw new TtsProviderError("Rate limited.", true, 429);
        }
        return { pcm: pcm(2), durationSeconds: 2, retryCount: 0, model: input.model };
      },
    };

    await processAudioJob(testEnv, job.id, provider);
    await assembleAudioJob(testEnv, job.id);

    const row = await testEnv.DB.prepare("SELECT status FROM audio_jobs WHERE id = ?")
      .bind(job.id)
      .first<{ status: string }>();
    const segment = await testEnv.DB.prepare(
      "SELECT status, model_used FROM audio_segments WHERE job_id = ? AND idx = 0"
    )
      .bind(job.id)
      .first<{ status: string; model_used: string }>();

    expect(attempted).toEqual([config.monologueModel, config.draftModel]);
    expect(row?.status).toBe("ready");
    expect(segment?.model_used).toBe(config.draftModel);
  });

  it("marks a failed block failed and does not charge quota", async () => {
    const userId = "failed-user";
    await seedParticipant(userId);
    const job = await createBasicJob(userId);

    await processAudioJob(testEnv, job.id, failingProvider());

    const row = await testEnv.DB.prepare("SELECT status, error FROM audio_jobs WHERE id = ?")
      .bind(job.id)
      .first<{ status: string; error: string }>();
    const segment = await testEnv.DB.prepare(
      "SELECT status FROM audio_segments WHERE job_id = ? AND idx = 0"
    )
      .bind(job.id)
      .first<{ status: string }>();
    expect(row).toMatchObject({ status: "failed", error: "Synthetic TTS failure." });
    expect(segment?.status).toBe("failed");
    expect(await ledgerRows(job.id)).toEqual([]);
  });

  it("fails malformed dialogue before any TTS provider call", async () => {
    const userId = "guard-user";
    await seedParticipant(userId);
    const job = await createAudioJob(testEnv, {
      userId,
      mode: "dialogue",
      quality: "draft",
      script: "Speaker 1: Bonjour.\nSpeaker 2: Salut.",
      direction: {
        level: "A2",
        accent: "Slow classroom French",
        pace: "Slow learner-friendly",
        style: "Warm and encouraging",
      },
      voices: {
        "Speaker 1": "Kore",
        "Speaker 2": "Puck",
      },
    });
    await testEnv.DB.prepare("UPDATE audio_segments SET text = ? WHERE job_id = ? AND idx = 0")
      .bind("Marie: Bonjour.\nSpeaker 2: Salut.", job.id)
      .run();
    let calls = 0;

    await processAudioJob(testEnv, job.id, {
      async generateBlock() {
        calls += 1;
        return {
          pcm: pcm(1),
          durationSeconds: 1,
          retryCount: 0,
          model: "test-model",
        };
      },
    });

    const row = await testEnv.DB.prepare("SELECT status, error FROM audio_jobs WHERE id = ?")
      .bind(job.id)
      .first<{ status: string; error: string }>();
    expect(calls).toBe(0);
    expect(row?.status).toBe("failed");
    expect(row?.error).toContain("Dialogue transcript must use only");
    expect(await ledgerRows(job.id)).toEqual([]);
  });

  it("resumes redelivered jobs by skipping completed segments", async () => {
    const userId = "resume-user";
    await seedParticipant(userId);
    const job = await createBasicJob(userId, `${words(100)}. ${words(100)}. ${words(100)}.`);
    let calls = 0;
    const firstKey = `audio/${job.id}/seg-0.pcm`;
    await testEnv.MEDIA.put(firstKey, pcm(1));
    await testEnv.DB.prepare(
      "UPDATE audio_segments SET status = 'ok', duration_seconds = 1, r2_key = ? WHERE job_id = ? AND idx = 0"
    )
      .bind(firstKey, job.id)
      .run();

    await processAudioJob(testEnv, job.id, {
      async generateBlock() {
        calls += 1;
        return {
          pcm: pcm(1),
          durationSeconds: 1,
          retryCount: 0,
          model: "test-model",
        };
      },
    });
    await assembleAudioJob(testEnv, job.id);

    expect(calls).toBe(1);
    const row = await testEnv.DB.prepare("SELECT status FROM audio_jobs WHERE id = ?")
      .bind(job.id)
      .first<{ status: string }>();
    expect(row?.status).toBe("ready");
  });

  it("returns 403 for a foreign job", async () => {
    const ownerId = "owner-user";
    const foreignId = "foreign-user";
    await seedParticipant(ownerId);
    await seedParticipant(foreignId);
    const job = await createBasicJob(ownerId);
    const cookie = await sessionCookie(foreignId);
    const ctx = createExecutionContext();

    const response = await worker.fetch(
      new Request(`https://promptomatik.test/api/audio/jobs/${job.id}`, {
        headers: { Cookie: cookie },
      }),
      testEnv,
      ctx
    );
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(403);
  });

  it("creates an audio job through the API", async () => {
    const userId = "api-create-user";
    await seedParticipant(userId);
    const cookie = await sessionCookie(userId);
    const ctx = createExecutionContext();

    const response = await worker.fetch(
      new Request("https://promptomatik.test/api/audio/jobs", {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: "monologue",
          quality: "draft",
          script: "Bonjour tout le monde.",
          direction: {
            level: "A2",
            accent: "Slow classroom French",
            pace: "Slow learner-friendly",
            style: "Warm and encouraging",
          },
          voices: { solo: "Kore" },
        }),
      }),
      testEnv,
      ctx
    );
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      estimatedSeconds: 2,
    });
  });

  it("blocks dialogue jobs with more than two speakers server-side", async () => {
    const userId = "api-speaker-user";
    await seedParticipant(userId);
    const cookie = await sessionCookie(userId);
    const ctx = createExecutionContext();

    const response = await worker.fetch(
      new Request("https://promptomatik.test/api/audio/jobs", {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: "dialogue",
          quality: "draft",
          script: [
            "Speaker 1: Bonjour.",
            "Speaker 2: Salut.",
            "Speaker 3: Bonsoir.",
          ].join("\n"),
          direction: {
            level: "A2",
            accent: "Slow classroom French",
            pace: "Slow learner-friendly",
            style: "Warm and encouraging",
          },
          voices: {
            "Speaker 1": "Kore",
            "Speaker 2": "Puck",
            "Speaker 3": "Charon",
          },
        }),
      }),
      testEnv,
      ctx
    );
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "2 speakers maximum in this version",
    });
  });

  it("returns the static voice catalog through the API", async () => {
    const userId = "voice-user";
    await seedParticipant(userId);
    const cookie = await sessionCookie(userId);
    const ctx = createExecutionContext();

    const response = await worker.fetch(
      new Request("https://promptomatik.test/api/audio/voices", {
        headers: { Cookie: cookie },
      }),
      testEnv,
      ctx
    );
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const body = await response.json<{ voices: { name: string; descriptor: string; previewUrl: string }[] }>();
    expect(body.voices).toHaveLength(30);
    expect(body.voices[0]).toMatchObject({
      name: "Zephyr",
      descriptor: "Bright",
      previewUrl: "/api/audio/voices/Zephyr/preview",
    });
  });
});
