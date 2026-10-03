import { describe, expect, it } from "vitest";
import { applySuggestions } from "../../src/lib/audio-suggestions";
import { emotionSuggestionsFrom, fixSuggestionsFrom, limitEmotionTags, mergeSuggestions, suggestAudioEdits } from "./audio-suggest";

const DIALOGUE = "Speaker 1: Tu as vu l'heure ? On va rater le train !\nSpeaker 2: J'arrive, j'arrive…";

function acceptAll(script: string, suggestions: ReturnType<typeof mergeSuggestions>) {
  return applySuggestions(script, suggestions, Object.fromEntries(suggestions.map((s) => [s.id, "accepted" as const])));
}

describe("emotionSuggestionsFrom", () => {
  it("turns the annotated copy into insertions after the speaker label", () => {
    const suggestions = emotionSuggestionsFrom(DIALOGUE, {
      annotatedScript: "Speaker 1: Tu as vu l'heure ? [serious] On va rater le train !\nSpeaker 2: [tired] J'arrive, j'arrive…",
      notes: [
        { line: 1, tag: "[serious]", reason: "Il fait un reproche." },
        { line: 2, tag: "[tired]", reason: "Elle a couru." },
      ],
    }, "dialogue");

    expect(suggestions.map((s) => [s.tag, s.reason])).toEqual([
      ["[serious]", "Il fait un reproche."],
      ["[tired]", "Elle a couru."],
    ]);
    expect(acceptAll(DIALOGUE, suggestions).script).toBe(
      "Speaker 1: Tu as vu l'heure ? [serious] On va rater le train !\nSpeaker 2: [tired] J'arrive, j'arrive…"
    );
  });

  it("never changes a word: a rewritten line loses its suggestions", () => {
    const suggestions = emotionSuggestionsFrom(DIALOGUE, {
      annotatedScript: "Speaker 1: [excited] Tu as vu l'heure ? On va louper le train !\nSpeaker 2: [sighs] J'arrive, j'arrive…",
      notes: [],
    }, "dialogue");

    expect(suggestions.map((s) => s.tag)).toEqual(["[sighs]"]);
  });

  it("keeps existing tags, drops unsupported ones and moves a tag placed before the label", () => {
    const script = "Speaker 1: [whispers] Chut.\nSpeaker 2: Quoi ?";
    const suggestions = emotionSuggestionsFrom(script, {
      annotatedScript: "Speaker 1: [whispers] Chut. [confused]\n[curious] Speaker 2: Quoi ?",
      notes: [],
    }, "dialogue");

    expect(acceptAll(script, suggestions).script).toBe("Speaker 1: [whispers] Chut.\nSpeaker 2: [curious] Quoi ?");
  });

  it("adds an end-of-line event with a leading space", () => {
    const script = "Je suis fatigué.";
    const suggestions = emotionSuggestionsFrom(script, { annotatedScript: "Je suis fatigué. [sighs]", notes: [] }, "monologue");
    expect(acceptAll(script, suggestions).script).toBe("Je suis fatigué. [sighs]");
  });

  it("gives up when the model changed the number of lines", () => {
    expect(emotionSuggestionsFrom(DIALOGUE, { annotatedScript: "Speaker 1: [excited] Tu as vu l'heure ?", notes: [] }, "dialogue")).toEqual([]);
  });
});

describe("fixSuggestionsFrom", () => {
  it("positions fixes on their line and moves direction hints to the scene", () => {
    const script = "Sarah: Bonjour. (soupire)\nMarc: [il regarde son téléphone] Oui ?";
    const fixes = fixSuggestionsFrom(script, [
      { type: "speaker_rename", before: "Sarah:", after: "Speaker 1:", line: 1, rationale: "r1" },
      { type: "stage_direction_converted", before: "(soupire)", after: "[sighs]", line: 1, rationale: "r2" },
      { type: "speaker_rename", before: "Marc:", after: "Speaker 2:", line: 2, rationale: "r3" },
      { type: "direction_hint", before: "[il regarde son téléphone]", after: "Marc regarde son téléphone.", line: 2, rationale: "r4" },
      { type: "cleanup", before: "introuvable", after: "x", line: 2, rationale: "r5" },
    ]);

    expect(fixes).toHaveLength(4);
    expect(acceptAll(script, fixes)).toEqual({
      script: "Speaker 1: Bonjour. [sighs]\nSpeaker 2: Oui ?",
      scenes: ["Marc regarde son téléphone."],
    });
  });
});

