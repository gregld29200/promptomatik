import type { AudioMode, CefrLevel } from "./audio-config";
import { STAGE_DIRECTION_TAG_MAP, SUPPORTED_AUDIO_TAGS, speakerLabelPrefix } from "../../src/lib/audio-script-rules";
import type { InlineSuggestion } from "../../src/lib/audio-suggestions";

export type { InlineSuggestion } from "../../src/lib/audio-suggestions";

// The interface languages the studio ships in. Reasons are shown verbatim in
// the review, so the model writes them in the teacher's language.
export const SUGGEST_LANGUAGES = ["fr", "en", "es"] as const;
export type SuggestLanguage = (typeof SUGGEST_LANGUAGES)[number];

export function isSuggestLanguage(value: unknown): value is SuggestLanguage {
  return typeof value === "string" && (SUGGEST_LANGUAGES as readonly string[]).includes(value);
}

export interface AudioSuggestResult {
  suggestions: InlineSuggestion[];
}

export interface SuggestAudioEditsInput {
  apiKey: string;
  model: string;
  script: string;
  mode: AudioMode;
  language: SuggestLanguage;
  level?: CefrLevel;
  fetcher?: typeof fetch;
}

export class AudioSuggestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioSuggestError";
  }
}

interface EmotionNote {
  line: number;
  tag: string;
  reason: string;
}

export interface ParenthesisDecision {
  line: number;
  /** The exact text, parentheses included: "(il rit)". */
  text: string;
  action: "tag" | "scene" | "remove";
  tag?: string;
  scene?: string;
  reason: string;
}

export interface SuggestProposal {
  annotatedScript: string;
  notes: EmotionNote[];
  parentheses: ParenthesisDecision[];
}

const SUPPORTED = new Set<string>(SUPPORTED_AUDIO_TAGS);

const LANGUAGE_NAMES: Record<SuggestLanguage, string> = {
  fr: "French",
  en: "English",
  es: "Spanish",
};

// Reasons in the teacher's language: examples in another language pull the
// model into writing that language.
const REASON_EXAMPLES: Record<SuggestLanguage, string> = {
  fr: "« Yanis rit vraiment au lieu de lire « il rit ». », « Une action sans son : la voix la lirait à voix haute. », « Chloé est épuisée, sa voix le fait entendre. »",
  en: "\"Yanis really laughs instead of reading out 'he laughs'.\", \"A silent action: the voice would read it aloud.\", \"Chloé is worn out, and you can hear it in her voice.\"",
  es: "«Yanis se ríe de verdad en lugar de leer «se ríe».», «Una acción sin sonido: la voz la leería en voz alta.», «Chloé está agotada y se le nota en la voz.»",
};

// Beginners need clarity more than acting: fewer cues at A1/A2.
const DENSITY: Record<CefrLevel, string> = {
  A1: "at most one tag every four lines",
  A2: "at most one tag every three lines",
  B1: "at most one tag every two or three lines",
  B2: "at most one tag every two lines",
  C1: "at most one tag every two lines",
};

function tagKey(tag: string): string {
  return `[${tag.slice(1, -1).trim().replace(/\s+/g, " ").toLowerCase()}]`;
}

