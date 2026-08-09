// Pure text helpers for the transcript reader.
//
// No React, no CSS, no i18n: everything here is a function of its arguments, so
// the reading experience can be reasoned about (and exercised) without a DOM.

import type {
  TranscriptCopyOptions,
  TranscriptSegment,
  TranscriptWord,
} from "./types";

/** Seconds -> `m:ss`, or `h:mm:ss` past the hour. Never negative, never NaN. */
export function formatTimecode(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/** Four accents cycle, so a fifth speaker reuses the first one. */
export const SPEAKER_ACCENT_COUNT = 4;

export function speakerAccentIndex(speakerIndex: number): number {
  const safe = Number.isFinite(speakerIndex) ? Math.max(0, Math.floor(speakerIndex)) : 0;
  return safe % SPEAKER_ACCENT_COUNT;
}

/** Below this, a word is worth a second listen. Overridable per view. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.6;

export function isLowConfidence(word: TranscriptWord, threshold: number): boolean {
  return word.confidence !== null && word.confidence < threshold;
}

export function countLowConfidence(segments: readonly TranscriptSegment[], threshold: number): number {
  let total = 0;
  for (const segment of segments) {
    for (const word of segment.words) {
      if (isLowConfidence(word, threshold)) total += 1;
    }
  }
  return total;
}

export function countWords(segments: readonly TranscriptSegment[]): number {
  let total = 0;
  for (const segment of segments) total += segment.words.length;
  return total;
}

/** The word being spoken at `time`, or null. Used for the reading follow cursor. */
export function wordIndexAt(words: readonly TranscriptWord[], time: number): number | null {
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (time >= word.start && time < word.end) return index;
  }
  return null;
}

export function isSegmentActive(segment: TranscriptSegment, time: number | null): boolean {
  if (time === null) return false;
  return time >= segment.start && time < segment.end;
}

// ---- Accent- and apostrophe-insensitive search ----

/**
 * Folds text for searching while keeping a map back to the original string, so a
 * match found on the folded text can still be highlighted at the right place.
 * `offsets[i]` is the index in `input` that produced folded character `i`.
 *
 * Folding covers what French actually trips over: diacritics (`élève` matches
 * `eleve`), case, and the typographic apostrophe (`aujourd’hui` matches
 * `aujourd'hui`).
 */
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

export function foldForSearch(input: string): { folded: string; offsets: number[] } {
  let folded = "";
  const offsets: number[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const normalised =
      char === "’" || char === "‘"
        ? "'"
        : char.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
    for (const piece of normalised) {
      folded += piece;
      offsets.push(index);
    }
  }
  return { folded, offsets };
}

export interface TextSpan {
  text: string;
  hit: boolean;
}

/**
 * Splits `text` into alternating plain / matching spans. An empty or
 * whitespace-only query yields a single non-matching span, so callers never
 * special-case "no search".
 */
export function splitByQuery(text: string, query: string): TextSpan[] {
  const needle = foldForSearch(query.trim()).folded;
  if (!needle) return [{ text, hit: false }];

  const { folded, offsets } = foldForSearch(text);
  const spans: TextSpan[] = [];
  let cursor = 0;
  let from = 0;

  for (;;) {
    const at = folded.indexOf(needle, from);
    if (at < 0) break;
    const start = offsets[at];
    const end = offsets[at + needle.length - 1] + 1;
    if (start > cursor) spans.push({ text: text.slice(cursor, start), hit: false });
    spans.push({ text: text.slice(start, end), hit: true });
    cursor = end;
    from = at + needle.length;
  }

  if (cursor < text.length) spans.push({ text: text.slice(cursor), hit: false });
  return spans.length > 0 ? spans : [{ text, hit: false }];
}

export function countMatches(text: string, query: string): number {
  const needle = foldForSearch(query.trim()).folded;
  if (!needle) return 0;
  const { folded } = foldForSearch(text);
  let total = 0;
  let from = 0;
  for (;;) {
    const at = folded.indexOf(needle, from);
    if (at < 0) break;
    total += 1;
    from = at + needle.length;
  }
  return total;
}

export function countTranscriptMatches(segments: readonly TranscriptSegment[], query: string): number {
  let total = 0;
  for (const segment of segments) total += countMatches(segment.text, query);
  return total;
}

