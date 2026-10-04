// Screen states for "Prise en main du Studio audio": the real studio, run by
// Vite from the app's sources, with its API answered from the demo
// (scripts/demo.mts). Each shot is a full-page capture plus the boxes of the
// elements the edit frames, spotlights and clicks.
//
//   npm run capture
//
// Writes public/studio-audio/shots/ and copies the brand fonts to public/fonts/.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { chromium, type Locator, type Page, type Route } from "playwright";
import { createServer } from "vite";
import { AUDIO_VOICES } from "../../worker/lib/audio-voices";
import { normalizeDialogueLabels } from "../../src/lib/audio-script-rules";
import { DEMO_SCENE, DEMO_SCRIPT, YANIS_NOTES } from "../src/studio-audio/script";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP = resolve(ROOT, "..");
const OUT = resolve(ROOT, "public/studio-audio/shots");
const PORT = 5317;
const VIEWPORT = { width: 1440, height: 900 };

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const demo = JSON.parse(readFileSync(resolve(ROOT, "public/studio-audio/demo.json"), "utf8"));
const takeMp3 = readFileSync(resolve(ROOT, "public/studio-audio/take.mp3"));

// ---- The studio's API, answered from the demo ----

const DAY = 86_400_000;
const now = Date.now();
const iso = (offset: number) => new Date(now + offset).toISOString();

const demoJob = {
  id: "demo",
  mode: "dialogue",
  quality: "final",
  title: null,
  script: demo.applied,
  direction: demo.direction,
  voices: demo.voices,
  status: "generating",
  estimatedSeconds: demo.take.estimatedSeconds,
  actualSeconds: null as number | null,
  error: null,
  modelUsed: "google/gemini-3.8-flash-tts",
  genMs: null,
  retryCount: 0,
  apiCostUsd: null,
  expiresAt: iso(7 * DAY - 60_000),
  createdAt: iso(0),
  // Stored as the worker writes it: names rewritten to voice slots.
  segments: [{ idx: 0, status: "pending", text: normalizeDialogueLabels(demo.applied) }] as Array<Record<string, unknown>>,
};

function readyJob() {
  const seconds = demo.take.seconds;
  return {
    ...demoJob,
    status: "ready",
    actualSeconds: Math.ceil(seconds),
    segments: [{ idx: 0, status: "ok", text: normalizeDialogueLabels(demo.applied), durationSeconds: seconds }],
    waveform: {
      peaks: demo.take.peaks,
      blocks: [{ idx: 0, startSeconds: 0, endSeconds: seconds, durationSeconds: seconds }],
    },
    downloads: {
      mp3: "/api/audio/jobs/demo/download/final.mp3",
      wav: "/api/audio/jobs/demo/download/final.wav",
      transcript: "/api/audio/jobs/demo/download/transcript.txt",
    },
  };
}

// Earlier takes, so the history and the library look lived in.
const olderTakes = [
  {
    ...demoJob,
    id: "cafe",
    title: "Au café : commander",
    script: "Inès : Bonjour, un café et un jus d'orange, s'il vous plaît.\nThomas : Sur place ou à emporter ?",
    direction: { ...demo.direction, level: "A2" },
    status: "ready",
    estimatedSeconds: 38,
    actualSeconds: 36,
    segments: undefined,
    expiresAt: iso(3 * DAY),
    createdAt: iso(-4 * DAY),
  },
  {
    ...demoJob,
    id: "meteo",
    mode: "monologue",
    title: "La météo de la semaine",
    script: "Cette semaine, le soleil revient sur toute la France.",
    direction: { ...demo.direction, level: "A1" },
    voices: { solo: "Kore" },
    status: "ready",
    estimatedSeconds: 52,
    actualSeconds: 49,
    segments: undefined,
    expiresAt: iso(5 * DAY),
    createdAt: iso(-2 * DAY),
  },
];

