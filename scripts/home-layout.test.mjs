import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const homeCss = readFileSync(new URL("../src/pages/home.module.css", import.meta.url), "utf8");
const homePage = readFileSync(new URL("../src/pages/home.tsx", import.meta.url), "utf8");
const shellCss = readFileSync(new URL("../src/components/layout/shell.module.css", import.meta.url), "utf8");
const shellPage = readFileSync(new URL("../src/components/layout/shell.tsx", import.meta.url), "utf8");
const globalCss = readFileSync(new URL("../src/styles/global.css", import.meta.url), "utf8");
const config = readFileSync(new URL("../src/lib/config.ts", import.meta.url), "utf8");

function cssRule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

test("home dashboard contains long recent-work titles", () => {
  assert.match(cssRule(homeCss, ".dashboardGrid"), /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(cssRule(homeCss, ".workshopContent"), /min-width:\s*0/);
  assert.match(cssRule(homeCss, ".workText"), /min-width:\s*0/);
  assert.match(homeCss, /text-overflow:\s*ellipsis/);
});

test("workshop art is responsive WebP, not dashboard chrome", () => {
  for (const asset of ["workshop-prompts", "workshop-audio", "workshop-documents", "workshop-training"]) {
    assert.equal(existsSync(new URL(`../public/images/workshops/${asset}.webp`, import.meta.url)), true);
    assert.equal(existsSync(new URL(`../public/images/workshops/${asset}@2x.webp`, import.meta.url)), true);
  }
  assert.match(cssRule(homeCss, ".workshopVisual"), /aspect-ratio:\s*11\s*\/\s*5/);
  assert.match(homePage, /srcSet=/);
});

test("shared shell uses product navigation and collapses for mobile", () => {
  assert.match(cssRule(shellCss, ".shell"), /grid-template-columns:\s*252px\s+minmax\(0,\s*1fr\)/);
  assert.match(cssRule(shellCss, ".nav"), /height:\s*100dvh/);
  assert.match(shellPage, /className=\{s\.subnav\}/);
  assert.match(shellPage, /Promptomatik/);
  assert.match(shellPage, /className=\{s\.topbar\}/);
  assert.match(shellPage, /href="#main-content"/);
  assert.match(shellPage, /aria-controls="mobile-navigation"/);
  assert.match(shellCss, /overscroll-behavior:\s*contain/);
  assert.match(globalCss, /touch-action:\s*manipulation/);
  assert.match(shellCss, /@media\s*\(max-width:\s*820px\)/);
  assert.match(shellCss, /flex-direction:\s*column/);
});

test("community links open the courses space", () => {
  assert.match(config, /COMMUNITY_URL\s*=\s*"https:\/\/community\.teachinspire\.me\/courses"/);
  assert.match(homePage, /href=\{isParticipant \? COMMUNITY_URL : UPGRADE_CTA_URL\}/);
  assert.match(shellPage, /href=\{isParticipant \? COMMUNITY_URL : UPGRADE_CTA_URL\}/);
});

test("TeachInspire wordmark returns to the public website", () => {
  assert.match(config, /TEACHINSPIRE_URL\s*=\s*"https:\/\/teachinspire\.me"/);
  assert.match(shellPage, /<a href=\{TEACHINSPIRE_URL\} className=\{s\.logo\}/);
});