/** Where one search match sits: which turn, and which hit inside that turn. */
export interface TranscriptMatch {
  /** `idx` of the turn this match sits in. */
  turn: number;
  /**
   * 0-based occurrence *within that turn*, counted the same way the turn counts
   * its `<mark>` elements. Turns routinely hold several hits — "temps" lands
   * twice in one turn of the fixture — so the turn alone cannot say which one
   * the stepper is parked on, and a stepper that cannot say that looks broken.
   */
  hit: number;
}

/**
 * One entry per match, in reading order.
 *
 * There is exactly one denominator for search in this reader, and it is this
 * array: its length is `countTranscriptMatches` by construction, and the same
 * number as the `<mark>` elements the turns render. So "N results" and the
 * "x of y" stepper can never disagree, and stepping walks matches — what a
 * teacher counted on screen — rather than turns.
 */
export function collectMatches(
  segments: readonly TranscriptSegment[],
  query: string
): TranscriptMatch[] {
  const matches: TranscriptMatch[] = [];
  for (const segment of segments) {
    const hits = countMatches(segment.text, query);
    for (let hit = 0; hit < hits; hit += 1) matches.push({ turn: segment.idx, hit });
  }
  return matches;
}

/** The turn of each match, in reading order. Derived, so it cannot drift. */
export function collectMatchTurns(segments: readonly TranscriptSegment[], query: string): number[] {
  return collectMatches(segments, query).map((match) => match.turn);
}

/**
 * Where the stepper lands, from where it is now.
 *
 * `null` means the teacher has not stepped yet, so "next" lands on the first
 * match and "previous" on the last — a find bar's behaviour. From then on it
 * wraps in both directions. Returns `null` only when there is nothing to step
 * through, so `null` never has to double as "the first one".
 */
export function stepMatchCursor(cursor: number | null, offset: number, total: number): number | null {
  if (total <= 0) return null;
  if (cursor === null) return offset >= 0 ? 0 : total - 1;
  const from = Math.min(Math.max(cursor, 0), total - 1);
  return (((from + offset) % total) + total) % total;
}

// ---- Speaker labels ----

/**
 * The name a teacher sees for a speaker: the one they gave, or the localised
 * fallback ("Speaker 2") the caller passes in already translated.
 *
 * The trim is deliberate — a field holding only spaces is not a name — and it is
 * precisely why a rename field must never be fed this value back as its `value`.
 * See `speaker-rename-field.tsx`.
 */
export function speakerDisplayLabel(storedName: string | null | undefined, fallback: string): string {
  const trimmed = storedName?.trim();
  return trimmed ? trimmed : fallback;
}

// ---- Render plan: one string, two overlays ----

/** Where one word of `segment.words` sits inside `segment.text`. */
export interface WordRange {
  /** Index into `segment.words`. */
  index: number;
  start: number;
  end: number;
}

/**
 * Locates each word inside `text`, in order of appearance, returning character
 * ranges.
 *
 * Why this exists: `segment.text` is the provider's smart-formatted prose while
 * `segment.words` are separate tokens. To paint per-word state (uncertain
 * confidence, the playback cursor) on the *same* string the search highlights,
 * we have to know where each word sits in it. Rendering the words instead would
 * hide every match that spans a space.
 *
 * Matching is fold-insensitive (see `foldForSearch`) and forward-only, so a
 * repeated word lands on its own occurrence. A word the segment text does not
 * contain verbatim — Whisper's segment text is not always a plain join of its
 * word tokens — is skipped: it loses its overlay, never its text.
 */
export function alignWordsToText(text: string, words: readonly TranscriptWord[]): WordRange[] {
  const { folded, offsets } = foldForSearch(text);
  const ranges: WordRange[] = [];
  let cursor = 0;

  for (let index = 0; index < words.length; index += 1) {
    const needle = foldForSearch(words[index].text).folded;
    if (!needle) continue;
    const at = folded.indexOf(needle, cursor);
    if (at < 0) continue;
    const start = offsets[at];
    let end = offsets[at + needle.length - 1] + 1;
    // Keep any trailing character that folded away (a lone combining mark)
    // inside the word, so a glyph is never split across two spans.
    while (end < text.length && foldForSearch(text[end]).folded === "") end += 1;
    ranges.push({ index, start, end });
    cursor = at + needle.length;
  }

  return ranges;
}

