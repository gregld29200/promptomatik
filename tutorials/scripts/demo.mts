// The demo shown in "Prise en main du Studio audio", made with the studio's
// own code: the suggestions the teacher reviews (kept as a fixture, so every
// capture shows the same review), the script once reviewed, the take at B1,
// and one line at A1 and at B1 for the level comparison.
//
// Needs GEMINI_API_KEY (suggestions, first run or --fresh) and
// OPENROUTER_API_KEY (speech). Writes public/studio-audio/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { suggestAudioEdits } from "../../worker/lib/audio-suggest";
import { applySuggestions, type InlineSuggestion, type SuggestionDecision } from "../../src/lib/audio-suggestions";
import { dialogueCast, normalizeDialogueLabels } from "../../src/lib/audio-script-rules";
import { estimateAudioSeconds, normalizeSpeakerDirections, normalizeVoiceMap, splitScriptIntoBlocks } from "../../worker/lib/audio-script";
import { generateBlock } from "../../worker/lib/tts-provider";
import { concatPcmWithSilence, mp3FromPcm, peaksFromPcm } from "../../worker/lib/audio-assembly";
import { PCM_BYTES_PER_SECOND, type AudioDirection } from "../../worker/lib/audio-config";
import { AUDIO_VOICES } from "../../worker/lib/audio-voices";
import { COMPARE_LINE, COMPARE_TAKES, DEMO_DIRECTION, DEMO_SCRIPT, DEMO_VOICES } from "../src/studio-audio/script";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = resolve(ROOT, "fixtures/studio-audio/suggestions.json");
const OUT = resolve(ROOT, "public/studio-audio");
const MODEL = "google/gemini-3.8-flash-tts";
const SUGGEST_MODEL = "gemini-2.5-flash";

