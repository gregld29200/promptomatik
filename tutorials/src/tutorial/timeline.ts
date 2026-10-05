import { FPS } from "../theme";
import { audioDemo, type Box, type TutorialData } from "./data";
import type { Beat, Chapter, Cut, TutorialScript } from "./types";

export type { Cut };

const sec = (seconds: number) => Math.round(seconds * FPS);

export const TIMING = {
  title: sec(3.6),
  card: sec(2.6),
  /** Silence before a paragraph's voice, and after it. */
  lead: sec(0.2),
  tail: sec(0.5),
  /** Turns of the take heard before chapter 0. */
  resultTurns: 3,
  resultPad: sec(0.9),
  comparePad: sec(1.1),
  compareGap: sec(0.9),
  end: sec(4.2),
  /** A frame jump hides under a full-screen card this long before it lifts. */
  hiddenCut: sec(0.6),
};

export interface StageKey {
  frame: number;
  shot: string;
  focus: Box | "page";
  spotlight?: Box;
  click?: Box;
  callout?: { target: Box; text: string; side?: "above" | "below" };
  /** Starts without a camera move: a card covers the jump. */
  cut: boolean;
}

export type Overlay =
  | { kind: "title"; from: number; duration: number }
  | { kind: "card"; from: number; duration: number; chapter: Chapter }
  | { kind: "result"; from: number; duration: number; audioFrom: number }
  | { kind: "compare"; from: number; duration: number; starts: number[] }
  | { kind: "recap"; from: number; duration: number; steps: number[] }
  | { kind: "scene"; from: number; duration: number; name: string }
  | { kind: "end"; from: number; duration: number };

export interface Sound {
  from: number;
  frames: number;
  file: string;
}

export interface Caption {
  from: number;
  to: number;
  text: string;
}

export interface ChapterSpan {
  id: string;
  label?: string;
  title: string;
  from: number;
  to: number;
}

export type Timeline = {
  duration: number;
  overlays: Overlay[];
  keys: StageKey[];
  voices: Sound[];
  sounds: Sound[];
  captions: Caption[];
  chapters: ChapterSpan[];
};

// A box missing from a shot (a button that disappeared once clicked) is
// taken from the shot where it was last seen: the layout around it is the
// same. Shots are in the order they were captured.
function findBox(data: TutorialData, shot: string, id: string): Box {
  const own = data.shots.shots[shot]?.boxes[id];
  if (own) return own;
  const order = Object.keys(data.shots.shots);
  const index = order.indexOf(shot);
  const nearest = [...order.slice(0, index).reverse(), ...order.slice(index + 1)];
  for (const other of nearest) {
    const box = data.shots.shots[other]?.boxes[id];
    if (box) return box;
  }
  throw new Error(`No box "${id}" in any capture (wanted in "${shot}"): check scripts/capture.mts.`);
}

function resolveKey(data: TutorialData, beat: Beat, frame: number, cut: boolean): StageKey {
  if (!data.shots.shots[beat.shot]) throw new Error(`No capture "${beat.shot}": run npm run capture.`);
  const box = (id: string) => findBox(data, beat.shot, id);
  return {
    frame,
    shot: beat.shot,
    cut,
    focus: beat.focus === "page" ? "page" : box(beat.focus),
    spotlight: beat.spotlight ? box(beat.spotlight) : undefined,
    click: beat.click ? box(beat.click) : undefined,
    callout: beat.callout ? { target: box(beat.callout.target), text: beat.callout.text, side: beat.callout.side } : undefined,
  };
}

const MAX_CAPTION = 84;

// Captions of at most two short lines, cut at the punctuation nearest the middle.
export function captionChunks(text: string): string[] {
  const sentences = text.split(/(?<=[.!?…])\s+(?=[A-ZÀ-ÖØ-Þ«])/u);
  const out: string[] = [];
  const split = (chunk: string) => {
    if (chunk.length <= MAX_CAPTION) {
      out.push(chunk);
      return;
    }
    const middle = chunk.length / 2;
    const cuts = [...chunk.matchAll(/[,:;]\s+|\s+(?=«)/g)].map((match) => (match.index ?? 0) + match[0].length);
    const spaces = [...chunk.matchAll(/\s+/g)].map((match) => (match.index ?? 0) + match[0].length);
    const pool = cuts.filter((at) => at >= 28 && at <= chunk.length - 28);
    const candidates = pool.length > 0 ? pool : spaces;
    const at = candidates.reduce((best, value) => (Math.abs(value - middle) < Math.abs(best - middle) ? value : best), candidates[0]);
    split(chunk.slice(0, at).trim());
    split(chunk.slice(at).trim());
  };
  sentences.forEach(split);
  return out;
}

