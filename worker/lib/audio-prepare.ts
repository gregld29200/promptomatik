import type { AudioMode } from "./audio-config";
import { validateTranscriptForTts } from "./audio-direction";
import { STAGE_DIRECTION_TAG_MAP, SUPPORTED_AUDIO_TAGS } from "../../src/lib/audio-script-rules";

const CHANGE_TYPES = new Set([
  "speaker_rename",
  "tag_added",
  "stage_direction_converted",
  "direction_hint",
  "removed_stage_direction",
  "cleanup",
]);

export interface AudioPrepareChange {
  type: "speaker_rename" | "tag_added" | "stage_direction_converted" | "direction_hint" | "removed_stage_direction" | "cleanup";
  before: string;
  after: string;
  line: number;
  rationale: string;
}

export interface AudioPrepareResult {
  speaker_count: number;
  formatted_script: string;
  changes: AudioPrepareChange[];
  warnings: string[];
}

export interface PrepareAudioScriptInput {
  apiKey: string;
  model: string;
  script: string;
  mode: AudioMode;
  fetcher?: typeof fetch;
}

interface GeminiTextResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
}

export class AudioPrepareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioPrepareError";
  }
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function parseJsonObject(raw: string): unknown {
  const cleaned = stripJsonFence(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new AudioPrepareError("Prepare response was not valid JSON.");
    }
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      throw new AudioPrepareError("Prepare response was not valid JSON.");
    }
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new AudioPrepareError(`Prepare response field "${field}" is invalid.`);
  }
  return value;
}

function parseChange(value: unknown): AudioPrepareChange {
  if (!value || typeof value !== "object") {
    throw new AudioPrepareError("Prepare response change is invalid.");
  }

  const record = value as Record<string, unknown>;
  const type = requireString(record.type, "changes.type");
  const line = record.line;
  if (!CHANGE_TYPES.has(type)) {
    throw new AudioPrepareError(`Prepare response change type "${type}" is invalid.`);
  }
  if (!Number.isInteger(line) || Number(line) < 1) {
    throw new AudioPrepareError("Prepare response change line is invalid.");
  }

  return {
    type: type as AudioPrepareChange["type"],
    before: requireString(record.before, "changes.before"),
    after: requireString(record.after, "changes.after"),
    line: Number(line),
    rationale: requireString(record.rationale, "changes.rationale"),
  };
}

export function parsePrepareResponse(raw: string): AudioPrepareResult {
  const parsed = parseJsonObject(raw);

  if (!parsed || typeof parsed !== "object") {
    throw new AudioPrepareError("Prepare response was not an object.");
  }

  const record = parsed as Record<string, unknown>;
  if (!Number.isInteger(record.speaker_count) || Number(record.speaker_count) < 0) {
    throw new AudioPrepareError("Prepare response speaker_count is invalid.");
  }
  if (!Array.isArray(record.changes)) {
    throw new AudioPrepareError("Prepare response changes are invalid.");
  }
  if (!Array.isArray(record.warnings) || record.warnings.some((warning) => typeof warning !== "string")) {
    throw new AudioPrepareError("Prepare response warnings are invalid.");
  }

  return {
    speaker_count: Number(record.speaker_count),
    formatted_script: requireString(record.formatted_script, "formatted_script"),
    changes: record.changes.map(parseChange),
    warnings: record.warnings as string[],
  };
}

function completeSpeakerRenameChanges(result: AudioPrepareResult, originalScript: string): AudioPrepareResult {
  const speakerMap = new Map<string, string>();
  for (const change of result.changes) {
    if (change.type !== "speaker_rename" || !change.before.endsWith(":") || !change.after.endsWith(":")) continue;
    speakerMap.set(change.before.slice(0, -1).trim().toLowerCase(), change.after);
  }
  if (speakerMap.size === 0) return result;

  const existing = new Set(result.changes
    .filter((change) => change.type === "speaker_rename")
    .map((change) => `${change.line}:${change.after}`));
  const additions: AudioPrepareChange[] = [];

  originalScript.split(/\r?\n/).forEach((rawLine, index) => {
    const label = rawLine.trim().match(/^([^:\n]{1,80}):/)?.[1]?.trim();
    if (!label || /^(Speaker|Locuteur)\s*\d+$/i.test(label)) return;
    const mapped = [...speakerMap.entries()].find(([name]) => label.toLowerCase().startsWith(name));
    if (!mapped) return;
    const [, after] = mapped;
    const key = `${index + 1}:${after}`;
    if (existing.has(key)) return;
    existing.add(key);
    additions.push({
      type: "speaker_rename",
      before: `${mapped[0]}:`,
      after,
      line: index + 1,
      rationale: "Même locuteur détecté plus haut.",
    });
  });

  return additions.length > 0
    ? { ...result, changes: [...result.changes, ...additions].sort((a, b) => a.line - b.line) }
    : result;
}

function systemPrompt(): string {
  const tagMap = Object.entries(STAGE_DIRECTION_TAG_MAP)
    .map(([source, tag]) => `${source} -> ${tag}`)
    .join(", ");
  return [
    "You prepare user-owned language-learning scripts for Gemini TTS.",
    "Do not write a script from scratch. Preserve the teacher's content and intent.",
    "For dialogue, map detected speakers to Speaker 1 and Speaker 2 only. Never return named speaker labels such as Marie, Paul, Teacher, or Student.",
    "In dialogue formatted_script, every non-empty line must start exactly with Speaker 1: or Speaker 2: followed by a space. Tags go after the colon, never inside the speaker label.",
    "Handle stage directions with exactly three actions:",
    `1. convert: parenthetical/bracketed acting notes with supported tag equivalents become inline tags. Mapping table: ${tagMap}. Supported tags: ${SUPPORTED_AUDIO_TAGS.join(", ")}. Use type stage_direction_converted.`,
    "2. promote: context that belongs upstream, such as setting, character state, or actions like checking a phone, becomes type direction_hint. Put proposed Scene/Director's-Notes text in after. It must not stay in the script.",
    "3. remove: non-spoken content with no useful audio or direction value becomes type removed_stage_direction.",
    "Speaker formatting changes use type speaker_rename. General TTS cleanup uses type cleanup.",
    "formatted_script must contain only the proposed TTS-ready script, with Speaker 1/2 labels in dialogue and no display names.",
    "Write rationale values in concise French.",
    "Return ONLY valid JSON matching this shape:",
    '{"speaker_count":2,"formatted_script":"Speaker 1: ...\\nSpeaker 2: ...","changes":[{"type":"speaker_rename|stage_direction_converted|direction_hint|removed_stage_direction|cleanup","before":"Sarah:","after":"Speaker 1:","line":3,"rationale":"short reason"}],"warnings":[]}',
  ].join("\n");
}

export async function prepareAudioScript(input: PrepareAudioScriptInput): Promise<AudioPrepareResult> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(
    `https://generativelanguage.googleapis.com/v1beta/models/${input.model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": input.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt() }] },
        contents: [{
          role: "user",
          parts: [{ text: `Mode: ${input.mode}\n\nScript:\n${input.script}` }],
        }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    }
  );

  const body = await response.json().catch(() => null) as GeminiTextResponse | null;
  if (!response.ok) {
    throw new AudioPrepareError(body?.error?.message ?? `Prepare request failed with HTTP ${response.status}.`);
  }

  const text = body?.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === "string")?.text;
  if (!text) {
    throw new AudioPrepareError("Prepare response did not include text.");
  }

  const result = completeSpeakerRenameChanges(parsePrepareResponse(text), input.script);
  validateTranscriptForTts(input.mode, result.formatted_script);
  return result;
}
