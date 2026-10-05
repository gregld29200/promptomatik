import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AudioJob } from "@/lib/api";
import { GenerationConsole } from "./generation-console";

// Segments as the worker stores them: names already rewritten to voice slots.
const job: AudioJob = {
  id: "job-1",
  mode: "dialogue",
  quality: "draft",
  title: null,
  script: "Chloé : Salut !\nYanis : Bonjour.",
  direction: { level: "B1", accent: "france", pace: "natural", style: "conversational" },
  voices: { "Speaker 1": "Kore", "Speaker 2": "Puck" },
  status: "generating",
  estimatedSeconds: 10,
  actualSeconds: null,
  error: null,
  modelUsed: null,
  genMs: null,
  retryCount: 0,
  apiCostUsd: null,
  expiresAt: null,
  createdAt: "2026-10-04T10:00:00Z",
  segments: [
    { idx: 0, text: "Speaker 1: Salut !\nSpeaker 2: Bonjour.", status: "pending", durationSeconds: null, retryCount: 0 },
  ],
};

describe("GenerationConsole", () => {
  it("names the character whose voice is being generated", () => {
    const markup = renderToStaticMarkup(
      <GenerationConsole job={job} elapsedSeconds={3} slotNames={{ "Speaker 1": "Chloé", "Speaker 2": "Yanis" }} />
    );
    expect(markup).toContain("Bloc 1/1 - voix de Chloé");
    expect(markup).not.toContain("locuteur");
  });

  it("falls back to the numbered speaker when the character has no name", () => {
    const markup = renderToStaticMarkup(<GenerationConsole job={job} elapsedSeconds={3} />);
    expect(markup).toContain("Bloc 1/1 - voix de locuteur 1");
  });
});
