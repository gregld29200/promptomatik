// What every capture shares: the studio run by Vite from the app's sources,
// Chromium driven by Playwright, the API answered by the tutorial's walk, and
// full-page shots with the boxes of what the edit frames, spotlights and clicks.
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { chromium, type Browser, type Locator, type Page, type Route } from "playwright";
import { createServer } from "vite";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const APP = resolve(ROOT, "..");
export const VIEWPORT = { width: 1440, height: 900 };
const PORT = 5317;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type BoxPart = Locator | Promise<Box | null>;
export type BoxSpec = (page: Page) => BoxPart | BoxPart[];
export type Shooter = (page: Page, id: string) => Promise<void>;

export interface WalkContext {
  url(path: string): string;
  browser: Browser;
}

export interface Walk {
  boxes: Record<string, BoxSpec>;
  answer(route: Route): Promise<unknown>;
  run(page: Page, shoot: Shooter, ctx: WalkContext): Promise<void>;
  /** Called before every shot, before the page is settled. */
  beforeShot?(page: Page): Promise<void>;
}

/** The teacher every walk is signed in as. */
export const MOCK_USER = {
  user: { id: "u1", email: "claire@example.com", name: "Claire", role: "teacher", languagePreference: "fr", tier: "participant" },
  quota: null,
};

export function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

export async function measure(locator: Locator): Promise<Box | null> {
  if ((await locator.count()) === 0) return null;
  const rect = await locator.first().evaluate((element) => {
    const r = element.getBoundingClientRect();
    return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height };
  });
  return rect.w > 0 && rect.h > 0 ? rect : null;
}

export async function part(locator: Locator, pick: (box: Box) => Box): Promise<Box | null> {
  const box = await measure(locator);
  return box ? pick(box) : null;
}

export function union(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: right - x, h: bottom - y };
}

async function boxesOf(page: Page, specs: Record<string, BoxSpec>): Promise<Record<string, Box>> {
  const found: Record<string, Box> = {};
  for (const [id, spec] of Object.entries(specs)) {
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

/** Captures tutorial `id` with its walk; writes public/<id>/shots/. */
export async function capture(id: string, walk: Walk): Promise<void> {
  const out = resolve(ROOT, "public", id, "shots");
  mkdirSync(out, { recursive: true });
  mkdirSync(resolve(ROOT, "public/fonts"), { recursive: true });
  for (const [from, to] of [
    ["@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2", "fraunces.woff2"],
    ["@fontsource-variable/fraunces/files/fraunces-latin-wght-italic.woff2", "fraunces-italic.woff2"],
    ["@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2", "dm-sans.woff2"],
  ]) {
    copyFileSync(resolve(APP, "node_modules", from), resolve(ROOT, "public/fonts", to));
  }

  const shots: Record<string, { file: string; width: number; height: number; boxes: Record<string, Box> }> = {};
  const shoot: Shooter = async (page, shotId) => {
    await walk.beforeShot?.(page);
    await settle(page);
    const file = `${id}/shots/${shotId}.png`;
    await page.screenshot({ path: resolve(ROOT, "public", file), fullPage: true, animations: "disabled", caret: "hide" });
    const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
    shots[shotId] = { file, ...size, boxes: await boxesOf(page, walk.boxes) };
    console.log(`${shotId}: ${Object.keys(shots[shotId].boxes).length} boxes`);
  };

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
    await context.route("**/api/**", (route) => walk.answer(route));
    const page = await context.newPage();
    page.on("pageerror", (error) => console.warn("page error:", error.message));
    await walk.run(page, shoot, { url: (path) => `http://localhost:${PORT}${path}`, browser });
    writeFileSync(resolve(out, "shots.json"), `${JSON.stringify({ viewport: VIEWPORT, shots }, null, 2)}\n`);
    console.log(`Wrote ${Object.keys(shots).length} shots.`);
  } finally {
    await browser.close();
    await server.close();
  }
}
