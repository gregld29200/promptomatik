import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const homeCss = readFileSync(new URL("../src/pages/home.module.css", import.meta.url), "utf8");

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return homeCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

test("home cards contain long recent-work titles", () => {
  assert.match(cssRule(".card"), /min-width:\s*0/);
  assert.match(cssRule(".recentList"), /min-width:\s*0/);
  assert.match(cssRule(".recentList li"), /min-width:\s*0/);

  const row = cssRule(".recentRow");
  assert.match(row, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
  assert.match(row, /min-width:\s*0/);
  assert.match(row, /max-width:\s*100%/);

  assert.doesNotMatch(cssRule(".recentMeta"), /max-width/);
  assert.match(cssRule(".cardCommunity"), /align-self:\s*start/);
});
