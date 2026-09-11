/**
 * Template card — the reader-facing "fiche" attached to a published template.
 *
 * A template is a teacher's own prompt, published as-is. Its name describes one
 * specific output ("28-Hour B1 Programme — Digital Marketing Manager"). The card
 * lifts it back to the need it answers, so another teacher recognises their own
 * situation and knows what to change.
 *
 * The LLM drafts it at publish time; the admin reviews it before it goes live.
 */

import { chatCompletion } from "./openrouter";
import type { Env } from "../env";
import { languageName, normalizeLanguage, type Language } from "./language";

export interface TemplateCard {
  /** The teacher's need, infinitive verb first. Becomes the template's title. */
  need: string;
  /** When to reach for it: the starting situation and what comes out. 1-2 sentences. */
  when: string;
  /** What makes this prompt worth reusing, pedagogically. 1 sentence. */
  why: string;
  /** What to change to make it one's own, naming the block each variable lives in. 2-4 items. */
  adapt: string[];
}

const LIMITS = { need: 120, when: 400, why: 300, adaptItem: 240, adaptMax: 4 } as const;

function cleanLine(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.slice(0, max);
}

/**
 * Accept a card-shaped value from the LLM or from the admin form.
 * Returns null when any required field is missing or empty.
 */
export function normalizeTemplateCard(input: unknown): TemplateCard | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const need = cleanLine(raw.need, LIMITS.need);
  const when = cleanLine(raw.when, LIMITS.when);
  const why = cleanLine(raw.why, LIMITS.why);
  const adaptRaw = Array.isArray(raw.adapt) ? raw.adapt : [];
  const adapt = adaptRaw
    .map((item) => cleanLine(item, LIMITS.adaptItem))
    .filter((item): item is string => item !== null)
    .slice(0, LIMITS.adaptMax);
  if (!need || !when || !why || adapt.length === 0) return null;
  return { need, when, why, adapt };
}

/** Read the stored JSON column. Tolerates NULL and legacy garbage. */
export function parseTemplateCard(stored: string | null | undefined): TemplateCard | null {
  if (!stored) return null;
  try {
    return normalizeTemplateCard(JSON.parse(stored));
  } catch {
    return null;
  }
}

export function templateCardPrompt(lang: Language): string {
  const language = languageName(lang);
  return `You write the short "card" shown next to a reusable AI prompt in a library for language teachers.

The prompt you receive was written by one teacher for one precise situation (one learner, one level, one number of hours). Other teachers will browse the library looking for THEIR situation. Your job is to describe the prompt as the need it answers, not as the output it produced.

Write every field in ${language}, in the plain, concrete language teachers use with each other. No marketing tone, no jargon, no exclamation marks.

Fields:
- "need": the teacher's need, starting with an infinitive verb, free of the specific case (no learner name, no exact hours, no job title unless the prompt only works for that job). Max 12 words. Example: "Construire un programme de formation sur mesure pour un apprenant professionnel".
- "when": when to reach for this prompt. One or two sentences: the situation the teacher starts from, and what they get out. Name the input they must have ready if there is one (a source text, a syllabus, a transcript).
- "why": one sentence on what this prompt does well pedagogically, in terms of what the teacher gains. Point at the technique that makes the difference when it is visible (a Think First step, a strict format, an example).
- "adapt": 2 to 4 short items, each naming ONE thing to change and the block it lives in (Role, Context, Examples, Constraints, Steps, Think First). Example: "Le niveau et le métier de l'apprenant sont dans Contexte." Order them from most to least likely to change.

Respond with exactly this JSON object and nothing else:
{
  "need": "...",
  "when": "...",
  "why": "...",
  "adapt": ["...", "..."]
}`;
}

interface CardSource {
  name: string;
  language: string;
  tags: string[];
  blocks: { technique: string; content: string; order: number }[];
  tips: string[];
}

function cardInput(source: CardSource): string {
  const blocks = [...source.blocks]
    .sort((a, b) => a.order - b.order)
    .map((b) => `## ${b.technique}\n${b.content}`)
    .join("\n\n");
  const tips = source.tips.length ? `\n\nTips written for the author:\n- ${source.tips.join("\n- ")}` : "";
  return `Original name: ${source.name}\nTags: ${source.tags.join(", ") || "none"}\n\nPrompt blocks:\n\n${blocks}${tips}`;
}

function modelName(name?: string): string | undefined {
  const trimmed = name?.trim();
  return trimmed ? trimmed : undefined;
}

export type GenerateCardResult =
  | { card: TemplateCard; error: null }
  | { card: null; error: string };

export async function generateTemplateCard(env: Env, source: CardSource): Promise<GenerateCardResult> {
  const completion = await chatCompletion<unknown>(
    env.OPENROUTER_API_KEY,
    {
      messages: [
        { role: "system", content: templateCardPrompt(normalizeLanguage(source.language)) },
        { role: "user", content: cardInput(source) },
      ],
      temperature: 0.3,
      max_tokens: 800,
    },
    { primaryModel: modelName(env.OPENROUTER_MODEL), fallbackModel: modelName(env.OPENROUTER_FALLBACK_MODEL) },
    { logContext: { operation: "templates.card" } }
  );

  if (completion.error !== null) {
    return { card: null, error: completion.error };
  }
  const card = normalizeTemplateCard(completion.data);
  if (!card) {
    return { card: null, error: "The generated card was incomplete." };
  }
  return { card, error: null };
}
