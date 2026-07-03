import type { Env } from "../env";

export type AudioMode = "monologue" | "dialogue";
export type AudioQuality = "draft" | "final";
export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1";

// Per-speaker overrides for dialogue mode (PRD amendment, 2026-07-02):
// accent/style default to the global Direction; notes is a free
// "manner of speaking" hint appended verbatim to that speaker's profile.
export interface AudioSpeakerDirection {
  accent?: string;
  accentDetail?: string;
  style?: string;
  notes?: string;
}

export interface AudioDirection {
  level: CefrLevel;
  accent: string;
  accentDetail?: string;
  pace: string;
  style: string;
  scene?: string;
  // Free manner-of-speaking note; voiced by the narrator in monologue
  // mode (dialogue speakers carry their own notes in `speakers`).
  notes?: string;
  speakers?: Record<string, AudioSpeakerDirection>;
}

export interface TtsModelConfig {
  draftModel: string;
  finalModel: string;
  draftPricePer1MTokens: number;
  finalPricePer1MTokens: number;
  prepModel: string;
}

export const PCM_SAMPLE_RATE = 24_000;
export const PCM_CHANNELS = 1;
export const PCM_BYTES_PER_SAMPLE = 2;
export const PCM_BYTES_PER_SECOND = PCM_SAMPLE_RATE * PCM_CHANNELS * PCM_BYTES_PER_SAMPLE;
export const AUDIO_TOKENS_PER_SECOND = 25;

const DEFAULT_TTS_MODEL_DRAFT = "gemini-2.5-flash-preview-tts";
const DEFAULT_TTS_MODEL_FINAL = "gemini-2.5-pro-preview-tts";
const DEFAULT_LLM_MODEL_PREP = "gemini-2.5-flash";

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function getTtsModelConfig(env: Env): TtsModelConfig {
  return {
    draftModel: env.TTS_MODEL_DRAFT?.trim() || DEFAULT_TTS_MODEL_DRAFT,
    finalModel: env.TTS_MODEL_FINAL?.trim() || DEFAULT_TTS_MODEL_FINAL,
    draftPricePer1MTokens: readNumber(env.TTS_PRICE_AUDIO_PER_1M_TOKENS_DRAFT, 10),
    finalPricePer1MTokens: readNumber(env.TTS_PRICE_AUDIO_PER_1M_TOKENS_FINAL, 20),
    prepModel: env.LLM_MODEL_PREP?.trim() || DEFAULT_LLM_MODEL_PREP,
  };
}

export function modelForQuality(config: TtsModelConfig, quality: AudioQuality): string {
  return quality === "draft" ? config.draftModel : config.finalModel;
}

export function audioCostUsd(seconds: number, pricePer1MTokens: number): number {
  const audioTokens = Math.ceil(Math.max(0, seconds)) * AUDIO_TOKENS_PER_SECOND;
  return (audioTokens / 1_000_000) * pricePer1MTokens;
}

export const CEFR_DELIVERY: Record<CefrLevel, { pacing: string; clarity: string }> = {
  A1: {
    pacing: "Noticeably slower than natural speech, short breath groups, predictable intonation.",
    clarity: "Very clear articulation, no reduced forms, gentle sentence stress.",
  },
  A2: {
    pacing: "Noticeably slower than natural speech, short breath groups, predictable intonation.",
    clarity: "Very clear articulation, no reduced forms, gentle sentence stress.",
  },
  B1: {
    pacing: "Controlled natural pace with moderate pauses between ideas.",
    clarity: "Clear articulation, limited reduced forms, clear sentence stress.",
  },
  B2: {
    pacing: "Close to natural pace, realistic rhythm.",
    clarity: "Natural but clear; reduced forms allowed.",
  },
  C1: {
    pacing: "Fully authentic pace and rhythm, subtle emotion.",
    clarity: "Authentic speech; natural linking and reduction.",
  },
};

export const STYLE_EXPANSIONS: Record<string, string> = {
  "Neutral classroom": "A clear, balanced classroom delivery focused on comprehension.",
  "Warm and encouraging": "Supportive, patient, and gently motivating without exaggeration.",
  "Professional corporate": "Polished, composed, and credible, suitable for workplace training.",
  "Business meeting": "Natural professional conversation with attentive turn-taking.",
  "Podcast host": "Confident, engaging host energy with crisp transitions.",
  "Examiner voice": "Objective, measured, calm, and consistent.",
  "Customer service": "Helpful, courteous, and solution-oriented.",
  "Informal conversation": "Relaxed, spontaneous, and natural.",
  Storytelling: "Expressive narration with clear images and controlled emotion.",
};

export const PACE_EXPANSIONS: Record<string, string> = {
  "Slow learner-friendly": "Slow learner-friendly delivery with enough space to process each idea.",
  "Natural classroom speed": "Natural classroom speed, clear but not artificial.",
  "Business meeting speed": "Business meeting speed with realistic professional rhythm.",
  "Exam speed": "Exam speed: controlled, neutral, and consistent.",
  "Fast authentic speech": "Fast authentic speech with natural reductions where appropriate.",
};

export const ACCENT_EXPANSIONS: Record<string, string> = {
  "Neutral international": "A neutral, clear accent, natural for the language of the transcript.",
  British: "British English.",
  "North American": "North American English.",
  Australian: "Australian English.",
  Irish: "Irish English.",
  "Indian English": "Indian English.",
  "French-accented English": "English spoken with a French accent.",
  Neutral: "Neutral French.",
  Parisian: "Parisian French.",
  Canadian: "Canadian French.",
  "Slow classroom French": "Slow classroom French.",
};

export function expandPreset(expansions: Record<string, string>, key: string): string {
  return expansions[key] ?? key;
}
