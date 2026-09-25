import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AudioVoice } from "@/lib/api";
import { VoiceCasting } from "./voice-casting";

function voice(name: string, label: string, gender: AudioVoice["gender"], tone: AudioVoice["tone"], descriptor: string): AudioVoice {
  return { name, label, gender, tone, descriptor, previewUrl: `/api/audio/voices/${name}/preview?v=${label}` };
}

const VOICES = [
  voice("Puck", "Leo", "masculine", "energetic", "Upbeat"),
  voice("Zephyr", "Nina", "feminine", "energetic", "Bright"),
  voice("Kore", "Clara", "feminine", "composed", "Firm"),
];

describe("VoiceCasting", () => {
  it("names each voice by its display name and says whether it is feminine or masculine", () => {
    const markup = renderToStaticMarkup(
      <VoiceCasting voices={VOICES} mode="dialogue" selected={{}} onChange={() => {}} />
    );
    expect(markup).toContain('aria-label="Choisir Clara, Féminine"');
    expect(markup).toContain('aria-label="Choisir Leo, Masculine"');
    expect(markup).not.toContain(">Kore<");
  });

  it("lists feminine voices first, each group alphabetical", () => {
    const markup = renderToStaticMarkup(
      <VoiceCasting voices={VOICES} mode="dialogue" selected={{}} onChange={() => {}} />
    );
    const order = ["Clara", "Nina", "Leo"].map((label) => markup.indexOf(`Choisir ${label},`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("offers gender and tone filters as labelled button groups", () => {
    const markup = renderToStaticMarkup(
      <VoiceCasting voices={VOICES} mode="monologue" selected={{ solo: "Kore" }} onChange={() => {}} />
    );
    expect(markup).toContain('aria-labelledby="voice-filter-gender-label"');
    expect(markup).toContain('aria-labelledby="voice-filter-tone-label"');
    expect(markup).toContain(">Tonalité<");
    // The narrator slot shows the chosen voice's display name, gender and descriptor.
    expect(markup).toContain("<strong>Clara</strong>");
    expect(markup).toContain("Féminine · Ferme");
  });
});
