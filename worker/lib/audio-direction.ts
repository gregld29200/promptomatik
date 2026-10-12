import {
  ACCENT_EXPANSIONS,
  CEFR_DELIVERY,
  PACE_EXPANSIONS,
  STYLE_EXPANSIONS,
  expandPreset,
  type AudioDirection,
  type AudioMode,
  type AudioSpeakerDirection,
} from "./audio-config";
import { monologueSpeakerLabels } from "../../src/lib/audio-script-rules";

export interface CompileDirectionInput {
  direction: AudioDirection;
  mode: AudioMode;
  speakers: string[];
  script: string;
}

export class TranscriptValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptValidationError";
  }
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

// The free accent text, when provided, REPLACES the preset entirely
// (product decision 2026-07-03: two combined fields were confusing).
function accentPhrase(accent: string, accentDetail: string | undefined): string {
  const detail = trimOptional(accentDetail);
  if (detail) return detail.replace(/\.+$/, "");
  return expandPreset(ACCENT_EXPANSIONS, accent).replace(/\.+$/, "");
}

function hasSpeakerAccent(override: AudioSpeakerDirection | undefined): boolean {
  return Boolean(trimOptional(override?.accent) || trimOptional(override?.accentDetail));
}

function audioProfile(mode: AudioMode, speakers: string[], direction: AudioDirection): string {
  const globalPersona = expandPreset(STYLE_EXPANSIONS, direction.style).replace(/\.+$/, "");
  if (mode === "monologue") {
    const notes = trimOptional(direction.notes);
    return `The speaker: ${globalPersona}.${notes ? ` Manner of speaking: ${notes.replace(/\.+$/, "")}.` : ""}`;
  }

  const anyOverride = speakers.some((speaker) => hasSpeakerAccent(direction.speakers?.[speaker]));
  return speakers.map((speaker) => {
    const override = direction.speakers?.[speaker];
    const persona = override?.style
      ? expandPreset(STYLE_EXPANSIONS, override.style).replace(/\.+$/, "")
      : globalPersona;
    const parts = [`${speaker}: ${persona}.`];
    // Once one speaker has their own accent, every speaker states theirs:
    // a single global accent line would contradict the override.
    if (hasSpeakerAccent(override)) {
      parts.push(`Accent: ${accentPhrase(override?.accent ?? direction.accent, override?.accentDetail)}.`);
    } else if (anyOverride) {
      parts.push(`Accent: ${accentPhrase(direction.accent, direction.accentDetail)}.`);
    }
    const notes = trimOptional(override?.notes);
    if (notes) {
      parts.push(`Manner of speaking: ${notes.replace(/\.+$/, "")}.`);
    }
    return parts.join(" ");
  }).join("\n");
}

export function validateTranscriptForTts(mode: AudioMode, script: string): void {
  const lines = script.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (mode === "dialogue") {
    const invalid = lines.find((line) => !/^Speaker [12]: /.test(line));
    if (invalid) {
      throw new TranscriptValidationError(
        `Dialogue transcript must use only "Speaker 1:" and "Speaker 2:" labels before TTS. Invalid line: ${invalid}`
      );
    }
    return;
  }

  // Same rule as the studio linter: "Attention : …" is typography, a cast is not.
  const [labelled] = monologueSpeakerLabels(lines);
  if (labelled) {
    throw new TranscriptValidationError(
      `Monologue transcript must not contain speaker labels before TTS. Invalid line: ${lines[labelled.index]}`
    );
  }
}

function sentence(value: string): string {
  return `${value.trim().replace(/[.\s]+$/, "")}.`;
}

// An accent sentence: a brief already reads "Speak with …"; a teacher's raw
// words or a preset expansion are introduced.
function accentSentence(accent: string): string {
  return /^speak\b/i.test(accent.trim()) ? sentence(accent) : `Speak with this accent: ${sentence(accent)}`;
}

