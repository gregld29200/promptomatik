import { describe, expect, it } from "vitest";
import { normalizeTemplateCard, parseTemplateCard, templateCardPrompt } from "./template-card";

describe("normalizeTemplateCard", () => {
  it("keeps a complete card and trims whitespace", () => {
    const card = normalizeTemplateCard({
      need: "  Construire un programme\n sur mesure ",
      when: "Vous avez un volume d'heures.",
      why: "Objectifs SMART d'abord.",
      adapt: ["Le niveau est dans Contexte.", "  ", 42, "Les heures sont dans Contraintes."],
    });
    expect(card).toEqual({
      need: "Construire un programme sur mesure",
      when: "Vous avez un volume d'heures.",
      why: "Objectifs SMART d'abord.",
      adapt: ["Le niveau est dans Contexte.", "Les heures sont dans Contraintes."],
    });
  });

  it("rejects a card with any empty field", () => {
    expect(normalizeTemplateCard({ need: "x", when: "y", why: "", adapt: ["z"] })).toBeNull();
    expect(normalizeTemplateCard({ need: "x", when: "y", why: "w", adapt: [] })).toBeNull();
    expect(normalizeTemplateCard(null)).toBeNull();
    expect(normalizeTemplateCard("need")).toBeNull();
  });

  it("keeps a known theme and drops an unknown one", () => {
    const base = { need: "n", when: "w", why: "y", adapt: ["a"] };
    expect(normalizeTemplateCard({ ...base, theme: "listening" })?.theme).toBe("listening");
    expect(normalizeTemplateCard({ ...base, theme: "karaoke" })?.theme).toBeUndefined();
    expect(normalizeTemplateCard(base)).toEqual(base);
  });

  it("caps the adapt list at four items", () => {
    const card = normalizeTemplateCard({ need: "n", when: "w", why: "y", adapt: ["1", "2", "3", "4", "5"] });
    expect(card?.adapt).toHaveLength(4);
  });
});

describe("parseTemplateCard", () => {
  it("returns null for NULL, garbage and legacy shapes", () => {
    expect(parseTemplateCard(null)).toBeNull();
    expect(parseTemplateCard("not json")).toBeNull();
    expect(parseTemplateCard(JSON.stringify({ title: "old" }))).toBeNull();
  });

  it("round-trips a stored card", () => {
    const card = { need: "n", when: "w", why: "y", adapt: ["a"] };
    expect(parseTemplateCard(JSON.stringify(card))).toEqual(card);
  });
});

describe("templateCardPrompt", () => {
  it("asks for the need as an infinitive in the template's language", () => {
    const fr = templateCardPrompt("fr");
    expect(fr).toContain("French");
    expect(fr).toContain("infinitive verb");
    expect(templateCardPrompt("es")).toContain("Spanish");
  });
});
