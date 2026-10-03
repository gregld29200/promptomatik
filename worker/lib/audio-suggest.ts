import type { AudioMode, CefrLevel } from "./audio-config";
import { prepareAudioScript, type AudioPrepareChange, type PrepareLanguage } from "./audio-prepare";
import { SUPPORTED_AUDIO_TAGS, speakerLabelPrefix } from "../../src/lib/audio-script-rules";
import type { InlineSuggestion } from "../../src/lib/audio-suggestions";

export type { InlineSuggestion } from "../../src/lib/audio-suggestions";

export interface AudioSuggestResult {
  suggestions: InlineSuggestion[];
  warnings: string[];
}

export interface SuggestAudioEditsInput {
  apiKey: string;
  model: string;
  script: string;
  mode: AudioMode;
  language: PrepareLanguage;
  level?: CefrLevel;
  fetcher?: typeof fetch;
}

interface EmotionNote {
  line: number;
  tag: string;
  reason: string;
}

interface EmotionProposal {
  annotatedScript: string;
  notes: EmotionNote[];
}

const SUPPORTED = new Set<string>(SUPPORTED_AUDIO_TAGS);

const LANGUAGE_NAMES: Record<PrepareLanguage, string> = {
  fr: "French",
  en: "English",
  es: "Spanish",
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

function emotionPrompt(language: PrepareLanguage, mode: AudioMode, level: CefrLevel): string {
  return [
    "You help a language teacher direct a text-to-speech recording of their own script.",
    `This script is a ${mode}. Suggest delivery tags where an emotion or a pause would make the reading more natural and expressive.`,
    `Allowed tags, and only these: ${SUPPORTED_AUDIO_TAGS.join(", ")}.`,
    "Event tags ([sighs], [laughs], [giggles], [gasp], [pause]) sound at their exact position. Manner tags (all the others) colour the sentence they start, so place them at the start of a sentence.",
    mode === "dialogue"
      ? "In a dialogue, a tag goes after the speaker label and its colon, never before or inside the label."
      : "In a monologue, never add speaker labels.",
    `Be sparing: ${DENSITY[level]}, only where the text clearly calls for it. Never stack more than two tags in one place. Keep every tag already in the script.`,
    "Return annotated_script: the script EXACTLY as given, same lines, same words, same punctuation, with only your new tags inserted. Changing, adding or removing a single word invalidates your answer.",
    `For each tag you insert, add a note with its 1-based line number, the tag, and a one-sentence reason written in concise, natively idiomatic ${LANGUAGE_NAMES[language]}.`,
    'Return ONLY valid JSON: {"annotated_script":"...","notes":[{"line":1,"tag":"[excited]","reason":"..."}]}',
  ].join("\n");
}

function parseEmotionProposal(raw: string): EmotionProposal | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.annotated_script !== "string") return null;
  const notes = Array.isArray(record.notes)
    ? record.notes.flatMap((note): EmotionNote[] => {
      if (!note || typeof note !== "object") return [];
      const { line, tag, reason } = note as Record<string, unknown>;
      if (!Number.isInteger(line) || typeof tag !== "string") return [];
      return [{ line: Number(line), tag: tagKey(tag), reason: typeof reason === "string" ? reason.trim() : "" }];
    })
    : [];
  return { annotatedScript: record.annotated_script, notes };
}