// 2.5 Pro reads an accent out of a short prompt where it is the lead
// instruction, but ignores it inside the sectioned template below (measured
// 2026-10-07: 0 strong takes in 4 with the template, 3-4 in 4 with this
// shape, for the same accent text). So a take with a regional accent gets
// this compact prompt, carrying the same direction.
function compileAccentedDirection(input: CompileDirectionInput): string {
  const { direction, mode, speakers, script } = input;
  const cefr = CEFR_DELIVERY[direction.level] ?? CEFR_DELIVERY.B1;
  const pace = [expandPreset(PACE_EXPANSIONS, direction.pace), cefr.pacing].filter(Boolean).join(" ");
  const scene = trimOptional(direction.scene);
  const lines: string[] = [];

  if (mode === "monologue") {
    const notes = trimOptional(direction.notes);
    lines.push(
      `Read this text aloud. ${accentSentence(accentPhrase(direction.accent, direction.accentDetail))}`,
      `Tone: ${sentence(expandPreset(STYLE_EXPANSIONS, direction.style))}${notes ? ` Manner of speaking: ${sentence(notes)}` : ""}`
    );
  } else {
    lines.push("Read this dialogue aloud.");
    for (const speaker of speakers) {
      const override = direction.speakers?.[speaker];
      const persona = expandPreset(STYLE_EXPANSIONS, override?.style || direction.style);
      const accent = hasSpeakerAccent(override)
        ? accentPhrase(override?.accent ?? direction.accent, override?.accentDetail)
        : accentPhrase(direction.accent, direction.accentDetail);
      const notes = trimOptional(override?.notes);
      lines.push(`${speaker}: ${sentence(persona)} ${accentSentence(accent)}${notes ? ` Manner of speaking: ${sentence(notes)}` : ""}`);
    }
    lines.push("Each speaker keeps their own accent in every line.");
  }

  lines.push(`Pace: ${pace}`, `Articulation: ${cefr.clarity}`);
  if (scene) lines.push(`Scene: ${sentence(scene)}`);
  lines.push(
    "Perform each bracketed tag, like [laughs] or [excited], as a sound or emotion at that exact spot; never read it aloud.",
    `Read only the ${mode === "dialogue" ? "dialogue" : "text"} below, exactly as written.`,
    "",
    "TEXT:",
    script
  );
  return lines.join("\n");
}

export function compileDirection(input: CompileDirectionInput): string {
  const { direction, mode, speakers, script } = input;
  validateTranscriptForTts(mode, script);
  if (hasRegionalAccent(direction, mode)) return compileAccentedDirection(input);
  // Fall back to B1 delivery if a stored job carries an unknown level, so a
  // bad `direction_json` degrades instead of crashing the generation worker.
  const cefr = CEFR_DELIVERY[direction.level] ?? CEFR_DELIVERY.B1;
  const style = expandPreset(STYLE_EXPANSIONS, direction.style);
  const accentDetail = trimOptional(direction.accentDetail);
  const accent = accentPhrase(direction.accent, accentDetail);
  const pace = expandPreset(PACE_EXPANSIONS, direction.pace);
  const scene = trimOptional(direction.scene);

  const sections = [
    `Synthesize the following ${mode} as speech. Everything before
"TRANSCRIPT:" is performance direction — do not read it aloud. Read only the
transcript, exactly as written, following the bracketed audio tags.`,
    `AUDIO PROFILE:
${audioProfile(mode, speakers, direction)}`,
  ];

  if (scene) {
    sections.push(`THE SCENE:
${scene}`);
  }

  const perSpeakerAccent = mode === "dialogue" && speakers.some((speaker) => hasSpeakerAccent(direction.speakers?.[speaker]));
  sections.push(`DIRECTOR'S NOTES:
Style: ${style}
Accent: ${perSpeakerAccent ? "each speaker keeps the accent given in the audio profile, in every line" : `${accent}.`}
Pacing: ${pace} ${cefr.pacing}
Clarity: ${cefr.clarity}
Audio tags: perform every bracketed tag (like [laughs] or [excited]) as a vocal expression at that exact spot; never read the bracket text aloud.`);

  sections.push(`TRANSCRIPT:
${script}`);

  return sections.join("\n\n");
}

