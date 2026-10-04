import { describe, expect, it } from "vitest";
import { applySuggestions } from "../../src/lib/audio-suggestions";
import {
  AudioSuggestError,
  emotionSuggestionsFrom,
  limitEmotionTags,
  mergeSuggestions,
  parenthesisSuggestionsFrom,
  parseSuggestResponse,
  suggestAudioEdits,
  type InlineSuggestion,
} from "./audio-suggest";

const DIALOGUE = "Léa : Tu as vu l'heure ? On va rater le train !\nKarim : J'arrive, j'arrive…";

function acceptAll(script: string, suggestions: InlineSuggestion[]) {
  return applySuggestions(script, suggestions, Object.fromEntries(suggestions.map((s) => [s.id, "accepted" as const])));
}

describe("emotionSuggestionsFrom", () => {
  it("places tags after the character name", () => {
    const suggestions = emotionSuggestionsFrom(DIALOGUE, {
      annotatedScript: "Léa : Tu as vu l'heure ? [serious] On va rater le train !\nKarim : [tired] J'arrive, j'arrive…",
      notes: [
        { line: 1, tag: "[serious]", reason: "Elle fait un reproche." },
        { line: 2, tag: "[tired]", reason: "Il a couru." },
      ],
    }, "dialogue");

    expect(suggestions.map((s) => [s.tag, s.reason])).toEqual([
      ["[serious]", "Elle fait un reproche."],
      ["[tired]", "Il a couru."],
    ]);
    expect(acceptAll(DIALOGUE, suggestions).script).toBe(
      "Léa : Tu as vu l'heure ? [serious] On va rater le train !\nKarim : [tired] J'arrive, j'arrive…"
    );
  });

  it("never changes a word: a rewritten line loses its suggestions", () => {
    const suggestions = emotionSuggestionsFrom(DIALOGUE, {
      annotatedScript: "Léa : [excited] Tu as vu l'heure ? On va louper le train !\nKarim : [sighs] J'arrive, j'arrive…",
      notes: [],
    }, "dialogue");

    expect(suggestions.map((s) => s.tag)).toEqual(["[sighs]"]);
  });

  it("keeps existing tags, drops unsupported ones and moves a tag placed before the name", () => {
    const script = "Léa : [whispers] Chut.\nKarim : Quoi ?";
    const suggestions = emotionSuggestionsFrom(script, {
      annotatedScript: "Léa : [whispers] Chut. [confused]\n[curious] Karim : Quoi ?",
      notes: [],
    }, "dialogue");

    expect(acceptAll(script, suggestions).script).toBe("Léa : [whispers] Chut.\nKarim : [curious] Quoi ?");
  });

  it("adds an end-of-line event with a leading space", () => {
    const script = "Je suis fatigué.";
    const suggestions = emotionSuggestionsFrom(script, { annotatedScript: "Je suis fatigué. [sighs]", notes: [] }, "monologue");
    expect(acceptAll(script, suggestions).script).toBe("Je suis fatigué. [sighs]");
  });

  it("gives up when the model changed the number of lines", () => {
    expect(emotionSuggestionsFrom(DIALOGUE, { annotatedScript: "Léa : [excited] Tu as vu l'heure ?", notes: [] }, "dialogue")).toEqual([]);
  });
});

describe("parenthesisSuggestionsFrom", () => {
  const script = "Léa : (soupire) Ce n'est pas vrai…\nKarim : (il regarde le panneau) Euh… Léa ?\nLéa : Bon. (rit)";

  it("turns a stage direction into a tag, moves a setting to the scene and removes the rest", () => {
    const fixes = parenthesisSuggestionsFrom(script, [
      { line: 1, text: "(soupire)", action: "tag", tag: "[sighs]", reason: "Un soupir s'entend." },
      { line: 2, text: "(il regarde le panneau)", action: "scene", scene: "Karim regarde le panneau.", reason: "C'est une action." },
      { line: 3, text: "(rit)", action: "remove", reason: "" },
    ]);

    expect(fixes.map((fix) => fix.fixType)).toEqual(["stage_direction", "stage_direction", "stage_direction"]);
    expect(acceptAll(script, fixes)).toEqual({
      script: "Léa : [sighs] Ce n'est pas vrai…\nKarim : Euh… Léa ?\nLéa : Bon.",
      scenes: ["Karim regarde le panneau."],
    });
  });

  it("drops a decision whose text is not in the script or whose tag is not playable", () => {
    expect(parenthesisSuggestionsFrom(script, [
      { line: 1, text: "(introuvable)", action: "remove", reason: "" },
      { line: 1, text: "(soupire)", action: "tag", tag: "[yawns]", reason: "" },
    ])).toEqual([]);
  });
});

