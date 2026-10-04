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

export interface Demo {
  /** The characters in order of appearance, with the voice that plays each. */
  cast: Array<{ name: string; voice: string }>;
  take: { file: string; seconds: number; estimatedSeconds: number; peaks: number[]; turns: Turn[] };
  compare: CompareTake[];
}

export type TutorialData = {
  shots: ShotSet;
  voice: Record<string, VoiceEntry>;
  demo: Demo;
};

async function load<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(staticFile(path), { signal });
  if (!response.ok) throw new Error(`${path} is missing: run npm run demo, npm run voice and npm run capture first.`);
  return (await response.json()) as T;
}

// Everything the edit is timed and framed on, made by the scripts in scripts/.
export async function loadTutorialData(signal?: AbortSignal): Promise<TutorialData> {
  const [shots, voice, demo] = await Promise.all([
    load<ShotSet>("studio-audio/shots/shots.json", signal),
    load<Record<string, VoiceEntry>>("studio-audio/voice/manifest.json", signal),
    load<Demo>("studio-audio/demo.json", signal),
  ]);
  return { shots, voice, demo };
}
