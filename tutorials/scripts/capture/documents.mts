// Screen states for "Prise en main de Documents". The worksheet is built and
// rendered by the studio's own code (buildDocument, renderMaterialHtml), its
// PDF printed by Chromium as the worker does, and the one AI addition kept as
// a fixture so every capture shows the same document.
//
// Needs OPENROUTER_API_KEY the first time (the comprehension questions).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Browser, Locator, Page, Route } from "playwright";
import { additionsAllowedTypes, buildDocument, isDocumentAddition } from "../../../worker/lib/documents/generate";
import { renderMaterialHtml } from "../../../worker/lib/documents/material-renderer";
import type { DocumentDesign, SimpleTemplateId, SimpleTransformMaterial } from "../../../worker/lib/documents/types";
import { ACCENT, DEMO_PASTE_HTML, EMPHASIS, FOOTER, IMAGE_BEFORE, IMAGE_FILE } from "../../src/documents/script";
import { CARTONS_SIZE, CARTONS_SVG } from "./illustration.mts";
import { MOCK_USER, ROOT, json, measure, type Box, type BoxSpec, type Shooter, type Walk, type WalkContext } from "./kit.mts";

const OUT = resolve(ROOT, "public/documents");
const FIXTURE = resolve(ROOT, "fixtures/documents/material.json");
const IMAGE_ID = "cartons01";
/** Where the added questions start, in pages from the top of the PDF. */
const QUESTIONS_AT = 1.72;
const DAY = 86_400_000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();

interface TransformRequest {
  content: string;
  title?: string;
  level?: string;
  languageFocus?: string;
  additions?: string[];
  emphasisTerms?: string[];
  templateId?: string;
  documentType?: string;
  orientation?: string;
  design?: DocumentDesign;
  locale?: string;
}

const state = {
  browser: null as Browser | null,
  image: Buffer.alloc(0) as Buffer,
  material: null as SimpleTransformMaterial | null,
  status: "processing" as "processing" | "completed",
  recent: [
    { id: "plan2", status: "completed", label: "Plan de cours — Séance 2 : se présenter", createdAt: iso(-2 * DAY) },
    { id: "roles", status: "completed", label: "Cartes de rôle — À la boulangerie", createdAt: iso(-5 * DAY) },
    { id: "brief", status: "completed", label: "Brief de formation — Anglais professionnel", createdAt: iso(-9 * DAY) },
  ],
};

function images(): Record<string, string> {
  return { [IMAGE_ID]: `data:image/png;base64,${state.image.toString("base64")}` };
}

// ---- The document, built and printed by the studio's code ----