const api = {
  job: demoJob as Record<string, unknown>,
  history: [...olderTakes] as Array<Record<string, unknown>>,
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function answer(route: Route) {
  const url = new URL(route.request().url());
  const path = url.pathname;
  const method = route.request().method();
  if (path === "/api/auth/me") {
    return json(route, {
      user: { id: "u1", email: "claire@example.com", name: "Claire", role: "teacher", languagePreference: "fr", tier: "participant" },
      quota: null,
    });
  }
  if (path === "/api/audio/quota") return json(route, { includedRemaining: 1800, credits: 0, monthResetsOn: iso(20 * DAY).slice(0, 10) });
  if (path === "/api/audio/voices") return json(route, { voices: AUDIO_VOICES });
  if (path === "/api/audio/credits/packs") return json(route, { packs: [] });
  if (path === "/api/audio/suggest") return json(route, { suggestions: demo.suggestions, warnings: [] });
  if (path === "/api/audio/jobs" && method === "POST") return json(route, { jobId: "demo", estimatedSeconds: demoJob.estimatedSeconds });
  if (path === "/api/audio/jobs") return json(route, { jobs: api.history });
  if (path === "/api/audio/jobs/demo/download/final.mp3") {
    return route.fulfill({ status: 200, contentType: "audio/mpeg", body: takeMp3 });
  }
  const job = path.match(/^\/api\/audio\/jobs\/([^/]+)$/)?.[1];
  if (job === "demo") return json(route, { job: api.job });
  if (job) return json(route, { job: api.history.find((entry) => entry.id === job) });
  return json(route, { error: "Not found" }, 404);
}

// ---- Boxes: what each shot exposes to the edit ----

type BoxPart = Locator | Promise<Box | null>;
type BoxSpec = (page: Page) => BoxPart | BoxPart[];

function zone(page: Page, name: string) {
  return page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name, exact: true }) }).first();
}
function review(page: Page) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "Émotions proposées" }) }).first();
}
function player(page: Page) {
  return page.locator('section[aria-label="Lecteur audio"]');
}
function history(page: Page) {
  return zone(page, "Prises récentes");
}
function field(page: Page, label: string) {
  return page.locator("label").filter({ has: page.locator("span", { hasText: label }) }).first();
}
function editor(page: Page) {
  return page.locator('textarea[aria-label="Script"]');
}
function firstTag(page: Page) {
  const tag = demo.suggestions.find((suggestion: { kind: string }) => suggestion.kind === "tag");
  return review(page).getByRole("button", { name: TAG_LABELS[tag.tag.slice(1, -1).replace(/\s+/g, "_")], exact: true });
}
async function part(locator: Locator, pick: (box: Box) => Box): Promise<Box | null> {
  const box = await measure(locator);
  return box ? pick(box) : null;
}

const fr = JSON.parse(readFileSync(resolve(APP, "src/lib/i18n/fr.json"), "utf8"));
const TAG_LABELS: Record<string, string> = fr.audio.tag_label;

