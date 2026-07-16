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

  it("rescues a collapsed paste with a light structure-only call, keeping the source immutable", async () => {
    const mangled = [
      "Managing supplier performance in practice",
      "the supplier review process continues across",
      "several regions and depends on consistent",
      "reporting from every local team involved in",
      "the quarterly evaluation cycle as well as",
      "steady communication between buyers and",
      "suppliers throughout the whole contract period.",
    ].join("\n");
    const requests: string[] = [];
    const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      requests.push(String(init?.body ?? ""));
      const content = JSON.stringify({
        structure: [
          { type: "heading", line_ids: [1] },
          { type: "paragraph", line_ids: [2, 3, 4, 5, 6, 7] },
        ],
      });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }) as typeof fetch;

    const result = await callLLM(
      { apiKey: "test-key", structureModel: "light-model", fetcher },
      mangled,
      "Supplier review",
      undefined, undefined, "auto", "three_materials", undefined, "simple",
    );

    expect(requests).toHaveLength(1);
    const body = JSON.parse(requests[0]) as { model?: string; response_format?: { json_schema?: { name?: string } } };
    expect(body.model).toBe("light-model");
    expect(body.response_format?.json_schema?.name).toBe("teachinspire_structure_rescue");
    expect(requests[0]).not.toContain(JSON.stringify(mangled));
    const material = result.materials[0] as { structure?: unknown; source_text?: string; heading_phrases?: string[] };
    expect(material.structure).toEqual([
      { type: "heading", line_ids: [1] },
      { type: "paragraph", line_ids: [2, 3, 4, 5, 6, 7] },
    ]);
    expect(material.source_text).toBe(mangled);
    expect(material.heading_phrases).toEqual(["Managing supplier performance in practice"]);
  });

  it("falls back to the local structure when the rescue returns invalid coverage", async () => {
    const mangled = [
      "the supplier review process continues across",
      "several regions and depends on consistent",
      "reporting from every local team involved in",
      "the quarterly evaluation cycle as well as",
      "steady communication between buyers and",
      "suppliers throughout the whole contract period.",
    ].join("\n");
    const fetcher = (async () => {
      const content = JSON.stringify({ structure: [{ type: "heading", line_ids: [1, 2] }] });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }) as typeof fetch;

    const result = await callLLM(
      { apiKey: "test-key", fetcher },
      mangled,
      "Supplier review",
      undefined, undefined, "auto", "three_materials", undefined, "simple",
    );

    const material = result.materials[0] as { structure?: unknown };
    expect(material.structure).toEqual([{ type: "paragraph", line_ids: [1, 2, 3, 4, 5, 6] }]);
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
