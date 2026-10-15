import { describe, expect, it } from "vitest";
import {
  PREVIEW_DIALOGUE_MAX_CHARS,
  PREVIEW_MONOLOGUE_MAX_CHARS,
  PREVIEW_MONOLOGUE_TARGET_CHARS,
  PREVIEW_SLOW_DELIVERY_FACTOR,
  cutAtWord,
  isSlowDelivery,
  dialogueExcerpt,
  monologueExcerpt,
  previewExcerpt,
} from "./audio-preview-excerpt";

const SENTENCE = "Le marché ouvre à huit heures et les clients arrivent tôt le samedi matin.";

function sentences(count: number): string {
  return Array.from({ length: count }, () => SENTENCE).join(" ");
}

function speakersIn(excerpt: string): Set<string> {
  return new Set(excerpt.split("\n").map((line) => line.split(":")[0]));
}

describe("monologue preview excerpt", () => {
  it("cuts at the sentence end closest to the target", () => {
    const excerpt = monologueExcerpt(sentences(40));
    expect(excerpt.endsWith(".")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(PREVIEW_MONOLOGUE_MAX_CHARS);
    expect(Math.abs(excerpt.length - PREVIEW_MONOLOGUE_TARGET_CHARS)).toBeLessThan(SENTENCE.length);
    expect(sentences(40).startsWith(excerpt)).toBe(true);
  });

  it("keeps a script already under the threshold whole", () => {
    expect(monologueExcerpt(SENTENCE)).toBe(SENTENCE);
    expect(monologueExcerpt(`  ${SENTENCE}\n`)).toBe(SENTENCE);
  });

  it("cuts a script with no punctuation on a whole word", () => {
    const words = Array.from({ length: 200 }, (_, index) => `mot${index}`).join(" ");
    const excerpt = monologueExcerpt(words);
    expect(excerpt.length).toBeLessThanOrEqual(PREVIEW_MONOLOGUE_TARGET_CHARS);
    expect(excerpt.length).toBeGreaterThan(PREVIEW_MONOLOGUE_TARGET_CHARS - 10);
    expect(words.startsWith(`${excerpt} `)).toBe(true);
  });

  it("falls back to a word cut when the first sentence runs past the cap", () => {
    const longSentence = `${Array.from({ length: 120 }, () => "encore").join(" ")}.`;
    const excerpt = monologueExcerpt(longSentence);
    expect(excerpt.length).toBeLessThanOrEqual(PREVIEW_MONOLOGUE_TARGET_CHARS);
    expect(excerpt.endsWith("encore")).toBe(true);
  });

  it("never cuts inside a bracket tag", () => {
    const text = `${"a".repeat(PREVIEW_MONOLOGUE_TARGET_CHARS - 5)} [very fast] suite du texte`;
    expect(cutAtWord(text, PREVIEW_MONOLOGUE_TARGET_CHARS)).toBe("a".repeat(PREVIEW_MONOLOGUE_TARGET_CHARS - 5));
  });

  it("caps a 5,000-character script", () => {
    const huge = "x ".repeat(2_500);
    expect(previewExcerpt(huge, "monologue").length).toBeLessThanOrEqual(PREVIEW_MONOLOGUE_MAX_CHARS);
  });
});

describe("dialogue preview excerpt", () => {
  it("keeps the first two or three turns so each voice is heard", () => {
    const script = [
      "Speaker 1: Bonjour, vous avez une table pour deux ?",
      "Speaker 2: Oui, bien sûr. Suivez-moi.",
      "Speaker 1: Merci beaucoup.",
      "Speaker 2: Voici la carte.",
    ].join("\n");
    const excerpt = dialogueExcerpt(script);
    expect(excerpt).toBe(script.split("\n").slice(0, 3).join("\n"));
    expect(speakersIn(excerpt)).toEqual(new Set(["Speaker 1", "Speaker 2"]));
  });

  it("trims long turns but still lets both voices speak within the cap", () => {
    const script = [
      `Speaker 1: ${sentences(10)}`,
      `Speaker 2: ${sentences(10)}`,
      `Speaker 1: ${sentences(10)}`,
    ].join("\n");
    const excerpt = dialogueExcerpt(script);
    expect(excerpt.length).toBeLessThanOrEqual(PREVIEW_DIALOGUE_MAX_CHARS);
    expect(excerpt.split("\n")).toHaveLength(2);
    expect(speakersIn(excerpt)).toEqual(new Set(["Speaker 1", "Speaker 2"]));
    for (const line of excerpt.split("\n")) expect(line.endsWith(".")).toBe(true);
  });

  it("reaches the second voice even when it speaks late", () => {
    const script = [
      "Speaker 1: Premier.",
      "Speaker 1: Deuxième.",
      "Speaker 1: Troisième.",
      "Speaker 1: Quatrième.",
      "Speaker 2: Enfin moi.",
    ].join("\n");
    const excerpt = dialogueExcerpt(script);
    expect(excerpt).toBe("Speaker 1: Premier.\nSpeaker 2: Enfin moi.");
  });

  it("keeps a short dialogue whole", () => {
    const script = "Speaker 1: Salut !\nSpeaker 2: Salut, ça va ?";
    expect(dialogueExcerpt(script)).toBe(script);
  });

  it("cuts unpunctuated turns on a whole word", () => {
    const words = Array.from({ length: 150 }, (_, index) => `mot${index}`).join(" ");
    const excerpt = dialogueExcerpt(`Speaker 1: ${words}\nSpeaker 2: ${words}`);
    expect(excerpt.length).toBeLessThanOrEqual(PREVIEW_DIALOGUE_MAX_CHARS);
    for (const line of excerpt.split("\n")) {
      const body = line.replace(/^Speaker \d: /, "");
      expect(words.startsWith(`${body} `)).toBe(true);
    }
  });

  it("caps a 5,000-character script", () => {
    const lines = Array.from({ length: 40 }, (_, index) => `Speaker ${(index % 2) + 1}: ${"bla ".repeat(30)}`);
    const script = lines.join("\n");
    expect(script.length).toBeGreaterThan(5_000);
    expect(previewExcerpt(script, "dialogue").length).toBeLessThanOrEqual(PREVIEW_DIALOGUE_MAX_CHARS);
  });
});

describe("slow delivery", () => {
  it("is A1, A2 or the slow pace", () => {
    expect(isSlowDelivery({ level: "A2", pace: "Natural classroom speed" })).toBe(true);
    expect(isSlowDelivery({ level: "B2", pace: "Slow learner-friendly" })).toBe(true);
    expect(isSlowDelivery({ level: "B1", pace: "Natural classroom speed" })).toBe(false);
  });

  it("shrinks both budgets so a slow read stays under 20 seconds", () => {
    const monologue = monologueExcerpt(sentences(40), { slow: true });
    expect(monologue.length).toBeLessThanOrEqual(Math.round(PREVIEW_MONOLOGUE_MAX_CHARS * PREVIEW_SLOW_DELIVERY_FACTOR));
    expect(monologue.length).toBeLessThan(monologueExcerpt(sentences(40)).length);

    const script = [`Speaker 1: ${sentences(10)}`, `Speaker 2: ${sentences(10)}`].join("\n");
    const dialogue = dialogueExcerpt(script, { slow: true });
    expect(dialogue.length).toBeLessThanOrEqual(Math.round(PREVIEW_DIALOGUE_MAX_CHARS * PREVIEW_SLOW_DELIVERY_FACTOR));
    expect(speakersIn(dialogue)).toEqual(new Set(["Speaker 1", "Speaker 2"]));
  });
});
