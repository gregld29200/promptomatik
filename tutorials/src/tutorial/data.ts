import { staticFile } from "remotion";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Shot {
  file: string;
  width: number;
  height: number;
  boxes: Record<string, Box>;
}

export interface ShotSet {
  viewport: { width: number; height: number };
  shots: Record<string, Shot>;
}

export interface VoiceEntry {
  file: string;
  seconds: number;
  text: string;
  source: "studio" | "recorded";
}

export interface Turn {
  speaker: string;
  text: string;
  start: number;
  end: number;
}

export interface CompareTake {
  id: string;
  label: string;
  level: string;
  file: string;
  seconds: number;
  peaks: number[];
}

/** The Studio audio demo: the take heard first and the level comparison. */
export interface AudioDemo {
  /** The characters in order of appearance, with the voice that plays each. */
  cast: Array<{ name: string; voice: string }>;
  take: { file: string; seconds: number; estimatedSeconds: number; peaks: number[]; turns: Turn[] };
  compare: CompareTake[];
}

/** The Documents demo: the finished document's pages, shown first. */
export interface DocumentsDemo {
  kind: "documents";
  title: string;
  pages: Array<{ file: string; width: number; height: number }>;
}

export type TutorialData = {
  shots: ShotSet;
  voice: Record<string, VoiceEntry>;
  demo: AudioDemo | DocumentsDemo;
};

export function audioDemo(data: TutorialData): AudioDemo {
  if ("kind" in data.demo) throw new Error("This tutorial has no audio demo.");
  return data.demo;
}

export function documentsDemo(data: TutorialData): DocumentsDemo {
  if (!("kind" in data.demo)) throw new Error("This tutorial has no document demo.");
  return data.demo;
}

async function load<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(staticFile(path), { signal });
  if (!response.ok) throw new Error(`${path} is missing: run the tutorial's demo, voice and capture scripts first.`);
  return (await response.json()) as T;
}

// Everything the edit is timed and framed on, made by the scripts in scripts/.
export async function loadTutorialData(id: string, signal?: AbortSignal): Promise<TutorialData> {
  const [shots, voice, demo] = await Promise.all([
    load<ShotSet>(`${id}/shots/shots.json`, signal),
    load<Record<string, VoiceEntry>>(`${id}/voice/manifest.json`, signal),
    load<AudioDemo | DocumentsDemo>(`${id}/demo.json`, signal),
  ]);
  return { shots, voice, demo };
}
