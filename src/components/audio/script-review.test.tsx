import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { InlineSuggestion } from "@/lib/audio-suggestions";
import { ScriptReview } from "./script-review";

const SCRIPT = "Marie: Tu as vu l'heure ? On va rater le train !";
const SUGGESTIONS: InlineSuggestion[] = [
  { id: "fix-0", kind: "fix", start: 0, end: 6, insert: "Speaker 1:", reason: "Numérotation des locuteurs." },
  { id: "tag-26", kind: "tag", start: 26, end: 26, insert: "[serious] ", tag: "[serious]", reason: "Il fait un reproche." },
];

function render(decisions: Record<string, "accepted" | "rejected"> = {}) {
  return renderToStaticMarkup(
    <ScriptReview
      script={SCRIPT}
      suggestions={SUGGESTIONS}
      warnings={[]}
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
  it("shows each suggestion in place, emotions by their French label", () => {
    const markup = render();
    expect(markup).toContain("<del>Marie:</del><ins>Speaker 1:</ins>");
    expect(markup).toContain(">sérieux<");
    expect(markup).toContain('aria-label="Garder : sérieux"');
    expect(markup).toContain('aria-label="Écarter : sérieux"');
    expect(markup.indexOf(">sérieux<")).toBeGreaterThan(markup.indexOf("vu l&#x27;heure ?"));
    expect(markup).toContain("2 en attente");
  });

  it("offers to undo a decision and counts what will be applied", () => {
    const markup = render({ "tag-26": "accepted", "fix-0": "rejected" });
    expect(markup).toContain('aria-label="Revenir sur : sérieux"');
    expect(markup).toContain("Appliquer (1)");
    expect(markup).not.toContain("<del>");
  });
});