// Presets that are a language's everyday pronunciation: every model speaks
// them well enough, so they need no special routing.
const NATIVE_ACCENT_PRESETS = new Set([
  "Neutral international",
  "Neutral",
  "Slow classroom French",
  "Parisian",
  "North American",
]);

function isRegionalAccent(preset: string | undefined, detail: string | undefined): boolean {
  if (trimOptional(detail)) return true;
  const key = trimOptional(preset);
  return Boolean(key && !NATIVE_ACCENT_PRESETS.has(key));
}

// Whether any speaker of the take has a regional or foreign accent (a free
// accent text, or a non-native preset). Gemini 3.8 ignores an accent asked for
// in its style, so such a take is voiced by a model that reads it.
export function hasRegionalAccent(direction: AudioDirection, mode: AudioMode): boolean {
  if (isRegionalAccent(direction.accent, direction.accentDetail)) return true;
  if (mode !== "dialogue") return false;
  return Object.values(direction.speakers ?? {}).some((override) =>
    isRegionalAccent(override?.accent, override?.accentDetail)
  );
}

// Rewrites every regional accent of the take (global, and each dialogue
// speaker's own) with `brief`, as a free accent text that replaces the preset.
export async function withAccentBriefs(
  direction: AudioDirection,
  mode: AudioMode,
  brief: (accent: string) => Promise<string>
): Promise<AudioDirection> {
  const result: AudioDirection = { ...direction };
  if (isRegionalAccent(direction.accent, direction.accentDetail)) {
    result.accentDetail = await brief(accentPhrase(direction.accent, direction.accentDetail));
  }
  if (mode === "dialogue" && direction.speakers) {
    const speakers: NonNullable<AudioDirection["speakers"]> = {};
    for (const [speaker, override] of Object.entries(direction.speakers)) {
      speakers[speaker as keyof typeof speakers] = override && isRegionalAccent(override.accent, override.accentDetail)
        ? { ...override, accentDetail: await brief(accentPhrase(override.accent ?? direction.accent, override.accentDetail)) }
        : override;
    }
    result.speakers = speakers;
  }
  return result;
}

export interface SpeechStyleInput {
  direction: AudioDirection;
  mode: AudioMode;
  /** "solo" in a monologue, "Speaker 1" or "Speaker 2" in a dialogue. */
  speaker: string;
}

// Gemini 3.8 TTS speaks its input verbatim, so the direction compileDirection
// writes into the 2.5 prompt travels as speech_metadata.style instead: one
// sustained delivery description per voice, with the same presets and the
// same per-speaker overrides.
export function speechStyle(input: SpeechStyleInput): string {
  const { direction, mode, speaker } = input;
  const override = mode === "dialogue" ? direction.speakers?.[speaker] : undefined;
  const cefr = CEFR_DELIVERY[direction.level] ?? CEFR_DELIVERY.B1;
  const persona = expandPreset(STYLE_EXPANSIONS, override?.style || direction.style).replace(/\.+$/, "");
  const accent = override && (trimOptional(override.accent) || trimOptional(override.accentDetail))
    ? accentPhrase(override.accent ?? direction.accent, override.accentDetail)
    : accentPhrase(direction.accent, direction.accentDetail);
  const pacing = [expandPreset(PACE_EXPANSIONS, direction.pace), cefr.pacing].filter(Boolean).join(" ");
  const notes = trimOptional(mode === "dialogue" ? override?.notes : direction.notes);
  const scene = trimOptional(direction.scene);

  const parts = [
    persona ? `${persona}.` : "",
    accent ? `Accent: ${accent}.` : "",
    `Pacing: ${pacing}`,
    `Clarity: ${cefr.clarity}`,
    notes ? `Manner of speaking: ${notes.replace(/\.+$/, "")}.` : "",
    scene ? `Scene: ${scene.replace(/\.+$/, "")}.` : "",
  ];
  return parts.filter(Boolean).join(" ");
}
