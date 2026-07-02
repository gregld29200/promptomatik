import { describe, expect, it } from "vitest";
import { AudioPrepareError, parsePrepareResponse } from "./audio-prepare";

const validPrepareJson = JSON.stringify({
  speaker_count: 2,
  formatted_script: "Speaker 1: Bonjour.\nSpeaker 2: Bien sûr.",
  changes: [
    {
      type: "speaker_rename",
      before: "Sarah:",
      after: "Speaker 1:",
      line: 1,
      rationale: "House convention: numbered speakers.",
    },
    {
      type: "stage_direction_converted",
      before: "(soupire)",
      after: "[sighs]",
      line: 2,
      rationale: "Supported tag equivalent.",
    },
    {
      type: "direction_hint",
      before: "[il regarde son téléphone]",
      after: "Speaker 2 is checking a phone while answering.",
      line: 2,
      rationale: "This is scene context, not spoken text.",
    },
  ],
  warnings: [],
});

describe("parsePrepareResponse", () => {
  it("parses a valid preparation contract", () => {
    expect(parsePrepareResponse(validPrepareJson)).toEqual({
      speaker_count: 2,
      formatted_script: "Speaker 1: Bonjour.\nSpeaker 2: Bien sûr.",
      changes: [
        {
          type: "speaker_rename",
          before: "Sarah:",
          after: "Speaker 1:",
          line: 1,
          rationale: "House convention: numbered speakers.",
        },
        {
          type: "stage_direction_converted",
          before: "(soupire)",
          after: "[sighs]",
          line: 2,
          rationale: "Supported tag equivalent.",
        },
        {
          type: "direction_hint",
          before: "[il regarde son téléphone]",
          after: "Speaker 2 is checking a phone while answering.",
          line: 2,
          rationale: "This is scene context, not spoken text.",
        },
      ],
      warnings: [],
    });
  });

  it("strips accidental markdown JSON fences before parsing", () => {
    expect(parsePrepareResponse(`\`\`\`json\n${validPrepareJson}\n\`\`\``).speaker_count).toBe(2);
  });

  it("extracts the JSON object from accidental surrounding text", () => {
    expect(parsePrepareResponse(`Here is the cleaned contract:\n${validPrepareJson}`).changes).toHaveLength(3);
  });

  it("rejects malformed preparation output without applying it", () => {
    expect(() => parsePrepareResponse("{not json")).toThrow(AudioPrepareError);
    expect(() => parsePrepareResponse(JSON.stringify({
      speaker_count: 2,
      formatted_script: "Speaker 1: Bonjour.",
      changes: [{ type: "unknown", before: "x", after: "y", line: 1, rationale: "bad" }],
      warnings: [],
    }))).toThrow(AudioPrepareError);
  });
});
