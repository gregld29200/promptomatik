import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../src/components/audio/audio-teaser.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/components/audio/audio-teaser.module.css", import.meta.url), "utf8");
const audioPage = readFileSync(new URL("../src/pages/audio.tsx", import.meta.url), "utf8");

const audioAssets = [
  "brocante-b1-fr.mp3",
  "plants-a2-en.mp3",
  "madrid-bees-b2-es.mp3",
];

const collageAssets = [
  "audio-teaser-heading-paper.webp",
  "audio-teaser-arrow.webp",
  "audio-teaser-card-fragment.webp",
];

test("locked Audio Studio renders the interactive teaser", () => {
  assert.match(audioPage, /<AudioTeaser\s*\/>/);
  assert.match(component, /<audio/);
  assert.match(component, /type="range"/);
  assert.match(component, /<fieldset/);
  assert.match(component, /type="radio"/);
  assert.match(component, /aria-live="polite"/);
  assert.match(component, /variant="conclusion"/);
  assert.ok(
    component.indexOf('<UpgradeGate variant="conclusion"') < component.indexOf("<header"),
    "the training banner should be displayed before the teaser heading",
  );
  assert.doesNotMatch(component, /questionActive|questionWaiting/);
});

test("teaser assets exist and are not empty", () => {
  for (const asset of audioAssets) {
    const url = new URL(`../public/audio/teasers/${asset}`, import.meta.url);
    assert.equal(existsSync(url), true, `${asset} should exist`);
    assert.ok(statSync(url).size > 100_000, `${asset} should contain a real audio extract`);
  }

  for (const asset of collageAssets) {
    const url = new URL(`../public/images/audio-teaser/${asset}`, import.meta.url);
    assert.equal(existsSync(url), true, `${asset} should exist`);
    assert.ok(statSync(url).size > 10_000, `${asset} should contain the collage layer`);
  }
});

test("teaser remains responsive and accessible by construction", () => {
  assert.match(styles, /grid-template-columns:\s*repeat\(3,/);
  assert.match(styles, /min-height:\s*44px/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /@media\s*\(max-width:\s*980px\)/);
  assert.match(styles, /@media\s*\(max-width:\s*640px\)/);
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test("teaser interface is localized in French, English, and Spanish", () => {
  for (const language of ["fr", "en", "es"]) {
    const translations = JSON.parse(
      readFileSync(new URL(`../src/lib/i18n/${language}.json`, import.meta.url), "utf8"),
    );
    for (const key of [
      "teaser_title",
      "teaser_intro",
      "teaser_correct",
      "teaser_incorrect",
      "teaser_replay",
    ]) {
      assert.equal(typeof translations.audio?.[key], "string", `${language}.audio.${key} should exist`);
    }

    for (const clipLanguage of ["fr", "en", "es"]) {
      for (const suffix of ["question_label", "instruction", "question"]) {
        const key = `teaser_${clipLanguage}_${suffix}`;
        assert.equal(typeof translations.audio?.[key], "string", `${language}.audio.${key} should exist`);
      }
    }
  }
});
