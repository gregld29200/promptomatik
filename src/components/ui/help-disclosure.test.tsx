// The disclosure contract the three studios now share.
//
// Both claims are ones a page got wrong on its own before this component
// existed: two of the three helpDots declared `aria-expanded` with no
// `aria-controls`, and the pages that did point at a panel rendered that panel
// only while it was open — so the id in `aria-controls` referred to nothing.
//
// Same approach as the transcript component tests: `react-dom/server`, no jsdom,
// assertions on markup.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HelpDot, HelpPanel, helpPanelId } from "./help-disclosure";

describe("HelpDot", () => {
  it("names itself and names what it controls", () => {
    const markup = renderToStaticMarkup(
      <HelpDot label="Quelles sont les limites ?" expanded={false} controls="panel-1" onToggle={() => {}} />
    );
    // Icon-only: the aria-label is the entire accessible name.
    expect(markup).toContain('aria-label="Quelles sont les limites ?"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-controls="panel-1"');
    // A button, not a div with a click handler, and never a form submit.
    expect(markup).toContain('type="button"');
  });

  it("reports itself expanded when it is", () => {
    const markup = renderToStaticMarkup(
      <HelpDot label="Aide" expanded controls="panel-1" onToggle={() => {}} />
    );
    expect(markup).toContain('aria-expanded="true"');
  });
});

describe("HelpPanel", () => {
  it("exists while closed, so aria-controls always has a target", () => {
    const markup = renderToStaticMarkup(
      <HelpPanel id="panel-1" open={false}>
        Jusqu&apos;à 90 minutes.
      </HelpPanel>
    );
    expect(markup).toContain('id="panel-1"');
    expect(markup).toContain("hidden");
    expect(markup).toContain("90 minutes");
  });

  it("is not hidden when open", () => {
    const markup = renderToStaticMarkup(
      <HelpPanel id="panel-1" open>
        Jusqu&apos;à 90 minutes.
      </HelpPanel>
    );
    expect(markup).not.toContain("hidden");
  });
});

describe("helpPanelId", () => {
  it("keeps one page's panels apart from one useId base", () => {
    expect(helpPanelId(":r0:", "level")).toBe(":r0:-level");
    expect(helpPanelId(":r0:", "level")).not.toBe(helpPanelId(":r0:", "pace"));
  });
});
