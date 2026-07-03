import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import { getTtsModelConfig, modelChainForMode, priceForModel } from "./audio-config";

const config = getTtsModelConfig({} as Env);

describe("modelChainForMode", () => {
  it("routes dialogues to Pro first, then the 2.5 Flash fallback", () => {
    expect(modelChainForMode(config, "dialogue")).toEqual([
      { model: "gemini-2.5-pro-preview-tts", pricePer1MTokens: 20 },
      { model: "gemini-2.5-flash-preview-tts", pricePer1MTokens: 10 },
    ]);
  });

  it("routes monologues to 3.1 Flash first, then the 2.5 Flash fallback", () => {
    expect(modelChainForMode(config, "monologue")).toEqual([
      { model: "gemini-3.1-flash-tts-preview", pricePer1MTokens: 10 },
      { model: "gemini-2.5-flash-preview-tts", pricePer1MTokens: 10 },
    ]);
  });

  it("does not duplicate the fallback when it equals the primary", () => {
    const collapsed = getTtsModelConfig({
      TTS_MODEL_MONOLOGUE: "gemini-2.5-flash-preview-tts",
    } as Env);
    expect(modelChainForMode(collapsed, "monologue")).toEqual([
      { model: "gemini-2.5-flash-preview-tts", pricePer1MTokens: 10 },
    ]);
  });
});

describe("priceForModel", () => {
  it("bills only the Pro model at the higher rate", () => {
    expect(priceForModel(config, "gemini-2.5-pro-preview-tts")).toBe(20);
    expect(priceForModel(config, "gemini-2.5-flash-preview-tts")).toBe(10);
    expect(priceForModel(config, "gemini-3.1-flash-tts-preview")).toBe(10);
  });
});