function suggestPrompt(language: SuggestLanguage, mode: AudioMode, level: CefrLevel): string {
  const examples = Object.entries(STAGE_DIRECTION_TAG_MAP)
    .map(([word, tag]) => `${word} -> ${tag}`)
    .join(", ");
  return [
    "You help a language teacher prepare their own script for a text-to-speech recording. Never rewrite it.",
    mode === "dialogue"
      ? "This is a dialogue. Lines start with a character name and a colon (\"Léa : …\"); keep names exactly as written."
      : "This is a monologue read by one narrator.",
    `Task 1, emotions. Insert delivery tags where an emotion or a pause clearly makes the reading more natural. Allowed tags, and only these: ${SUPPORTED_AUDIO_TAGS.join(", ")}.`,
    "Event tags ([sighs], [laughs], [giggles], [gasp], [pause]) sound at their exact position. Manner tags (all the others) colour the sentence they start, so place them at the start of a sentence, after the character name and its colon.",
    `Be sparing: ${DENSITY[level]}. Never stack two tags in one place. Keep every tag already in the script.`,
    "annotated_script is the script EXACTLY as given: same lines, words, punctuation and parentheses, with only your new tags inserted. Changing a single word invalidates your answer.",
    "For each tag you insert, add a note: its 1-based line number, the tag and a one-sentence reason.",
    `Task 2, text in parentheses. It is a stage direction that would otherwise be read aloud. For each one, report its line and exact text, parentheses included, with one action: "tag" when an allowed tag performs it (e.g. ${examples}); "scene" when it describes the setting or an action, with a short scene sentence in the script's language; "remove" when it has no audio value. Add a one-sentence reason.`,
    `Write every reason in concise, natively idiomatic ${LANGUAGE_NAMES[language]}.`,
    `The teacher reads each reason, so write it for a language teacher, not a technician: say what the listener will hear and why it helps the scene. Call whoever reads the script "the voice", never "the teacher". These examples show the style, not words to copy: ${REASON_EXAMPLES[language]}`,
    "Never mention tags, brackets, stage directions, cues, markup, the model, the voice engine or text-to-speech in a reason, in any language (no balise, didascalie, livraison, etiqueta, acotación…). Name the characters and what they do or feel.",
    'Return ONLY valid JSON: {"annotated_script":"...","notes":[{"line":1,"tag":"[excited]","reason":"..."}],"parentheses":[{"line":2,"text":"(soupire)","action":"tag","tag":"[sighs]","reason":"..."}]}',
  ].join("\n");
}

function parseJson(raw: string): unknown {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1");
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Lenient by design: a malformed note or parenthesis entry is skipped, never
// allowed to sink the whole answer. Only a missing annotated script fails.
export function parseSuggestResponse(raw: string): SuggestProposal | null {
  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.annotated_script !== "string") return null;

  const notes = (Array.isArray(record.notes) ? record.notes : []).flatMap((entry): EmotionNote[] => {
    if (!entry || typeof entry !== "object") return [];
    const { line, tag, reason } = entry as Record<string, unknown>;
    if (!Number.isInteger(line) || typeof tag !== "string") return [];
    return [{ line: Number(line), tag: tagKey(tag), reason: text(reason) }];
  });

  const parentheses = (Array.isArray(record.parentheses) ? record.parentheses : []).flatMap((entry): ParenthesisDecision[] => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const found = text(item.text);
    const action = item.action;
    if (!Number.isInteger(item.line) || !/^\(.*\)$/s.test(found)) return [];
    if (action !== "tag" && action !== "scene" && action !== "remove") return [];
    return [{
      line: Number(item.line),
      text: found,
      action,
      tag: typeof item.tag === "string" ? tagKey(item.tag) : undefined,
      scene: text(item.scene).slice(0, 200) || undefined,
      reason: text(item.reason),
    }];
  });

  return { annotatedScript: record.annotated_script, notes, parentheses };
}

interface LineShape {
  /** Non-whitespace characters outside tags, in order. */
  core: string;
  /** Line index of each core character. */
  coreAt: number[];
  /** Tags with the number of core characters before them. */
  tags: Array<{ key: string; before: number }>;
}

function lineShape(line: string): LineShape {
  const shape: LineShape = { core: "", coreAt: [], tags: [] };
  let index = 0;
  while (index < line.length) {
    if (line[index] === "[") {
      const close = line.indexOf("]", index);
      if (close > index) {
        shape.tags.push({ key: tagKey(line.slice(index, close + 1)), before: shape.core.length });
        index = close + 1;
        continue;
      }
    }
    if (!/\s/.test(line[index])) {
      shape.core += line[index];
      shape.coreAt.push(index);
    }
    index += 1;
  }
  return shape;
}