const BOXES: Record<string, BoxSpec> = {
  zoneScript: (p) => zone(p, "Script"),
  zoneDirection: (p) => zone(p, "Direction"),
  zoneCabine: (p) => zone(p, "Cabine"),
  quota: (p) => p.locator('div[title="Réinitialisation mensuelle automatique"]'),
  modeToggle: (p) => p.locator('[aria-label="Mode"]'),
  modeDialogue: (p) => p.locator('[aria-label="Mode"]').getByRole("button", { name: "Dialogue" }),
  editor: (p) => editor(p),
  editorTop: (p) => part(editor(p), (b) => ({ ...b, h: Math.min(b.h, 128) })),
  editorEnd: (p) => part(editor(p), (b) => ({ x: b.x + 14, y: b.y + b.h - 44, w: 220, h: 30 })),
  status: (p) => [p.locator("p", { hasText: "personnages :" }).first(), p.locator("p", { hasText: "entre parenthèses" }).first()],
  statusCast: (p) => p.locator("p", { hasText: "personnages :" }).first(),
  statusParens: (p) => p.locator("p", { hasText: "entre parenthèses" }).first(),
  problem: (p) => p.locator('p[role="alert"]', { hasText: "personnages détectés" }),
  problemArea: (p) => [part(editor(p), (b) => ({ ...b, y: b.y + b.h - 120, h: 120 })), p.locator('p[role="alert"]', { hasText: "personnages détectés" })],
  actions: (p) => p.getByRole("button", { name: "Proposer des émotions" }).locator(".."),
  suggestBtn: (p) => p.getByRole("button", { name: "Proposer des émotions" }),
  guideLink: (p) => p.getByRole("button", { name: "Proposer des émotions" }).locator("..").getByRole("button", { name: "Guide du studio" }),
  review: (p) => review(p),
  fixLaugh: (p) => review(p).locator("del", { hasText: "(il rit)" }).locator("xpath=ancestor::span[1]"),
  fixCarton: (p) => review(p).locator("del", { hasText: "(il prend le carton)" }).locator("xpath=ancestor::span[1]"),
  firstTag: (p) => firstTag(p).locator(".."),
  firstTagLabel: (p) => firstTag(p),
  firstTagAccept: (p) => firstTag(p).locator("..").getByRole("button", { name: /^Garder/ }),
  reason: (p) => review(p).locator('p[aria-live="polite"]'),
  reviewFooter: (p) => review(p).locator("footer"),
  applyBtn: (p) => review(p).getByRole("button", { name: /^Appliquer/ }),
  undoBtn: (p) => p.getByRole("button", { name: "Annuler les suggestions" }),
  emotionBtn: (p) => p.getByRole("button", { name: "Ajouter une émotion" }),
  menu: (p) => p.locator('[role="group"][aria-label^="L\'émotion"]'),
  menuArea: (p) => [p.getByRole("button", { name: "Proposer des émotions" }).locator(".."), p.locator('[role="group"][aria-label^="L\'émotion"]')],
  level: (p) => field(p, "Niveau"),
  pace: (p) => field(p, "Rythme"),
  levelPace: (p) => [field(p, "Niveau"), field(p, "Rythme")],
  style: (p) => p.locator("fieldset").first().locator("label").filter({ has: p.locator("span", { hasText: "Style" }) }),
  styleArea: (p) => p.locator("fieldset").first(),
  speakerSummary: (p) => p.locator("details > summary"),
  yanisGroup: (p) => p.locator("fieldset").nth(1),
  yanisNotes: (p) => p.locator("fieldset").nth(1).locator("label").filter({ has: p.locator("span", { hasText: "Façon de s'exprimer" }) }),
  scene: (p) => field(p, "Scène"),
  cards: (p) => p.locator('[aria-label="Attribution des voix"]'),
  cardChloe: (p) => p.locator('[aria-label="Attribution des voix"]').getByRole("button").nth(0),
  cardYanis: (p) => p.locator('[aria-label="Attribution des voix"]').getByRole("button").nth(1),
  filters: (p) => p.locator('[aria-labelledby="voice-filter-gender-label"]').locator(".."),
  filterWarm: (p) => p.getByRole("button", { name: "Chaleureuse", exact: true }),
  voiceList: (p) => p.locator('[aria-label="Catalogue de voix"]'),
  previewFirst: (p) => p.locator('[aria-label="Catalogue de voix"] article').first().getByRole("button", { name: /^Écouter/ }),
  voiceRosa: (p) => p.locator('[aria-label="Catalogue de voix"] article', { hasText: "Rosa" }),
  generate: (p) => p.getByRole("button", { name: "Générer la prise" }).locator(".."),
  generateBtn: (p) => p.getByRole("button", { name: "Générer la prise" }),
  generateHint: (p) => p.locator("#generate-hint"),
  console: (p) => p.locator('section[aria-live="polite"]'),
  player: (p) => player(p),
  playerHead: (p) => player(p).getByRole("button", { name: "Lire" }).locator(".."),
  playBtn: (p) => player(p).getByRole("button", { name: "Lire" }),
  estActual: (p) => player(p).locator("small", { hasText: "Estimé" }),
  downloads: (p) => player(p).getByRole("link").first().locator(".."),
  downloadMp3: (p) => player(p).getByRole("link").first(),
  waveform: (p) => player(p).locator('svg[role="img"]'),
  block0: (p) => player(p).locator('svg[role="img"] rect[class*="block"]').first(),
  regenArea: (p) => player(p).getByRole("button", { name: /Régénérer/ }).locator(".."),
  history: (p) => history(p),
  historyRow: (p) => history(p).getByRole("button").first(),
  historyExpiry: (p) => history(p).getByRole("button").first().locator("small"),
  libraryList: (p) => p.locator("article").first().locator(".."),
  libraryRow: (p) => p.locator("article").first(),
  libraryRename: (p) => p.locator("article").first().getByRole("button", { name: "Renommer" }),
};

