// Temporary narration, one take per paragraph, read by a studio voice so the
// edit can be timed before the real voice-over is recorded.
//
//   npm run voice                 missing paragraphs only
//   npm run voice -- --force      every paragraph again
//   npm run voice -- --only=ch2-3,ch5-1
//
// Needs OPENROUTER_API_KEY. Writes public/studio-audio/voice/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateBlock } from "../../worker/lib/tts-provider";
import { wavFromPcm } from "../../worker/lib/audio-assembly";
import { PCM_BYTES_PER_SECOND, type AudioDirection } from "../../worker/lib/audio-config";
import { speakerLabelPrefix } from "../../src/lib/audio-script-rules";
import { CHAPTERS } from "../src/studio-audio/script";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "public/studio-audio/voice");
const MANIFEST = resolve(OUT, "manifest.json");
const MODEL = "google/gemini-3.8-flash-tts";
const NARRATOR = "Algieba";
const DIRECTION: AudioDirection = {
  level: "C1",
  accent: "Neutral",
  pace: "Natural classroom speed",
  style: "Warm and encouraging",
};
const CONCURRENCY = 3;

interface VoiceEntry {
  file: string;
  seconds: number;
  text: string;
  source: "temporary" | "recorded";
}

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set.");

const force = process.argv.includes("--force");
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length).split(",");

mkdirSync(OUT, { recursive: true });
const manifest: Record<string, VoiceEntry> = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
const paragraphs = CHAPTERS.flatMap((chapter) => chapter.paragraphs).filter((paragraph) => {
  if (only) return only.includes(paragraph.id);
  const entry = manifest[paragraph.id];
  return force || !entry || entry.text !== paragraph.text || !existsSync(resolve(ROOT, "public", entry.file));
});

// A monologue line opening on "Un petit conseil :" reads as a speaker label
// to the studio, which refuses it: the narrator says a comma instead.
function spoken(text: string): string {
  return speakerLabelPrefix(text) ? text.replace(/\s*:/, ",") : text;
}

async function read(id: string, text: string) {
  const result = await generateBlock({ apiKey: apiKey as string, model: MODEL, script: spoken(text), mode: "monologue", voices: { solo: NARRATOR }, direction: DIRECTION });
  const file = `studio-audio/voice/${id}.wav`;
  writeFileSync(resolve(ROOT, "public", file), wavFromPcm(result.pcm));
  manifest[id] = { file, seconds: result.pcm.byteLength / PCM_BYTES_PER_SECOND, text, source: "temporary" };
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${id}: ${manifest[id].seconds.toFixed(1)} s`);
}

const queue = [...paragraphs];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (let next = queue.shift(); next; next = queue.shift()) await read(next.id, next.text);
}));
const total = Object.values(manifest).reduce((sum, entry) => sum + entry.seconds, 0);
console.log(`${paragraphs.length} paragraph(s) read; narration ${Math.round(total)} s in all.`);
