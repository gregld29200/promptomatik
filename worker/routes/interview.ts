import { Hono } from "hono";
import type { Env } from "../env";
import { requireAuth } from "../lib/auth-middleware";
import type { SessionData } from "../lib/session";
import { chatCompletion } from "../lib/openrouter";
import {
  intentAnalysisPrompt,
  interviewQuestionsPrompt,
  promptAssemblyPrompt,
  promptRefinementPrompt,
} from "../lib/llm/prompts";
import type {
  IntentAnalysis,
  InterviewQuestion,
  AssembledPrompt,
  AssembleResult,
  RefinedPrompt,
} from "../lib/llm/types";
import type { TeacherProfile } from "./profile";

type InterviewEnv = { Bindings: Env; Variables: { session: SessionData } };

const interview = new Hono<InterviewEnv>();

interview.use("/*", requireAuth);

function normalizeQuestion(q: InterviewQuestion): InterviewQuestion {
  const anyQ = q as unknown as {
    options?: unknown;
    allow_other?: unknown;
    other_placeholder?: unknown;
    multi_select?: unknown;
    allow_freetext?: unknown;
  };

  const options = Array.isArray(anyQ.options) ? anyQ.options : [];
  const normalizedOptions = options
    .map((opt) => {
      if (typeof opt === "string") {
        return { label: opt, value: opt };
      }
      if (opt && typeof opt === "object") {
        const o = opt as { label?: unknown; value?: unknown; recommended?: unknown };
        const label = typeof o.label === "string" ? o.label : typeof o.value === "string" ? o.value : "";
        const value = typeof o.value === "string" ? o.value : typeof o.label === "string" ? o.label : "";
        const recommended = typeof o.recommended === "boolean" ? o.recommended : undefined;
        return { label, value, ...(recommended !== undefined ? { recommended } : {}) };
      }
      return { label: "", value: "" };
    })
    .filter((o) => o.label && o.value);

  return {
    ...q,
    options: normalizedOptions,
    multi_select: typeof anyQ.multi_select === "boolean" ? anyQ.multi_select : q.multi_select,
    allow_other: typeof anyQ.allow_other === "boolean"
      ? anyQ.allow_other
      : typeof anyQ.allow_freetext === "boolean"
        ? (anyQ.allow_freetext as boolean)
        : q.allow_other,
    other_placeholder: typeof anyQ.other_placeholder === "string" ? anyQ.other_placeholder : q.other_placeholder,
  };
}

function normalizeQuestions(questions: InterviewQuestion[]): InterviewQuestion[] {
  return Array.isArray(questions) ? questions.map(normalizeQuestion) : [];
}

