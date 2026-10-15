import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../index";
import type { Env } from "../env";
import { createSession, type SessionData } from "../lib/session";
import { PCM_BYTES_PER_SECOND } from "../lib/audio-config";
import { getAudioQuotaBalance } from "../lib/audio-quota";
import { PREVIEW_DIALOGUE_MAX_CHARS, PREVIEW_MONOLOGUE_MAX_CHARS } from "../lib/audio-preview-excerpt";
import { PREVIEW_DAILY_LIMIT, PREVIEW_MONTHLY_LIMIT } from "../lib/audio-preview";
import { reservePreview } from "../lib/tts-usage";

const testEnv = env as unknown as Env;

const SCHEMA = [
  "PRAGMA foreign_keys = OFF",
  "DROP TABLE IF EXISTS tts_usage_log",
  "DROP TABLE IF EXISTS quota_ledger",
  "DROP TABLE IF EXISTS credit_balances",
  "DROP TABLE IF EXISTS audio_segments",
  "DROP TABLE IF EXISTS audio_jobs",
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
  `CREATE TABLE audio_jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    quality TEXT NOT NULL,
    title TEXT,
    script_raw TEXT NOT NULL,
    direction_json TEXT NOT NULL,
    voices_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    estimated_seconds INTEGER NOT NULL,
    actual_seconds INTEGER,
    error TEXT,
    model_used TEXT,
    gen_ms INTEGER,
    retry_count INTEGER NOT NULL DEFAULT 0,
    api_cost_usd REAL,
    r2_prefix TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE audio_segments (
    job_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    duration_seconds REAL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error_status INTEGER,
    model_used TEXT,
    r2_key TEXT,
    PRIMARY KEY (job_id, idx)
  )`,
  `CREATE TABLE quota_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    delta_seconds INTEGER NOT NULL,
    source TEXT NOT NULL,
    reason TEXT NOT NULL,
    job_id TEXT,
    stripe_ref TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE credit_balances (
    user_id TEXT PRIMARY KEY,
    seconds INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE tts_usage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('preview','full')),
    status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('pending','ok','failed')),
    model TEXT,
    audio_seconds REAL NOT NULL DEFAULT 0,
    chars_sent INTEGER NOT NULL DEFAULT 0,
    cache_hit INTEGER NOT NULL DEFAULT 0 CHECK (cache_hit IN (0, 1)),
    job_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX idx_tts_usage_user ON tts_usage_log(user_id, kind, created_at)",
];

const USER_ID = "preview-user";
const DIRECTION = {
  level: "B1",
  accent: "Neutral",
  pace: "Natural classroom speed",
  style: "Informal conversation",
};
const SENTENCE = "Nous avons rendez-vous devant la gare à neuf heures et demie demain matin.";

interface SpeechCall {
  model: string;
  input: string;
  voice: string;
}

let speechCalls: SpeechCall[] = [];

// Every OpenRouter speech request answers one second of silent PCM.
function stubSpeechProvider() {
  speechCalls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).includes("openrouter.ai/api/v1/audio/speech")) {
      speechCalls.push(JSON.parse(String(init?.body)) as SpeechCall);
      return new Response(new Uint8Array(PCM_BYTES_PER_SECOND), {
        headers: { "Content-Type": "audio/pcm" },
      });
    }
    throw new Error(`Unexpected fetch in test: ${String(url)}`);
  }));
}

async function clearPreviewCache() {
  const listed = await testEnv.MEDIA.list({ prefix: "audio/previews/" });
  if (listed.objects.length > 0) await testEnv.MEDIA.delete(listed.objects.map((object) => object.key));
}

async function resetAll() {
  for (const statement of SCHEMA) await testEnv.DB.prepare(statement).run();
  const keys = testEnv as unknown as { GEMINI_API_KEY?: string; OPENROUTER_API_KEY?: string };
  keys.GEMINI_API_KEY = "test-gemini-key";
  keys.OPENROUTER_API_KEY = "test-openrouter-key";
  await testEnv.DB.prepare(
    "INSERT INTO users (id, email, name, password_hash, tier) VALUES (?, ?, 'Preview', 'hash', 'participant')"
  ).bind(USER_ID, `${USER_ID}@example.com`).run();
  await testEnv.DB.prepare("INSERT INTO credit_balances (user_id, seconds) VALUES (?, 600)").bind(USER_ID).run();
  await clearPreviewCache();
}

async function cookie(): Promise<string> {
  const session: SessionData = {
    userId: USER_ID,
    email: `${USER_ID}@example.com`,
    role: "teacher",
    languagePreference: "fr",
    createdAt: Date.now(),
  };
  return `promptomatik_session=${await createSession(testEnv, session)}`;
}

async function post(path: string, body: unknown): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`https://promptomatik.test${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: await cookie() },
      body: JSON.stringify(body),
    }),
    testEnv,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return res;
}