describe("fixSuggestionsFrom, speaker names", () => {
  it("renames a speaker even when the model echoes the name in another case", () => {
    const script = "Sophie: Salut.\nSophie: Ça va ?";
    const fixes = fixSuggestionsFrom(script, [
      { type: "speaker_rename", before: "Sophie:", after: "Speaker 1:", line: 1, rationale: "x" },
      { type: "speaker_rename", before: "sophie:", after: "Speaker 1:", line: 2, rationale: "x" },
    ]);
    expect(acceptAll(script, fixes).script).toBe("Speaker 1: Salut.\nSpeaker 1: Ça va ?");
    expect(fixes.every((fix) => fix.reason === "" && fix.fixType === "speaker_rename")).toBe(true);
  });
});

describe("limitEmotionTags", () => {
  const script = Array.from({ length: 6 }, (_, index) => `Speaker ${(index % 2) + 1}: Ligne ${index}.`).join("\n");
  const tagAt = (line: number, tag = "[excited]") => {
    const start = script.split("\n").slice(0, line).join("\n").length + (line > 0 ? 1 : 0) + 11;
    return { id: `t${line}${tag}`, kind: "tag" as const, start, end: start, insert: `${tag} `, tag, reason: "" };
  };

  it("keeps one emotion per line and spreads them within the level's budget", () => {
    const tags = [0, 0, 1, 2, 3, 4, 5].map((line, index) => tagAt(line, index === 1 ? "[curious]" : "[excited]"));
    const kept = limitEmotionTags(script, [], tags, "A2");
    expect(kept.map((tag) => tag.id)).toEqual(["t0[excited]", "t5[excited]"]);
    expect(limitEmotionTags(script, [], tags, "B2")).toHaveLength(3);
  });

  it("leaves alone a line where a fix already turns a stage direction into a tag", () => {
    const fix = { id: "f", kind: "fix" as const, start: tagAt(1).start, end: tagAt(1).start + 3, insert: "[sighs]", reason: "" };
    expect(limitEmotionTags(script, [fix], [tagAt(1), tagAt(3)], "C1").map((tag) => tag.id)).toEqual(["t3[excited]"]);
  });
});

describe("mergeSuggestions", () => {
  it("drops an emotion tag that falls inside a fixed range", () => {
    const script = "Sarah: Bonjour.";
    const fixes = fixSuggestionsFrom(script, [{ type: "cleanup", before: "Sarah: Bonjour", after: "Speaker 1: Bonjour", line: 1, rationale: "" }]);
    const tags = emotionSuggestionsFrom("Sarah: Bonjour.", { annotatedScript: "Sarah: Bon[excited]jour.", notes: [] }, "monologue");
    expect(mergeSuggestions(fixes, tags).map((s) => s.kind)).toEqual(["fix"]);
  });
});

describe("suggestAudioEdits", () => {
  it("combines the prepare pass and the emotion pass", async () => {
    const script = "Marie: Bonjour !\nSpeaker 2: Salut.";
    const fetcher = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { systemInstruction: { parts: Array<{ text: string }> } };
      const isEmotion = body.systemInstruction.parts[0].text.includes("delivery tags");
      const payload = isEmotion
        ? { annotated_script: "Marie: [excited] Bonjour !\nSpeaker 2: Salut.", notes: [{ line: 1, tag: "[excited]", reason: "Joie." }] }
        : {
          speaker_count: 2,
          formatted_script: "Speaker 1: Bonjour !\nSpeaker 2: Salut.",
          changes: [{ type: "speaker_rename", before: "Marie:", after: "Speaker 1:", line: 1, rationale: "Numérotation." }],
          warnings: [],
        };
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }));
    }) as typeof fetch;

    const result = await suggestAudioEdits({ apiKey: "k", model: "m", script, mode: "dialogue", language: "fr", fetcher });
    expect(result.suggestions.map((s) => s.kind)).toEqual(["fix", "tag"]);
    expect(acceptAll(script, result.suggestions).script).toBe("Locuteur 1: [excited] Bonjour !\nSpeaker 2: Salut.");
  });
});