async function measure(locator: Locator): Promise<Box | null> {
  if ((await locator.count()) === 0) return null;
  const rect = await locator.first().evaluate((element) => {
    const r = element.getBoundingClientRect();
    return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height };
  });
  return rect.w > 0 && rect.h > 0 ? rect : null;
}

function union(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: right - x, h: bottom - y };
}

async function boxesOf(page: Page): Promise<Record<string, Box>> {
  const found: Record<string, Box> = {};
  for (const [id, spec] of Object.entries(BOXES)) {
    const target = spec(page);
    const parts = Array.isArray(target) ? target : [target];
    const boxes: Box[] = [];
    for (const item of parts) {
      const box = item instanceof Promise ? await item : await measure(item);
      if (box) boxes.push(box);
    }
    if (boxes.length === parts.length) found[id] = union(boxes);
  }
  return found;
}

// ---- The walk through the studio ----

const shots: Record<string, { file: string; width: number; height: number; boxes: Record<string, Box> }> = {};

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  // The sidebar is as tall as the window; on a full-page capture its colour
  // carries on down the page, as it does while scrolling.
  await page.evaluate(() => {
    const nav = document.querySelector("nav");
    const shell = nav?.parentElement;
    if (!nav || !shell) return;
    const colour = getComputedStyle(nav).backgroundColor;
    shell.style.background = `linear-gradient(to right, ${colour} ${nav.offsetWidth}px, transparent ${nav.offsetWidth}px)`;
  });
  await page.mouse.move(VIEWPORT.width - 4, 4);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(350);
}

