// The narration as plain text, chapter by chapter, with each chapter's start
// time in both cuts: for course pages, chapter markers and rewrites.
//
//   npm run transcript      writes out/prise-en-main-studio-audio-script.txt
//
// Run after demo, voice and capture: the times come from the edit itself.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FPS } from "../src/theme";
import type { TutorialData } from "../src/studio-audio/data";
import { CHAPTERS, COMPARE_LINE, DEMO_SCENE, DEMO_SCRIPT, type Chapter } from "../src/studio-audio/script";
import { buildTimeline, type Timeline } from "../src/studio-audio/timeline";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "out/prise-en-main-studio-audio-script.txt");
const RULE = "─".repeat(48);

const read = <T,>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, "public", path), "utf8")) as T;
const data: TutorialData = {
  shots: read("studio-audio/shots/shots.json"),
  voice: read("studio-audio/voice/manifest.json"),
  demo: read("studio-audio/demo.json"),
};
const cuts = { module: buildTimeline(data, "module"), site: buildTimeline(data, "site") };

function clock(frames: number): string {
  const seconds = Math.round(frames / FPS);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function length(frames: number): string {
  const seconds = Math.round(frames / FPS);
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`;
}

// The first chapter of a cut starts with the video: its title card is part of it.
function start(timeline: Timeline, chapter: Chapter): string {
  const index = timeline.chapters.findIndex((span) => span.id === chapter.id);
  return index < 0 ? "—" : clock(index === 0 ? 0 : timeline.chapters[index].from);
}

function name(chapter: Chapter): string {
  return chapter.label === undefined ? chapter.title : `${chapter.label} · ${chapter.title}`;
}

const width = Math.max(...CHAPTERS.map((chapter) => name(chapter).length)) + 4;
const lines: string[] = [
  "Prise en main du Studio audio",
  "Script de la voix off · TeachInspire Studio, Module 5, vidéo 1",
  "",
  `Durée : ${length(cuts.module.duration)} (version module) · ${length(cuts.site.duration)} (version site)`,
  "",
  "CHAPITRES",
  `${"".padEnd(width)}Module   Site`,
  ...CHAPTERS.map((chapter) => `${name(chapter).padEnd(width)}${start(cuts.module, chapter).padEnd(9)}${start(cuts.site, chapter)}`),
];

for (const chapter of CHAPTERS) {
  const where = chapter.moduleOnly ? "version module uniquement" : `module ${start(cuts.module, chapter)} · site ${start(cuts.site, chapter)}`;
  lines.push("", RULE, "", `${name(chapter).toUpperCase()}   (${where})`);
  if (chapter.before === "result") lines.push("", "[On écoute le début du dialogue de démonstration.]");
  for (const paragraph of chapter.paragraphs) {
    lines.push("", paragraph.text);
    if (paragraph.after === "compare") lines.push("", "[On écoute la même réplique en A1, rythme lent, puis en B1.]");
  }
}

const [first, second] = data.demo.cast;
lines.push(
  "",
  RULE,
  "",
  "LE DIALOGUE DE DÉMONSTRATION",
  "",
  DEMO_SCRIPT,
  "",
  `Réplique comparée en A1 et en B1 : « ${COMPARE_LINE} »`,
  `Scène : ${DEMO_SCENE}`,
  `Voix : ${first.name}, ${first.voice} · ${second.name}, ${second.voice}. Niveau B1, rythme naturel de classe.`,
  "",
);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join("\n"));
console.log(`Wrote ${OUT}`);