/** A run of text inside one search span, belonging to at most one word. */
export interface TurnPart {
  text: string;
  /** Index into `segment.words`, or null where no word claims this text. */
  wordIndex: number | null;
  /** True when this part reaches the end of its word — where the a11y note goes. */
  wordEnd: boolean;
}

/** One search span: a match, or the plain text between matches. */
export interface TurnSpan {
  hit: boolean;
  parts: TurnPart[];
}

function partsIn(
  text: string,
  from: number,
  to: number,
  ranges: readonly WordRange[]
): TurnPart[] {
  const parts: TurnPart[] = [];
  let cursor = from;

  for (const range of ranges) {
    if (range.end <= from) continue;
    if (range.start >= to) break;
    const start = Math.max(range.start, from);
    const end = Math.min(range.end, to);
    if (start > cursor) parts.push({ text: text.slice(cursor, start), wordIndex: null, wordEnd: false });
    if (end > start) {
      parts.push({ text: text.slice(start, end), wordIndex: range.index, wordEnd: end === range.end });
    }
    cursor = end;
  }

  if (cursor < to) parts.push({ text: text.slice(cursor, to), wordIndex: null, wordEnd: false });
  return parts;
}

/**
 * The render plan for one turn: `segment.text` cut into search spans, each span
 * subdivided by the words it covers.
 *
 * The search runs over the whole turn *once*, so a query with a space still
 * matches, and the spans nest the right way round: one `<mark>` per match, word
 * overlays inside it. That makes the number of `<mark>` elements a turn renders
 * exactly `countMatches(segment.text, query)` in every rendering mode — the
 * highlights and the match counter are read off the same string, which is the
 * whole point.
 *
 * `perWord` only decides whether word overlays are computed; it never changes
 * the text, nor the number of matches.
 */
export function buildTurnSpans(
  segment: TranscriptSegment,
  query: string,
  options: { perWord: boolean }
): TurnSpan[] {
  const text = segment.text;
  const ranges = options.perWord ? alignWordsToText(text, segment.words) : [];
  const plan: TurnSpan[] = [];
  let at = 0;

  for (const span of splitByQuery(text, query)) {
    const from = Math.min(at, text.length);
    const to = Math.min(from + span.text.length, text.length);
    at = to;
    plan.push({ hit: span.hit, parts: partsIn(text, from, to, ranges) });
  }

  return plan;
}

// ---- Copy ----

/**
 * Words rejoined with spaces. A fallback for callers holding words without the
 * provider's punctuated text; the reader itself always renders `segment.text`.
 */
export function joinWords(words: readonly TranscriptWord[]): string {
  return words.map((word) => word.text).join(" ");
}

/**
 * One turn as plain text. `speakerLabel` is already localised by the caller —
 * this module never knows a language.
 */
export function segmentToCopyText(
  segment: TranscriptSegment,
  speakerLabel: string | null,
  options: TranscriptCopyOptions
): string {
  const prefix: string[] = [];
  if (options.timestamps) prefix.push(`[${formatTimecode(segment.start)}]`);
  if (options.speakers && speakerLabel) prefix.push(`${speakerLabel} :`);
  return prefix.length > 0 ? `${prefix.join(" ")} ${segment.text}` : segment.text;
}

/**
 * The whole transcript as plain text, one blank line between turns. Copy always
 * mirrors what is on screen: hide the timestamps and they leave the clipboard
 * too, which is the behaviour a teacher pasting into a worksheet expects.
 */
export function transcriptToCopyText(
  segments: readonly TranscriptSegment[],
  speakerLabelFor: (speakerId: string | null) => string | null,
  options: TranscriptCopyOptions
): string {
  const lines: string[] = [];
  let previousSpeaker: string | null | undefined;
  for (const segment of segments) {
    const repeated = previousSpeaker !== undefined && previousSpeaker === segment.speaker;
    const label = repeated ? null : speakerLabelFor(segment.speaker);
    lines.push(segmentToCopyText(segment, label, options));
    previousSpeaker = segment.speaker;
  }
  return lines.join("\n\n");
}
