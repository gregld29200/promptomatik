// The matching addition: learners must not receive it already solved.
import { describe, expect, it } from "vitest";
import { buildSimpleMaterial } from "./simple-structure";
import { matchingOrder, renderSimpleMaterialHtml } from "./simple-material-renderer";
import type { DocumentType, SimpleTransformMaterial } from "./types";

const PAIRS = [
  { left: "Marcel", right: "le maraîcher" },
  { left: "un kilo", right: "de tomates" },
  { left: "une barquette", right: "de fraises" },
  { left: "payer", right: "en espèces" },
  { left: "rentrer", right: "à pied" },
];

function material(documentType: DocumentType, heading?: string): SimpleTransformMaterial {
  const base = buildSimpleMaterial("# Au marché\n\nInès va au marché tous les samedis et achète des fraises.", { documentType, locale: "fr" });
  return { ...base, blocks: [{ type: "matching", ...(heading ? { heading } : {}), pairs: PAIRS }] } as SimpleTransformMaterial;
}

function rightColumn(html: string): string[] {
  return [...html.matchAll(/<span class="match-right"><b>[a-z]\)<\/b> ([^<]+)<\/span>/g)].map((match) => match[1]);
}

describe("matching addition", () => {
  it("never leaves an item next to its pair, and always picks the same order", () => {
    for (let count = 2; count <= 12; count += 1) {
      const pairs = Array.from({ length: count }, (_, index) => ({ left: `l${index}`, right: `r${index}` }));
      const order = matchingOrder(pairs);
      expect([...order].sort((a, b) => a - b)).toEqual(pairs.map((_, index) => index));
      expect(order.every((value, index) => value !== index)).toBe(true);
      expect(matchingOrder(pairs)).toEqual(order);
    }
    expect(matchingOrder([PAIRS[0]])).toEqual([0]);
  });

  it("shuffles the right column on a worksheet, numbered and lettered, with a default heading", () => {
    const html = renderSimpleMaterialHtml(material("worksheet"));
    const right = rightColumn(html);
    expect([...right].sort()).toEqual(PAIRS.map((pair) => pair.right).sort());
    right.forEach((value, index) => expect(value).not.toBe(PAIRS[index].right));
    expect(html).toContain("<h2>Associez chaque élément à sa paire</h2>");
    expect(html).toContain('<b>1.</b> Marcel');
    expect(html).toContain('class="match-slot"');
  });

  it("keeps the model's heading when it gives one", () => {
    expect(renderSimpleMaterialHtml(material("worksheet", "Reliez"))).toContain("<h2>Reliez</h2>");
  });

  it("keeps the pairs side by side in a teacher guide: it is the key", () => {
    const html = renderSimpleMaterialHtml(material("teacher_guide"));
    expect(html).not.toContain('class="matching matching-exercise"');
    expect(html).toContain("<li><span>Marcel</span><span>le maraîcher</span></li>");
  });
});
