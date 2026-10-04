import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { InlineSuggestion } from "@/lib/audio-suggestions";
import { ScriptReview } from "./script-review";

const SCRIPT = "Léa : (soupire) Tu as vu l'heure ? On va rater le train !";
const SUGGESTIONS: InlineSuggestion[] = [
  { id: "paren-6", kind: "fix", start: 6, end: 15, insert: "[sighs]", tag: "[sighs]", fixType: "stage_direction", reason: "Un soupir s'entend." },
  { id: "tag-34", kind: "tag", start: 34, end: 34, insert: "[serious] ", tag: "[serious]", reason: "Elle fait un reproche." },
];

function render(decisions: Record<string, "accepted" | "rejected"> = {}) {
  return renderToStaticMarkup(
    <ScriptReview
      script={SCRIPT}
      suggestions={SUGGESTIONS}
      decisions={decisions}
      onDecide={() => {}}
      onAcceptAll={() => {}}
      onRejectAll={() => {}}
      onApply={() => {}}
      onCancel={() => {}}
    />
  );
}

describe("ScriptReview", () => {
  it("shows each suggestion in place, by its French name", () => {
    const markup = render();
    expect(markup).toContain("<del>(soupire)</del><ins>soupire</ins>");
    expect(markup).toContain(">sérieux<");
    expect(markup).not.toContain("[serious]</");
    expect(markup).toContain('aria-label="Garder : sérieux"');
    expect(markup).toContain('aria-label="Écarter : « (soupire) » devient « soupire »"');
    expect(markup.indexOf(">sérieux<")).toBeGreaterThan(markup.indexOf("vu l&#x27;heure ?"));
    expect(markup).toContain("2 en attente");
  });

  it("offers to undo a decision and counts what will be applied", () => {
    const markup = render({ "tag-34": "accepted", "paren-6": "rejected" });
    expect(markup).toContain('aria-label="Revenir sur : sérieux"');
    expect(markup).toContain("Appliquer (1)");
    expect(markup).toContain("(soupire)");
    expect(markup).not.toContain("<del>");
  });
});
