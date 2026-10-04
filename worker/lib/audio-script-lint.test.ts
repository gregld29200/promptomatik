import { describe, expect, it } from "vitest";
import { dialogueCast, lintAudioScript, normalizeDialogueLabels } from "../../src/lib/audio-script-rules";
import fr from "../../src/lib/i18n/fr.json";
import en from "../../src/lib/i18n/en.json";
import es from "../../src/lib/i18n/es.json";

const LINT_CODES = [
  "empty_script",
  "unbalanced_brackets",
  "speaker_label_in_monologue",
  "too_many_speakers",
  "narration_line",
  "orphan_line",
  "residual_stage_direction",
  "unknown_tag",
  "long_turn",
] as const;

describe("lintAudioScript", () => {
  it("blocks empty scripts", () => {
    expect(lintAudioScript("  ", "dialogue")).toEqual([
      expect.objectContaining({ severity: "blocking", code: "empty_script" }),
    ]);
  });

  it("accepts characters written by name", () => {
    expect(lintAudioScript("Léa : Bonjour.\nKarim : Salut.\nLéa : Ça va ?", "dialogue")
      .filter((finding) => finding.severity === "blocking")).toEqual([]);
  });

  it("blocks more than two characters and names them", () => {
    expect(lintAudioScript("Speaker 1: A.\nSpeaker 2: B.\nSpeaker 3: C.", "dialogue"))
      .toContainEqual(expect.objectContaining({ severity: "blocking", code: "too_many_speakers" }));
    expect(lintAudioScript("Léa : A.\nKarim : B.\nMarc : C.", "dialogue"))
      .toContainEqual({ severity: "blocking", code: "too_many_speakers", names: ["Léa", "Karim", "Marc"] });
  });

  it("blocks unbalanced brackets", () => {
    expect(lintAudioScript("Speaker 1: Bonjour [sighs.", "dialogue"))
      .toContainEqual(expect.objectContaining({ severity: "blocking", code: "unbalanced_brackets" }));
  });

  it("blocks short speaker-style labels in monologue mode", () => {
    expect(lintAudioScript("Sarah: Bonjour tout le monde.", "monologue"))
      .toContainEqual(expect.objectContaining({ severity: "blocking", code: "speaker_label_in_monologue" }));
    expect(lintAudioScript("M. Dupont : Bonjour.", "monologue"))
      .toContainEqual(expect.objectContaining({ severity: "blocking", code: "speaker_label_in_monologue" }));
  });

  it("carries the offending tag so the UI can localize the message", () => {
    expect(lintAudioScript("Speaker 1: Bonjour [sigh]", "dialogue"))
      .toContainEqual({ severity: "warning", code: "unknown_tag", line: 1, tag: "[sigh]" });
  });

  // The studio renders these through t(); a code with no key would surface as
  // the raw key, or fall back to English inside an otherwise French panel.
  it.each([["fr", fr], ["en", en], ["es", es]])("has a %s message for every lint code", (_lang, bundle) => {
    const audio = bundle.audio as Record<string, string>;
    for (const code of LINT_CODES) {
      expect(audio[`lint_${code}`], `missing lint_${code}`).toBeTypeOf("string");
    }
    expect(audio.lint_unknown_tag).toContain("{{tag}}");
    expect(audio.status_orphan).toContain("{{line}}");
    expect(audio.status_too_many).toContain("{{names}}");
  });

  it("never returns prose, so the worker and the browser can both run it", () => {
    const findings = lintAudioScript("Marie: Bonjour (sourit) [nope]", "dialogue");
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(finding).not.toHaveProperty("message");
      expect(finding).not.toHaveProperty("remedy");
    }
  });

  it("does not treat prose colons as speaker labels (phase 7 harness finding)", () => {
    // French spaced colon mid-sentence
    expect(lintAudioScript(
      "Claire posa sa valise sur le quai et regarda l'horloge : six heures dix.",
      "monologue"
    )).toEqual([]);
    // English colon after a clause of more than three words
    expect(lintAudioScript(
      "Some employees enjoy the flexibility: they can start earlier and avoid crowded trains.",
      "monologue"
    )).toEqual([]);
    // Prose colon in dialogue narration stays a warning, not an unknown speaker
    expect(lintAudioScript(
      "Speaker 1: Bonjour.\nIls regardent la carte : le restaurant est fermé.",
      "dialogue"
    )).toContainEqual(expect.objectContaining({ severity: "warning", code: "narration_line", line: 2 }));
  });

  it("warns on stage directions, unknown tags, long turns, and narration lines", () => {
    const longTurn = Array.from({ length: 155 }, (_, index) => `mot${index}`).join(" ");
    const findings = lintAudioScript([
      "Speaker 1: Bonjour (sourit) [unknown]",
      longTurn,
    ].join("\n"), "dialogue");

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "warning", code: "residual_stage_direction", line: 1 }),
      expect.objectContaining({ severity: "warning", code: "unknown_tag", line: 1 }),
      expect.objectContaining({ severity: "warning", code: "narration_line", line: 2 }),
      expect.objectContaining({ severity: "warning", code: "long_turn", line: 2 }),
    ]));
  });

  it("blocks a line nobody can voice, before the first turn", () => {
    expect(lintAudioScript("Au café.\nSpeaker 1: Bonjour.", "dialogue")).toContainEqual(
      expect.objectContaining({ severity: "blocking", code: "orphan_line", line: 1 })
    );
  });
});

describe("dialogueCast", () => {
  it("gives each name the next free voice, in order of appearance", () => {
    expect(dialogueCast("Léa : A.\nKarim: B.\nléa : C.")).toEqual([
      { label: "Léa", slot: "Speaker 1" },
      { label: "Karim", slot: "Speaker 2" },
    ]);
  });

  it("lets a numbered label keep its own voice", () => {
    expect(dialogueCast("Locuteur 2 : A.\nMarc : B.")).toEqual([
      { label: "Locuteur 2", slot: "Speaker 2" },
      { label: "Marc", slot: "Speaker 1" },
    ]);
  });
});

describe("normalizeDialogueLabels", () => {
  it("rewrites names to voice slots and leaves other lines alone", () => {
    expect(normalizeDialogueLabels("Léa : Bonjour !\r\nKarim: Salut.\nIls partent.")).toBe(
      "Speaker 1: Bonjour !\nSpeaker 2: Salut.\nIls partent."
    );
  });
});
