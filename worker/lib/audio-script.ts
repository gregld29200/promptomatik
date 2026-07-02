import type { AudioMode } from "./audio-config";

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
    /^(speaker|locuteur)\s*(\d+)\s*:/gim,
    (_match, _label: string, index: string) => `Speaker ${index}:`
  );
}

export function normalizeVoiceMap(voices: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(voices)) {
    const match = key.match(/^(speaker|locuteur)\s*([12])$/i);
    normalized[match ? `Speaker ${match[2]}` : key] = value;
  }

  return normalized;
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

    if (/^(Speaker|Locuteur)\s+\d+\s*:/i.test(line)) {
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
