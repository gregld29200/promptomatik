import type { AudioDirection, AudioMode } from "./audio-config";
import { dialogueUnits, monologueUnits } from "./audio-script";

// Free preview of a take: only the opening of the script is ever voiced, so
// the excerpt is cut here, before any text-to-speech request, never after.
// Tuned for 10-20 s of audio with Gemini 3.8 Flash (measured 2026-10-15):
// 12-18 characters a second at a natural pace, so the 300/400 first planned
// would overrun 20 s, but 9-16 at A1 or with the slow pace, hence the smaller
// budget for a slow delivery. The same text varies by up to half from one take
// to the next, so the range is a target, not a guarantee. Dialogue caps count
// the speaker labels.
export const PREVIEW_MONOLOGUE_TARGET_CHARS = 220;
export const PREVIEW_MONOLOGUE_MAX_CHARS = 260;
export const PREVIEW_DIALOGUE_MAX_CHARS = 300;
export const PREVIEW_SLOW_DELIVERY_FACTOR = 0.7;
export const PREVIEW_DIALOGUE_MIN_TURNS = 2;
export const PREVIEW_DIALOGUE_MAX_TURNS = 3;
// A sentence cut shorter than this share of its target leaves too little to
// hear, so the cut falls on the last whole word instead.
const MIN_SENTENCE_SHARE = 0.5;

const TURN_RE = /^(Speaker \d+):\s*/;

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// Cuts at the last space within `limit`, never inside a word or an unclosed
// [tag], and drops the dangling comma or dash the cut leaves behind.
export function cutAtWord(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = text.slice(0, limit + 1);
  const space = head.lastIndexOf(" ");
  let cut = space > 0 ? head.slice(0, space) : text.slice(0, limit);
  const open = cut.lastIndexOf("[");
  if (open > cut.lastIndexOf("]")) cut = cut.slice(0, open);
  return cut.replace(/[\s,;:–—-]+$/u, "");
}

// The sentence end closest to `target` that stays within `max`; a text with
// no usable sentence end is cut on a word near `target`.
export function cutAtSentence(text: string, target: number, max: number): string {
  const normalized = collapse(text);
  if (normalized.length <= target) return normalized;

  let best = "";
  let bestDistance = Number.POSITIVE_INFINITY;
  let running = "";
  for (const sentence of monologueUnits(normalized)) {
    running = running ? `${running} ${sentence}` : sentence;
    if (running.length > max) break;
    const distance = Math.abs(target - running.length);
    if (distance < bestDistance) {
      best = running;
      bestDistance = distance;
    }
  }
  if (best.length >= target * MIN_SENTENCE_SHARE) return best;
  return cutAtWord(normalized, target);
}

export interface ExcerptOptions {
  /** A1/A2 or the slow pace: fewer characters fill the same seconds. */
  slow?: boolean;
}

function scaled(chars: number, options: ExcerptOptions): number {
  return options.slow ? Math.round(chars * PREVIEW_SLOW_DELIVERY_FACTOR) : chars;
}

export function monologueExcerpt(script: string, options: ExcerptOptions = {}): string {
  return cutAtSentence(script, scaled(PREVIEW_MONOLOGUE_TARGET_CHARS, options), scaled(PREVIEW_MONOLOGUE_MAX_CHARS, options));
}

interface Turn {
  speaker: string;
  body: string;
}

function turnsOf(script: string): Turn[] {
  return dialogueUnits(script).flatMap((unit) => {
    const match = unit.match(TURN_RE);
    return match ? [{ speaker: match[1], body: collapse(unit.slice(match[0].length)) }] : [];
  });
}

function lineOf(turn: Turn): string {
  return `${turn.speaker}: ${turn.body}`;
}

// The opening turn, then the first turn of every voice not yet heard, then
// the next turns up to the minimum, all in script order.
function requiredTurns(turns: Turn[]): number[] {
  const picked = [0];
  const heard = new Set([turns[0].speaker]);
  turns.forEach((turn, index) => {
    if (!heard.has(turn.speaker) && picked.length < PREVIEW_DIALOGUE_MAX_TURNS) {
      heard.add(turn.speaker);
      picked.push(index);
    }
  });
  for (let index = 1; picked.length < PREVIEW_DIALOGUE_MIN_TURNS && index < turns.length; index += 1) {
    if (!picked.includes(index)) picked.push(index);
  }
  return picked.sort((a, b) => a - b);
}

// Shares the character budget fairly: short turns keep their full length and
// hand what they do not use to the longer ones.
function shareBudget(lengths: number[], budget: number): number[] {
  const shares = new Array<number>(lengths.length).fill(0);
  const order = lengths.map((length, index) => ({ length, index })).sort((a, b) => a.length - b.length);
  let remaining = budget;
  order.forEach(({ length, index }, position) => {
    const share = Math.min(length, Math.floor(remaining / (order.length - position)));
    shares[index] = share;
    remaining -= share;
  });
  return shares;
}

export function dialogueExcerpt(script: string, options: ExcerptOptions = {}): string {
  const maxChars = scaled(PREVIEW_DIALOGUE_MAX_CHARS, options);
  const turns = turnsOf(script);
  if (turns.length === 0) return "";

  const picked = requiredTurns(turns).map((index) => turns[index]);
  const overhead = picked.reduce((sum, turn) => sum + turn.speaker.length + 2, 0) + picked.length - 1;
  const shares = shareBudget(picked.map((turn) => turn.body.length), maxChars - overhead);
  const kept = picked
    .map((turn, index) => ({ ...turn, body: cutAtSentence(turn.body, shares[index], shares[index]) }))
    .filter((turn) => turn.body.length > 0);

  // A third turn is added only whole, and only when it directly follows the
  // turns already kept: half a line, or a jump ahead, sounds broken.
  const lastIndex = turns.indexOf(picked[picked.length - 1]);
  const next = turns[lastIndex + 1];
  const untrimmed = kept.every((turn, index) => turn.body === picked[index]?.body) && kept.length === picked.length;
  const contiguous = picked.every((turn, index) => turns[index] === turn);
  if (next && untrimmed && contiguous && kept.length < PREVIEW_DIALOGUE_MAX_TURNS) {
    const length = kept.map(lineOf).join("\n").length + 1 + lineOf(next).length;
    if (length <= maxChars) kept.push(next);
  }

  return kept.map(lineOf).join("\n");
}

// A1/A2 are directed "noticeably slower than natural speech" (CEFR_DELIVERY).
export function isSlowDelivery(direction: Pick<AudioDirection, "level" | "pace">): boolean {
  return direction.level === "A1" || direction.level === "A2" || direction.pace === "Slow learner-friendly";
}

// `script` arrives normalized: dialogue lines start with "Speaker N:".
export function previewExcerpt(script: string, mode: AudioMode, options: ExcerptOptions = {}): string {
  return mode === "dialogue" ? dialogueExcerpt(script, options) : monologueExcerpt(script, options);
}
