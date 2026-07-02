import { describe, expect, it } from "vitest";
import {
  estimateAudioSeconds,
  normalizeSpeakerDirections,
  normalizeSpeakerLabels,
  normalizeVoiceMap,
  splitScriptIntoBlocks,
} from "./audio-script";
import type { AudioDirection } from "./audio-config";

function words(count: number): string {
  return Array.from({ length: count }, (_, index) => `word${index}`).join(" ");
}

describe("estimateAudioSeconds", () => {
  it("excludes bracketed audio tags from word count", () => {
    expect(estimateAudioSeconds("Hello [sighs] my friend [very slow]")).toBe(2);
  });
});

describe("splitScriptIntoBlocks", () => {
  it("keeps dialogue speaker turns intact while enforcing the 90s cap", () => {
    const script = [
      `Speaker 1: ${words(90)}`,
      `Speaker 2: ${words(90)}`,
      `Speaker 1: ${words(80)}`,
    ].join("\n");

    const blocks = splitScriptIntoBlocks(script, "dialogue");

    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toContain("Speaker 1:");
    expect(blocks[0].text).toContain("Speaker 2:");
    expect(blocks[0].estimatedSeconds).toBeLessThanOrEqual(90);
    expect(blocks[1].text).toBe(`Speaker 1: ${words(80)}`);
  });

  it("splits monologues at sentence boundaries", () => {
    const script = `${words(100)}. ${words(100)}. ${words(100)}.`;
    const blocks = splitScriptIntoBlocks(script, "monologue");

    expect(blocks).toHaveLength(2);
    expect(blocks[0].text.endsWith(".")).toBe(true);
    expect(blocks[1].text.endsWith(".")).toBe(true);
    expect(blocks[0].estimatedSeconds).toBe(80);
  });

  it("keeps a single long speaker turn as one oversize block", () => {
    const script = `Speaker 1: ${words(260)}`;
    const blocks = splitScriptIntoBlocks(script, "dialogue");

    expect(blocks).toHaveLength(1);
    expect(blocks[0].estimatedSeconds).toBeGreaterThan(90);
    expect(blocks[0].text).toBe(script);
  });
});

describe("speaker normalization", () => {
  it("normalizes Speaker and Locuteur conventions to Speaker labels", () => {
    const script = [
      "Speaker 1: Hello.",
      "locuteur 2: Bonjour.",
      "LOCUTEUR 1: Encore.",
      "speaker 2: Again.",
    ].join("\n");

    expect(normalizeSpeakerLabels(script)).toBe([
      "Speaker 1: Hello.",
      "Speaker 2: Bonjour.",
      "Speaker 1: Encore.",
      "Speaker 2: Again.",
    ].join("\n"));
  });

  it("normalizes mixed input before dialogue splitting", () => {
    const blocks = splitScriptIntoBlocks([
      "Locuteur 1: Bonjour.",
      "speaker 2: Hello.",
    ].join("\n"), "dialogue");

    expect(normalizeSpeakerLabels(blocks[0].text)).toBe([
      "Speaker 1: Bonjour.",
      "Speaker 2: Hello.",
    ].join("\n"));
  });

  it("normalizes voice-map keys to Speaker labels", () => {
    expect(normalizeVoiceMap({
      "Locuteur 1": "Kore",
      "speaker 2": "Puck",
      solo: "Aoede",
    })).toEqual({
      "Speaker 1": "Kore",
      "Speaker 2": "Puck",
      solo: "Aoede",
    });
  });
});

describe("normalizeSpeakerDirections", () => {
  const base: AudioDirection = {
    level: "B1",
    accent: "Neutral international",
    pace: "Natural classroom speed",
    style: "Neutral classroom",
  };

  it("normalizes localized keys and drops unknown speakers and empty fields", () => {
    const result = normalizeSpeakerDirections({
      ...base,
      speakers: {
        "locuteur 1": { accent: " British ", notes: "" },
        "Speaker 2": { style: "Examiner voice" },
        "Speaker 3": { accent: "Irish" },
        narrator: { accent: "Irish" },
      },
    }, "dialogue");

    expect(result.speakers).toEqual({
      "Speaker 1": { accent: "British" },
      "Speaker 2": { style: "Examiner voice" },
    });
  });

  it("caps field lengths", () => {
    const result = normalizeSpeakerDirections({
      ...base,
      speakers: { "Speaker 1": { notes: "x".repeat(500) } },
    }, "dialogue");

    expect(result.speakers?.["Speaker 1"].notes).toHaveLength(200);
  });

  it("drops speaker overrides entirely in monologue mode", () => {
    const result = normalizeSpeakerDirections({
      ...base,
      speakers: { "Speaker 1": { accent: "British" } },
    }, "monologue");

    expect(result.speakers).toBeUndefined();
  });

  it("drops an empty speakers object", () => {
    const result = normalizeSpeakerDirections({
      ...base,
      speakers: { "Speaker 1": {} },
    }, "dialogue");

    expect(result.speakers).toBeUndefined();
  });
});

describe("global manner-of-speaking note normalization", () => {
  it("trims, caps, and drops empty global notes", () => {
    const base = {
      level: "B1" as const,
      accent: "Neutral international",
      pace: "Natural classroom speed",
      style: "Storytelling",
    };
    expect(normalizeSpeakerDirections({ ...base, notes: "  parle lentement  " }, "monologue").notes)
      .toBe("parle lentement");
    expect(normalizeSpeakerDirections({ ...base, notes: "x".repeat(500) }, "monologue").notes)
      .toHaveLength(200);
    expect(normalizeSpeakerDirections({ ...base, notes: "   " }, "monologue").notes)
      .toBeUndefined();
  });
});