function monologueBody(script: string) {
  return { mode: "monologue", script, direction: DIRECTION, voices: { solo: "Kore" } };
}

function longDialogue(): string {
  const lines = Array.from({ length: 30 }, (_, index) =>
    `Speaker ${(index % 2) + 1}: ${SENTENCE} ${SENTENCE} ${SENTENCE}`
  );
  return lines.join("\n");
}

function dialogueBody(script: string) {
  return {
    mode: "dialogue",
    script,
    direction: DIRECTION,
    voices: { "Speaker 1": "Kore", "Speaker 2": "Puck" },
  };
}

async function usageRows() {
  const { results } = await testEnv.DB.prepare(
    "SELECT user_id, kind, status, model, audio_seconds, chars_sent, cache_hit, created_at FROM tts_usage_log ORDER BY id"
  ).all<{
    user_id: string;
    kind: string;
    status: string;
    model: string | null;
    audio_seconds: number;
    chars_sent: number;
    cache_hit: number;
    created_at: string;
  }>();
  return results;
}

describe("POST /api/audio/preview", () => {
  beforeEach(async () => {
    await resetAll();
    stubSpeechProvider();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("voices only the excerpt of a 5,000-character monologue", async () => {
    const script = Array.from({ length: 70 }, () => SENTENCE).join(" ");
    expect(script.length).toBeGreaterThan(5_000);

    const res = await post("/api/audio/preview", monologueBody(script));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
    const sent = speechCalls.map((call) => call.input).join(" ");
    expect(sent.length).toBeLessThanOrEqual(PREVIEW_MONOLOGUE_MAX_CHARS);
    expect(script.startsWith(sent)).toBe(true);
  });

  it("voices only the opening turns of a 5,000-character dialogue, each voice heard", async () => {
    const script = longDialogue();
    expect(script.length).toBeGreaterThan(5_000);

    const res = await post("/api/audio/preview", dialogueBody(script));

    expect(res.status).toBe(200);
    const sentChars = speechCalls.reduce((sum, call) => sum + call.input.length, 0);
    expect(sentChars).toBeLessThanOrEqual(PREVIEW_DIALOGUE_MAX_CHARS);
    expect(new Set(speechCalls.map((call) => call.voice))).toEqual(new Set(["Kore", "Puck"]));
  });

  it("leaves the monthly quota and the credits untouched", async () => {
    const before = await getAudioQuotaBalance(testEnv, USER_ID);
    const res = await post("/api/audio/preview", monologueBody(SENTENCE));
    expect(res.status).toBe(200);
    const after = await getAudioQuotaBalance(testEnv, USER_ID);

    expect(after.includedRemaining).toBe(before.includedRemaining);
    expect(after.credits).toBe(before.credits);
    const ledger = await testEnv.DB.prepare("SELECT COUNT(*) AS n FROM quota_ledger").first<{ n: number }>();
    expect(ledger?.n).toBe(0);
  });

  it("serves an identical second preview from the cache without a model call or a count", async () => {
    const first = await post("/api/audio/preview", dialogueBody("Speaker 1: Salut !\nSpeaker 2: Bonjour."));
    expect(first.headers.get("X-Preview-Cached")).toBe("0");
    expect(first.headers.get("X-Preview-Daily-Used")).toBe("1");
    const callsAfterFirst = speechCalls.length;

    const second = await post("/api/audio/preview", dialogueBody("Speaker 1: Salut !\nSpeaker 2: Bonjour."));

    expect(second.status).toBe(200);
    expect(second.headers.get("X-Preview-Cached")).toBe("1");
    expect(second.headers.get("X-Preview-Daily-Used")).toBe("1");
    expect(speechCalls.length).toBe(callsAfterFirst);
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(new Uint8Array(await first.arrayBuffer()));
  });

  it("refuses past the daily cap with its code, and a full take still goes through", async () => {
    const statements = Array.from({ length: PREVIEW_DAILY_LIMIT }, () =>
      testEnv.DB.prepare("INSERT INTO tts_usage_log (user_id, kind, status) VALUES (?, 'preview', 'ok')").bind(USER_ID)
    );
    await testEnv.DB.batch(statements);

    const refused = await post("/api/audio/preview", monologueBody(SENTENCE));
    expect(refused.status).toBe(429);
    const body = await refused.json<{ code: string; dailyUsed: number; dailyLimit: number }>();
    expect(body.code).toBe("preview_daily_limit");
    expect(body.dailyUsed).toBe(PREVIEW_DAILY_LIMIT);
    expect(body.dailyLimit).toBe(PREVIEW_DAILY_LIMIT);
    expect(speechCalls).toHaveLength(0);
    // The refused request gave its place back.
    const pending = await testEnv.DB.prepare("SELECT COUNT(*) AS n FROM tts_usage_log WHERE status = 'pending'")
      .first<{ n: number }>();
    expect(pending?.n).toBe(0);

    const full = await post("/api/audio/jobs", { ...monologueBody(SENTENCE), quality: "final" });
    expect(full.status).toBe(202);
  });

  it("logs each TTS request with user, kind, model, seconds, characters and cache hit", async () => {
    await post("/api/audio/preview", monologueBody(SENTENCE));
    await post("/api/audio/preview", monologueBody(SENTENCE));

    const rows = await usageRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      user_id: USER_ID,
      kind: "preview",
      status: "ok",
      model: "google/gemini-3.8-flash-tts",
      audio_seconds: 1,
      chars_sent: SENTENCE.length,
      cache_hit: 0,
    });
    expect(rows[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(rows[1]).toMatchObject({ kind: "preview", status: "ok", cache_hit: 1, audio_seconds: 1, chars_sent: 0 });
  });

  it("rejects a script that a full take would reject, before any model call", async () => {
    const res = await post("/api/audio/preview", monologueBody("   "));
    expect(res.status).toBe(400);
    expect(speechCalls).toHaveLength(0);
    expect(await usageRows()).toHaveLength(0);
  });

  it("gives the place back when every model fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "nope" } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })));

    const res = await post("/api/audio/preview", monologueBody(SENTENCE));

    expect(res.status).toBe(502);
    expect((await res.json<{ code: string }>()).code).toBe("audio_preview_failed");
    const rows = await usageRows();
    expect(rows.every((row) => row.status === "failed")).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("preview caps", () => {
  beforeEach(resetAll);

  it("counts only model-voiced, non-failed previews of the current month", async () => {
    const now = new Date("2026-10-15T12:00:00Z");
    const insert = (createdAt: string, extra = "") =>
      testEnv.DB.prepare(
        `INSERT INTO tts_usage_log (user_id, kind, status, cache_hit, created_at) VALUES (?, 'preview', ${extra || "'ok', 0"}, ?)`
      ).bind(USER_ID, createdAt);
    await testEnv.DB.batch([
      ...Array.from({ length: PREVIEW_MONTHLY_LIMIT }, () => insert("2026-10-02 09:00:00")),
      insert("2026-09-30 23:00:00"),
      insert("2026-10-15 08:00:00", "'ok', 1"),
      insert("2026-10-15 08:00:00", "'failed', 0"),
    ]);

    const refused = await reservePreview(testEnv.DB, USER_ID, 10, { daily: 30, monthly: PREVIEW_MONTHLY_LIMIT }, now);
    expect(refused).toMatchObject({
      ok: false,
      reason: "preview_monthly_limit",
      usage: { dailyUsed: 0, monthlyUsed: PREVIEW_MONTHLY_LIMIT },
    });

    const roomier = await reservePreview(testEnv.DB, USER_ID, 10, { daily: 30, monthly: PREVIEW_MONTHLY_LIMIT + 1 }, now);
    expect(roomier).toMatchObject({ ok: true, usage: { dailyUsed: 1, monthlyUsed: PREVIEW_MONTHLY_LIMIT + 1 } });
  });

  it("ranks parallel reservations so they cannot all slip under the cap", async () => {
    const limits = { daily: 2, monthly: 100 };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => reservePreview(testEnv.DB, USER_ID, 10, limits))
    );
    expect(results.filter((result) => result.ok)).toHaveLength(2);
  });
});
