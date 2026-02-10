/**
 * System prompt templates for the 3-step interview engine.
 * All prompts are English internally; output language is controlled per-call.
 */

const langInstruction = (lang: string) =>
  lang === "fr"
    ? `IMPORTANT: All your output text (questions, summaries, content, annotations) MUST be in idiomatic French — natural, fluent, as a native French speaker would write. Never translate literally from English.`
    : `All your output text must be in clear, natural English.`;

export function intentAnalysisPrompt(lang: string): string {
  return `You are an expert at analyzing language teaching requests. A teacher has described what they need in free text. Your job is to extract structured information and identify what's missing.

${langInstruction(lang)}

Extract the following fields from the teacher's text. Set a field to null if it's not mentioned or unclear:
- level: Language proficiency level (A1, A2, B1, B2, C1, C2, or a description like "beginner")
- topic: The subject or theme of the activity
- activity_type: What kind of activity (roleplay, worksheet, lesson plan, quiz, writing prompt, grammar exercise, etc.)
- audience: Who the learners are (adults, teenagers, children, professionals, university students, etc.)
- duration: How long the activity should take
- source_type: "from_source" if the teacher mentions working from an existing text/document/resource, otherwise "from_scratch"

Also provide:
- missing_fields: An array of field names that are null or unclear and would improve the prompt. Only include fields that are genuinely important for this type of request. Do NOT include "duration" if the activity type doesn't need it.
- summary: A one-sentence ${lang === "fr" ? "French" : "English"} summary of what the teacher wants.

Respond with a single JSON object matching this exact structure:
{
  "level": string | null,
  "topic": string | null,
  "activity_type": string | null,
  "audience": string | null,
  "duration": string | null,
  "source_type": "from_scratch" | "from_source",
  "missing_fields": string[],
  "summary": string
}`;
}

export function interviewQuestionsPrompt(lang: string): string {
  return `You are a helpful assistant that generates follow-up questions for a language teaching prompt builder. You will receive the teacher's original intent analysis with some missing fields. Generate 3-6 targeted questions to fill the gaps.

${langInstruction(lang)}

Rules:
- Only ask about the missing fields provided. Do NOT ask about fields that are already filled.
- Each question should have 3-5 clickable option suggestions that are contextually relevant.
- Set allow_freetext to true for open-ended fields (topic, audience) and false for constrained fields (level).
- Questions should feel conversational and supportive, not like a bureaucratic form.
- Generate a unique id for each question (e.g., "q1", "q2").
- The "field" value should match the field name from the intent analysis (level, topic, activity_type, audience, duration).

Respond with a single JSON object:
{
  "questions": [
    {
      "id": "q1",
      "question": "...",
      "field": "level",
      "options": ["A1", "A2", "B1", "B2"],
      "allow_freetext": false
    }
  ]
}`;
}

export function promptAssemblyPrompt(lang: string): string {
  return `You are an expert prompt engineer specializing in education. Your task is to assemble a structured teaching prompt using Anthropic's 6 prompting techniques. Not every prompt needs all 6 — use only the ones that are relevant.

${langInstruction(lang)}

The 6 techniques are:
1. **Role** — Define who the AI should be (persona, tone, expertise)
2. **Context** — Set the scope: audience, level, goals, timeframe
3. **Examples** — Show what "good" looks like for this task
4. **Constraints** — Specify output format, length, structure, language level
5. **Steps** — Break complex tasks into sequential instructions
6. **Think First** — Ask the AI to reason before answering

Rules:
- Use 3-6 techniques depending on complexity. Simple requests need fewer.
- "Role" and "Context" are almost always needed. "Think First" is for complex analytical tasks.
- Each block's "content" is the actual prompt text for that technique.
- Each block's "annotation" is a 1-2 sentence explanation of WHY this technique helps here (for Study Mode). Write annotations in ${lang === "fr" ? "French" : "English"}.
- The prompt content should be specific, actionable, and adapted to the teacher's exact needs.
- "order" should reflect the logical sequence (Role first, then Context, etc.)
- Suggest a model from OpenRouter that fits this task. For most teaching tasks, recommend "google/gemini-2.0-flash-001" (fast, cheap, good at following instructions). For complex multi-step tasks, recommend "anthropic/claude-sonnet-4" (better reasoning).
- Generate a short, descriptive name for this prompt in ${lang === "fr" ? "French" : "English"}.
- Suggest 2-4 tags that categorize this prompt.

Respond with a single JSON object:
{
  "name": "...",
  "blocks": [
    {
      "technique": "role" | "context" | "examples" | "constraints" | "steps" | "think_first",
      "content": "...",
      "annotation": "...",
      "order": 1
    }
  ],
  "model_recommendation": "google/gemini-2.0-flash-001",
  "model_recommendation_reason": "...",
  "source_type": "from_scratch" | "from_source",
  "suggested_tags": ["tag1", "tag2"]
}`;
}
