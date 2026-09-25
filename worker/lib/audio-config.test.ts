import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import { getTtsModelConfig, isOpenRouterTtsModel, modelChainForMode, priceForModel } from "./audio-config";

const config = getTtsModelConfig({} as Env);

describe("modelChainForMode", () => {
  it("routes dialogues to 3.8 Flash through OpenRouter first, then 2.5 Pro on the Gemini API", () => {
    expect(modelChainForMode(config, "dialogue")).toEqual([
      { model: "google/gemini-3.8-flash-tts", pricePer1MTokens: 9 },
      { model: "gemini-2.5-pro-preview-tts", pricePer1MTokens: 20 },
    ]);
  });

  it("routes monologues to 3.8 Flash through OpenRouter first, then 2.5 Pro on the Gemini API", () => {
    expect(modelChainForMode(config, "monologue")).toEqual([
      { model: "google/gemini-3.8-flash-tts", pricePer1MTokens: 9 },
      { model: "gemini-2.5-pro-preview-tts", pricePer1MTokens: 20 },
    ]);
  });

  it("lets each mode's primary be overridden on its own", () => {
    const overridden = getTtsModelConfig({
      TTS_MODEL_DIALOGUE: "gemini-2.5-flash-preview-tts",
    } as Env);
    expect(modelChainForMode(overridden, "dialogue")[0].model).toBe("gemini-2.5-flash-preview-tts");
    expect(modelChainForMode(overridden, "monologue")[0].model).toBe("google/gemini-3.8-flash-tts");
  });

  it("does not duplicate the fallback when it equals the primary", () => {
    const collapsed = getTtsModelConfig({
      TTS_MODEL_DIALOGUE: "gemini-2.5-pro-preview-tts",
    } as Env);
    expect(modelChainForMode(collapsed, "dialogue")).toEqual([
      { model: "gemini-2.5-pro-preview-tts", pricePer1MTokens: 20 },
    ]);
  });
});

describe("priceForModel", () => {
  it("bills Pro at the higher rate, OpenRouter models at the OpenRouter rate, other Flash models at the lower rate", () => {
    expect(priceForModel(config, "gemini-2.5-pro-preview-tts")).toBe(20);
    expect(priceForModel(config, "google/gemini-3.8-flash-tts")).toBe(9);
    expect(priceForModel(config, "gemini-2.5-flash-preview-tts")).toBe(10);
    expect(priceForModel(config, "gemini-3.1-flash-tts-preview")).toBe(10);
  });
});

describe("isOpenRouterTtsModel", () => {
  it("tells OpenRouter ids from Gemini API ids by their vendor prefix", () => {
    expect(isOpenRouterTtsModel("google/gemini-3.8-flash-tts")).toBe(true);
    expect(isOpenRouterTtsModel("gemini-2.5-pro-preview-tts")).toBe(false);
  });
});
