export type AudioModeForRules = "monologue" | "dialogue";

export const SUPPORTED_AUDIO_TAGS = [
  "[sighs]",
  "[laughs]",
  "[giggles]",
  "[whispers]",
  "[shouting]",
  "[excited]",
  "[tired]",
  "[serious]",
  "[sarcastic]",
  "[curious]",
  "[amazed]",
  "[panicked]",
  "[gasp]",
  "[crying]",
  "[trembling]",
  "[hesitant]",
  "[pause]",
  "[very fast]",
  "[very slow]",
  "[smiling]",
] as const;

export const STAGE_DIRECTION_TAG_MAP: Record<string, string> = {
  sourit: "[smiling]",
  sourire: "[smiling]",
  souriant: "[smiling]",
  smile: "[smiling]",
  smiles: "[smiling]",
  smiling: "[smiling]",
  soupire: "[sighs]",
  soupir: "[sighs]",
  sigh: "[sighs]",
  sighs: "[sighs]",
  rit: "[laughs]",
  rire: "[laughs]",
  laugh: "[laughs]",
  laughs: "[laughs]",
  chuchote: "[whispers]",
  whisper: "[whispers]",
  whispers: "[whispers]",
};

export type ScriptLintSeverity = "blocking" | "warning";

export type ScriptLintCode =
  | "empty_script"
  | "unknown_speaker"
  | "too_many_speakers"
  | "unbalanced_brackets"
  | "residual_stage_direction"
  | "unknown_tag"
  | "long_turn"
  | "narration_line";

export interface ScriptLintFinding {
  severity: ScriptLintSeverity;
  code: ScriptLintCode;
  message: string;
  remedy: string;
  line?: number;
}

const SPEAKER_LABEL_RE = /^(Speaker|Locuteur)\s*([0-9]+)\s*:/i;
const ANY_LABEL_RE = /^([^:\n]{1,40}?)\s*:/;
const TAG_RE = /\[[^\]]+]/g;
const WORDS_PER_SECOND = 2.5;

// A colon only marks a speaker label when the prefix is short (1-3 words,
// e.g. "Sarah", "M. Dupont", "Speaker 1"). Prose colons — "regarda
// l'horloge : six heures dix", "the flexibility: they can..." — are
// legitimate script content and must not be treated as labels.
export function speakerLabelPrefix(line: string): string | null {
  const prefix = line.match(ANY_LABEL_RE)?.[1]?.trim();
  if (!prefix || prefix.startsWith("[")) return null;
  const words = prefix.split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 3 ? prefix : null;
}

function wordsIn(text: string): number {
  return text.replace(TAG_RE, " ").trim().match(/\S+/g)?.length ?? 0;
}

function normalizedKnownSpeaker(label: string): string | null {
  const match = label.match(SPEAKER_LABEL_RE);
  if (!match) return null;
  return `Speaker ${match[2]}`;
}

export function lintAudioScript(script: string, mode: AudioModeForRules): ScriptLintFinding[] {
  const findings: ScriptLintFinding[] = [];
  const trimmed = script.trim();
  const remedy = "Préparer pour l'audio";

  if (!trimmed) {
    return [{
      severity: "blocking",
      code: "empty_script",
      message: "Le script est vide.",
      remedy,
    }];
  }

  const openTags = (script.match(/\[/g) ?? []).length;
  const closeTags = (script.match(/]/g) ?? []).length;
  if (openTags !== closeTags) {
    findings.push({
      severity: "blocking",
      code: "unbalanced_brackets",
      message: "Un tag audio n'est pas fermé.",
      remedy,
    });
  }

  const speakerSet = new Set<string>();
  const lines = script.split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;
    const lineNumber = index + 1;
    const label = speakerLabelPrefix(line);
    const knownSpeaker = label ? normalizedKnownSpeaker(`${label}:`) : null;

    if (mode === "dialogue") {
      if (knownSpeaker) {
        speakerSet.add(knownSpeaker);
      } else if (label) {
        findings.push({
          severity: "blocking",
          code: "unknown_speaker",
          message: `Étiquette de locuteur inconnue ligne ${lineNumber}.`,
          remedy,
          line: lineNumber,
        });
      } else {
        findings.push({
          severity: "warning",
          code: "narration_line",
          message: `Ligne de narration en mode dialogue ligne ${lineNumber}.`,
          remedy,
          line: lineNumber,
        });
      }
    } else if (label) {
      findings.push({
        severity: "blocking",
        code: "unknown_speaker",
        message: "Le mode monologue ne doit pas contenir d'étiquettes de locuteur.",
        remedy,
        line: lineNumber,
      });
    }

    if (/\([^)]*\)/.test(line)) {
      findings.push({
        severity: "warning",
        code: "residual_stage_direction",
        message: `Indication scénique résiduelle ligne ${lineNumber}.`,
        remedy,
        line: lineNumber,
      });
    }

    for (const tag of line.match(TAG_RE) ?? []) {
      if (!(SUPPORTED_AUDIO_TAGS as readonly string[]).includes(tag)) {
        findings.push({
          severity: "warning",
          code: "unknown_tag",
          message: `Tag non référencé ${tag} ligne ${lineNumber}.`,
          remedy,
          line: lineNumber,
        });
      }
    }

    if (wordsIn(line) / WORDS_PER_SECOND > 60) {
      findings.push({
        severity: "warning",
        code: "long_turn",
        message: `Tour de parole long ligne ${lineNumber}.`,
        remedy,
        line: lineNumber,
      });
    }
  });

  if (mode === "dialogue" && speakerSet.size > 2) {
    findings.push({
      severity: "blocking",
      code: "too_many_speakers",
      message: "Deux locuteurs maximum pour cette version.",
      remedy,
    });
  }

  return findings;
}
