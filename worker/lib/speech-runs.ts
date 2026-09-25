import type { AudioDirection, AudioMode } from "./audio-config";
import { speechStyle, validateTranscriptForTts } from "./audio-direction";

export interface SpeechRun {
  /** Spoken verbatim: no speaker label, no square-bracket tag. */
  text: string;
  voice: string;
  /** speech_metadata.style; empty when the block carries no direction. */
  style: string;
  /** Dialogue turn (always 0 in a monologue); a pause separates turns. */
  turn: number;
}

export interface PlanSpeechRunsInput {
  script: string;
  mode: AudioMode;
  voices: Record<string, string>;
  direction?: AudioDirection;
}

// The studio's square-bracket tags were written for the 2.5 models, which
// read performance cues out of the prompt. Gemini 3.8 speaks its input
// verbatim, so each tag is translated: a momentary sound becomes one of 3.8's
// inline angle-bracket events, a sustained manner moves into the style of the
// text it colours, and anything else is dropped rather than read aloud.
export const EVENT_TAGS: Record<string, string> = {
  "[sighs]": "<sigh>",
  "[laughs]": "<laugh>",
  "[giggles]": "<laugh>",
  "[gasp]": "<gasp>",
  "[pause]": "<short pause>",
};

export const MANNER_TAGS: Record<string, string> = {
  "[whispers]": "whispering",
  "[shouting]": "shouting",
  "[excited]": "excited",
  "[tired]": "tired",
  "[serious]": "serious",
  "[sarcastic]": "sarcastic",
  "[curious]": "curious",
  "[amazed]": "amazed",
  "[panicked]": "panicked",
  "[crying]": "crying",
  "[trembling]": "with a trembling voice",
  "[hesitant]": "hesitant",
  "[very fast]": "speaking very fast",
  "[very slow]": "speaking very slowly",
  "[smiling]": "smiling",
};

const TAG_RE = /\[[^\]]*]/g;
const TURN_RE = /^(Speaker [12]):\s*/;
// A sentence ends after its terminal punctuation, any closing quote or
// bracket, and the whitespace that follows, so "3.5" stays whole.
const SENTENCE_END_RE = /[.!?…]+["'”’»)\]]*\s+/g;

function tagKey(tag: string): string {
  return `[${tag.slice(1, -1).trim().replace(/\s+/g, " ").toLowerCase()}]`;
}

function mannersIn(text: string): string[] {
  const manners: string[] = [];
  for (const tag of text.match(TAG_RE) ?? []) {
    const manner = MANNER_TAGS[tagKey(tag)];
    if (manner && !manners.includes(manner)) manners.push(manner);
  }
  return manners;
}

function spokenText(text: string): string {
  return text
    .replace(TAG_RE, (tag) => EVENT_TAGS[tagKey(tag)] ?? " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// Splits after each newline, keeping it, so the pieces rejoin losslessly.
function lines(text: string): string[] {
  return text.split(/(?<=\n)/);
}

function sentences(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (const match of text.matchAll(SENTENCE_END_RE)) {
    const end = (match.index ?? 0) + match[0].length;
    parts.push(text.slice(start, end));
    start = end;
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts;
}

function withManners(manners: string[], base: string): string {
  const lead = manners.join(", ");
  const sentence = `${lead.charAt(0).toUpperCase()}${lead.slice(1)}.`;
  return base ? `${sentence} ${base}` : sentence;
}

interface Turn {
  speaker: string;
  text: string;
}

function turnsOf(script: string, mode: AudioMode): Turn[] {
  if (mode === "monologue") return [{ speaker: "solo", text: script }];
  return script.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(TURN_RE);
      // validateTranscriptForTts has already refused any unlabelled line.
      if (!match) throw new Error(`Unlabelled dialogue line: ${line}`);
      return { speaker: match[1], text: line.slice(match[0].length) };
    });
}

function voiceFor(input: PlanSpeechRunsInput, speaker: string): string {
  const voice = input.mode === "monologue"
    ? input.voices.solo ?? Object.values(input.voices)[0]
    : input.voices[speaker];
  if (!voice) throw new Error(`Missing voice for ${speaker}.`);
  return voice;
}

// Splits one audio block into the single-voice requests Gemini 3.8 takes
// through OpenRouter: one per dialogue turn, and within a turn one per run
// of sentences sharing a style. A manner tag colours the rest of its line
// from the sentence it sits in: the rest of the turn in a dialogue, that one
// sentence in a monologue block (whose lines are its sentences).
export function planSpeechRuns(input: PlanSpeechRunsInput): SpeechRun[] {
  validateTranscriptForTts(input.mode, input.script);
  const runs: SpeechRun[] = [];

  turnsOf(input.script, input.mode).forEach((turn, index) => {
    const voice = voiceFor(input, turn.speaker);
    const base = input.direction
      ? speechStyle({ direction: input.direction, mode: input.mode, speaker: turn.speaker })
      : "";
    const pieces: Array<{ raw: string; style: string }> = [];

    for (const line of lines(turn.text)) {
      const manners: string[] = [];
      for (const sentence of sentences(line)) {
        for (const manner of mannersIn(sentence)) {
          if (!manners.includes(manner)) manners.push(manner);
        }
        const style = manners.length > 0 ? withManners(manners, base) : base;
        const last = pieces[pieces.length - 1];
        if (last && last.style === style) {
          last.raw += sentence;
        } else {
          pieces.push({ raw: sentence, style });
        }
      }
    }

    for (const piece of pieces) {
      const text = spokenText(piece.raw);
      if (text) runs.push({ text, voice, style: piece.style, turn: index });
    }
  });

  return runs;
}
