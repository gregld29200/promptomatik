// Run against a local production build. API fixtures avoid real users and paid AI calls.
// PLAYWRIGHT_MODULE and CHROME_PATH can point to an existing browser installation.
import assert from "node:assert/strict";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const baseURL = process.env.TEST_BASE_URL || "http://127.0.0.1:8789";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname));
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const user = { id: "fixture", name: "Teacher", email: "teacher@example.test",
  role: "teacher", tier: "participant", languagePreference: "fr" };
const template = {
  id: "source-template", user_id: user.id, name: "Programme B1 réception",
  language: "fr", tags: [], tips: [], source_type: "from_source", is_template: true,
  template_id: null, template_kind: "official", template_status: "approved",
  author_name: "Teacher", created_at: "2026-09-11", updated_at: "2026-09-11",
  blocks: [{ technique: "constraints", content: "Joignez fiche.txt avant de commencer.",
    attachment_requirements: true, annotation: "", order: 0 }],
  template_card: { theme: "programme", need: "Construire un programme sur mesure",
    when: "Vous préparez une formation professionnelle.", why: "Objectifs adaptés au métier.",
    adapt: ["Adaptez le niveau et la durée."] },
};
const copy = { ...template, id: "template-copy", is_template: false,
  template_id: template.id, template_card: null };
const profile = { languages_taught: ["English"], typical_levels: ["B1"],
  typical_audience: ["Adults"], typical_duration: "60", teaching_context: "",
  setup_completed: true, onboarding_completed: true, onboarding_version: 1,
  profile_onboarding_completed: true, profile_onboarding_version: 1 };
const errors = [];
let uploaded = false;
let removed = false;

try {
  const context = await browser.newContext();
  await context.route("**/api/**", async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    let data;
    let status = 200;
    if (path === "/api/auth/me") data = { user, quota: null };
    else if (path === "/api/profile") data = { profile };
    else if (path === "/api/templates") data = { templates: [template] };
    else if (path === `/api/templates/${template.id}/use`) {
      assert.equal(req.method(), "POST");
      data = { prompt: copy }; status = 201;
    } else if (path === `/api/prompts/${copy.id}`) data = { prompt: copy };
    else if (path === "/api/interview/attachments") {
      assert.equal(req.method(), "POST");
      data = { contextId: "fixture-context" }; status = 201;
    } else if (path === "/api/interview/attachments/fixture-context/files") {
      assert.equal(req.method(), "POST");
      assert.match(req.postData() || "", /fiche.txt/);
      assert.match(req.postData() || "", /B1 reception/);
      uploaded = true;
      data = { document: { id: "fixture-file", name: "fiche.txt", type: "txt",
        size: 12, characters: 12 } }; status = 201;
    } else if (path === "/api/interview/attachments/fixture-context/files/fixture-file") {
      assert.equal(req.method(), "DELETE");
      removed = true;
      data = { success: true };
    } else {
      errors.push(`Unexpected API request: ${req.method()} ${path}`);
      status = 500; data = { error: "Missing fixture" };
    }
    await route.fulfill({ status, json: data });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(baseURL + "/prompts/new");
    await page.locator("textarea").waitFor();
    assert.equal(await page.locator('input[type="file"]').count(), 1,
      "The released app must retain the document picker alongside the ready-to-use library");
    const request = "Prépare une activité B1 pour la réception hôtelière.";
    await page.locator("textarea").fill(request);
    await page.locator('input[type="file"]').setInputFiles({ name: "fiche.txt",
      mimeType: "text/plain", buffer: Buffer.from("B1 reception") });
    const attachments = page.getByRole("region", { name: "Joindre des documents" });
    await attachments.getByText("Prêt", { exact: true }).waitFor();
    assert.ok(uploaded);
    assert.equal(await page.locator('button[type="submit"]').isEnabled(), true);
    await attachments.getByRole("button", { name: "Retirer fiche.txt" }).click();
    await attachments.getByText("fiche.txt", { exact: true }).waitFor({ state: "detached" });
    assert.ok(removed);
    assert.equal(await page.locator("textarea").inputValue(), request);

    await page.goto(baseURL + "/prompts/templates");
    await page.getByRole("heading", { name: "Prompts prêts à l'emploi", exact: true }).waitFor();
    await page.getByRole("button", { name: "Programme de formation", exact: true }).click();
    await page.getByRole("link", { name: template.template_card.need, exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator("main li").filter({ hasText: template.template_card.need })
      .getByRole("button").click();
    await page.waitForURL(`**/prompts/${copy.id}`);
    // Reopening a copied ready-to-use prompt must still display its original-file reminder.
    await page.reload();
    await page.getByText(template.blocks[0].content, { exact: true }).first().waitFor();
    console.log(`PASS document upload/removal, ready-to-use theme/card, copy and reopen at ${width}px`);
  }
  assert.deepEqual(errors, [], "No browser errors or failed API requests");
} finally {
  await browser.close();
}