function requestKey(request: TransformRequest): string {
  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

interface ResponseFormat {
  json_schema?: { schema?: { properties?: { additions?: { items?: { oneOf?: Array<{ properties: { type: { const: string } } }> } } } } };
}

// The studio sends the model the schema of every block type; Gemini then mixes
// their fields and the call fails. Narrowed to the ticked types it does not.
function narrowedFetcher(types: Set<string>): typeof fetch {
  return (input, init) => {
    const body = JSON.parse(String(init?.body)) as { response_format?: ResponseFormat };
    const items = body.response_format?.json_schema?.schema?.properties?.additions?.items;
    if (items?.oneOf) items.oneOf = items.oneOf.filter((option) => types.has(option.properties.type.const));
    return fetch(input, { ...init, body: JSON.stringify(body) });
  };
}

async function buildMaterial(request: TransformRequest): Promise<SimpleTransformMaterial> {
  const key = requestKey(request);
  if (existsSync(FIXTURE)) {
    const cached = JSON.parse(readFileSync(FIXTURE, "utf8")) as { key: string; material: SimpleTransformMaterial };
    if (cached.key === key) return cached.material;
  }
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set: the comprehension questions are written by the model.");
  const additions = (request.additions ?? []).filter(isDocumentAddition);
  const result = await buildDocument({ apiKey, fetcher: narrowedFetcher(additionsAllowedTypes(additions)) }, request.content, {
    title: request.title,
    level: request.level,
    languageFocus: request.languageFocus,
    additions,
    emphasisTerms: request.emphasisTerms ?? [],
    templateId: request.templateId as SimpleTemplateId | undefined,
    documentType: request.documentType as SimpleTransformMaterial["document_type"],
    design: request.design,
    locale: request.locale,
  });
  const material = result.materials[0] as SimpleTransformMaterial;
  mkdirSync(dirname(FIXTURE), { recursive: true });
  writeFileSync(FIXTURE, `${JSON.stringify({ key, material }, null, 2)}\n`);
  return material;
}

function escapeFooter(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// As worker/lib/documents/pdf.ts prints it, with Playwright's Chromium.
async function printPdf(material: SimpleTransformMaterial): Promise<Buffer> {
  const html = renderMaterialHtml(material, { simpleTemplate: material.template_id, images: images() });
  const page = await (state.browser as Browser).newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle" });
    const landscape = material.orientation === "landscape";
    const footer = material.design?.footerText?.trim();
    let pageNumbers = Boolean(footer);
    if (!footer) {
      await page.emulateMedia({ media: "print" });
      const height = await page.evaluate(() => Math.max(document.querySelector("main")?.scrollHeight ?? 0, document.body.scrollHeight));
      pageNumbers = height > (landscape ? 680 : 990);
    }
    const showFooter = pageNumbers || Boolean(footer);
    return await page.pdf({
      format: "A4",
      landscape,
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: showFooter,
      headerTemplate: "<div></div>",
      footerTemplate: showFooter
        ? `<div style="width:100%;padding:0 19mm;font:8px Arial,sans-serif;color:#6c7483;display:flex;justify-content:space-between;">
            <span>${footer ? escapeFooter(footer) : ""}</span>
            <span>${pageNumbers ? '<span class="pageNumber"></span> / <span class="totalPages"></span>' : ""}</span>
          </div>`
        : "<div></div>",
    });
  } finally {
    await page.close();
  }
}

// The finished document's pages as images, drawn by Chromium's own PDF viewer
// (PDF.js skips the gradients that draw the answer lines). The viewer only
// lays pages out right at device scale 1, hence the large window.
async function pageImages(pdf: Buffer): Promise<Array<{ file: string; width: number; height: number }>> {
  const count = Number(/\/Type \/Pages[\s\S]*?\/Count (\d+)/.exec(pdf.toString("latin1"))?.[1] ?? 0);
  const context = await (state.browser as Browser).newContext({ viewport: { width: 1500, height: 2100 }, deviceScaleFactor: 1 });
  try {
    const viewer = await context.newPage();
    await viewer.route("**/document.pdf*", (route) => route.fulfill({ contentType: "application/pdf", headers: { "Content-Disposition": "inline" }, body: pdf }));
    const cropper = await context.newPage();
    // tsx names the helpers below with __name, which the page lacks.
    await cropper.evaluate("window.__name = (fn) => fn");
    mkdirSync(resolve(OUT, "pages"), { recursive: true });
    const pages: Array<{ file: string; width: number; height: number }> = [];
    for (let number = 1; number <= count; number += 1) {
      await viewer.goto(`http://pages.local/document.pdf?page=${number}#page=${number}&toolbar=0&navpanes=0&view=Fit`);
      await viewer.waitForTimeout(3000);
      const shot = await viewer.screenshot();
      // The page is the light rectangle on the viewer's dark background.
      const cropped = await cropper.evaluate(async (url) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context2d = canvas.getContext("2d") as CanvasRenderingContext2D;
        context2d.drawImage(image, 0, 0);
        const { data } = context2d.getImageData(0, 0, image.width, image.height);
        const light = (x: number, y: number) => {
          const i = (y * image.width + x) * 4;
          return data[i] + data[i + 1] + data[i + 2] > 3 * 170;
        };
        const samples = [0.2, 0.35, 0.5, 0.65, 0.8];
        const first = (size: number, at: (position: number, sample: number) => boolean) =>
          Math.min(...samples.map((sample) => {
            for (let position = 0; position < size; position += 1) if (at(position, sample)) return position;
            return size;
          }));
        const top = first(image.height, (y, f) => light(Math.round(f * image.width), y));
        const bottom = image.height - first(image.height, (y, f) => light(Math.round(f * image.width), image.height - 1 - y));
        const left = first(image.width, (x, f) => light(x, Math.round(f * image.height)));
        const right = image.width - first(image.width, (x, f) => light(image.width - 1 - x, Math.round(f * image.height)));
        const out = document.createElement("canvas");
        out.width = right - left;
        out.height = bottom - top;
        (out.getContext("2d") as CanvasRenderingContext2D).drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height);
        return { url: out.toDataURL("image/png"), width: out.width, height: out.height };
      }, `data:image/png;base64,${shot.toString("base64")}`);
      const file = `documents/pages/page-${number}.png`;
      writeFileSync(resolve(ROOT, "public", file), Buffer.from(cropped.url.split(",")[1], "base64"));
      pages.push({ file, width: cropped.width, height: cropped.height });
    }
    return pages;
  } finally {
    await context.close();
  }
}

