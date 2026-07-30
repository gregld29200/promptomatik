import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../src/components/documents/document-teaser.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/components/documents/document-teaser.module.css", import.meta.url), "utf8");
const documentsPage = readFileSync(new URL("../src/pages/documents.tsx", import.meta.url), "utf8");

const previews = ["reading.webp", "worksheet.webp", "teacher-guide.webp", "lesson-plan.webp"];

test("locked Documents page renders the real-output teaser", () => {
  assert.match(documentsPage, /<DocumentTeaser\s*\/>/);
  assert.match(component, /role="tablist"/);
  assert.match(component, /role="tab"/);
  assert.match(component, /role="tabpanel"/);
  assert.match(component, /variant="conclusion"/);
  assert.ok(
    component.indexOf('<UpgradeGate variant="conclusion"') < component.indexOf("<header"),
    "the training banner should be displayed before the teaser heading",
  );
});

test("Documents teaser uses four optimized real-output previews", () => {
  for (const asset of previews) {
    const url = new URL(`../public/images/documents-teaser/${asset}`, import.meta.url);
    assert.equal(existsSync(url), true, `${asset} should exist`);
    assert.ok(statSync(url).size > 20_000, `${asset} should contain a real document preview`);
    assert.ok(statSync(url).size < 150_000, `${asset} should remain optimized`);
  }
});

test("Documents teaser presents formatting templates, not content generation", () => {
  assert.match(component, /sourceTitle/);
  assert.match(component, /sourceParagraphs/);

  const expectedTemplateTerms = {
    fr: /modèles de mise en page/i,
    en: /document templates/i,
    es: /plantillas de maquetación/i,
  };

  for (const [language, expectedTerm] of Object.entries(expectedTemplateTerms)) {
    const translations = JSON.parse(
      readFileSync(new URL(`../src/lib/i18n/${language}.json`, import.meta.url), "utf8"),
    );
    assert.match(translations.documents_teaser.title, expectedTerm);
  }

  const french = JSON.parse(
    readFileSync(new URL("../src/lib/i18n/fr.json", import.meta.url), "utf8"),
  );
  assert.doesNotMatch(french.documents_teaser.title, /supports prêts pour la classe/i);
  assert.match(french.documents_teaser.intro, /ne réécrit rien/i);
});

test("each raw source contains enough finalized content for a realistic document", () => {
  assert.match(component, /After the three-month trial/);
  assert.match(component, /DISCUSSION\\nWould a meeting-free morning/);
  assert.match(component, /VOCABULARY GUIDE/);
  assert.match(component, /OPTIONAL HOMEWORK/);
  assert.match(component, /aria-readonly="true"/);
  assert.match(styles, /min-height:\s*420px/);
  assert.match(styles, /overflow-y:\s*auto/);
});

test("Documents teaser is responsive, keyboard accessible, and motion safe", () => {
  assert.match(component, /ArrowLeft/);
  assert.match(component, /ArrowRight/);
  assert.match(component, /tabIndex=\{selected \? 0 : -1\}/);
  assert.match(styles, /min-height:\s*44px/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /@media\s*\(max-width:\s*820px\)/);
  assert.match(styles, /@media\s*\(max-width:\s*560px\)/);
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test("Documents teaser is localized in French, English, and Spanish", () => {
  for (const language of ["fr", "en", "es"]) {
    const translations = JSON.parse(
      readFileSync(new URL(`../src/lib/i18n/${language}.json`, import.meta.url), "utf8"),
    );
    for (const key of ["title", "intro", "locked_message", "source_label", "preview_label", "expand"]) {
      assert.equal(
        typeof translations.documents_teaser?.[key],
        "string",
        `${language}.documents_teaser.${key} should exist`,
      );
    }
    for (const preview of ["reading", "worksheet", "teacher_guide", "lesson_plan"]) {
      assert.equal(typeof translations.documents_teaser?.tabs?.[preview], "string");
      assert.equal(typeof translations.documents_teaser?.alts?.[preview], "string");
    }
  }
});

test("new teaser copy contains no em dash", () => {
  assert.doesNotMatch(component, /\u2014/);
  for (const language of ["fr", "en", "es"]) {
    const translations = JSON.parse(
      readFileSync(new URL(`../src/lib/i18n/${language}.json`, import.meta.url), "utf8"),
    );
    assert.doesNotMatch(JSON.stringify(translations.documents_teaser), /\u2014/);
  }
});