describe("parseSuggestResponse", () => {
  it("skips malformed entries instead of failing the whole answer", () => {
    const proposal = parseSuggestResponse(JSON.stringify({
      annotated_script: "Léa : Bonjour.",
      notes: [{ line: 1, tag: "[Excited]", reason: "Joie." }, { line: null, tag: "[sighs]" }, "oops"],
      parentheses: [{ line: 1, text: null, action: "tag" }, { line: 1, text: "(rit)", action: "dance" }],
    }));

    expect(proposal).toEqual({
      annotatedScript: "Léa : Bonjour.",
      notes: [{ line: 1, tag: "[excited]", reason: "Joie." }],
      parentheses: [],
    });
  });

  it("needs the annotated script", () => {
    expect(parseSuggestResponse('{"notes":[]}')).toBeNull();
    expect(parseSuggestResponse("not json")).toBeNull();
  });
});

describe("limitEmotionTags", () => {
  const script = Array.from({ length: 6 }, (_, index) => `${index % 2 ? "Karim" : "Léa"} : Ligne ${index}.`).join("\n");
  const tagAt = (line: number, tag = "[excited]"): InlineSuggestion => {
    const start = script.split("\n").slice(0, line).join("\n").length + (line > 0 ? 1 : 0) + 6;
    return { id: `t${line}${tag}`, kind: "tag", start, end: start, insert: `${tag} `, tag, reason: "" };
  };

  it("keeps one emotion per line and spreads them within the level's budget", () => {
    const tags = [0, 0, 1, 2, 3, 4, 5].map((line, index) => tagAt(line, index === 1 ? "[curious]" : "[excited]"));
    expect(limitEmotionTags(script, [], tags, "A2").map((tag) => tag.id)).toEqual(["t0[excited]", "t5[excited]"]);
    expect(limitEmotionTags(script, [], tags, "B2")).toHaveLength(3);
  });

  it("leaves alone a line where a stage direction already becomes a tag", () => {
    const fix: InlineSuggestion = { id: "f", kind: "fix", start: tagAt(1).start, end: tagAt(1).start + 3, insert: "[sighs]", reason: "" };
    expect(limitEmotionTags(script, [fix], [tagAt(1), tagAt(3)], "C1").map((tag) => tag.id)).toEqual(["t3[excited]"]);
  });
});

describe("mergeSuggestions", () => {
  it("drops an emotion tag that falls inside a replaced range", () => {
    const script = "Léa : Bonjour (rit) toi.";
    const fixes = parenthesisSuggestionsFrom(script, [{ line: 1, text: "(rit)", action: "tag", tag: "[laughs]", reason: "" }]);
    const tags = emotionSuggestionsFrom(script, { annotatedScript: "Léa : Bonjour (r[excited]it) toi.", notes: [] }, "dialogue");
    expect(mergeSuggestions(fixes, tags).map((s) => s.kind)).toEqual(["fix"]);
  });
});

function geminiReply(payload: unknown, status = 200) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status });
}

describe("suggestAudioEdits", () => {
  const script = "Léa : (soupire) Encore ?\nKarim : Oui.";
  const answer = {
    annotated_script: "Léa : (soupire) Encore ?\nKarim : [hesitant] Oui.",
    notes: [{ line: 2, tag: "[hesitant]", reason: "Il n'est pas sûr." }],
    parentheses: [{ line: 1, text: "(soupire)", action: "tag", tag: "[sighs]", reason: "Un soupir." }],
  };

  it("returns emotions and parentheses from one answer", async () => {
    const fetcher = (async () => geminiReply(answer)) as typeof fetch;
    const result = await suggestAudioEdits({ apiKey: "k", model: "m", script, mode: "dialogue", language: "fr", fetcher });
    expect(result.suggestions.map((s) => s.kind)).toEqual(["fix", "tag"]);
    expect(acceptAll(script, result.suggestions).script).toBe("Léa : [sighs] Encore ?\nKarim : [hesitant] Oui.");
  });

  it("retries once after an unreadable answer", async () => {
    let calls = 0;
    const fetcher = (async () => (calls++ === 0 ? geminiReply("{broken") : geminiReply(answer))) as typeof fetch;
    const result = await suggestAudioEdits({ apiKey: "k", model: "m", script, mode: "dialogue", language: "fr", fetcher });
    expect(calls).toBe(2);
    expect(result.suggestions).toHaveLength(2);
  });

  it("fails clearly, never with half a review, when the model keeps failing", async () => {
    const fetcher = (async () => new Response("busy", { status: 503 })) as typeof fetch;
    await expect(suggestAudioEdits({ apiKey: "k", model: "m", script, mode: "dialogue", language: "fr", fetcher }))
      .rejects.toBeInstanceOf(AudioSuggestError);
  });

  it("does not retry a refused request", async () => {
    let calls = 0;
    const fetcher = (async () => { calls += 1; return new Response("bad key", { status: 400 }); }) as typeof fetch;
    await expect(suggestAudioEdits({ apiKey: "k", model: "m", script, mode: "dialogue", language: "fr", fetcher }))
      .rejects.toBeInstanceOf(AudioSuggestError);
    expect(calls).toBe(1);
  });
});
