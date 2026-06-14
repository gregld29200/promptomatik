import { Hono } from "hono";
import type { Env } from "../env";
import { requireAuth, requireParticipant } from "../lib/auth-middleware";
import type { SessionData } from "../lib/session";
import {
  createInterviewJob,
  enqueueInterviewJob,
  failInterviewJob,
} from "../lib/interview-jobs";
import { normalizeLanguage } from "../lib/language";
import { getUserTier, type Tier } from "../lib/tier";
import {
  DAILY_INTERVIEW_LIMIT,
  getInterviewQuotaUsed,
  incrementInterviewQuota,
  nextUtcMidnightIso,
} from "../lib/quota";
import type {
  IntentAnalysis,
} from "../lib/llm/types";

type InterviewEnv = { Bindings: Env; Variables: { session: SessionData } };

const interview = new Hono<InterviewEnv>();

interview.use("/*", requireAuth);

// Resolved at enqueue time and stored in the job payload — the queue
// consumer must not re-query tier at consume time.
async function resolveTier(db: D1Database, session: SessionData): Promise<Tier> {
  if (session.role === "admin") return "participant";
  return getUserTier(db, session.userId);
}

// POST /api/interview/analyze — Parse free text into structured intent
interview.post("/analyze", async (c) => {
  const { text, language } = await c.req.json<{
    text: string;
    language: string;
  }>();

  if (!text || text.trim().length < 10) {
    return c.json({ error: "Please describe what you need in a bit more detail." }, 400);
  }

  const lang = normalizeLanguage(language);
  const session = c.get("session");
  const tier = await resolveTier(c.env.DB, session);

  // Quota is enforced here only — questions/assemble belong to an interview
  // already admitted; blocking later would waste the LLM calls already paid for.
  if (tier !== "participant") {
    const used = await getInterviewQuotaUsed(c.env, session.userId);
    if (used >= DAILY_INTERVIEW_LIMIT) {
      return c.json(
        {
          error: "daily_quota",
          limit: DAILY_INTERVIEW_LIMIT,
          resets_at: nextUtcMidnightIso(),
        },
        429
      );
    }
    await incrementInterviewQuota(c.env, session.userId);
  }

  const job = await createInterviewJob(c.env.DB, session.userId, "analyze", {
    text: text.trim(),
    language: lang,
    tier,
  });

  try {
    await enqueueInterviewJob(c.env, job.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to queue intent analysis.";
    await failInterviewJob(c.env.DB, job.id, message);
    return c.json({ error: message }, 502);
  }

  return c.json({ job }, 202);
});

// POST /api/interview/questions — Generate adaptive follow-up questions
interview.post("/questions", async (c) => {
  const { intent, language } = await c.req.json<{
    intent: IntentAnalysis;
    language: string;
  }>();

  if (!intent) {
    return c.json({ error: "Intent analysis is required." }, 400);
  }

  // No missing fields? No questions needed.
  if (!intent.missing_fields || intent.missing_fields.length === 0) {
    return c.json({ questions: [] });
  }

  const lang = normalizeLanguage(language);
  const session = c.get("session");
  const tier = await resolveTier(c.env.DB, session);
  const job = await createInterviewJob(c.env.DB, session.userId, "questions", {
    intent,
    language: lang,
    tier,
  });

  try {
    await enqueueInterviewJob(c.env, job.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to queue question generation.";
    await failInterviewJob(c.env.DB, job.id, message);
    return c.json({ error: message }, 502);
  }

  return c.json({ job }, 202);
});

// POST /api/interview/assemble — Generate the final structured prompt
interview.post("/assemble", async (c) => {
  const { intent, answers, original_text, language } = await c.req.json<{
    intent: IntentAnalysis;
    answers: Record<string, string>;
    original_text: string;
    language: string;
  }>();

  if (!intent || !original_text) {
    return c.json({ error: "Intent and original text are required." }, 400);
  }

  const lang = normalizeLanguage(language);
  const session = c.get("session");
  const tier = await resolveTier(c.env.DB, session);
  const job = await createInterviewJob(c.env.DB, session.userId, "assemble", {
    intent,
    answers: answers ?? {},
    original_text,
    language: lang,
    tier,
  });

  try {
    await enqueueInterviewJob(c.env, job.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to queue prompt generation.";
    await failInterviewJob(c.env.DB, job.id, message);
    return c.json({ error: message }, 502);
  }

  return c.json({ job }, 202);
});

// POST /api/interview/refine — Refine an existing prompt based on teacher feedback
interview.post("/refine", requireParticipant, async (c) => {
  const { promptId, issueType, issueDescription, outputSample, language } =
    await c.req.json<{
      promptId: string;
      issueType: string;
      issueDescription?: string;
      outputSample?: string;
      language: string;
    }>();

  if (!promptId || !issueType) {
    return c.json({ error: "Prompt ID and issue type are required." }, 400);
  }

  const session = c.get("session");
  const lang = normalizeLanguage(language);

  const existingPrompt = await c.env.DB.prepare(
    "SELECT id FROM prompts WHERE id = ? AND user_id = ?"
  )
    .bind(promptId, session.userId)
    .first<{ id: string }>();

  if (!existingPrompt) {
    return c.json({ error: "Prompt not found." }, 404);
  }

  // refine is participant-gated, but resolve anyway so the payload stays uniform
  const tier = await resolveTier(c.env.DB, session);
  const job = await createInterviewJob(c.env.DB, session.userId, "refine", {
    promptId,
    issueType,
    issueDescription: issueDescription || undefined,
    outputSample: outputSample || undefined,
    language: lang,
    tier,
  });

  try {
    await enqueueInterviewJob(c.env, job.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to queue prompt refinement.";
    await failInterviewJob(c.env.DB, job.id, message);
    return c.json({ error: message }, 502);
  }

  return c.json({ job }, 202);
});

export { interview };