/**
 * Shows the PDF in the preview frame as Chromium's viewer lays it out (pages
 * fit to width on its dark ground), scrolled so that `at` pages are above the
 * top edge. Headless Chromium's own viewer zooms wrongly at device scale 2.
 */
async function showPdf(page: Page, pages: Array<{ file: string }>, at: number) {
  const sources = pages.map((entry) => `data:image/png;base64,${readFileSync(resolve(ROOT, "public", entry.file)).toString("base64")}`);
  await page.locator("iframe").first().evaluate((frame, [images, scroll]) => {
    const iframe = frame as HTMLIFrameElement;
    const list = (images as string[]).map((src) => `<img src="${src}" style="display:block;width:100%;margin:0 0 10px;box-shadow:0 1px 4px rgba(0,0,0,0.55)">`).join("");
    iframe.removeAttribute("src");
    iframe.srcdoc = `<!doctype html><html><body style="margin:0;background:#282828;overflow:hidden">
      <div id="pages" style="padding:10px 12px">${list}</div>
      <style>#pages { transform: translateY(calc(-1 * var(--scroll, 0px))); }</style>
      </body></html>`;
    iframe.dataset.scroll = String(scroll);
  }, [sources, at] as const);
  const frame = page.frameLocator("iframe").first();
  await frame.locator("img").last().waitFor();
  await page.locator("iframe").first().evaluate((element) => {
    const iframe = element as HTMLIFrameElement;
    const doc = iframe.contentDocument as Document;
    const images = Array.from(doc.querySelectorAll("img"));
    const at = Number(iframe.dataset.scroll);
    const whole = Math.floor(at);
    const target = images[Math.min(whole, images.length - 1)];
    const offset = target.offsetTop + (at - whole) * target.offsetHeight - 10;
    (doc.getElementById("pages") as HTMLElement).style.setProperty("--scroll", `${Math.max(0, offset)}px`);
  });
  await page.waitForTimeout(300);
}

// ---- The studio's API ----

function job() {
  return {
    id: "demo",
    status: state.status,
    result: state.status === "completed" && state.material ? { materials: [state.material] } : null,
    error: null,
    createdAt: iso(0),
  };
}

