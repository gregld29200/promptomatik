import { describe, expect, it } from "vitest";
import { briefAccent, parseAccentBrief } from "./accent-brief";

const BRIEF = "A broad southern French accent of Marseille: final mute e pronounced, nasal vowels ending in ng.";

function geminiAnswer(text: string): Response {
  return Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
}

function memoryKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  } as unknown as KVNamespace;
}

describe("parseAccentBrief", () => {
  it("accepts a real description, fenced or not", () => {
    expect(parseAccentBrief(`{"description":"${BRIEF}"}`)).toBe(BRIEF);
    expect(parseAccentBrief("```json\n{\"description\":\"" + BRIEF + "\"}\n```")).toBe(BRIEF);
  });

  it("refuses an empty or unreadable answer", () => {
    expect(parseAccentBrief('{"description":"Marseille."}')).toBeNull();
    expect(parseAccentBrief("not json")).toBeNull();
  });
});

describe("briefAccent", () => {
  it("asks the model once per phrase and remembers the brief", async () => {
    const cache = memoryKv();
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls += 1;
      return geminiAnswer(`{"description":"${BRIEF}"}`);
    };
    const input = { apiKey: "k", model: "gemini-2.5-flash", cache, fetcher };

    expect(await briefAccent({ ...input, accent: "Accent du  Midi" })).toBe(BRIEF);
    expect(await briefAccent({ ...input, accent: "accent du midi" })).toBe(BRIEF);
    expect(calls).toBe(1);
  });

  it("keeps the teacher's words when the model gives nothing usable", async () => {
    const fetcher: typeof fetch = async () => new Response("busy", { status: 503 });
    expect(await briefAccent({ apiKey: "k", model: "m", accent: "accent du midi", fetcher })).toBe("accent du midi");
  });
});
