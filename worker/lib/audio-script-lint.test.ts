import { describe, expect, it } from "vitest";
import { lintAudioScript } from "../../src/lib/audio-script-rules";

describe("lintAudioScript", () => {
  it("blocks empty scripts", () => {
    expect(lintAudioScript("  ", "dialogue")).toEqual([
      expect.objectContaining({ severity: "blocking", code: "empty_script" }),
    ]);
  });

  it("blocks unknown speaker labels after normalization", () => {
    expect(lintAudioScript("Marie: Bonjour.\nSpeaker 2: Salut.", "dialogue"))
      .toContainEqual(expect.objectContaining({ severity: "blocking", code: "unknown_speaker", line: 1 }));
  });

  it("blocks more than two speakers", () => {
    expect(lintAudioScript("Speaker 1: A.\nSpeaker 2: B.\nSpeaker 3: C.", "dialogue"))
      .toContainEqual(expect.objectContaining({ severity: "blocking", code: "too_many_speakers" }));
  });

  it("blocks unbalanced brackets", () => {
    expect(lintAudioScript("Speaker 1: Bonjour [sighs.", "dialogue"))
      .toContainEqual(expect.objectContaining({ severity: "blocking", code: "unbalanced_brackets" }));
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
});
