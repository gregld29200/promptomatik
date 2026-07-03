import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../index";
import type { Env } from "../env";
import { createSession, type SessionData } from "./session";
import { renderMaterialHtml, presetForIndex } from "./documents/material-renderer";
import { callLLM } from "./documents/generate";
import {
  createDocumentJob,
  getDocumentJobForUser,
  processDocumentJob,
  validateDocumentRequest,
} from "./document-jobs";
import type { TransformMaterial } from "./documents/types";

const testEnv = env as unknown as Env;

const FULL_MATERIAL: TransformMaterial = {
  id: "material-test-0",
  preset_id: "studio_academic",
  material_type: "comprehension_quiz",
  title: "Remote Work & <Trainers>",
  skill_focus: "reading",
  interaction_pattern: "individual",
  estimated_minutes: 20,
  blocks: [
    { type: "instructions", heading: "Before you read", text: "Read the text once.", bullets: ["Underline new words"], word_bank: ["fatigue", "batch"] },
    { type: "article", heading: "Reading", title: "The Modern Trainer", paragraphs: ["First paragraph about remote work.", "Second paragraph with details."] },
    { type: "questions", heading: "Questions", items: [{ prompt: "What changed?", answer: "Everything about scheduling." }] },
    { type: "reference_list", heading: "Vocabulary", items: [{ term: "batch", detail: "group tasks together", example: "I batch my admin." }] },
    { type: "matching", heading: "Match", pairs: [{ left: "fatigue", right: "tiredness" }, { left: "batch", right: "group" }] },
    { type: "fill_blanks", heading: "Gap fill", word_bank: ["batch"], items: [{ sentence: "I ____ my emails.", answer: "batch" }] },
    { type: "role_cards", heading: "Role play", cards: [
      { role: "Trainer", situation: "Overbooked week", goal: "Negotiate time", bullets: ["Stay calm"], prompts: ["Could we discuss..."] },
      { role: "Manager", situation: "High demand", goal: "Keep capacity" },
    ] },
    { type: "notes", heading: "Teacher notes", text: "Wrap up with reflection.", bullets: ["Ask for feedback"] },
  ],
};

describe("material renderer (ported)", () => {
  it("renders every block type with escaping, answer key, and TeachInspire branding", () => {
    const html = renderMaterialHtml(FULL_MATERIAL);

    expect(html).toContain("Remote Work &amp; &lt;Trainers&gt;");
    expect(html).toContain("The Modern Trainer");
    expect(html).toContain("What changed?");
    expect(html).toContain("Answer Key");
    expect(html).toContain("Everything about scheduling.");
    expect(html).toContain("fatigue");
    expect(html).toContain("Speaker A");
    expect(html).toContain("TeachInspire Studio");
    expect(html).not.toContain("RenderInspire");
    expect(html).toContain("page-break-inside: avoid");
  });

  it("maps preset order deterministically", () => {
    expect([0, 1, 2, 3].map(presetForIndex)).toEqual([
      "studio_academic",
      "modern_training",
      "warm_coaching",
      "studio_academic",
    ]);
  });
});

function llmResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

function validMaterialsJson(topic = "remote work for trainers"): string {
  const material = (type: string, skill: string, blocks: unknown[]) => ({
    material_type: type,
    title: `Working with ${topic}`,
    skill_focus: skill,
    interaction_pattern: "individual",
    estimated_minutes: 15,
    blocks,
  });
  return JSON.stringify({
    materials: [
      material("comprehension_quiz", "reading", [
        { type: "article", paragraphs: [`A text about ${topic}.`] },
        { type: "questions", items: [{ prompt: "Why?", answer: "Because." }] },
      ]),
      material("matching_exercise", "vocabulary", [
        { type: "matching", pairs: [{ left: "a", right: "b" }, { left: "c", right: "d" }] },
      ]),
      material("role_play_cards", "speaking", [
        { type: "role_cards", cards: [
          { role: "A", situation: "s", goal: "g" },
          { role: "B", situation: "s", goal: "g" },
        ] },
      ]),
    ],
  });
}

const REQUEST_CONTENT = [
  "Remote work has changed how language trainers organise their weeks and their energy.",
  "This source text discusses scheduling, fatigue, batching admin work, and protecting preparation time",
  "so that lessons stay high quality even in a demanding freelance context.",
].join(" ");

