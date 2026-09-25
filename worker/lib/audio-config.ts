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
  monologueModel: string;
  dialogueModel: string;
  draftPricePer1MTokens: number;
  finalPricePer1MTokens: number;
  openRouterPricePer1MTokens: number;
  prepModel: string;
}

export interface TtsModelStep {
  model: string;
  pricePer1MTokens: number;
}

export const PCM_SAMPLE_RATE = 24_000;
export const PCM_CHANNELS = 1;
export const PCM_BYTES_PER_SAMPLE = 2;
export const PCM_BYTES_PER_SECOND = PCM_SAMPLE_RATE * PCM_CHANNELS * PCM_BYTES_PER_SAMPLE;
export const AUDIO_TOKENS_PER_SECOND = 25;

const DEFAULT_TTS_MODEL_DRAFT = "gemini-2.5-flash-preview-tts";
const DEFAULT_TTS_MODEL_FINAL = "gemini-2.5-pro-preview-tts";
// Primary for both modes: Gemini 3.8 Flash TTS served through OpenRouter,
// which puts no daily request cap on a paid model — the Gemini API Tier 1
// caps each TTS model at 50-100 requests/day per project.
const DEFAULT_TTS_MODEL_PRIMARY = "google/gemini-3.8-flash-tts";
const DEFAULT_LLM_MODEL_PREP = "gemini-2.5-flash";

// OpenRouter ids carry the vendor prefix ("google/…"); Gemini API ids do not.
export function isOpenRouterTtsModel(model: string): boolean {
  return model.includes("/");
}

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function getTtsModelConfig(env: Env): TtsModelConfig {
  return {
    draftModel: env.TTS_MODEL_DRAFT?.trim() || DEFAULT_TTS_MODEL_DRAFT,
    finalModel: env.TTS_MODEL_FINAL?.trim() || DEFAULT_TTS_MODEL_FINAL,
    monologueModel: env.TTS_MODEL_MONOLOGUE?.trim() || DEFAULT_TTS_MODEL_PRIMARY,
    dialogueModel: env.TTS_MODEL_DIALOGUE?.trim() || DEFAULT_TTS_MODEL_PRIMARY,
    draftPricePer1MTokens: readNumber(env.TTS_PRICE_AUDIO_PER_1M_TOKENS_DRAFT, 10),
    finalPricePer1MTokens: readNumber(env.TTS_PRICE_AUDIO_PER_1M_TOKENS_FINAL, 20),
    // OpenRouter list price of 3.8 Flash TTS: $9 per 1M audio tokens.
    openRouterPricePer1MTokens: readNumber(env.TTS_PRICE_AUDIO_PER_1M_TOKENS_OPENROUTER, 9),
    prepModel: env.LLM_MODEL_PREP?.trim() || DEFAULT_LLM_MODEL_PREP,
  };
}

export function modelForQuality(config: TtsModelConfig, quality: AudioQuality): string {
  return quality === "draft" ? config.draftModel : config.finalModel;
}

// Per-model audio price: Pro at the higher Gemini rate, any OpenRouter model
// at the OpenRouter rate, every other Gemini Flash-tier model at the lower rate.
export function priceForModel(config: TtsModelConfig, model: string): number {
  if (model === config.finalModel) return config.finalPricePer1MTokens;
  if (isOpenRouterTtsModel(model)) return config.openRouterPricePer1MTokens;
  return config.draftPricePer1MTokens;
}

// Ordered model chain per mode. Both modes start on 3.8 Flash through
// OpenRouter and fall back to 2.5 Pro on the Gemini API: two providers with
// separate keys and limits, so an OpenRouter outage or a spent balance never
// blocks generation.
//   Dialogue:  3.8 Flash (OpenRouter) -> 2.5 Pro (Gemini API)
//   Monologue: 3.8 Flash (OpenRouter) -> 2.5 Pro (Gemini API)
export function modelChainForMode(config: TtsModelConfig, mode: AudioMode): TtsModelStep[] {
  const primary = mode === "dialogue" ? config.dialogueModel : config.monologueModel;
  const chain: TtsModelStep[] = [{ model: primary, pricePer1MTokens: priceForModel(config, primary) }];
  if (config.finalModel !== primary) {
    chain.push({ model: config.finalModel, pricePer1MTokens: priceForModel(config, config.finalModel) });
  }
  return chain;
}

// Gemini 3.8 TTS bills 32 audio tokens per second of speech, not the 25 of
// the 2.5 models (measured through OpenRouter: 384 tokens for 12.0 s).
const OPENROUTER_AUDIO_TOKENS_PER_SECOND = 32;

export function audioTokensPerSecond(model: string): number {
  return isOpenRouterTtsModel(model) ? OPENROUTER_AUDIO_TOKENS_PER_SECOND : AUDIO_TOKENS_PER_SECOND;
}

export function audioCostUsd(
  seconds: number,
  pricePer1MTokens: number,
  tokensPerSecond = AUDIO_TOKENS_PER_SECOND
): number {
  const audioTokens = Math.ceil(Math.max(0, seconds)) * tokensPerSecond;
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

export function expandPreset(
  expansions: Record<string, string>,
  key: string | undefined
): string {
  // Stored/legacy jobs can carry a partial direction; a missing key must
  // yield an empty string, never undefined, so callers can safely chain
  // string methods (e.g. `.replace`) on the result.
  if (!key) return "";
  return expansions[key] ?? key;
}
