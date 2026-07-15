import { describe, expect, it } from "vitest";
import { callLLM } from "./documents/generate";

const CONTENT = Array.from({ length: 40 }, (_, index) => `word${index}`).join(" ");

describe("documents structured output", () => {
  it("enforces the one-handout schema for simple generations", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const content = JSON.stringify({
        materials: [{
          material_type: "clean_handout",
          title: "Remote Work",
          skill_focus: "reading",
          interaction_pattern: "individual",
          estimated_minutes: 5,
          blocks: [{ type: "article", paragraphs: ["A faithful paragraph."] }],
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
      undefined,
      "simple",
    );

    const responseFormat = requestBody?.response_format as {
      type?: string;
      json_schema?: {
        strict?: boolean;
        schema?: {
          properties?: {
            materials?: {
              minItems?: number;
              maxItems?: number;
              items?: { properties?: { material_type?: { const?: string } } };
            };
          };
        };
      };
    } | undefined;

    expect(responseFormat?.type).toBe("json_schema");
    expect(responseFormat?.json_schema?.strict).toBe(true);
    expect(responseFormat?.json_schema?.schema?.properties?.materials).toMatchObject({
      minItems: 1,
      maxItems: 1,
      items: { properties: { material_type: { const: "clean_handout" } } },
    });
  });
});