async function answer(route: Route) {
  const url = new URL(route.request().url());
  const path = url.pathname;
  const method = route.request().method();
  if (path === "/api/auth/me") return json(route, MOCK_USER);
  if (path === "/api/documents/images" && method === "POST") return json(route, { id: IMAGE_ID }, 201);
  if (path === `/api/documents/images/${IMAGE_ID}`) return route.fulfill({ contentType: "image/png", body: state.image });
  if (path === "/api/documents/transform" && method === "POST") {
    state.material = await buildMaterial(route.request().postDataJSON() as TransformRequest);
    return json(route, { jobId: "demo" }, 202);
  }
  if (path === "/api/documents/jobs") {
    const done = state.status === "completed" && state.material
      ? [{ id: "demo", status: "completed", label: state.material.title, createdAt: iso(0) }]
      : [];
    return json(route, { jobs: [...done, ...state.recent] });
  }
  if (path === "/api/documents/jobs/demo") return json(route, { job: job() });
  if (path === "/api/documents/jobs/demo/materials/0/presentation" && method === "PATCH") {
    const update = route.request().postDataJSON() as { templateId?: SimpleTemplateId; design?: DocumentDesign; orientation?: "portrait" | "landscape" };
    const material = state.material as SimpleTransformMaterial;
    if (update.templateId) material.template_id = update.templateId;
    if (update.orientation) material.orientation = update.orientation;
    if (update.design) {
      const cleaned = Object.fromEntries(Object.entries(update.design).filter(([, value]) => value !== undefined && value !== ""));
      if (Object.keys(cleaned).length > 0) material.design = cleaned as DocumentDesign;
      else delete material.design;
    }
    return json(route, { job: job() });
  }
  if (path === "/api/documents/jobs/demo/materials/0.html") {
    const material = state.material as SimpleTransformMaterial;
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: renderMaterialHtml(material, { simpleTemplate: material.template_id, images: images() }) });
  }
  if (path === "/api/documents/jobs/demo/materials/0.pdf") {
    return route.fulfill({ contentType: "application/pdf", headers: { "Content-Disposition": "inline" }, body: await printPdf(state.material as SimpleTransformMaterial) });
  }
  return json(route, { error: "Not found" }, 404);
}

// ---- Boxes ----

function step(page: Page, n: number) {
  return page.locator("section").filter({ has: page.locator(`#step${n}-title`) }).first();
}
function textarea(page: Page) {
  return page.locator('textarea[aria-labelledby="step1-title"]');
}
function group(page: Page, label: string) {
  return page.locator("p", { hasText: label }).first().locator("..");
}
function labelled(page: Page, text: string) {
  return page.locator("label").filter({ has: page.locator("span", { hasText: text }) }).first();
}
function fieldset(page: Page, legend: string) {
  return page.locator("fieldset").filter({ has: page.locator("legend", { hasText: legend }) }).first();
}
function recent(page: Page) {
  return page.locator("aside").filter({ has: page.getByRole("heading", { name: "Documents récents" }) });
}
function panel(page: Page) {
  return page.locator("#appearance-panel-title").locator("xpath=ancestor::section[1]");
}
function submit(page: Page) {
  return page.getByRole("button", { name: "Mettre en page" });
}

