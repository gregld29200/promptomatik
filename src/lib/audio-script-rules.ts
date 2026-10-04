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
  | "speaker_label_in_monologue"
  | "too_many_speakers"
  | "unbalanced_brackets"
  | "residual_stage_direction"
  | "unknown_tag"
  | "long_turn"
  | "narration_line"
  | "orphan_line";

// Findings carry a code and its parameters, never prose: this module runs both
// in the browser (where the studio renders it through i18n) and in the worker
// (where no user language is in scope).
export interface ScriptLintFinding {
  severity: ScriptLintSeverity;
  code: ScriptLintCode;
  line?: number;
  tag?: string;
  /** Character names, for too_many_speakers and speaker_label_in_monologue. */
  names?: string[];
}

// The speaker labels teachers actually type, one per interface language. The
// pipeline normalizes them all to "Speaker N" before the model sees them, so a
// Spanish teacher writing "Hablante 1:" is as valid as "Locuteur 1:".
export const SPEAKER_LABEL_WORDS = "Speaker|Locuteur|Hablante";

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

export const DIALOGUE_SLOTS = ["Speaker 1", "Speaker 2"] as const;
export type DialogueSlot = (typeof DIALOGUE_SLOTS)[number];

export interface CastMember {
  /** The character as the teacher wrote it: "Léa", "Locuteur 1". */
  label: string;
  /** The voice slot this character plays; null past the second one. */
  slot: DialogueSlot | null;
}

const NUMBERED_LABEL_RE = new RegExp(`^(${SPEAKER_LABEL_WORDS})\\s*([0-9]+)$`, "i");

// "Locuteur 1" and "Speaker 1" are one character; names compare loosely.
function castKey(label: string): string {
  const numbered = label.match(NUMBERED_LABEL_RE);
  return numbered ? `Speaker ${numbered[2]}` : label.toLocaleLowerCase().replace(/\s+/g, " ");
}

function lineLabel(line: string): string | null {
  return speakerLabelPrefix(line.trim());
}

// The characters of a dialogue, in order of first appearance. Teachers write
// names ("Léa : …"); a numbered label keeps its own slot and each name takes
// the first free one, so "Léa" plays voice 1 and "Karim" voice 2.
export function dialogueCast(script: string): CastMember[] {
  const labels = new Map<string, string>();
  for (const line of script.split(/\r?\n/)) {
    const label = lineLabel(line);
    if (label && !labels.has(castKey(label))) labels.set(castKey(label), label);
  }
  const taken = new Set<string>(labels.keys());
  return [...labels].map(([key, label]) => {
    if ((DIALOGUE_SLOTS as readonly string[]).includes(key)) return { label, slot: key as DialogueSlot };
    if (NUMBERED_LABEL_RE.test(label)) return { label, slot: null };
    const free = DIALOGUE_SLOTS.find((slot) => !taken.has(slot)) ?? null;
    if (free) taken.add(free);
    return { label, slot: free };
  });
}

// Rewrites every character label to its voice slot ("Léa :" -> "Speaker 1:"),
// the only labels speech generation reads. Lines of a character beyond the
// second keep their label, which the linter has already refused.
export function normalizeDialogueLabels(script: string): string {
  const slots = new Map(dialogueCast(script).map((member) => [castKey(member.label), member.slot]));
  return script.replace(/\r\n?/g, "\n").split("\n").map((line) => {
    const label = lineLabel(line);
    const slot = label ? slots.get(castKey(label)) : null;
    if (!slot) return line;
    return `${slot}: ${line.slice(line.indexOf(":") + 1).trimStart()}`;
  }).join("\n");
}

export function lintAudioScript(script: string, mode: AudioModeForRules): ScriptLintFinding[] {
  const findings: ScriptLintFinding[] = [];
  const trimmed = script.trim();

  if (!trimmed) {
    return [{ severity: "blocking", code: "empty_script" }];
  }

  const openTags = (script.match(/\[/g) ?? []).length;
  const closeTags = (script.match(/]/g) ?? []).length;
  if (openTags !== closeTags) {
    findings.push({ severity: "blocking", code: "unbalanced_brackets" });
  }

  const lines = script.split(/\r?\n/);
  let seenTurn = false;

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;
    const lineNumber = index + 1;
    const label = speakerLabelPrefix(line);

    if (mode === "dialogue") {
      if (label) {
        seenTurn = true;
      } else if (!seenTurn) {
        // Nobody can voice a line before the first turn.
        findings.push({ severity: "blocking", code: "orphan_line", line: lineNumber });
      } else {
        // Joined to the turn above and read by the same speaker.
        findings.push({ severity: "warning", code: "narration_line", line: lineNumber });
      }
    } else if (label) {
      findings.push({ severity: "blocking", code: "speaker_label_in_monologue", line: lineNumber });
    }

    if (/\([^)]*\)/.test(line)) {
      findings.push({ severity: "warning", code: "residual_stage_direction", line: lineNumber });
    }

    for (const tag of line.match(TAG_RE) ?? []) {
      if (!(SUPPORTED_AUDIO_TAGS as readonly string[]).includes(tag)) {
        findings.push({ severity: "warning", code: "unknown_tag", line: lineNumber, tag });
      }
    }

    if (wordsIn(line) / WORDS_PER_SECOND > 60) {
      findings.push({ severity: "warning", code: "long_turn", line: lineNumber });
    }
  });

  if (mode === "dialogue") {
    const cast = dialogueCast(script);
    if (cast.length > 2) {
      findings.push({ severity: "blocking", code: "too_many_speakers", names: cast.map((member) => member.label) });
    }
  }

  return findings;
}