// The script editor shows the whole dialogue, as a teacher who drags its
// corner would see it.
async function fitEditor(page: Page) {
  await editor(page).evaluate((element) => {
    const textarea = element as HTMLTextAreaElement;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight + 4}px`;
  });
}

async function shoot(page: Page, id: string) {
  await settle(page);
  const file = `studio-audio/shots/${id}.png`;
  await page.screenshot({ path: resolve(ROOT, "public", file), fullPage: true, animations: "disabled", caret: "hide" });
  const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
  shots[id] = { file, ...size, boxes: await boxesOf(page) };
  console.log(`${id}: ${Object.keys(shots[id].boxes).length} boxes`);
}

async function walk(page: Page) {
  await page.goto(`http://localhost:${PORT}/audio`);
  await page.getByRole("heading", { name: "Studio audio" }).waitFor();
  await page.getByText("30 min").waitFor();
  await shoot(page, "empty");

  await editor(page).fill(DEMO_SCRIPT);
  await fitEditor(page);
  await shoot(page, "pasted");

  await editor(page).fill(`${DEMO_SCRIPT}\nMei : Bonjour !`);
  await fitEditor(page);
  await shoot(page, "third");
  await editor(page).fill(DEMO_SCRIPT);
  await fitEditor(page);

  await page.getByRole("button", { name: "Proposer des émotions" }).click();
  await review(page).waitFor();
  await shoot(page, "review");

  await firstTag(page).click();
  await shoot(page, "reviewReason");
  await firstTag(page).click();

  const tags = demo.suggestions.filter((suggestion: { kind: string }) => suggestion.kind === "tag");
  const label = (tag: string) => TAG_LABELS[tag.slice(1, -1).replace(/\s+/g, "_")];
  await review(page).getByRole("button", { name: `Garder : ${label(tags[0].tag)}` }).click();
  await review(page).getByRole("button", { name: `Écarter : ${label(tags[1].tag)}` }).click();
  await review(page).getByRole("button", { name: "Tout garder" }).click();
  await shoot(page, "reviewDecided");

  await review(page).getByRole("button", { name: /^Appliquer/ }).click();
  await fitEditor(page);
  await shoot(page, "applied");

  await page.getByRole("button", { name: "Ajouter une émotion" }).click();
  await shoot(page, "menu");
  await page.keyboard.press("Escape");

  await page.locator("details > summary").click();
  const chloe = page.locator("fieldset").nth(0);
  await chloe.locator("select").nth(0).selectOption("Neutral");
  await chloe.locator("select").nth(1).selectOption("Informal conversation");
  await page.locator("fieldset").nth(1).locator('input[type="text"]').nth(1).fill(YANIS_NOTES);
  await field(page, "Scène").locator("textarea").fill(DEMO_SCENE);
  await shoot(page, "speakers");

  const cards = page.locator('[aria-label="Attribution des voix"]');
  await cards.getByRole("button").nth(0).click();
  await page.locator('[aria-labelledby="voice-filter-gender-label"]').getByRole("button", { name: "Féminine" }).click();
  await page.getByRole("button", { name: "Chaleureuse", exact: true }).click();
  await shoot(page, "filtered");

  await page.getByRole("button", { name: "Choisir Rosa, Féminine" }).click();
  await page.locator('[aria-labelledby="voice-filter-gender-label"]').getByRole("button", { name: "Masculine" }).click();
  await page.locator('[aria-labelledby="voice-filter-tone-label"]').getByRole("button", { name: "Toutes" }).click();
  await page.getByRole("button", { name: "Choisir Daniel, Masculine" }).click();
  await page.locator('[aria-labelledby="voice-filter-gender-label"]').getByRole("button", { name: "Toutes" }).click();
  await shoot(page, "cast");

  // From here on the editor folds as it does once a take is ready.
  await editor(page).evaluate((element) => {
    (element as HTMLTextAreaElement).style.height = "";
  });
  await page.getByRole("button", { name: "Générer la prise" }).click();
  await page.locator('section[aria-live="polite"]').waitFor();
  await page.waitForTimeout(3200);
  await shoot(page, "generating");

  api.job = readyJob();
  api.history = [api.job, ...olderTakes];
  await page.locator('section[aria-label="Lecteur audio"]').waitFor({ timeout: 15_000 });
  await page.getByText("Estimé").waitFor();
  await page.waitForTimeout(800);
  await shoot(page, "ready");

  await player(page).locator('svg[role="img"] rect[class*="block"]').first().click({ force: true });
  await shoot(page, "block");
  await player(page).locator('svg[role="img"] rect[class*="block"]').first().click({ force: true });

  await history(page).getByRole("button").first().click();
  await page.waitForTimeout(400);
  await field(page, "Niveau").locator("select").selectOption("A1");
  await field(page, "Rythme").locator("select").selectOption("Slow learner-friendly");
  await shoot(page, "variant");

  await page.goto(`http://localhost:${PORT}/audio/library`);
  await page.locator("article").first().waitFor();
  await shoot(page, "library");
}

// ---- Run ----

mkdirSync(OUT, { recursive: true });
mkdirSync(resolve(ROOT, "public/fonts"), { recursive: true });
for (const [from, to] of [
  ["@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2", "fraunces.woff2"],
  ["@fontsource-variable/fraunces/files/fraunces-latin-wght-italic.woff2", "fraunces-italic.woff2"],
  ["@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2", "dm-sans.woff2"],
]) {
  copyFileSync(resolve(APP, "node_modules", from), resolve(ROOT, "public/fonts", to));
}

const server = await createServer({
  configFile: false,
  root: APP,
  logLevel: "warn",
  plugins: [react()],
  resolve: { alias: { "@": resolve(APP, "src") } },
  server: { port: PORT, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, locale: "fr-FR", reducedMotion: "reduce" });
  await context.route("**/api/**", answer);
  const page = await context.newPage();
  page.on("pageerror", (error) => console.warn("page error:", error.message));
  await walk(page);
  writeFileSync(resolve(OUT, "shots.json"), `${JSON.stringify({ viewport: VIEWPORT, shots }, null, 2)}\n`);
  console.log(`Wrote ${Object.keys(shots).length} shots.`);
} finally {
  await browser.close();
  await server.close();
}