const BOXES: Record<string, BoxSpec> = {
  header: (p) => p.locator("header").filter({ has: p.getByRole("heading", { level: 1, name: "Documents" }) }),
  guideBtn: (p) => p.getByRole("button", { name: "Guide", exact: true }),
  step1: (p) => step(p, 1),
  step2: (p) => step(p, 2),
  step2Head: (p) => p.locator("#step2-title").locator(".."),
  textarea: (p) => textarea(p),
  contentTools: (p) => p.getByRole("button", { name: "Ajouter une image" }).locator(".."),
  addImage: (p) => p.getByRole("button", { name: "Ajouter une image" }),
  syntaxToggle: (p) => p.getByRole("button", { name: "Ce que Documents reconnaît" }),
  syntaxHelp: (p) => p.locator("dl").filter({ hasText: "# Titre" }).first(),
  caret: (p) => p.evaluate(() => (window as unknown as { __caret?: { x: number; y: number; w: number; h: number } }).__caret ?? null),
  catalogue: (p) => p.getByRole("radiogroup").first(),
  groupLearner: (p) => group(p, "À distribuer à l'apprenant"),
  groupTeacher: (p) => group(p, "Pour vous, l'enseignant"),
  groupCourse: (p) => group(p, "Pour cadrer la formation"),
  groupOther: (p) => p.getByRole("radiogroup").locator("p", { hasText: /^Autre$/ }).locator(".."),
  typeWorksheet: (p) => p.locator("label").filter({ hasText: "Support apprenant (exercices)" }),
  typeFree: (p) => p.locator("label").filter({ hasText: "Document libre" }),
  optionalSummary: (p) => p.locator("details summary").filter({ hasText: "Précisions facultatives" }),
  optionalBody: (p) => p.locator("details").filter({ hasText: "Précisions facultatives" }),
  titleLanguage: (p) => [labelled(p, "Titre du document"), labelled(p, "Langue enseignée")],
  levelChips: (p) => fieldset(p, "Niveau"),
  levelB1: (p) => fieldset(p, "Niveau").getByRole("button", { name: "B1", exact: true }),
  emphasisField: (p) => labelled(p, "Mots à mettre en gras"),
  levelEmphasis: (p) => [fieldset(p, "Niveau"), labelled(p, "Mots à mettre en gras")],
  additions: (p) => fieldset(p, "Ajouter au document"),
  additionQuestions: (p) => p.locator("label").filter({ hasText: "Des questions de compréhension" }),
  submitBar: (p) => submit(p).locator(".."),
  submitBtn: (p) => submit(p),
  submitHint: (p) => submit(p).locator("..").locator("p"),
  recent: (p) => recent(p),
  recentRow: (p) => recent(p).locator("button:not([aria-label])").first(),
  waiting: (p) => p.locator("section").filter({ hasText: "Mise en page de votre document" }).first(),
  reviewTop: (p) => [p.locator("#review-title").locator("..").locator(".."), p.getByRole("button", { name: "Modifier le texte" }).locator("..")],
  downloadBtn: (p) => p.getByRole("button", { name: "Télécharger le PDF" }).first(),
  editText: (p) => p.getByRole("button", { name: "Modifier le texte" }),
  copyText: (p) => p.getByRole("button", { name: "Copier le texte" }),
  previewFrame: (p) => p.locator("iframe").first(),
  workspace: (p) => [p.locator("iframe").first().locator(".."), panel(p)],
  viewArea: (p) => [p.getByRole("group", { name: "Mode d'aperçu" }), p.getByRole("group", { name: "Mode d'aperçu" }).locator("xpath=following-sibling::p[1]")],
  viewQuick: (p) => p.getByRole("group", { name: "Mode d'aperçu" }).getByRole("button", { name: "Aperçu rapide" }),
  viewExact: (p) => p.getByRole("group", { name: "Mode d'aperçu" }).getByRole("button", { name: "Pages exactes" }),
  panel: (p) => panel(p),
  panelTop: (p) => [p.locator("#appearance-panel-title").locator(".."), fieldset(p, "Orientation")],
  panelIntro: (p) => panel(p).locator("p").first(),
  stylePicker: (p) => panel(p).locator("fieldset").first(),
  styleClassroom: (p) => panel(p).locator("label").filter({ hasText: "Support de classe" }),
  accent: (p) => fieldset(p, "Couleur"),
  swatch: (p) => p.getByRole("button", { name: `Couleur ${ACCENT}` }),
  orientation: (p) => fieldset(p, "Orientation"),
  moreSummary: (p) => panel(p).locator("details > summary"),
  moreBody: (p) => panel(p).locator("details"),
  headerBand: (p) => p.getByRole("button", { name: "Titre sur fond de couleur" }),
  footerField: (p) => labelled(p, "Pied de page"),
  footerArea: (p) => [labelled(p, "Pied de page"), p.getByRole("button", { name: "Revenir au style d'origine" })],
  resetBtn: (p) => p.getByRole("button", { name: "Revenir au style d'origine" }),
  guidePanel: (p) => p.getByRole("dialog"),
  guideSteps: (p) => p.getByRole("dialog").locator("ol"),
  guidePrompt: (p) => p.getByRole("dialog").locator("section"),
};

