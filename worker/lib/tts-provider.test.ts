import { describe, expect, it } from "vitest";
import { generateBlock, pcmFromAudioBytes, TtsProviderError } from "./tts-provider";
import { PCM_BYTES_PER_SECOND, type AudioDirection } from "./audio-config";
import { wavFromPcm } from "./audio-assembly";

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

const DIRECTION: AudioDirection = {
  level: "A2",
  accent: "Slow classroom French",
  pace: "Slow learner-friendly",
  style: "Warm and encouraging",
};

const OPENROUTER_MODEL = "google/gemini-3.8-flash-tts";

function pcmResponse(bytes: Uint8Array, contentType = "audio/pcm"): Response {
  return new Response(bytes, { headers: { "Content-Type": contentType } });
}

// Half a second of samples all set to `marker`, to see where a turn landed.
function markedPcm(marker: number): Uint8Array {
  return new Uint8Array(PCM_BYTES_PER_SECOND / 2).fill(marker);
}

interface SpeechBody {
  model: string;
  input: string;
  voice: string;
  response_format: string;
  provider?: { options: Record<string, { speech_metadata: { style: string } }> };
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
      script: "Synthesize this.",
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

  it("wraps the script in the 2.5 performance direction when one is given", async () => {
    const bodies: string[] = [];
    const fetcher: typeof fetch = async (_input, init) => {
      bodies.push(String(init?.body));
      return audioResponse(new Uint8Array(PCM_BYTES_PER_SECOND));
    };

    await generateBlock({
      apiKey: "test-key",
      model: "gemini-2.5-pro-preview-tts",
      mode: "monologue",
      script: "Bonjour tout le monde.",
      direction: DIRECTION,
      voices: { solo: "Kore" },
      fetcher,
      backoffMs: [0],
    });

    const body = JSON.parse(bodies[0]) as { contents: Array<{ parts: Array<{ text: string }> }> };
    const prompt = body.contents[0].parts[0].text;
    expect(prompt).toContain("DIRECTOR'S NOTES:");
    expect(prompt).toContain("TRANSCRIPT:\nBonjour tout le monde.");
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
      script: "Speaker 1: Hello\nSpeaker 2: Hi",
      voices: { "Speaker 1": "Kore", "Speaker 2": "Puck" },
      fetcher,
      backoffMs: [0, 0, 0],
    });

    expect(result.retryCount).toBe(1);
    expect(attempts).toBe(2);
    expect(result.durationSeconds).toBe(0.5);
  });

  it("retries gateway timeouts (524) before succeeding", async () => {
    let attempts = 0;
    const pcm = new Uint8Array(PCM_BYTES_PER_SECOND / 2);
    const fetcher: typeof fetch = async () => {
      attempts += 1;
      return attempts === 1
        ? new Response("upstream request timeout", { status: 524 })
        : audioResponse(pcm);
    };

    const result = await generateBlock({
      apiKey: "test-key",
      model: "test-model",
      mode: "monologue",
      script: "Synthesize this.",
      voices: { solo: "Kore" },
      fetcher,
      backoffMs: [0, 0, 0],
    });

    expect(result.retryCount).toBe(1);
    expect(attempts).toBe(2);
    expect(result.lastErrorStatus).toBe(524);
  });

  it("leaves lastErrorStatus undefined when nothing was retried", async () => {
    const pcm = new Uint8Array(PCM_BYTES_PER_SECOND);
    const fetcher: typeof fetch = async () => audioResponse(pcm);

    const result = await generateBlock({
      apiKey: "test-key",
      model: "test-model",
      mode: "monologue",
      script: "Synthesize this.",
      voices: { solo: "Kore" },
      fetcher,
      backoffMs: [0],
    });

    expect(result.lastErrorStatus).toBeUndefined();
  });

  it("fast-fails a 429 without backing off when the status is in fastFailStatuses", async () => {
    let attempts = 0;
    const fetcher: typeof fetch = async () => {
      attempts += 1;
      return Response.json({ error: { message: "quota" } }, { status: 429 });
    };

    await expect(generateBlock({
      apiKey: "test-key",
      model: "test-model",
      mode: "monologue",
      script: "Synthesize this.",
      voices: { solo: "Kore" },
      fetcher,
      backoffMs: [0, 0, 0],
      fastFailStatuses: [429],
    })).rejects.toMatchObject({ status: 429 });
    // No retries — the very first 429 breaks the loop.
    expect(attempts).toBe(1);
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
      script: "ambiguous",
      voices: { solo: "Kore" },
      fetcher,
      backoffMs: [0, 0, 0],
    })).rejects.toBeInstanceOf(TtsProviderError);
    expect(attempts).toBe(1);
  });
});