function lineStarts(script: string): number[] {
  const starts = [0];
  for (let index = 0; index < script.length; index += 1) {
    if (script[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

// Turns the model's annotated copy into insertions on the original script.
// A line whose words, punctuation or order changed in any way is dropped
// whole: the teacher's text is never altered by an emotion suggestion.
export function emotionSuggestionsFrom(
  original: string,
  proposal: Pick<SuggestProposal, "annotatedScript" | "notes">,
  mode: AudioMode
): InlineSuggestion[] {
  const originalLines = original.split("\n");
  const annotatedLines = proposal.annotatedScript.replace(/\r\n/g, "\n").split("\n");
  const keep = (lines: string[]) => lines.flatMap((line, index) => (line.trim() ? [index] : []));
  const originalIdx = keep(originalLines);
  const annotatedIdx = keep(annotatedLines);
  if (originalIdx.length !== annotatedIdx.length) return [];

  const starts = lineStarts(original);
  const suggestions: InlineSuggestion[] = [];

  originalIdx.forEach((lineIndex, position) => {
    const line = originalLines[lineIndex].replace(/\r$/, "");
    const before = lineShape(line);
    const after = lineShape(annotatedLines[annotatedIdx[position]]);
    if (before.core !== after.core) return;

    const existing = before.tags.map((tag) => `${tag.key}@${tag.before}`);
    const label = mode === "dialogue" ? speakerLabelPrefix(line.trim()) : null;
    const labelEnd = label ? line.indexOf(":") + 1 : 0;

    for (const tag of after.tags) {
      const id = `${tag.key}@${tag.before}`;
      const seen = existing.indexOf(id);
      if (seen >= 0) {
        existing.splice(seen, 1);
        continue;
      }
      if (!SUPPORTED.has(tag.key)) continue;

      let at = tag.before < before.coreAt.length ? before.coreAt[tag.before] : line.trimEnd().length;
      if (at < labelEnd) {
        at = labelEnd;
        while (at < line.length && /\s/.test(line[at])) at += 1;
      }
      const atEnd = at >= line.trimEnd().length;
      const needsLead = at > 0 && !/\s/.test(line[at - 1]);
      const insert = atEnd ? ` ${tag.key}` : `${needsLead ? " " : ""}${tag.key} `;
      const note = proposal.notes.find((entry) => entry.line === lineIndex + 1 && entry.tag === tag.key)
        ?? proposal.notes.find((entry) => entry.tag === tag.key && Math.abs(entry.line - (lineIndex + 1)) <= 1);
      const offset = starts[lineIndex] + at;
      suggestions.push({
        id: `tag-${offset}-${tag.key}`,
        kind: "tag",
        start: offset,
        end: offset,
        insert,
        tag: tag.key,
        reason: note?.reason ?? "",
      });
    }
  });

  return suggestions;
}

// Positions each decision about text in parentheses on the original script:
// replaced by the tag that performs it, or removed (and, for "scene", moved
// to the Scene field). A decision whose text cannot be found is dropped.
export function parenthesisSuggestionsFrom(original: string, decisions: ParenthesisDecision[]): InlineSuggestion[] {
  const lines = original.split("\n");
  const starts = lineStarts(original);
  const suggestions: InlineSuggestion[] = [];
  const used = new Set<number>();

  for (const decision of decisions) {
    let foundAt = -1;
    for (const lineIndex of [decision.line - 1, decision.line - 2, decision.line]) {
      if (lineIndex < 0 || lineIndex >= lines.length) continue;
      const found = lines[lineIndex].indexOf(decision.text);
      if (found >= 0 && !used.has(starts[lineIndex] + found)) {
        foundAt = starts[lineIndex] + found;
        break;
      }
    }
    if (foundAt < 0) continue;

    const tag = decision.action === "tag" && decision.tag && SUPPORTED.has(decision.tag) ? decision.tag : undefined;
    if (decision.action === "tag" && !tag) continue;
    let start = foundAt;
    let end = start + decision.text.length;
    if (!tag) {
      // Take one neighbouring space with the removed text.
      if (original[end] === " " && (start === 0 || /\s/.test(original[start - 1]))) end += 1;
      else if (start > 0 && original[start - 1] === " " && (end === original.length || original[end] === "\n")) start -= 1;
    }
    used.add(foundAt);
    suggestions.push({
      id: `paren-${start}`,
      kind: "fix",
      start,
      end,
      insert: tag ?? "",
      tag,
      scene: decision.action === "scene" ? decision.scene ?? decision.text.slice(1, -1).trim() : undefined,
      fixType: "stage_direction",
      reason: decision.reason,
    });
  }

  return suggestions;
}

function overlaps(left: InlineSuggestion, right: InlineSuggestion): boolean {
  if (left.start === left.end) return left.start > right.start && left.start < right.end;
  if (right.start === right.end) return right.start > left.start && right.start < left.end;
  return left.start < right.end && right.start < left.end;
}

// Fixes win over emotion tags when both touch the same text, so every
// combination of accepted suggestions applies cleanly.
export function mergeSuggestions(fixes: InlineSuggestion[], tags: InlineSuggestion[]): InlineSuggestion[] {
  const kept: InlineSuggestion[] = [];
  for (const suggestion of [...fixes, ...tags]) {
    if (kept.some((other) => overlaps(other, suggestion))) continue;
    kept.push(suggestion);
  }
  return kept.sort((left, right) => left.start - right.start || left.end - right.end);
}

const LINES_PER_TAG: Record<CefrLevel, number> = { A1: 4, A2: 3, B1: 2.5, B2: 2, C1: 2 };

function lineOf(script: string, offset: number): number {
  let line = 0;
  for (let index = 0; index < offset; index += 1) if (script[index] === "\n") line += 1;
  return line;
}

// Keeps the reading natural: one emotion per line at most, none on a line
// where a fix already turns a stage direction into a tag, and no more than
// the level allows, spread evenly across the script.
export function limitEmotionTags(
  script: string,
  fixes: InlineSuggestion[],
  tags: InlineSuggestion[],
  level: CefrLevel
): InlineSuggestion[] {
  const taggedByFix = new Set(fixes.filter((fix) => fix.insert.includes("[")).map((fix) => lineOf(script, fix.start)));
  const usedLines = new Set<number>();
  const candidates = tags.filter((tag) => {
    const line = lineOf(script, tag.start);
    if (taggedByFix.has(line) || usedLines.has(line)) return false;
    usedLines.add(line);
    return true;
  });
  const lines = script.split("\n").filter((line) => line.trim()).length;
  const cap = Math.max(1, Math.ceil(lines / LINES_PER_TAG[level]));
  if (candidates.length <= cap) return candidates;
  if (cap === 1) return [candidates[0]];
  const picked = new Set<number>();
  for (let index = 0; index < cap; index += 1) picked.add(Math.round((index * (candidates.length - 1)) / (cap - 1)));
  return candidates.filter((_, index) => picked.has(index));
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

async function requestProposal(input: SuggestAudioEditsInput, script: string): Promise<SuggestProposal | null> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(
    `https://generativelanguage.googleapis.com/v1beta/models/${input.model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": input.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: suggestPrompt(input.language, input.mode, input.level ?? "B1") }] },
        contents: [{ role: "user", parts: [{ text: `Script:\n${script}` }] }],
        // Placing tags is a light task: thinking adds tens of seconds, not quality.
        generationConfig: { responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
      }),
    }
  );
  if (!response.ok) {
    if (RETRYABLE_STATUSES.has(response.status)) return null;
    throw new AudioSuggestError(`Suggestion request failed with HTTP ${response.status}.`);
  }
  const body = await response.json().catch(() => null) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  } | null;
  const raw = body?.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === "string")?.text;
  return raw ? parseSuggestResponse(raw) : null;
}

// One pass, one contract: emotions and parentheses come back together, so
// the teacher never gets half a review. A busy model or an unreadable answer
// is retried once; after that the caller gets an error, never a partial.
export async function suggestAudioEdits(input: SuggestAudioEditsInput): Promise<AudioSuggestResult> {
  const script = input.script.replace(/\r\n?/g, "\n");
  let proposal: SuggestProposal | null = null;
  for (let attempt = 0; attempt < 2 && !proposal; attempt += 1) {
    proposal = await requestProposal(input, script);
  }
  if (!proposal) throw new AudioSuggestError("The suggestion model returned no usable answer.");

  const fixes = parenthesisSuggestionsFrom(script, proposal.parentheses);
  const tags = limitEmotionTags(script, fixes, emotionSuggestionsFrom(script, proposal, input.mode), input.level ?? "B1");
  return { suggestions: mergeSuggestions(fixes, tags) };
}
