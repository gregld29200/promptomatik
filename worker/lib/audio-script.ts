import type { AudioDirection, AudioMode, AudioSpeakerDirection } from "./audio-config";
import { SPEAKER_LABEL_WORDS } from "../../src/lib/audio-script-rules";

const SPEAKER_LINE_RE = new RegExp(`^(${SPEAKER_LABEL_WORDS})\\s+\\d+\\s*:`, "i");
// Voice- and direction-map keys arrive named the way the client displays them.
const SPEAKER_SLOT_KEY_RE = new RegExp(`^(${SPEAKER_LABEL_WORDS})\\s*([12])$`, "i");

export interface AudioBlock {
  idx: number;
  text: string;
  estimatedSeconds: number;
}

const MAX_BLOCK_SECONDS = 90;
const WORDS_PER_SECOND = 2.5;

export function stripAudioTags(text: string): string {
  return text.replace(/\[[^\]]*]/g, " ");
}

export function estimateAudioSeconds(text: string): number {
  const words = stripAudioTags(text).trim().match(/\S+/g);
  return Math.ceil((words?.length ?? 0) / WORDS_PER_SECOND);
}

export function normalizeSpeakerLabels(script: string): string {
  return script.replace(
    new RegExp(`^(${SPEAKER_LABEL_WORDS})\\s*(\\d+)\\s*:`, "gim"),
    (_match, _label: string, index: string) => `Speaker ${index}:`
  );
}

export function normalizeVoiceMap(voices: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(voices)) {
    const match = key.match(SPEAKER_SLOT_KEY_RE);
    normalized[match ? `Speaker ${match[2]}` : key] = value;
  }

  return normalized;
}

const SPEAKER_FIELD_LIMITS: Record<keyof AudioSpeakerDirection, number> = {
  accent: 80,
  accentDetail: 120,
  style: 80,
  notes: 200,
};

// Per-speaker direction overrides only make sense for dialogue, only for
// the two canonical speakers, and only with bounded, non-empty strings.
export function normalizeSpeakerDirections(direction: AudioDirection, mode: AudioMode): AudioDirection {
  const { speakers, ...rest } = direction;
  if (typeof rest.notes === "string") {
    const trimmed = rest.notes.trim().slice(0, SPEAKER_FIELD_LIMITS.notes);
    if (trimmed) rest.notes = trimmed;
    else delete rest.notes;
  }
  if (mode !== "dialogue" || !speakers || typeof speakers !== "object") {
    return rest;
  }

  const normalized: Record<string, AudioSpeakerDirection> = {};
  for (const [key, value] of Object.entries(speakers)) {
    const match = key.match(SPEAKER_SLOT_KEY_RE);
    if (!match || !value || typeof value !== "object") continue;

    const entry: AudioSpeakerDirection = {};
    for (const field of Object.keys(SPEAKER_FIELD_LIMITS) as (keyof AudioSpeakerDirection)[]) {
      const raw = (value as Record<string, unknown>)[field];
      if (typeof raw !== "string") continue;
      const trimmed = raw.trim().slice(0, SPEAKER_FIELD_LIMITS[field]);
      if (trimmed) entry[field] = trimmed;
    }
    if (Object.keys(entry).length > 0) {
      normalized[`Speaker ${match[2]}`] = entry;
    }
  }

  return Object.keys(normalized).length > 0 ? { ...rest, speakers: normalized } : rest;
}

function pushBlock(blocks: AudioBlock[], parts: string[]) {
  const text = parts.join("\n").trim();
  if (!text) return;
  blocks.push({
    idx: blocks.length,
    text,
    estimatedSeconds: estimateAudioSeconds(text),
  });
}

function dialogueUnits(script: string): string[] {
  const units: string[] = [];
  let current: string[] = [];

  for (const rawLine of script.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (SPEAKER_LINE_RE.test(line)) {
      if (current.length > 0) {
        units.push(current.join("\n"));
      }
      current = [line];
      continue;
    }

    if (current.length > 0) {
      current.push(line);
    } else {
      units.push(line);
    }
  }

  if (current.length > 0) {
    units.push(current.join("\n"));
  }

  return units;
}

function monologueUnits(script: string): string[] {
  const normalized = script.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  return normalized.match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g)?.map((s) => s.trim()) ?? [normalized];
}

export function splitScriptIntoBlocks(
  script: string,
  mode: AudioMode,
  maxSeconds = MAX_BLOCK_SECONDS
): AudioBlock[] {
  const units = mode === "dialogue" ? dialogueUnits(script) : monologueUnits(script);
  const blocks: AudioBlock[] = [];
  let current: string[] = [];

  for (const unit of units) {
    const unitSeconds = estimateAudioSeconds(unit);
    if (current.length === 0) {
      current.push(unit);
      continue;
    }

    const candidate = [...current, unit];
    if (estimateAudioSeconds(candidate.join("\n")) <= maxSeconds) {
      current = candidate;
      continue;
    }

    pushBlock(blocks, current);
    current = [unit];

    if (unitSeconds > maxSeconds) {
      pushBlock(blocks, current);
      current = [];
    }
  }

  pushBlock(blocks, current);
  return blocks;
}
