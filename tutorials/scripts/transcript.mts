// The narration as plain text, chapter by chapter, with each chapter's start
// time in both cuts: for course pages, chapter markers and rewrites.
//
//   npm run transcript                  Studio audio
//   npm run transcript -- documents     another tutorial
//
// Writes out/prise-en-main-<tutorial>-script.txt.
//
// Run after demo, voice and capture: the times come from the edit itself.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FPS } from "../src/theme";
import { tutorialScript } from "../src/tutorial/catalog";
import type { TutorialData } from "../src/tutorial/data";
import { buildTimeline, type Timeline } from "../src/tutorial/timeline";
import type { Chapter, Cut } from "../src/tutorial/types";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = tutorialScript(process.argv[2] ?? "studio-audio");
const OUT = resolve(ROOT, `out/prise-en-main-${script.id}-script.txt`);
const RULE = "─".repeat(48);

const read = <T,>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, "public", path), "utf8")) as T;
const data: TutorialData = {
  shots: read(`${script.id}/shots/shots.json`),
  voice: read(`${script.id}/voice/manifest.json`),
  demo: read(`${script.id}/demo.json`),
};
// A tutorial with nothing reserved for the module has a single cut.
const hasModuleCut = script.chapters.some((chapter) => chapter.moduleOnly) || Boolean(script.title.kicker.module);
const cutNames: Cut[] = hasModuleCut ? ["module", "site"] : ["site"];
const cuts = Object.fromEntries(cutNames.map((cut) => [cut, buildTimeline(script, data, cut)])) as Partial<Record<Cut, Timeline>>;

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

const CUT_NAMES: Record<Cut, string> = { module: "Module", site: "Site" };
const width = Math.max(...script.chapters.map((chapter) => name(chapter).length)) + 4;
const lines: string[] = [
  `${script.title.lead} ${script.title.name}`,
  `Script de la voix off · ${script.title.kicker.module ?? script.title.kicker.site}`,
  "",
  `Durée : ${cutNames.map((cut) => `${length(cuts[cut]!.duration)} (version ${cut})`).join(" · ")}`,
  "",
  "CHAPITRES",
  `${"".padEnd(width)}${cutNames.map((cut) => CUT_NAMES[cut].padEnd(9)).join("").trimEnd()}`,
  ...script.chapters.map((chapter) => `${name(chapter).padEnd(width)}${cutNames.map((cut) => start(cuts[cut]!, chapter).padEnd(9)).join("").trimEnd()}`),
];

for (const chapter of script.chapters) {
  const where = chapter.moduleOnly
    ? "version module uniquement"
    : cutNames.map((cut) => `${cutNames.length > 1 ? `${cut} ` : ""}${start(cuts[cut]!, chapter)}`).join(" · ");
  lines.push("", RULE, "", `${name(chapter).toUpperCase()}   (${where})`);
  if (chapter.before === "result") lines.push("", "[On écoute le début du dialogue de démonstration.]");
  for (const paragraph of chapter.paragraphs) {
    if (paragraph.scene === "result") lines.push("", "[À l'écran : le document terminé.]");
    lines.push("", paragraph.text);
    if (paragraph.after === "compare") lines.push("", "[On écoute la même réplique en A1, rythme lent, puis en B1.]");
  }
}

lines.push("", RULE, "", script.appendix.title.toUpperCase(), "", ...script.appendix.lines, "");

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join("\n"));
console.log(`Wrote ${OUT}`);
