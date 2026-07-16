import { describe, expect, it } from "vitest";
import { callLLM } from "./documents/generate";

const CONTENT = Array.from({ length: 40 }, (_, index) => `word${index}`).join(" ");

describe("documents structured output", () => {
  it("enforces the additions-only schema when a simple generation asks for an addition", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const content = JSON.stringify({
        additions: [{
          type: "reference_list",
          heading: "Word bank",
          items: [{ term: "word1", detail: "An example term from the source." }],
        }],
      });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }) as typeof fetch;

    await callLLM(
      { apiKey: "test-key", fetcher },
      CONTENT,
      undefined,
      undefined,
      undefined,
      "auto",
      "three_materials",
      "Add a word bank at the end.",
      "simple",
    );

    const responseFormat = requestBody?.response_format as {
      type?: string;
      json_schema?: {
        name?: string;
        strict?: boolean;
        schema?: { properties?: { additions?: { minItems?: number; maxItems?: number } } };
      };
    } | undefined;

    expect(responseFormat?.type).toBe("json_schema");
    expect(responseFormat?.json_schema?.strict).toBe(true);
    expect(responseFormat?.json_schema?.name).toBe("teachinspire_simple_additions");
    expect(responseFormat?.json_schema?.schema?.properties?.additions).toMatchObject({
      minItems: 1,
      maxItems: 4,
    });
  });

  it("sends no LLM request at all for a formatting-only simple generation", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const result = await callLLM(
      { apiKey: "test-key", fetcher },
      CONTENT,
      undefined,
      undefined,
      undefined,
      "auto",
      "three_materials",
      undefined,
      "simple",
    );

    expect(calls).toBe(0);
    expect(result.materials).toHaveLength(1);
  });
});