describe("generateBlock through OpenRouter", () => {
  it("sends a monologue as one speech request carrying its direction as speech_metadata", async () => {
    const calls: { input: RequestInfo | URL; init?: RequestInit }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ input, init });
      return pcmResponse(new Uint8Array(PCM_BYTES_PER_SECOND));
    };

    const result = await generateBlock({
      apiKey: "or-key",
      model: OPENROUTER_MODEL,
      mode: "monologue",
      script: "Bonjour à tous. [laughs] On commence ?",
      direction: DIRECTION,
      voices: { solo: "Kore" },
      fetcher,
      backoffMs: [0],
    });

    expect(calls).toHaveLength(1);
    expect(String(calls[0].input)).toBe("https://openrouter.ai/api/v1/audio/speech");
    expect(new Headers(calls[0].init?.headers).get("Authorization")).toBe("Bearer or-key");
    const body = JSON.parse(String(calls[0].init?.body)) as SpeechBody;
    expect(body).toMatchObject({
      model: OPENROUTER_MODEL,
      input: "Bonjour à tous. <laugh> On commence ?",
      voice: "Kore",
      response_format: "pcm",
    });
    const style = body.provider?.options["google-ai-studio"].speech_metadata.style;
    expect(style).toContain("Supportive, patient");
    expect(style).toContain("Accent: Slow classroom French.");
    expect(body.provider?.options["google-vertex"].speech_metadata.style).toBe(style);
    expect(result).toMatchObject({ durationSeconds: 1, retryCount: 0, model: OPENROUTER_MODEL });
  });

  it("voices a dialogue turn by turn, in order, with a pause between turns", async () => {
    const bodies: SpeechBody[] = [];
    const markers: Record<string, number> = { "Bonjour !": 1, "Salut, ça va ?": 2, "Très bien.": 3 };
    const fetcher: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as SpeechBody;
      bodies.push(body);
      return pcmResponse(markedPcm(markers[body.input]));
    };

    const result = await generateBlock({
      apiKey: "or-key",
      model: OPENROUTER_MODEL,
      mode: "dialogue",
      script: "Speaker 1: Bonjour !\nSpeaker 2: Salut, ça va ?\nSpeaker 1: Très bien.",
      direction: DIRECTION,
      voices: { "Speaker 1": "Kore", "Speaker 2": "Puck" },
      fetcher,
      backoffMs: [0],
    });

    expect(bodies.map((body) => [body.voice, body.input])).toEqual([
      ["Kore", "Bonjour !"],
      ["Puck", "Salut, ça va ?"],
      ["Kore", "Très bien."],
    ]);
    const turn = PCM_BYTES_PER_SECOND / 2;
    const gap = PCM_BYTES_PER_SECOND * 0.3;
    expect(result.pcm.byteLength).toBe(3 * turn + 2 * gap);
    expect([result.pcm[0], result.pcm[turn], result.pcm[turn + gap], result.pcm[2 * (turn + gap)]])
      .toEqual([1, 0, 2, 3]);
    expect(result.durationSeconds).toBeCloseTo(2.1, 5);
  });

  it("gives a manner tag's sentence its own request, with no pause inside the turn", async () => {
    const bodies: SpeechBody[] = [];
    const fetcher: typeof fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as SpeechBody);
      return pcmResponse(markedPcm(1));
    };

    const result = await generateBlock({
      apiKey: "or-key",
      model: OPENROUTER_MODEL,
      mode: "monologue",
      script: "Je suis là. [whispers] Ne dis rien.",
      direction: DIRECTION,
      voices: { solo: "Kore" },
      fetcher,
      backoffMs: [0],
    });

    expect(bodies.map((body) => body.input)).toEqual(["Je suis là.", "Ne dis rien."]);
    expect(bodies[1].provider?.options["google-ai-studio"].speech_metadata.style).toMatch(/^Whispering\. /);
    expect(result.pcm.byteLength).toBe(PCM_BYTES_PER_SECOND);
  });

  it("strips a WAV header from the returned audio", async () => {
    const pcm = markedPcm(7);
    const fetcher: typeof fetch = async () => pcmResponse(wavFromPcm(pcm), "audio/wav");

    const result = await generateBlock({
      apiKey: "or-key",
      model: OPENROUTER_MODEL,
      mode: "monologue",
      script: "Bonjour.",
      voices: { solo: "Kore" },
      fetcher,
      backoffMs: [0],
    });

    expect(result.pcm).toEqual(pcm);
  });

  it("refuses PCM announced at another sample rate", async () => {
    const fetcher: typeof fetch = async () => pcmResponse(markedPcm(1), "audio/pcm; rate=16000");

    await expect(generateBlock({
      apiKey: "or-key",
      model: OPENROUTER_MODEL,
      mode: "monologue",
      script: "Bonjour.",
      voices: { solo: "Kore" },
      fetcher,
      backoffMs: [0],
    })).rejects.toMatchObject({ retryable: false, message: "Unexpected audio sample rate: 16000 Hz." });
  });

  it("does not retry a spent balance (402), so the chain can fall back at once", async () => {
    let attempts = 0;
    const fetcher: typeof fetch = async () => {
      attempts += 1;
      return Response.json({ error: { code: 402, message: "Insufficient credits" } }, { status: 402 });
    };

    await expect(generateBlock({
      apiKey: "or-key",
      model: OPENROUTER_MODEL,
      mode: "monologue",
      script: "Bonjour.",
      voices: { solo: "Kore" },
      fetcher,
      backoffMs: [0, 0, 0],
    })).rejects.toMatchObject({ status: 402, retryable: false, message: "Insufficient credits" });
    expect(attempts).toBe(1);
  });

  it("fast-fails a 429 when the status is in fastFailStatuses", async () => {
    let attempts = 0;
    const fetcher: typeof fetch = async () => {
      attempts += 1;
      return Response.json({ error: { message: "Rate limit exceeded" } }, { status: 429 });
    };

    await expect(generateBlock({
      apiKey: "or-key",
      model: OPENROUTER_MODEL,
      mode: "dialogue",
      script: "Speaker 1: Bonjour !\nSpeaker 2: Salut !",
      voices: { "Speaker 1": "Kore", "Speaker 2": "Puck" },
      fetcher,
      backoffMs: [0, 0, 0],
      fastFailStatuses: [429],
    })).rejects.toMatchObject({ status: 429 });
    // Both turns were already in flight; neither was retried.
    expect(attempts).toBe(2);
  });

  it("retries a JSON error served behind a 200", async () => {
    let attempts = 0;
    const fetcher: typeof fetch = async () => {
      attempts += 1;
      return attempts === 1
        ? Response.json({ error: { message: "Upstream error" } })
        : pcmResponse(new Uint8Array(PCM_BYTES_PER_SECOND));
    };

    const result = await generateBlock({
      apiKey: "or-key",
      model: OPENROUTER_MODEL,
      mode: "monologue",
      script: "Bonjour.",
      voices: { solo: "Kore" },
      fetcher,
      backoffMs: [0, 0, 0],
    });

    expect(attempts).toBe(2);
    expect(result.retryCount).toBe(1);
  });
});

describe("pcmFromAudioBytes", () => {
  it("returns headerless PCM trimmed to whole samples", () => {
    expect(pcmFromAudioBytes(new Uint8Array([1, 2, 3, 4, 5]))).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("refuses a WAV in another sample rate", () => {
    const wav = wavFromPcm(new Uint8Array(8));
    new DataView(wav.buffer).setUint32(24, 44_100, true);
    expect(() => pcmFromAudioBytes(wav)).toThrow(TtsProviderError);
  });
});
