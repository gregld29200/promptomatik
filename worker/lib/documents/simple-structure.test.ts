// Regression suite for the deterministic Simple Document pipeline, anchored
// to the real production supplier-performance generation (job z4rU86Fe38…,
// 2026-07-16). The parser must keep matching that verified ground truth.

import { describe, expect, it } from "vitest";
import fixture from "./fixtures/supplier-performance.json";
import singleLineFixture from "./fixtures/supplier-performance-singleline.json";
import { buildSimpleMaterial, isCollapsedStructure, parseSimpleStructure } from "./simple-structure";
import { renderSimpleMaterialHtml } from "./simple-material-renderer";

const SOURCE = fixture.source as string;
const TITLE = fixture.title as string;
const VOCABULARY = fixture.vocabulary as string[];
const EXPECTED_STRUCTURE = fixture.structure as Array<{ type: string; line_ids: number[] }>;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

describe("supplier-performance fixture (production ground truth)", () => {
  it("parses the exact structure the verified production run produced", () => {
    const { lines, structure } = parseSimpleStructure(SOURCE);
    expect(lines).toHaveLength(15);
    expect(structure).toEqual(EXPECTED_STRUCTURE);
  });

  it("covers every source line exactly once, in order", () => {
    const { lines, structure } = parseSimpleStructure(SOURCE);
    const ids = structure.flatMap((block) => block.line_ids);
    expect(ids).toEqual(lines.map((_, index) => index + 1));
  });

  it("is repeatable: three runs produce identical materials and identical HTML", () => {
    const runs = [1, 2, 3].map(() => buildSimpleMaterial(SOURCE, TITLE, VOCABULARY, "editorial_reader"));
    const htmls = runs.map((material) => renderSimpleMaterialHtml(material));
    const [first, ...rest] = runs.map(({ id, ...material }) => material);
    for (const material of rest) expect(material).toEqual(first);
    expect(htmls[1]).toBe(htmls[0]);
    expect(htmls[2]).toBe(htmls[0]);
  });

  it("preserves the source sequence in the rendered HTML", () => {
    // Render without vocabulary so line text is not split by <strong> tags.
    const material = buildSimpleMaterial(SOURCE, TITLE, [], "editorial_reader");
    const html = renderSimpleMaterialHtml(material);
    const { lines } = parseSimpleStructure(SOURCE);
    let cursor = -1;
    for (const line of lines) {
      const needle = escapeHtml(line.replace(/^[-*•]\s+/, "")).replace(/&#39;/g, "&#39;");
      const index = html.indexOf(needle, cursor + 1);
      expect(index, `source line missing or out of order: ${line.slice(0, 40)}…`).toBeGreaterThan(cursor);
      cursor = index;
    }
  });

  it("bolds every requested vocabulary phrase and nothing invented", () => {
    const material = buildSimpleMaterial(SOURCE, TITLE, VOCABULARY, "editorial_reader");
    expect(material.bold_phrases).toEqual(VOCABULARY);
    const html = renderSimpleMaterialHtml(material);
    for (const phrase of VOCABULARY) {
      expect(html).toContain(`<strong>${escapeHtml(phrase)}</strong>`);
    }
  });

  it("renders one title, four section headings, no unrequested blocks, no page footer", () => {
    const material = buildSimpleMaterial(SOURCE, TITLE, VOCABULARY, "editorial_reader");
    expect(material.blocks).toEqual([]);
    const html = renderSimpleMaterialHtml(material);
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html.match(/<h2>/g)).toHaveLength(4);
    expect(html).not.toContain(escapeHtml(`${TITLE}</h2>`));
    expect(html).not.toContain("counter(page)");
    expect(html).not.toContain("Answer Key");
  });
});