interface SuggestionFixture {
  script: string;
  suggestions: InlineSuggestion[];
  decisions: Record<string, SuggestionDecision>;
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

// The narration names three parentheses and what happens to each: the
// review on screen has to match it, whatever the model proposed this time.
function curate(script: string, suggestions: InlineSuggestion[]): InlineSuggestion[] {
  const at = (text: string) => script.indexOf(text);
  const speaker = (text: string) => script.slice(script.lastIndexOf("\n", at(text)) + 1).split(":")[0].trim();
  const expected: Array<{ text: string; tag?: string; reason: string }> = [
    { text: "(il prend le carton)", reason: "Une action sans son : la voix la lirait à voix haute." },
    { text: "(il rit)", tag: "[laughs]", reason: `${speaker("(il rit)")} rit vraiment au lieu de lire « il rit ».` },
    { text: "(elle soupire)", tag: "[sighs]", reason: `${speaker("(elle soupire)")} soupire au lieu de lire « elle soupire ».` },
  ];
  const fixes = expected.map(({ text, tag, reason }) => {
    const found = at(text);
    if (found < 0) throw new Error(`Missing ${text} in the demo script.`);
    const start = found;
    let end = found + text.length;
    if (!tag && script[end] === " ") end += 1;
    return {
      id: `paren-${start}`,
      kind: "fix" as const,
      start,
      end,
      insert: tag ?? "",
      tag,
      fixType: "stage_direction",
      reason,
    };
  });
  const tags = suggestions.filter((s) => s.kind === "tag" && !fixes.some((f) => s.start > f.start && s.start < f.end));
  if (tags.length < 2) throw new Error(`Only ${tags.length} emotion(s) proposed.`);
  return [...fixes, ...tags].sort((a, b) => a.start - b.start);
}

// "Je garde celle-ci, j'écarte celle-là": the first emotion is kept, the
// second set aside, everything else kept.
function decide(suggestions: InlineSuggestion[]): Record<string, SuggestionDecision> {
  const tags = suggestions.filter((s) => s.kind === "tag");
  return Object.fromEntries(suggestions.map((s) => [s.id, s.id === tags[1]?.id ? "rejected" : "accepted"]));
}

async function suggestionFixture(fresh: boolean): Promise<SuggestionFixture> {
  if (!fresh && existsSync(FIXTURE)) {
    const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as SuggestionFixture;
    if (fixture.script === DEMO_SCRIPT) return fixture;
  }
  // The model proposes no emotion at all about one time in three on this
  // script: ask again until the review has some to keep and to set aside.
  let suggestions: InlineSuggestion[] | null = null;
  for (let attempt = 1; !suggestions; attempt += 1) {
    const result = await suggestAudioEdits({
      apiKey: env("GEMINI_API_KEY"),
      model: SUGGEST_MODEL,
      script: DEMO_SCRIPT,
      mode: "dialogue",
      language: "fr",
      level: "B1",
    });
    try {
      suggestions = curate(DEMO_SCRIPT, result.suggestions);
    } catch (error) {
      if (attempt >= 5) throw error;
      console.warn(`Attempt ${attempt}: ${error instanceof Error ? error.message : error}`);
    }
  }
  const fixture = { script: DEMO_SCRIPT, suggestions, decisions: decide(suggestions) };
  mkdirSync(dirname(FIXTURE), { recursive: true });
  writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`);
  return fixture;
}

// Turns are joined by 300 ms of digital silence: runs of exact zeros mark them.
function voicedSpans(pcm: Uint8Array, minGapSeconds = 0.25): Array<{ start: number; end: number }> {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
  const rate = PCM_BYTES_PER_SECOND / 2;
  const minGap = Math.round(minGapSeconds * rate);
  const spans: Array<{ start: number; end: number }> = [];
  let spanStart = -1;
  let zeros = 0;
  for (let i = 0; i < samples.length; i += 1) {
    if (samples[i] === 0) {
      zeros += 1;
      if (zeros === minGap && spanStart >= 0) {
        spans.push({ start: spanStart / rate, end: (i - minGap + 1) / rate });
        spanStart = -1;
      }
    } else {
      if (spanStart < 0) spanStart = i;
      zeros = 0;
    }
  }
  if (spanStart >= 0) spans.push({ start: spanStart / rate, end: samples.length / rate });
  return spans;
}

function displayLine(line: string): { speaker: string; text: string } {
  const [speaker, ...rest] = line.split(":");
  return { speaker: speaker.trim(), text: rest.join(":").replace(/\[[^\]]+\]\s*/g, "").replace(/\s+/g, " ").trim() };
}

// Block by block, as the worker does, with the same silence between blocks.
async function speak(script: string, mode: "dialogue" | "monologue", voices: Record<string, string>, direction: AudioDirection) {
  const pcms: Uint8Array[] = [];
  for (const block of splitScriptIntoBlocks(script, mode)) {
    const result = await generateBlock({ apiKey: env("OPENROUTER_API_KEY"), model: MODEL, script: block.text, mode, voices, direction });
    pcms.push(result.pcm);
  }
  const pcm = concatPcmWithSilence(pcms);
  const gap = (pcm.byteLength - pcms.reduce((sum, part) => sum + part.byteLength, 0)) / Math.max(1, pcms.length - 1) / PCM_BYTES_PER_SECOND;
  let cursor = 0;
  const blocks = pcms.map((part, idx) => {
    const durationSeconds = part.byteLength / PCM_BYTES_PER_SECOND;
    const block = { idx, startSeconds: cursor, endSeconds: cursor + durationSeconds, durationSeconds };
    cursor += durationSeconds + gap;
    return block;
  });
  return { pcm, blocks };
}

const fresh = process.argv.includes("--fresh");
mkdirSync(OUT, { recursive: true });

const fixture = await suggestionFixture(fresh);
const applied = applySuggestions(fixture.script, fixture.suggestions, fixture.decisions).script;
console.log(`Suggestions: ${fixture.suggestions.length}; script once reviewed:\n${applied}\n`);

const direction = normalizeSpeakerDirections(structuredClone(DEMO_DIRECTION) as unknown as AudioDirection, "dialogue");
const take = await speak(normalizeDialogueLabels(applied), "dialogue", normalizeVoiceMap({ ...DEMO_VOICES }), direction);
const seconds = take.pcm.byteLength / PCM_BYTES_PER_SECOND;
writeFileSync(resolve(OUT, "take.mp3"), mp3FromPcm(take.pcm));

const lines = applied.split("\n").filter((line) => line.trim()).map(displayLine);
const spans = voicedSpans(take.pcm);
const turns = spans.length === lines.length
  ? lines.map((line, index) => ({ ...line, ...spans[index] }))
  : (() => {
      // Fallback: share the take by length of text.
      const total = lines.reduce((sum, line) => sum + line.text.length, 0);
      let cursor = 0;
      return lines.map((line) => {
        const start = cursor;
        cursor += (line.text.length / total) * seconds;
        return { ...line, start, end: cursor };
      });
    })();
console.log(`Take: ${seconds.toFixed(1)} s, ${take.blocks.length} block(s), ${spans.length} voiced spans for ${lines.length} lines.`);

const compare = [];
for (const setting of COMPARE_TAKES) {
  const result = await speak(COMPARE_LINE, "monologue", { solo: DEMO_VOICES["Speaker 2"] }, {
    level: setting.level,
    accent: "Neutral",
    pace: setting.pace,
    style: "Informal conversation",
  } as AudioDirection);
  writeFileSync(resolve(OUT, `compare-${setting.id}.mp3`), mp3FromPcm(result.pcm));
  const duration = result.pcm.byteLength / PCM_BYTES_PER_SECOND;
  compare.push({ ...setting, file: `studio-audio/compare-${setting.id}.mp3`, seconds: duration, peaks: peaksFromPcm(result.pcm, 120) });
  console.log(`${setting.label}: ${duration.toFixed(1)} s`);
}

const demo = {
  script: fixture.script,
  applied,
  cast: dialogueCast(applied).map((member) => ({
    name: member.label,
    voice: AUDIO_VOICES.find((voice) => voice.name === DEMO_VOICES[member.slot as keyof typeof DEMO_VOICES])?.label ?? "",
  })),
  suggestions: fixture.suggestions,
  decisions: fixture.decisions,
  direction: DEMO_DIRECTION,
  voices: DEMO_VOICES,
  take: {
    file: "studio-audio/take.mp3",
    seconds,
    estimatedSeconds: estimateAudioSeconds(normalizeDialogueLabels(applied)),
    peaks: peaksFromPcm(take.pcm),
    blocks: take.blocks,
    turns,
  },
  compare,
};
writeFileSync(resolve(OUT, "demo.json"), `${JSON.stringify(demo, null, 2)}\n`);
console.log(`Wrote ${resolve(OUT, "demo.json")}`);
