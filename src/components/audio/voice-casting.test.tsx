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

  // A teacher saw the yellow dot on two voices at once: the grid marked every
  // voice held by any slot, including the dialogue's two characters while
  // casting a monologue narrator.
  function markedVoices(markup: string): string[] {
    return [...markup.matchAll(/aria-pressed="true" aria-label="Choisir ([^,]+),/g)].map((match) => match[1]);
  }

  it("marks only the narrator's voice in a monologue, not the dialogue's leftovers", () => {
    const markup = renderToStaticMarkup(
      <VoiceCasting
        voices={VOICES}
        mode="monologue"
        selected={{ solo: "Kore", "Speaker 1": "Zephyr", "Speaker 2": "Puck" }}
        onChange={() => {}}
      />
    );
    expect(markedVoices(markup)).toEqual(["Clara"]);
  });

  it("marks only the voice of the character being cast, and names who plays which voice", () => {
    const markup = renderToStaticMarkup(
      <VoiceCasting
        voices={VOICES}
        mode="dialogue"
        selected={{ solo: "Zephyr", "Speaker 1": "Puck", "Speaker 2": "Kore" }}
        onChange={() => {}}
        slotNames={{ "Speaker 1": "Le serveur", "Speaker 2": "La cliente" }}
      />
    );
    expect(markedVoices(markup)).toEqual(["Leo"]);
    expect(card(markup, "Leo")).toContain("Le serveur");
    expect(card(markup, "Clara")).toContain("La cliente");
    // Nina is the hidden narrator's voice: nothing on her card in a dialogue.
    expect(card(markup, "Nina")).not.toMatch(/Le serveur|La cliente/);
  });

  function card(markup: string, label: string): string {
    const start = markup.indexOf(`Choisir ${label},`);
    return markup.slice(start, markup.indexOf("</article>", start));
  }
});
