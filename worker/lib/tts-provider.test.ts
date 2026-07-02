import { describe, expect, it } from "vitest";
import { generateBlock, TtsProviderError } from "./tts-provider";
import { PCM_BYTES_PER_SECOND } from "./audio-config";

function audioResponse(bytes: Uint8Array): Response {
  return Response.json({
    candidates: [
      {
        content: {
          parts: [
            {
              inlineData: {
                data: btoa(String.fromCharCode(...bytes)),
              },
            },
          ],
        },
      },
    ],
  });
}

function textResponse(): Response {
  return Response.json({
    candidates: [{ content: { parts: [{ text: "not audio" }] } }],
  });
}

describe("generateBlock", () => {
  it("builds a generateContent request and returns PCM duration", async () => {
    const calls: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    const pcm = new Uint8Array(PCM_BYTES_PER_SECOND);
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ input, init });
      return audioResponse(pcm);
    };

    const result = await generateBlock({
      apiKey: "test-key",
      model: "test-model",
      mode: "monologue",
      prompt: "Synthesize this.",
      voices: { solo: "Kore" },
      fetcher,
      backoffMs: [0],
    });

    expect(result.durationSeconds).toBe(1);
    expect(result.retryCount).toBe(0);
    const body = JSON.parse(String(calls[0].init?.body)) as {
      generationConfig: { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } } };
    };
    expect(String(calls[0].input)).toContain("/v1beta/models/test-model:generateContent");
    expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Kore");
  });

  it("retries text-token responses before succeeding", async () => {
    let attempts = 0;
    const pcm = new Uint8Array(PCM_BYTES_PER_SECOND / 2);
    const fetcher: typeof fetch = async () => {
      attempts += 1;
      return attempts === 1 ? textResponse() : audioResponse(pcm);
    };

    const result = await generateBlock({
      apiKey: "test-key",
      model: "test-model",
      mode: "dialogue",
      prompt: "Speaker 1: Hello\nSpeaker 2: Hi",
      voices: { "Speaker 1": "Kore", "Speaker 2": "Puck" },
      fetcher,
      backoffMs: [0, 0, 0],
    });

    expect(result.retryCount).toBe(1);
    expect(attempts).toBe(2);
    expect(result.durationSeconds).toBe(0.5);
  });

  it("does not retry prohibited content", async () => {
    let attempts = 0;
    const fetcher: typeof fetch = async () => {
      attempts += 1;
      return Response.json({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } }, { status: 400 });
    };

    await expect(generateBlock({
      apiKey: "test-key",
      model: "test-model",
      mode: "monologue",
      prompt: "ambiguous",
      voices: { solo: "Kore" },
      fetcher,
      backoffMs: [0, 0, 0],
    })).rejects.toBeInstanceOf(TtsProviderError);
    expect(attempts).toBe(1);
  });
});
