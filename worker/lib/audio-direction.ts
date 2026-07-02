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

function audioProfile(mode: AudioMode, speakers: string[], style: string): string {
  const persona = expandPreset(STYLE_EXPANSIONS, style).replace(/\.+$/, "");
  if (mode === "monologue") {
    return `The speaker: ${persona}.`;
  }

  return speakers.map((speaker) => `${speaker}: ${persona}.`).join("\n");
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
  const cefr = CEFR_DELIVERY[direction.level];
  const style = expandPreset(STYLE_EXPANSIONS, direction.style);
  const accentBase = expandPreset(ACCENT_EXPANSIONS, direction.accent);
  const accentDetail = trimOptional(direction.accentDetail);
  const accent = `${accentBase}${accentDetail ? `, specifically ${accentDetail}` : ""}`;
  const pace = expandPreset(PACE_EXPANSIONS, direction.pace);
  const scene = trimOptional(direction.scene);

  const sections = [
    `Synthesize the following ${mode} as speech. Everything before
"TRANSCRIPT:" is performance direction — do not read it aloud. Read only the
transcript, exactly as written, following the bracketed audio tags.`,
    `AUDIO PROFILE:
${audioProfile(mode, speakers, direction.style)}`,
  ];

  if (scene) {
    sections.push(`THE SCENE:
${scene}`);
  }

  sections.push(`DIRECTOR'S NOTES:
Style: ${style}
Accent: ${accent}
Pacing: ${pace} ${cefr.pacing}
Clarity: ${cefr.clarity}`);

  sections.push(`TRANSCRIPT:
${script}`);

  return sections.join("\n\n");
}
