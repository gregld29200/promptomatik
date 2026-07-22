import {
  ACCENT_EXPANSIONS,
  CEFR_DELIVERY,
  PACE_EXPANSIONS,
  STYLE_EXPANSIONS,
  expandPreset,
  type AudioDirection,
  type AudioMode,
} from "./audio-config";
import { speakerLabelPrefix } from "../../src/lib/audio-script-rules";

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

function audioProfile(mode: AudioMode, speakers: string[], direction: AudioDirection): string {
  const globalPersona = expandPreset(STYLE_EXPANSIONS, direction.style).replace(/\.+$/, "");
  if (mode === "monologue") {
    const notes = trimOptional(direction.notes);
    return `The speaker: ${globalPersona}.${notes ? ` Manner of speaking: ${notes.replace(/\.+$/, "")}.` : ""}`;
  }

  return speakers.map((speaker) => {
    const override = direction.speakers?.[speaker];
    const persona = override?.style
      ? expandPreset(STYLE_EXPANSIONS, override.style).replace(/\.+$/, "")
      : globalPersona;
    const parts = [`${speaker}: ${persona}.`];
    if (override && (trimOptional(override.accent) || trimOptional(override.accentDetail))) {
      parts.push(`Accent: ${accentPhrase(override.accent ?? direction.accent, override.accentDetail)}.`);
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

  const labelled = lines.find((line) => speakerLabelPrefix(line) !== null);
  if (labelled) {
    throw new TranscriptValidationError(
      `Monologue transcript must not contain speaker labels before TTS. Invalid line: ${labelled}`
    );
  }
}

export function compileDirection(input: CompileDirectionInput): string {
  const { direction, mode, speakers, script } = input;
  validateTranscriptForTts(mode, script);
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

  sections.push(`DIRECTOR'S NOTES:
Style: ${style}
Accent: ${accent}.
Pacing: ${pace} ${cefr.pacing}
Clarity: ${cefr.clarity}
Audio tags: perform every bracketed tag (like [laughs] or [excited]) as a vocal expression at that exact spot; never read the bracket text aloud.`);

  sections.push(`TRANSCRIPT:
${script}`);

  return sections.join("\n\n");
}