describe("documents LLM port", () => {
  it("parses fenced JSON, normalizes aliases, and returns 3 materials with presets", async () => {
    const fenced = "```json\n" + validMaterialsJson() + "\n```";
    const fetcher = (async () => llmResponse(fenced)) as typeof fetch;

    const result = await callLLM({ apiKey: "k", fetcher }, REQUEST_CONTENT, "Remote work");

    expect(result.materials).toHaveLength(3);
    expect(result.materials.map((m) => m.preset_id)).toEqual([
      "studio_academic",
      "modern_training",
      "warm_coaching",
    ]);
  });

  it("retries once on a wrong structure, then succeeds (source behavior)", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return llmResponse(calls === 1 ? '{"foo": []}' : validMaterialsJson());
    }) as typeof fetch;

    const result = await callLLM({ apiKey: "k", fetcher }, REQUEST_CONTENT, "Remote work");
    expect(calls).toBe(2);
    expect(result.materials).toHaveLength(3);
  });

  it("fails immediately on unparseable raw output (source behavior: no retry on non-JSON)", async () => {
    const fetcher = (async () => llmResponse("not json at all")) as typeof fetch;
    await expect(callLLM({ apiKey: "k", fetcher }, REQUEST_CONTENT)).rejects.toThrow(/invalid JSON/i);
  });
});

describe("document request validation", () => {
  it("rejects short and oversized content, accepts normal content", () => {
    expect(validateDocumentRequest({ content: "too short" })).toBe("content_too_short");
    expect(validateDocumentRequest({ content: Array.from({ length: 40 }, () => "word").join(" ") })).toBeNull();
    expect(validateDocumentRequest({ content: "word ".repeat(31).padEnd(15_001, "x") })).toBe("content_too_long");
  });
});

const TEST_SCHEMA = [
  "PRAGMA foreign_keys = OFF",
  "DROP TABLE IF EXISTS document_jobs",
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
  `CREATE TABLE document_jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued'
      CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    request_payload TEXT NOT NULL,
    result_payload TEXT,
    error_message TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];

async function resetDb() {
  for (const statement of TEST_SCHEMA) {
    await testEnv.DB.prepare(statement).run();
  }
}

async function seedUser(userId: string, tier: "free" | "participant") {
  await testEnv.DB.prepare(
    `INSERT INTO users (id, email, name, password_hash, tier)
     VALUES (?, ?, 'Docs Tester', 'hash', ?)`
  ).bind(userId, `${userId}@example.com`, tier).run();
}

describe("document jobs lifecycle", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates, processes with an injected generator, and completes", async () => {
    await seedUser("writer", "participant");
    const jobId = await createDocumentJob(testEnv, "writer", { content: REQUEST_CONTENT });

    await processDocumentJob(testEnv, jobId, async () => ({
      materials: [{ ...FULL_MATERIAL }],
    }));

    const job = await getDocumentJobForUser(testEnv, jobId, "writer");
    expect(job?.status).toBe("completed");
    expect(job?.result?.materials).toHaveLength(1);
    expect(job?.error).toBeNull();
  });

  it("marks the job failed with the generator error message", async () => {
    await seedUser("writer", "participant");
    const jobId = await createDocumentJob(testEnv, "writer", { content: REQUEST_CONTENT });

    await processDocumentJob(testEnv, jobId, async () => {
      throw new Error("AI generation failed after validation retries.");
    });

    const job = await getDocumentJobForUser(testEnv, jobId, "writer");
    expect(job?.status).toBe("failed");
    expect(job?.error).toMatch(/validation retries/);
  });

  it("hides jobs from other users", async () => {
    await seedUser("writer", "participant");
    await seedUser("other", "participant");
    const jobId = await createDocumentJob(testEnv, "writer", { content: REQUEST_CONTENT });
    expect(await getDocumentJobForUser(testEnv, jobId, "other")).toBeNull();
  });
});

describe("documents routes", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function fetchAs(userId: string, path: string, init?: RequestInit) {
    const session: SessionData = {
      userId,
      email: `${userId}@example.com`,
      role: "teacher",
      languagePreference: "fr",
      createdAt: Date.now(),
    };
    const sessionId = await createSession(testEnv, session);
    const request = new Request(`https://promptomatik.test${path}`, {
      ...init,
      headers: { Cookie: `promptomatik_session=${sessionId}`, "Content-Type": "application/json" },
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    return response;
  }

  it("keeps transform behind the participant tier", async () => {
    await seedUser("free-user", "free");
    const response = await fetchAs("free-user", "/api/documents/transform", {
      method: "POST",
      body: JSON.stringify({ content: REQUEST_CONTENT }),
    });
    expect(response.status).toBe(403);
  });

  it("accepts a valid transform request and exposes the job to polling", async () => {
    await seedUser("participant-user", "participant");
    const response = await fetchAs("participant-user", "/api/documents/transform", {
      method: "POST",
      body: JSON.stringify({ content: REQUEST_CONTENT }),
    });
    expect(response.status).toBe(202);
    const { jobId } = await response.json() as { jobId: string };

    const poll = await fetchAs("participant-user", `/api/documents/jobs/${jobId}`);
    expect(poll.status).toBe(200);
    await expect(poll.json()).resolves.toMatchObject({ job: { id: jobId, status: "queued" } });
  });

  it("rejects short content with a stable error code", async () => {
    await seedUser("participant-user", "participant");
    const response = await fetchAs("participant-user", "/api/documents/transform", {
      method: "POST",
      body: JSON.stringify({ content: "way too short" }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "content_too_short" });
  });
});