// ---- The walk ----

/**
 * Scrolls the text box so the line starting at `index` sits third from the
 * top, and records where that line is on the page. The line's height is
 * measured on the text box itself, holding only the text before it.
 */
async function markCaret(page: Page, index: number) {
  await textarea(page).evaluate((element, at) => {
    const area = element as HTMLTextAreaElement;
    const style = getComputedStyle(area);
    const { value, selectionStart, selectionEnd } = area;
    const { height, minHeight } = area.style;
    area.value = value.slice(0, at);
    Object.assign(area.style, { height: "0px", minHeight: "0px" });
    const before = area.scrollHeight;
    Object.assign(area.style, { height, minHeight });
    area.value = value;
    area.setSelectionRange(selectionStart, selectionEnd);
    const lineHeight = parseFloat(style.lineHeight) || 24;
    const top = before - parseFloat(style.paddingBottom) - lineHeight;
    area.scrollTop = Math.max(0, top - parseFloat(style.paddingTop) - lineHeight * 2);
    const rect = area.getBoundingClientRect();
    (window as unknown as { __caret: unknown }).__caret = {
      x: rect.left + window.scrollX + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
      y: rect.top + window.scrollY + parseFloat(style.borderTopWidth) + top - area.scrollTop,
      w: 330,
      h: lineHeight,
    };
  }, index);
}

async function clearCaret(page: Page) {
  await page.evaluate(() => {
    delete (window as unknown as { __caret?: unknown }).__caret;
  });
}

async function previewSettled(page: Page) {
  await page.waitForTimeout(900);
  await page.locator("iframe").first().waitFor();
  await page.waitForTimeout(600);
}