async function fetchProfile(db: D1Database, userId: string): Promise<TeacherProfile | undefined> {
  const row = await db.prepare("SELECT profile FROM users WHERE id = ?")
    .bind(userId)
    .first<{ profile: string }>();
  if (!row) return undefined;
  const parsed = JSON.parse(row.profile) as TeacherProfile;
  return parsed.setup_completed ? parsed : undefined;
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

  const lang = language === "en" ? "en" : "fr";
  const session = c.get("session");
  const profile = await fetchProfile(c.env.DB, session.userId);

  const result = await chatCompletion<IntentAnalysis>(c.env.OPENROUTER_API_KEY, {
    messages: [
      { role: "system", content: intentAnalysisPrompt(lang, profile) },
      { role: "user", content: text.trim() },
    ],
    temperature: 0.3,
  });

  if (result.error) {
    const retry = await chatCompletion<IntentAnalysis>(c.env.OPENROUTER_API_KEY, {
      messages: [
        { role: "system", content: intentAnalysisPrompt(lang, profile) },
        { role: "user", content: text.trim() },
      ],
      temperature: 0.2,
    });
    if (retry.error) {
      return c.json({ error: retry.error }, 502);
    }
    return c.json({ intent: retry.data });
  }

  return c.json({ intent: result.data });
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

  const lang = language === "en" ? "en" : "fr";
  const session = c.get("session");
  const profile = await fetchProfile(c.env.DB, session.userId);

  const userMessage = `Here is the intent analysis:
${JSON.stringify(intent, null, 2)}

Missing fields to ask about: ${intent.missing_fields.join(", ")}

Generate questions ONLY for the missing fields listed above.`;

  const result = await chatCompletion<{ questions: InterviewQuestion[] }>(
    c.env.OPENROUTER_API_KEY,
    {
      messages: [
        { role: "system", content: interviewQuestionsPrompt(lang, profile) },
        { role: "user", content: userMessage },
      ],
      temperature: 0.6,
    }
  );

  if (result.error) {
    const retry = await chatCompletion<{ questions: InterviewQuestion[] }>(
      c.env.OPENROUTER_API_KEY,
      {
        messages: [
          { role: "system", content: interviewQuestionsPrompt(lang, profile) },
          { role: "user", content: userMessage },
        ],
        temperature: 0.4,
      }
    );
    if (retry.error) {
      return c.json({ error: retry.error }, 502);
    }
    return c.json({ questions: normalizeQuestions(retry.data!.questions) });
  }

  return c.json({ questions: normalizeQuestions(result.data!.questions) });
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

  const lang = language === "en" ? "en" : "fr";
  const session = c.get("session");
  const profile = await fetchProfile(c.env.DB, session.userId);

  const userMessage = `Original teacher request:
"${original_text}"

Intent analysis:
${JSON.stringify(intent, null, 2)}

Teacher's answers to follow-up questions:
${JSON.stringify(answers ?? {}, null, 2)}

Assemble a complete, ready-to-use teaching prompt using the appropriate techniques.`;

  const result = await chatCompletion<AssembleResult>(c.env.OPENROUTER_API_KEY, {
    messages: [
      { role: "system", content: promptAssemblyPrompt(lang, profile) },
      { role: "user", content: userMessage },
    ],
    temperature: 0.5,
    max_tokens: 4096,
  });

  if (result.error) {
    const retry = await chatCompletion<AssembleResult>(c.env.OPENROUTER_API_KEY, {
      messages: [
        { role: "system", content: promptAssemblyPrompt(lang, profile) },
        { role: "user", content: userMessage },
      ],
      temperature: 0.4,
      max_tokens: 4096,
    });
    if (retry.error) {
      return c.json({ error: retry.error }, 502);
    }
    const data = retry.data;
    if (!data) return c.json({ error: "Empty response from AI." }, 502);
    if (data.kind === "ask_user") {
      return c.json({ ...data, questions: normalizeQuestions(data.questions) });
    }
    if (data.kind === "prompt") {
      return c.json(data);
    }
    // Back-compat: treat unknown shape as prompt payload
    return c.json({ kind: "prompt", prompt: data as unknown as AssembledPrompt });
  }

  const data = result.data;
  if (!data) return c.json({ error: "Empty response from AI." }, 502);
  if (data.kind === "ask_user") {
    return c.json({ ...data, questions: normalizeQuestions(data.questions) });
  }
  if (data.kind === "prompt") {
    return c.json(data);
  }
  return c.json({ kind: "prompt", prompt: data as unknown as AssembledPrompt });
});

// POST /api/interview/refine — Refine an existing prompt based on teacher feedback
interview.post("/refine", async (c) => {
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
  const lang = language === "en" ? "en" : "fr";

  // Fetch prompt (verify ownership)
  const row = await c.env.DB.prepare(
    "SELECT blocks FROM prompts WHERE id = ? AND user_id = ?"
  )
    .bind(promptId, session.userId)
    .first<{ blocks: string }>();

  if (!row) {
    return c.json({ error: "Prompt not found." }, 404);
  }

  const currentBlocks = JSON.parse(row.blocks);
  const profile = await fetchProfile(c.env.DB, session.userId);

  const userMessage = `Current prompt blocks:
${JSON.stringify(currentBlocks, null, 2)}

Issue type: ${issueType}
${issueDescription ? `Issue description: ${issueDescription}` : ""}
${outputSample ? `AI output sample:\n${outputSample}` : ""}

Revise the prompt to fix this issue. Only change what needs changing.`;

  const result = await chatCompletion<RefinedPrompt>(c.env.OPENROUTER_API_KEY, {
    messages: [
      { role: "system", content: promptRefinementPrompt(lang, profile) },
      { role: "user", content: userMessage },
    ],
    temperature: 0.4,
    max_tokens: 4096,
  });

  if (result.error) {
    const retry = await chatCompletion<RefinedPrompt>(c.env.OPENROUTER_API_KEY, {
      messages: [
        { role: "system", content: promptRefinementPrompt(lang, profile) },
        { role: "user", content: userMessage },
      ],
      temperature: 0.3,
      max_tokens: 4096,
    });
    if (retry.error) {
      return c.json({ error: retry.error }, 502);
    }
    return c.json({ refined: retry.data });
  }

  return c.json({ refined: result.data });
});

export { interview };