function captionsFor(text: string, from: number, frames: number): Caption[] {
  const chunks = captionChunks(text);
  const weight = (chunk: string) => chunk.length + 12;
  const total = chunks.reduce((sum, chunk) => sum + weight(chunk), 0);
  let cursor = from;
  return chunks.map((chunk, index) => {
    const length = index === chunks.length - 1 ? from + frames - cursor : Math.round((weight(chunk) / total) * frames);
    const caption = { from: cursor, to: cursor + length, text: chunk };
    cursor += length;
    return caption;
  });
}

// Each recap step appears as the narration reaches it.
function recapSteps(cues: string[], text: string, from: number, frames: number): number[] {
  return cues.map((cue) => {
    const at = text.indexOf(cue);
    if (at < 0) throw new Error(`Recap cue "${cue}" is not in the narration.`);
    return from + Math.round((at / text.length) * frames);
  });
}

export function buildTimeline(script: TutorialScript, data: TutorialData, cut: Cut): Timeline {
  const overlays: Overlay[] = [];
  const keys: StageKey[] = [];
  const voices: Sound[] = [];
  const sounds: Sound[] = [];
  const captions: Caption[] = [];
  const chapters: ChapterSpan[] = [];

  overlays.push({ kind: "title", from: 0, duration: TIMING.title });
  let t = TIMING.title;
  let covered = true;

  for (const chapter of script.chapters) {
    if (chapter.moduleOnly && cut !== "module") continue;
    const chapterFrom = t;
    if (chapter.label !== undefined) {
      overlays.push({ kind: "card", from: t, duration: TIMING.card, chapter });
      t += TIMING.card;
      covered = true;
    }
    if (chapter.before === "result") {
      const take = audioDemo(data).take;
      const turns = take.turns.slice(0, TIMING.resultTurns);
      const frames = sec(turns[turns.length - 1].end + 0.3);
      const audioFrom = t + TIMING.resultPad;
      overlays.push({ kind: "result", from: t, duration: frames + TIMING.resultPad * 2, audioFrom });
      sounds.push({ from: audioFrom, frames, file: take.file });
      t += frames + TIMING.resultPad * 2;
      covered = true;
    }
    for (const paragraph of chapter.paragraphs) {
      const voice = data.voice[paragraph.id];
      if (!voice) throw new Error(`No narration for "${paragraph.id}": run npm run voice -- ${script.id}.`);
      const frames = sec(voice.seconds);
      const voiceFrom = t + TIMING.lead;
      voices.push({ from: voiceFrom, frames, file: voice.file });
      paragraph.beats.forEach((beat, index) => {
        const first = index === 0;
        const frame = first ? (covered ? t - TIMING.hiddenCut : t) : voiceFrom + Math.round((beat.at ?? 0) * frames);
        keys.push(resolveKey(data, beat, frame, first && covered));
      });
      captions.push(...captionsFor(paragraph.text, voiceFrom, frames));
      if (paragraph.recap) {
        overlays.push({ kind: "recap", from: voiceFrom, duration: frames + TIMING.tail, steps: recapSteps(script.recap.cues, paragraph.text, voiceFrom, frames) });
      }
      if (paragraph.scene) overlays.push({ kind: "scene", from: t, duration: TIMING.lead + frames + TIMING.tail, name: paragraph.scene });
      t = voiceFrom + frames + TIMING.tail;
      covered = Boolean(paragraph.scene);

      if (paragraph.after === "compare") {
        const starts: number[] = [];
        let cursor = t + TIMING.comparePad;
        for (const take of audioDemo(data).compare) {
          const takeFrames = sec(take.seconds);
          starts.push(cursor);
          sounds.push({ from: cursor, frames: takeFrames, file: take.file });
          cursor += takeFrames + TIMING.compareGap;
        }
        const duration = cursor - TIMING.compareGap + TIMING.comparePad - t;
        overlays.push({ kind: "compare", from: t, duration, starts });
        t += duration;
        covered = true;
      }
    }
    chapters.push({ id: chapter.id, label: chapter.label, title: chapter.title, from: chapterFrom, to: t });
  }

  overlays.push({ kind: "end", from: t, duration: TIMING.end });
  t += TIMING.end;
  return { duration: t, overlays, keys, voices, sounds, captions, chapters };
}