async function proposeEmotionTags(input: SuggestAudioEditsInput): Promise<EmotionProposal | null> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(
    `https://generativelanguage.googleapis.com/v1beta/models/${input.model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": input.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: emotionPrompt(input.language, input.mode, input.level ?? "B1") }] },
        contents: [{ role: "user", parts: [{ text: `Script:\n${input.script}` }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    }
  );
  if (!response.ok) throw new Error(`Emotion suggestion failed with HTTP ${response.status}.`);
  const body = await response.json().catch(() => null) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  } | null;
  const text = body?.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === "string")?.text;
  return text ? parseEmotionProposal(text) : null;
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
  proposal: EmotionProposal,
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
    const raw = originalLines[lineIndex];
    const line = raw.replace(/\r$/, "");
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
      const insert = atEnd
        ? ` ${tag.key}`
        : `${needsLead ? " " : ""}${tag.key} `;
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

// Positions the structural fixes of the prepare pass (speaker labels,
// stage directions, cleanups) on the original script. A change whose
// `before` text cannot be found is dropped rather than guessed.
// Teachers type, and read, the speaker label of their interface language;
// the pipeline normalises all of them to "Speaker N" before speech.
const SPEAKER_WORD: Record<PrepareLanguage, string> = { fr: "Locuteur", en: "Speaker", es: "Hablante" };

export function fixSuggestionsFrom(
  original: string,
  changes: AudioPrepareChange[],
  language: PrepareLanguage = "en"
): InlineSuggestion[] {
  const lines = original.split("\n");
  const starts = lineStarts(original);
  const suggestions: InlineSuggestion[] = [];

  changes.forEach((change, index) => {
    if (change.type === "tag_added" || !change.before) return;
    let start = -1;
    let end = -1;
    const lineIndex = change.line - 1;
    if (lineIndex >= 0 && lineIndex < lines.length) {
      const found = lines[lineIndex].indexOf(change.before);
      if (found >= 0) start = starts[lineIndex] + found;
      // The prepare pass may echo a speaker name in another case ("sophie:").
      const label = lines[lineIndex].match(/^\s*([^:\n]{1,80}):/);
      if (start < 0 && change.type === "speaker_rename" && label
        && label[1].trim().toLowerCase().startsWith(change.before.slice(0, -1).trim().toLowerCase())) {
        start = starts[lineIndex] + label[0].indexOf(label[1]);
        end = starts[lineIndex] + label[0].length;
      }
    }
    if (start < 0) {
      const first = original.indexOf(change.before);
      if (first < 0 || original.indexOf(change.before, first + 1) >= 0) return;
      start = first;
    }
    if (end < 0) end = start + change.before.length;
    const isHint = change.type === "direction_hint";
    const insert = isHint
      ? ""
      : change.after.replace(/^Speaker (\d+):/, `${SPEAKER_WORD[language]} $1:`);
    if (!insert && original[end] === " " && (start === 0 || /\s/.test(original[start - 1]))) end += 1;
    if (insert === change.before) return;

    suggestions.push({
      id: `fix-${start}-${index}`,
      kind: "fix",
      start,
      end,
      insert,
      scene: isHint && change.after.trim() ? change.after.trim() : undefined,
      // The studio explains a speaker renaming itself, in teacher language.
      reason: change.type === "speaker_rename" ? "" : change.rationale,
      fixType: change.type,
    });
  });

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

export async function suggestAudioEdits(input: SuggestAudioEditsInput): Promise<AudioSuggestResult> {
  const script = input.script.replace(/\r\n/g, "\n");
  const [fixes, emotions] = await Promise.allSettled([
    prepareAudioScript({ ...input, script }),
    proposeEmotionTags({ ...input, script }),
  ]);
  if (fixes.status === "rejected" && emotions.status === "rejected") {
    throw fixes.reason instanceof Error ? fixes.reason : new Error("Unable to suggest edits.");
  }

  const fixSuggestions = fixes.status === "fulfilled" ? fixSuggestionsFrom(script, fixes.value.changes, input.language) : [];
  const tagSuggestions = emotions.status === "fulfilled" && emotions.value
    ? limitEmotionTags(script, fixSuggestions, emotionSuggestionsFrom(script, emotions.value, input.mode), input.level ?? "B1")
    : [];
  return {
    suggestions: mergeSuggestions(fixSuggestions, tagSuggestions),
    warnings: fixes.status === "fulfilled" ? fixes.value.warnings : [],
  };
}