async function run(page: Page, shoot: Shooter, ctx: WalkContext) {
  state.browser = ctx.browser;
  const drawing = await ctx.browser.newPage({ viewport: CARTONS_SIZE });
  await drawing.setContent(`<body style="margin:0">${CARTONS_SVG}</body>`);
  state.image = await drawing.screenshot({ clip: { x: 0, y: 0, ...CARTONS_SIZE } });
  await drawing.close();
  page.on("dialog", (dialog) => void dialog.accept());

  await page.goto(ctx.url("/documents"));
  await page.getByRole("heading", { level: 1, name: "Documents" }).waitFor();
  await recent(page).getByText("Plan de cours").waitFor();
  await shoot(page, "empty");

  // Copied from Google Docs: the clipboard holds HTML, which the studio turns
  // into the text it reads.
  await textarea(page).click();
  await textarea(page).evaluate((element, html) => {
    const data = new DataTransfer();
    data.setData("text/html", html);
    data.setData("text/plain", "");
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, DEMO_PASTE_HTML);
  await page.waitForTimeout(300);
  const pasted = await textarea(page).inputValue();
  writeFileSync(resolve(OUT, "pasted.md"), pasted);
  await textarea(page).evaluate((element) => {
    (element as HTMLTextAreaElement).scrollTop = 0;
  });
  await shoot(page, "pasted");

  await markCaret(page, pasted.search(/^\|/m));
  await clearCaret(page);
  await shoot(page, "pastedTable");

  const imageAt = pasted.indexOf(IMAGE_BEFORE);
  if (imageAt < 0) throw new Error(`"${IMAGE_BEFORE}" is not in the pasted text.`);
  await textarea(page).evaluate((element, at) => {
    const area = element as HTMLTextAreaElement;
    area.focus();
    area.setSelectionRange(at, at);
  }, imageAt);
  await markCaret(page, imageAt);
  await shoot(page, "cursor");

  await page.locator('input[type="file"]').first().setInputFiles({ name: IMAGE_FILE, mimeType: "image/png", buffer: state.image });
  await page.waitForFunction(() => document.querySelector("textarea")?.value.includes("studio:"));
  await page.waitForTimeout(300);
  const content = await textarea(page).inputValue();
  writeFileSync(resolve(OUT, "source.md"), content);
  await markCaret(page, content.indexOf("!["));
  await shoot(page, "image");
  await clearCaret(page);

  await page.getByRole("button", { name: "Ce que Documents reconnaît" }).click();
  await shoot(page, "syntax");
  await page.getByRole("button", { name: "Ce que Documents reconnaît" }).click();
  await shoot(page, "types");

  await page.locator("label").filter({ hasText: "Support apprenant (exercices)" }).click();
  await shoot(page, "typeSelected");

  await page.locator("details summary").filter({ hasText: "Précisions facultatives" }).click();
  await shoot(page, "optional");

  await fieldset(page, "Niveau").getByRole("button", { name: "B1", exact: true }).click();
  await labelled(page, "Langue enseignée").locator("input").fill("français");
  await labelled(page, "Mots à mettre en gras").locator("input").fill(EMPHASIS);
  await shoot(page, "optionalFilled");

  await page.locator("label").filter({ hasText: "Des questions de compréhension" }).click();
  await shoot(page, "addition");

  // The document is built before the click, so the studio's request does
  // not wait on the model: same request, same cache key.
  await buildMaterial({
    content,
    level: "B1",
    languageFocus: "français",
    additions: ["questions"],
    emphasisTerms: EMPHASIS.split(",").map((term) => term.trim()),
    templateId: "editorial_reader",
    documentType: "worksheet",
    locale: "fr",
  });
  await submit(page).click();
  await page.locator("section").filter({ hasText: "Mise en page de votre document" }).first().waitFor();
  await shoot(page, "waiting");

  state.status = "completed";
  await page.locator("#review-title").waitFor({ timeout: 20_000 });
  await previewSettled(page);
  await shoot(page, "preview");

  await panel(page).locator("label").filter({ hasText: "Support de classe" }).click();
  await previewSettled(page);
  await shoot(page, "classroom");

  await page.getByRole("button", { name: `Couleur ${ACCENT}` }).click();
  await previewSettled(page);
  await shoot(page, "color");

  await panel(page).locator("details > summary").click();
  await shoot(page, "more");

  await page.getByRole("button", { name: "Titre sur fond de couleur" }).click();
  await previewSettled(page);
  await shoot(page, "band");

  await labelled(page, "Pied de page").locator("input").fill(FOOTER);
  await page.waitForTimeout(900);
  await previewSettled(page);
  await shoot(page, "footer");

  // The finished document, as it will be downloaded.
  const pdf = await printPdf(state.material as SimpleTransformMaterial);
  writeFileSync(resolve(OUT, "document.pdf"), pdf);
  const pages = await pageImages(pdf);
  writeFileSync(resolve(OUT, "demo.json"), `${JSON.stringify({ kind: "documents", title: (state.material as SimpleTransformMaterial).title, pages }, null, 2)}\n`);

  await page.getByRole("group", { name: "Mode d'aperçu" }).getByRole("button", { name: "Pages exactes" }).click();
  await page.waitForTimeout(1500);
  await showPdf(page, pages, 0);
  await shoot(page, "exact");

  // The teacher scrolls down to the questions added at the end.
  await showPdf(page, pages, QUESTIONS_AT);
  await shoot(page, "exactLast");

  await page.getByRole("button", { name: "Nouveau document" }).click();
  await recent(page).getByText((state.material as SimpleTransformMaterial).title).waitFor();
  await shoot(page, "recent");

  await page.getByRole("button", { name: "Guide", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await shoot(page, "guide");
}

export const walk: Walk = { boxes: BOXES, answer, run };
export { measure, type Box, type Locator };