describe("single-newline paste (production regression 2026-07-16, job XYC9KEGz6…)", () => {
  // Same document, but pasted the way teachers actually paste from
  // Docs/Word/web: single newlines between every block, no blank lines,
  // no list markers. This exact input collapsed into one paragraph in prod.
  const SOURCE_1LN = singleLineFixture.source as string;
  const TITLE_1LN = singleLineFixture.title as string;

  it("does not collapse: headings and paragraphs are recovered without blank lines", () => {
    const { lines, structure } = parseSimpleStructure(SOURCE_1LN);
    expect(lines).toHaveLength(16);
    expect(isCollapsedStructure(structure)).toBe(false);
    const headingIds = structure.filter((block) => block.type === "heading").map((block) => block.line_ids[0]);
    expect(headingIds).toEqual([1, 2, 5, 11, 14]);
    const ids = structure.flatMap((block) => block.line_ids);
    expect(ids).toEqual(lines.map((_, index) => index + 1));
  });

  it("renders one title and the four section headings, title-line deduplicated", () => {
    const material = buildSimpleMaterial(SOURCE_1LN, TITLE_1LN, [], "editorial_reader");
    const html = renderSimpleMaterialHtml(material);
    // Line 1 repeats the material title and is suppressed in the body.
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html.match(/<h2>/g)).toHaveLength(4);
    expect(html).toContain("<h2>What is supplier performance management?</h2>");
    expect(html).toContain("<h2>Successful performance management</h2>");
  });
});

describe("deterministic parser behavior", () => {
  it("groups an intro line followed by bullets inside the same chunk", () => {
    const { structure } = parseSimpleStructure("Tools you can use:\n- Scorecards\n- Metrics");
    expect(structure).toEqual([
      { type: "paragraph", line_ids: [1] },
      { type: "bullet_list", line_ids: [2, 3] },
    ]);
  });

  it("recognizes numbered lists", () => {
    const { structure } = parseSimpleStructure("Steps\n\n1. Read the text.\n2) Answer aloud.");
    expect(structure).toEqual([
      { type: "heading", line_ids: [1] },
      { type: "numbered_list", line_ids: [2, 3] },
    ]);
  });

  it("joins wrapped lines of one chunk into a single paragraph", () => {
    const { structure } = parseSimpleStructure("A first wrapped line of prose that continues\nonto a second physical line.");
    expect(structure).toEqual([{ type: "paragraph", line_ids: [1, 2] }]);
  });

  it("treats short standalone sentences ending in a period as paragraphs, questions as headings", () => {
    const { structure } = parseSimpleStructure("Read the text.\n\nWhy does quality matter?\n\nBecause customers notice everything about the products they buy from you.");
    expect(structure.map((block) => block.type)).toEqual(["paragraph", "heading", "paragraph"]);
  });

  it("strips Markdown heading markers at render time and in the derived title", () => {
    const source = "# Supplier Review\n\n## Key Metrics\n\nTrack **lead times** and *quality* closely across every region you operate in.";
    const material = buildSimpleMaterial(source, undefined, [], "editorial_reader");
    expect(material.title).toBe("Supplier Review");
    const html = renderSimpleMaterialHtml(material);
    expect(html).toContain("<h2>Key Metrics</h2>");
    expect(html).not.toContain("##");
    expect(html).toContain("<strong>lead times</strong>");
    expect(html).toContain("<em>quality</em>");
    // The title heading is suppressed in the body: one h1, one h2.
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html.match(/<h2>/g)).toHaveLength(1);
  });

  it("joins hard-wrapped prose without inventing headings, and flags a collapsed blob for rescue", () => {
    const wrapped = [
      "The supplier review process continues across",
      "several regions and depends on consistent",
      "reporting from every local team involved in",
      "the quarterly evaluation cycle as well as",
      "steady communication between buyers and",
      "suppliers throughout the whole contract period.",
    ].join("\n");
    const { structure } = parseSimpleStructure(wrapped);
    expect(structure).toEqual([{ type: "paragraph", line_ids: [1, 2, 3, 4, 5, 6] }]);
    expect(isCollapsedStructure(structure)).toBe(true);
  });

  it("derives a clipped title from the first line when nothing looks like a heading", () => {
    const longFirstLine = "Supplier performance directly affects the efficiency of your entire supply chain and the satisfaction of every customer downstream.";
    const material = buildSimpleMaterial(longFirstLine, undefined, [], "editorial_reader");
    expect(material.title.length).toBeLessThanOrEqual(81);
    expect(material.title.endsWith("…")).toBe(true);
    expect(longFirstLine.startsWith(material.title.slice(0, -1))).toBe(true);
  });
});
