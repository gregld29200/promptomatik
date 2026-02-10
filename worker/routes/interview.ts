import { Hono } from "hono";
import type { Env } from "../env";
import { requireAuth } from "../lib/auth-middleware";
import { chatCompletion } from "../lib/openrouter";
import {
  intentAnalysisPrompt,
  interviewQuestionsPrompt,
  promptAssemblyPrompt,
} from "../lib/llm/prompts";
import type {
  IntentAnalysis,
  InterviewQuestion,
  AssembledPrompt,
} from "../lib/llm/types";

const interview = new Hono<{ Bindings: Env }>();

interview.use("/*", requireAuth);

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

  const result = await chatCompletion<IntentAnalysis>(c.env.OPENROUTER_API_KEY, {
    messages: [
      { role: "system", content: intentAnalysisPrompt(lang) },
      { role: "user", content: text.trim() },
    ],
    temperature: 0.3,
  });

  if (result.error) {
    // Retry once on failure
    const retry = await chatCompletion<IntentAnalysis>(c.env.OPENROUTER_API_KEY, {
      messages: [
        { role: "system", content: intentAnalysisPrompt(lang) },
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

  const userMessage = `Here is the intent analysis:
${JSON.stringify(intent, null, 2)}

Missing fields to ask about: ${intent.missing_fields.join(", ")}

Generate questions ONLY for the missing fields listed above.`;

  const result = await chatCompletion<{ questions: InterviewQuestion[] }>(
    c.env.OPENROUTER_API_KEY,
    {
      messages: [
        { role: "system", content: interviewQuestionsPrompt(lang) },
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
          { role: "system", content: interviewQuestionsPrompt(lang) },
          { role: "user", content: userMessage },
        ],
        temperature: 0.4,
      }
    );
    if (retry.error) {
      return c.json({ error: retry.error }, 502);
    }
    return c.json({ questions: retry.data!.questions });
  }

  return c.json({ questions: result.data!.questions });
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

  const userMessage = `Original teacher request:
"${original_text}"

Intent analysis:
${JSON.stringify(intent, null, 2)}

Teacher's answers to follow-up questions:
${JSON.stringify(answers ?? {}, null, 2)}

Assemble a complete, ready-to-use teaching prompt using the appropriate techniques.`;

  const result = await chatCompletion<AssembledPrompt>(c.env.OPENROUTER_API_KEY, {
    messages: [
      { role: "system", content: promptAssemblyPrompt(lang) },
      { role: "user", content: userMessage },
    ],
    temperature: 0.5,
    max_tokens: 4096,
  });

  if (result.error) {
    const retry = await chatCompletion<AssembledPrompt>(c.env.OPENROUTER_API_KEY, {
      messages: [
        { role: "system", content: promptAssemblyPrompt(lang) },
        { role: "user", content: userMessage },
      ],
      temperature: 0.4,
      max_tokens: 4096,
    });
    if (retry.error) {
      return c.json({ error: retry.error }, 502);
    }
    return c.json({ prompt: retry.data });
  }

  return c.json({ prompt: result.data });
});

export { interview };
