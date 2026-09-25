import { describe, expect, it } from "vitest";
import { AudioPrepareError, parsePrepareResponse, prepareAudioScript } from "./audio-prepare";

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

function geminiReply(payload: unknown): Response {
  return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] });
}

interface GeminiRequestBody {
  systemInstruction: { parts: Array<{ text: string }> };
  contents: Array<{ parts: Array<{ text: string }> }>;
}

function recordingFetcher(replies: unknown[]) {
  const bodies: GeminiRequestBody[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as GeminiRequestBody);
    return geminiReply(replies[Math.min(bodies.length - 1, replies.length - 1)]);
  };
  return { fetcher, bodies };
}

const namedDialogue = {
  speaker_count: 2,
  formatted_script: "Marie: Bonjour.\nPaul: Salut.",
  changes: [],
  warnings: [],
};

const numberedDialogue = {
  speaker_count: 2,
  formatted_script: "Speaker 1: Bonjour.\nSpeaker 2: Salut.",
  changes: [],
  warnings: [],
};

describe("prepareAudioScript", () => {
  it("sends the model instructions for the selected mode only", async () => {
    const { fetcher, bodies } = recordingFetcher([{
      speaker_count: 1,
      formatted_script: "Il était une fois un petit chat.",
      changes: [],
      warnings: [],
    }]);

    await prepareAudioScript({
      apiKey: "key",
      model: "gemini-2.5-flash",
      script: "Il était une fois un petit chat.",
      mode: "monologue",
      language: "fr",
      fetcher,
    });

    const system = bodies[0].systemInstruction.parts[0].text;
    expect(system).toContain("This is a monologue with one narrator.");
    expect(system).not.toContain("Map detected speakers");
  });

  it("asks once more when the proposal breaks the dialogue speaker format", async () => {
    const { fetcher, bodies } = recordingFetcher([namedDialogue, numberedDialogue]);

    const result = await prepareAudioScript({
      apiKey: "key",
      model: "gemini-2.5-flash",
      script: "Marie: Bonjour.\nPaul: Salut.",
      mode: "dialogue",
      language: "fr",
      fetcher,
    });

    expect(bodies).toHaveLength(2);
    expect(bodies[1].contents[0].parts[0].text).toContain("Your previous proposal had invalid speaker formatting.");
    expect(result.formatted_script).toBe("Speaker 1: Bonjour.\nSpeaker 2: Salut.");
  });

  it("rejects a monologue change that would add a speaker label", async () => {
    const labelledChange = {
      speaker_count: 1,
      formatted_script: "Il était une fois un petit chat.",
      changes: [{ type: "cleanup", before: "Il était", after: "Narrateur: Il était", line: 1, rationale: "x" }],
      warnings: [],
    };
    const clean = { ...labelledChange, changes: [] };
    const { fetcher, bodies } = recordingFetcher([labelledChange, clean]);

    const result = await prepareAudioScript({
      apiKey: "key",
      model: "gemini-2.5-flash",
      script: "Il était une fois un petit chat.",
      mode: "monologue",
      language: "fr",
      fetcher,
    });

    expect(bodies).toHaveLength(2);
    expect(result.changes).toEqual([]);
  });

  it("gives up after two invalid proposals and leaves the script untouched", async () => {
    const { fetcher, bodies } = recordingFetcher([namedDialogue]);

    await expect(prepareAudioScript({
      apiKey: "key",
      model: "gemini-2.5-flash",
      script: "Marie: Bonjour.\nPaul: Salut.",
      mode: "dialogue",
      language: "fr",
      fetcher,
    })).rejects.toThrow(AudioPrepareError);
    expect(bodies).toHaveLength(2);
  });
});
