import { describe, expect, it } from "vitest";
import type { Env } from "../../env";
import { DEEPGRAM_MODEL, deepgramProvider, normaliseDeepgramTranscript } from "./deepgram";
import {
  buildProvider,
  isTranscriptionProviderConfigured,
  planTranscriptionRoute,
  selectTranscriptionProvider,
} from "./index";
import {
  TRANSCRIPTION_MAX_SOURCE_SECONDS,
  TRANSCRIPTION_MAX_UPLOAD_BYTES,
  isTranscriptionError,
  type TranscriptionAudioSource,
  type TranscriptionFailure,
} from "./types";

// NOTE ON FIXTURES: no Deepgram API key exists in this environment, so nothing
// below was captured from a live call. These payloads are HANDWRITTEN to the
// documented shape of the pre-recorded `/v1/listen` response (metadata +
// results.channels[0].alternatives[0].words[] with punctuated_word, speaker and
// per-word language from nova-3 `language=multi`). They prove our normalisation
// and error handling, not Deepgram's accuracy.

interface FixtureWord {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  confidence?: number;
  speaker?: number;
  language?: string;
}

function fixtureResponse(words: FixtureWord[], overrides: { duration?: number; channels?: number } = {}) {
  return {
    metadata: {
      request_id: "9f2c1e64-7a55-4f0b-8d1a-2c8a0f6b31d4",
      sha256: "1c9d…",
      created: "2026-08-09T09:14:22.118Z",
      duration: overrides.duration ?? 4.51,
      channels: overrides.channels ?? 1,
      models: ["nova-3"],
    },
    results: {
      channels: [
        {
          detected_language: "multi",
          alternatives: [
            {
              transcript: words.map((word) => word.punctuated_word ?? word.word).join(" "),
              confidence: 0.9912,
              words,
            },
          ],
        },
      ],
    },
  };
}

/** Two speakers, French and English inside one file. */
const MULTILINGUAL_WORDS: FixtureWord[] = [
  { word: "bonjour", punctuated_word: "Bonjour", start: 0.08, end: 0.56, confidence: 0.9987, speaker: 0, language: "fr" },
  { word: "tout", punctuated_word: "tout", start: 0.56, end: 0.8, confidence: 0.9931, speaker: 0, language: "fr" },
  { word: "le", punctuated_word: "le", start: 0.8, end: 0.96, confidence: 0.9954, speaker: 0, language: "fr" },
  { word: "monde", punctuated_word: "monde.", start: 0.96, end: 1.44, confidence: 0.9902, speaker: 0, language: "fr" },
  { word: "hello", punctuated_word: "Hello", start: 1.72, end: 2.1, confidence: 0.988, speaker: 1, language: "en" },
  { word: "everyone", punctuated_word: "everyone.", start: 2.1, end: 2.86, confidence: 0.9765, speaker: 1, language: "en" },
  { word: "alors", punctuated_word: "Alors,", start: 3.02, end: 3.44, confidence: 0.9812, speaker: 0, language: "fr" },
  { word: "on", punctuated_word: "on", start: 3.44, end: 3.58, confidence: 0.9899, speaker: 0, language: "fr" },
  { word: "commence", punctuated_word: "commence.", start: 3.58, end: 4.22, confidence: 0.993, speaker: 0, language: "fr" },
];

function envWith(keys: Partial<Pick<Env, "DEEPGRAM_API_KEY" | "GROQ_API_KEY">>): Env {
  return keys as unknown as Env;
}

const DEEPGRAM_ENV = envWith({ DEEPGRAM_API_KEY: "dg-test-key" });

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

function recordingFetcher(response: () => Response | Promise<Response>): {
  calls: RecordedCall[];
  fetcher: typeof fetch;
} {
  const calls: RecordedCall[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return response();
  };
  return { calls, fetcher };
}

async function failureFrom(run: () => Promise<unknown>): Promise<TranscriptionFailure> {
  try {
    await run();
  } catch (error) {
    if (isTranscriptionError(error)) return error.failure;
    throw error;
  }
  throw new Error("Expected a TranscriptionError, but the call resolved.");
}

/**
 * An uploaded-media source. Ingest hands the provider a `Blob` (one copy of the
 * media, never two) plus R2's own object size, so a test that only cares about
 * the size gate can declare `sizeBytes` without allocating that many bytes.
 */
function bytesAudio(options: {
  payload?: Uint8Array;
  sizeBytes?: number;
  contentType: string;
  filename: string;
}): TranscriptionAudioSource {
  const payload = options.payload ?? new Uint8Array(0);
  return {
    kind: "bytes",
    blob: new Blob([payload], { type: options.contentType }),
    sizeBytes: options.sizeBytes ?? payload.byteLength,
    contentType: options.contentType,
    filename: options.filename,
  };
}

describe("deepgram request shape", () => {
  it("asks for nova-3 multilingual with diarization and single-channel billing", async () => {
    const { calls, fetcher } = recordingFetcher(() => Response.json(fixtureResponse(MULTILINGUAL_WORDS)));

    await deepgramProvider(DEEPGRAM_ENV).submit({
      audio: { kind: "url", url: "https://cdn.example.com/episode-12.mp3" },
      diarize: true,
      fetcher,
    });

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe("https://api.deepgram.com/v1/listen");
    expect(url.searchParams.get("model")).toBe("nova-3");
    expect(url.searchParams.get("language")).toBe("multi");
    expect(url.searchParams.get("diarize")).toBe("true");
    expect(url.searchParams.get("smart_format")).toBe("true");
    expect(url.searchParams.get("punctuate")).toBe("true");
  });

  it("does not diarize a job that did not ask for speakers", async () => {
    // Hard-coding diarize=true made the SHAPE of the answer depend on which tier
    // the cascade happened to reach: labelled from Deepgram, unlabelled from Groq,
    // for the same plain request. `transcription_jobs.diarization` then recorded
    // which provider ran instead of what the teacher asked for.
    const { calls, fetcher } = recordingFetcher(() => Response.json(fixtureResponse(MULTILINGUAL_WORDS)));

    await deepgramProvider(DEEPGRAM_ENV).submit({
      audio: { kind: "url", url: "https://cdn.example.com/lecture.mp3" },
      diarize: false,
      fetcher,
    });

    expect(new URL(calls[0].url).searchParams.get("diarize")).toBe("false");
  });

  it("sends multichannel=false explicitly so a stereo podcast is never billed twice", async () => {
    const { calls, fetcher } = recordingFetcher(() => Response.json(fixtureResponse(MULTILINGUAL_WORDS)));

    await deepgramProvider(DEEPGRAM_ENV).submit({
      audio: { kind: "url", url: "https://cdn.example.com/stereo.mp3" },
      diarize: true,
      fetcher,
    });

    const url = new URL(calls[0].url);
    // Explicit, not defaulted: multichannel=true bills every channel separately.
    expect(url.searchParams.get("multichannel")).toBe("false");
  });

  it("authenticates with the Token scheme and posts a JSON url body", async () => {
    const { calls, fetcher } = recordingFetcher(() => Response.json(fixtureResponse(MULTILINGUAL_WORDS)));

    await deepgramProvider(DEEPGRAM_ENV).submit({
      audio: { kind: "url", url: "https://cdn.example.com/episode-12.mp3" },
      diarize: true,
      fetcher,
    });

    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Token dg-test-key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      url: "https://cdn.example.com/episode-12.mp3",
    });
  });

  it("carries a wall-clock deadline, so a stalled provider cannot hold the consumer", async () => {
    // Without a signal, a provider that accepts the connection and then goes quiet
    // holds the queue consumer until the platform kills the isolate — and the
    // redelivered message would be a second billed submission.
    const { calls, fetcher } = recordingFetcher(() => Response.json(fixtureResponse(MULTILINGUAL_WORDS)));

    await deepgramProvider(DEEPGRAM_ENV).submit({
      audio: { kind: "url", url: "https://cdn.example.com/episode-12.mp3" },
      diarize: true,
      fetcher,
    });

    const signal = calls[0].init?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });

  it("reports an aborted request as provider_unavailable, never as the teacher's fault", async () => {
    const fetcher: typeof fetch = async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    };
    const failure = await failureFrom(() =>
      deepgramProvider(DEEPGRAM_ENV).submit({
        audio: { kind: "url", url: "https://cdn.example.com/episode-12.mp3" },
        diarize: true,
        fetcher,
      })
    );
    expect(failure).toEqual({ code: "provider_unavailable", provider: "deepgram" });
  });

  it("posts uploaded bytes raw with the media content type", async () => {
    const { calls, fetcher } = recordingFetcher(() => Response.json(fixtureResponse(MULTILINGUAL_WORDS)));
    const audio = bytesAudio({
      payload: new Uint8Array([0x49, 0x44, 0x33, 0x04]),
      contentType: "audio/mpeg",
      filename: "cours.mp3",
    });

    await deepgramProvider(DEEPGRAM_ENV).submit({ audio, diarize: true, fetcher });

    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("audio/mpeg");
    // The very Blob ingest read out of R2, sent without a second copy of it.
    if (audio.kind !== "bytes") throw new Error("expected an uploaded source");
    expect(calls[0].init?.body).toBe(audio.blob);
  });

  it("falls back to a generic content type when the upload has none", async () => {
    const { calls, fetcher } = recordingFetcher(() => Response.json(fixtureResponse(MULTILINGUAL_WORDS)));

    await deepgramProvider(DEEPGRAM_ENV).submit({
      audio: bytesAudio({ payload: new Uint8Array(4), contentType: "", filename: "cours" }),
      diarize: true,
      fetcher,
    });

    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/octet-stream");
  });

  it("keeps language=multi even when the caller passes a hint", async () => {
    const { calls, fetcher } = recordingFetcher(() => Response.json(fixtureResponse(MULTILINGUAL_WORDS)));

    await deepgramProvider(DEEPGRAM_ENV).submit({
      audio: { kind: "url", url: "https://cdn.example.com/episode-12.mp3" },
      diarize: true,
      languageHint: "fr",
      fetcher,
    });

    // Narrowing to one language would degrade a code-switching classroom clip.
    expect(new URL(calls[0].url).searchParams.get("language")).toBe("multi");
  });

  it("returns a ready handle carrying the provider request id", async () => {
    const { fetcher } = recordingFetcher(() => Response.json(fixtureResponse(MULTILINGUAL_WORDS)));

    const handle = await deepgramProvider(DEEPGRAM_ENV).submit({
      audio: { kind: "url", url: "https://cdn.example.com/episode-12.mp3" },
      diarize: true,
      fetcher,
    });

    expect(handle.provider).toBe("deepgram");
    expect(handle.model).toBe(DEEPGRAM_MODEL);
    expect(handle.ready).toBe(true);
    expect(handle.providerJobId).toBe("9f2c1e64-7a55-4f0b-8d1a-2c8a0f6b31d4");
  });
});

describe("deepgram normalisation", () => {
  const transcript = normaliseDeepgramTranscript(fixtureResponse(MULTILINGUAL_WORDS));

  it("groups consecutive same-speaker words into one turn each", () => {
    expect(transcript.segments).toHaveLength(3);
    expect(transcript.segments.map((segment) => segment.speaker)).toEqual(["0", "1", "0"]);
    expect(transcript.segments.map((segment) => segment.words.length)).toEqual([4, 2, 3]);
    expect(transcript.segments.map((segment) => segment.idx)).toEqual([0, 1, 2]);
  });

  it("bounds each turn by its own first and last word", () => {
    expect(transcript.segments[0].start).toBeCloseTo(0.08, 5);
    expect(transcript.segments[0].end).toBeCloseTo(1.44, 5);
    expect(transcript.segments[1].start).toBeCloseTo(1.72, 5);
    expect(transcript.segments[2].end).toBeCloseTo(4.22, 5);
  });

  it("preserves smart_format punctuation and capitalisation", () => {
    expect(transcript.segments[0].text).toBe("Bonjour tout le monde.");
    expect(transcript.segments[2].text).toBe("Alors, on commence.");
    expect(transcript.text).toBe("Bonjour tout le monde.\n\nHello everyone.\n\nAlors, on commence.");
  });

  it("passes per-word confidence straight through, without rounding", () => {
    expect(transcript.segments[0].words.map((word) => word.confidence)).toEqual([
      0.9987, 0.9931, 0.9954, 0.9902,
    ]);
    expect(transcript.segments[1].words[1].confidence).toBe(0.9765);
  });

  it("maps Deepgram integer speakers to stable string ids ordered by first appearance", () => {
    expect(transcript.speakers.map((speaker) => speaker.id)).toEqual(["0", "1"]);
    expect(transcript.speakers.map((speaker) => speaker.index)).toEqual([0, 1]);
    expect(transcript.speakers.map((speaker) => speaker.label)).toEqual(["speaker_0", "speaker_1"]);
    // Sum of each word's own duration: 0.48 + 0.24 + 0.16 + 0.48 for the first
    // turn, 0.42 + 0.14 + 0.64 for the third. This fixture is word-contiguous
    // inside every turn, so it cannot tell speaking time from wall clock — the
    // silence test below is the one that pins the definition down.
    expect(transcript.speakers[0].seconds).toBeCloseTo(2.56, 5);
    expect(transcript.speakers[1].seconds).toBeCloseTo(1.14, 5);
  });

  it("counts spoken seconds only, never the silence sitting inside a turn", () => {
    // A teacher says one word, writes on the board for twenty seconds, says one
    // more. buildSegments only cuts a same-speaker run after 90 words AND a
    // pause, so both words stay in ONE segment whose span is 20.4 s. Reading the
    // span as speaking time told the teacher they spoke for 20 seconds when they
    // spoke for 0.8 — a 25x inflation of a number the transcript view renders.
    const withSilence = normaliseDeepgramTranscript(
      fixtureResponse(
        [
          { word: "alors", punctuated_word: "Alors...", start: 0, end: 0.4, speaker: 0, language: "fr" },
          { word: "voilà", punctuated_word: "voilà.", start: 20, end: 20.4, speaker: 0, language: "fr" },
        ],
        { duration: 21 }
      )
    );

    expect(withSilence.segments).toHaveLength(1);
    expect(withSilence.segments[0].end - withSilence.segments[0].start).toBeCloseTo(20.4, 5);
    expect(withSilence.speakers).toHaveLength(1);
    expect(withSilence.speakers[0].seconds).toBeCloseTo(0.8, 5);
  });

  it("keeps each speaker's own silences out of the other speaker's total", () => {
    // Interleaved turns with long gaps on both sides: neither total may absorb a
    // gap, and the order of first appearance must survive.
    const conversation = normaliseDeepgramTranscript(
      fixtureResponse(
        [
          { word: "oui", start: 0, end: 0.5, speaker: 0, language: "fr" },
          { word: "hmm", start: 10, end: 10.5, speaker: 1, language: "fr" },
          { word: "donc", start: 30, end: 30.25, speaker: 0, language: "fr" },
          { word: "exact", start: 60, end: 61, speaker: 1, language: "fr" },
        ],
        { duration: 62 }
      )
    );

    expect(conversation.speakers.map((speaker) => speaker.id)).toEqual(["0", "1"]);
    expect(conversation.speakers[0].seconds).toBeCloseTo(0.75, 5);
    expect(conversation.speakers[1].seconds).toBeCloseTo(1.5, 5);
    // The media is 62 s long; the two of them spoke for 2.25 s of it.
    expect(conversation.metadata.durationSeconds).toBe(62);
  });

  it("carries every detected language, most-spoken first", () => {
    expect(transcript.metadata.detectedLanguages).toEqual(["fr", "en"]);
    expect(transcript.segments.map((segment) => segment.language)).toEqual(["fr", "en", "fr"]);
  });

  it("records diarization, speaker count, duration and a single billed channel", () => {
    expect(transcript.metadata.provider).toBe("deepgram");
    expect(transcript.metadata.model).toBe("nova-3");
    expect(transcript.metadata.providerJobId).toBe("9f2c1e64-7a55-4f0b-8d1a-2c8a0f6b31d4");
    expect(transcript.metadata.diarization).toBe(true);
    expect(transcript.metadata.speakerCount).toBe(2);
    expect(transcript.metadata.durationSeconds).toBeCloseTo(4.51, 5);
    expect(transcript.metadata.channels).toBe(1);
  });

  it("uses the bare word when smart_format gave no punctuated form", () => {
    const plain = normaliseDeepgramTranscript(
      fixtureResponse([{ word: "salut", start: 0, end: 0.4, speaker: 0, language: "fr" }])
    );
    expect(plain.text).toBe("salut");
    expect(plain.segments[0].words[0].confidence).toBeNull();
  });

  it("reports no speakers when the payload was not diarized", () => {
    const undiarized = normaliseDeepgramTranscript(
      fixtureResponse([
        { word: "bonjour", punctuated_word: "Bonjour", start: 0.1, end: 0.5, confidence: 0.99, language: "fr" },
        { word: "monde", punctuated_word: "monde.", start: 0.5, end: 0.9, confidence: 0.98, language: "fr" },
      ])
    );

    expect(undiarized.metadata.diarization).toBe(false);
    expect(undiarized.metadata.speakerCount).toBeNull();
    expect(undiarized.speakers).toEqual([]);
    // One rendering path for both providers: still segmented, just speaker-less.
    expect(undiarized.segments).toHaveLength(1);
    expect(undiarized.segments[0].speaker).toBeNull();
  });

  it("falls back to a concrete channel language, never the literal \"multi\"", () => {
    const noWordLanguages = normaliseDeepgramTranscript({
      metadata: { request_id: "abc", duration: 1, channels: 1 },
      results: {
        channels: [
          {
            detected_language: "multi",
            alternatives: [{ transcript: "Bonjour", words: [{ word: "bonjour", start: 0, end: 0.5 }] }],
          },
        ],
      },
    });
    expect(noWordLanguages.metadata.detectedLanguages).toEqual([]);

    const concrete = normaliseDeepgramTranscript({
      metadata: { request_id: "abc", duration: 1, channels: 1 },
      results: {
        channels: [
          {
            detected_language: "es",
            alternatives: [{ transcript: "Hola", words: [{ word: "hola", start: 0, end: 0.5 }] }],
          },
        ],
      },
    });
    expect(concrete.metadata.detectedLanguages).toEqual(["es"]);
  });

  it("accepts a silent recording as an empty transcript, not a failure", () => {
    const empty = normaliseDeepgramTranscript(fixtureResponse([], { duration: 12 }));
    expect(empty.segments).toEqual([]);
    expect(empty.text).toBe("");
    expect(empty.metadata.durationSeconds).toBe(12);
    expect(empty.metadata.diarization).toBe(false);
  });

  it("derives the duration from the last word when metadata has none", () => {
    const transcriptWithoutDuration = normaliseDeepgramTranscript({
      metadata: { request_id: "abc", channels: 1 },
      results: {
        channels: [{ alternatives: [{ words: [{ word: "salut", start: 0.2, end: 3.75, speaker: 0 }] }] }],
      },
    });
    expect(transcriptWithoutDuration.metadata.durationSeconds).toBeCloseTo(3.75, 5);
  });

  it("breaks a very long single-speaker turn into readable segments", () => {
    const words: FixtureWord[] = Array.from({ length: 120 }, (_, index) => ({
      word: `mot${index}`,
      start: index * 0.3,
      end: index * 0.3 + 0.2,
      speaker: 0,
      language: "fr",
    }));
    // A one-second breath after the 95th word gives the grouper a place to cut.
    words[95].start = words[94].end + 1;
    words[95].end = words[95].start + 0.2;
    for (let index = 96; index < words.length; index += 1) {
      words[index].start = words[index - 1].end + 0.05;
      words[index].end = words[index].start + 0.2;
    }

    const long = normaliseDeepgramTranscript(fixtureResponse(words, { duration: 60 }));
    expect(long.segments.length).toBeGreaterThan(1);
    expect(long.segments.every((segment) => segment.speaker === "0")).toBe(true);
    expect(long.speakers).toHaveLength(1);
    // 120 words of 0.2 s each. The turn covers ~37 s of wall clock — a 0.1 s gap
    // between every word plus the one-second breath — and none of that is speech.
    expect(long.speakers[0].seconds).toBeCloseTo(24, 5);
    const wallClock = long.segments.reduce((total, segment) => total + (segment.end - segment.start), 0);
    expect(wallClock).toBeGreaterThan(30);
  });
});

describe("deepgram failures", () => {
  it("treats a rejected key as provider_unavailable, not a request error", async () => {
    const { fetcher } = recordingFetcher(() => new Response("Unauthorized", { status: 401 }));

    const failure = await failureFrom(() =>
      deepgramProvider(DEEPGRAM_ENV).submit({
        audio: { kind: "url", url: "https://cdn.example.com/a.mp3" },
        diarize: true,
        fetcher,
      })
    );

    expect(failure).toEqual({ code: "provider_unavailable", provider: "deepgram", status: 401 });
  });

  it("treats rate limiting and outages as provider_unavailable", async () => {
    for (const status of [429, 503]) {
      const { fetcher } = recordingFetcher(() => new Response("nope", { status }));
      const failure = await failureFrom(() =>
        deepgramProvider(DEEPGRAM_ENV).submit({
          audio: { kind: "url", url: "https://cdn.example.com/a.mp3" },
          diarize: true,
          fetcher,
        })
      );
      expect(failure).toEqual({ code: "provider_unavailable", provider: "deepgram", status });
    }
  });

  it("keeps the provider message on a 400 we caused as loggable detail", async () => {
    const { fetcher } = recordingFetcher(() =>
      Response.json(
        {
          err_code: "INVALID_QUERY_PARAMETER",
          err_msg: "diarize must be a boolean",
          request_id: "3a1f9c02-55e1-4d7a-9b0e-6c1d2f4b8a77",
        },
        { status: 400 }
      )
    );

    const failure = await failureFrom(() =>
      deepgramProvider(DEEPGRAM_ENV).submit({
        audio: { kind: "url", url: "https://cdn.example.com/a.mp3" },
        diarize: true,
        fetcher,
      })
    );

    // A bad query parameter is our bug, not the teacher's link or file.
    expect(failure.code).toBe("provider_failed");
    if (failure.code !== "provider_failed") throw new Error("narrowing");
    expect(failure.provider).toBe("deepgram");
    expect(failure.status).toBe(400);
    expect(failure.detail).toBe("diarize must be a boolean");
  });

  it("reports REMOTE_CONTENT_ERROR as an unreachable source, not our provider's fault", async () => {
    const { fetcher } = recordingFetcher(() =>
      Response.json(
        {
          err_code: "REMOTE_CONTENT_ERROR",
          err_msg: "Failed to fetch the remote content. Please verify the URL is publicly accessible.",
          request_id: "d4b0f1a2-9c3e-4f58-8a17-0b6e5c2d9f31",
        },
        { status: 400 }
      )
    );

    const failure = await failureFrom(() =>
      deepgramProvider(DEEPGRAM_ENV).submit({
        audio: { kind: "url", url: "https://cdn.example.com/private.mp3" },
        diarize: true,
        fetcher,
      })
    );

    // Our ingest HEADs the URL from a Worker; Deepgram fetches it from its own
    // network. A CDN that refused Deepgram is the teacher's link to fix.
    expect(failure).toEqual({ code: "source_unreachable", status: 400 });
  });

  it("recognises the remote-content sentence even without an err_code", async () => {
    const { fetcher } = recordingFetcher(() =>
      Response.json({ err_msg: "Could not retrieve the remote content." }, { status: 400 })
    );

    const failure = await failureFrom(() =>
      deepgramProvider(DEEPGRAM_ENV).submit({
        audio: { kind: "url", url: "https://cdn.example.com/expired.mp3" },
        diarize: true,
        fetcher,
      })
    );

    expect(failure).toEqual({ code: "source_unreachable", status: 400 });
  });

  it("reports corrupt or unreadable media as an unsupported media type", async () => {
    const { fetcher } = recordingFetcher(() =>
      Response.json(
        {
          err_code: "Bad Request",
          err_msg: "failed to process audio: corrupt or unsupported data",
          request_id: "b7c8d9e0-1f2a-4b3c-8d5e-6f7a8b9c0d1e",
        },
        { status: 400 }
      )
    );

    const failure = await failureFrom(() =>
      deepgramProvider(DEEPGRAM_ENV).submit({
        audio: bytesAudio({ payload: new Uint8Array(8), contentType: "audio/x-weird", filename: "cours.dat" }),
        diarize: true,
        fetcher,
      })
    );

    expect(failure).toEqual({ code: "unsupported_media_type", contentType: "audio/x-weird" });
  });

  it.each([
    [
      "an explicit server err_code",
      { err_code: "INTERNAL_SERVER_ERROR", err_msg: "failed to process audio", request_id: "e1" },
      500,
    ],
    [
      "no err_code at all",
      { err_msg: "failed to process audio: corrupt or unsupported data", request_id: "e2" },
      502,
    ],
    ["a body that mentions remote content", { err_msg: "remote content pipeline error", request_id: "e3" }, 503],
  ])("treats a 5xx outage with %s as provider_unavailable, never a corrupt file", async (_label, body, status) => {
    const { fetcher } = recordingFetcher(() => Response.json(body, { status }));

    const failure = await failureFrom(() =>
      deepgramProvider(DEEPGRAM_ENV).submit({
        audio: bytesAudio({ payload: new Uint8Array(8), contentType: "audio/mpeg", filename: "cours.mp3" }),
        diarize: true,
        fetcher,
      })
    );

    // Deepgram's own outage prose mentions audio processing. Blaming the
    // teacher's file would fail the job for good, when a retry would work.
    expect(failure).toEqual({ code: "provider_unavailable", provider: "deepgram", status });
  });

  it("still trusts an explicit REMOTE_CONTENT_ERROR code whatever status carried it", async () => {
    const { fetcher } = recordingFetcher(() =>
      Response.json({ err_code: "REMOTE_CONTENT_ERROR", err_msg: "Failed to fetch the remote content." }, { status: 500 })
    );

    const failure = await failureFrom(() =>
      deepgramProvider(DEEPGRAM_ENV).submit({
        audio: { kind: "url", url: "https://cdn.example.com/private.mp3" },
        diarize: true,
        fetcher,
      })
    );

    // The one deliberate cross-status override: the code names the link, not us.
    expect(failure).toEqual({ code: "source_unreachable", status: 500 });
  });

  it("maps a 415 to an unsupported media type, and omits an unknown content type", async () => {
    const { fetcher } = recordingFetcher(() => new Response("Unsupported Media Type", { status: 415 }));

    const failure = await failureFrom(() =>
      deepgramProvider(DEEPGRAM_ENV).submit({
        audio: { kind: "url", url: "https://cdn.example.com/stream.m3u8" },
        diarize: true,
        fetcher,
      })
    );

    expect(failure).toEqual({ code: "unsupported_media_type" });
  });

  it("maps a 413 to source_too_large, carrying the bytes we actually sent", async () => {
    const { fetcher } = recordingFetcher(() => new Response("Payload Too Large", { status: 413 }));

    const failure = await failureFrom(() =>
      deepgramProvider(DEEPGRAM_ENV).submit({
        audio: bytesAudio({ payload: new Uint8Array(2048), contentType: "audio/mpeg", filename: "long.mp3" }),
        diarize: true,
        fetcher,
      })
    );

    expect(failure).toEqual({
      code: "source_too_large",
      bytes: 2048,
      maxBytes: TRANSCRIPTION_MAX_UPLOAD_BYTES,
    });
  });

  it("refuses a source longer than the provider ceiling before spending a call", async () => {
    const { calls, fetcher } = recordingFetcher(() => Response.json(fixtureResponse(MULTILINGUAL_WORDS)));

    const failure = await failureFrom(() =>
      deepgramProvider(DEEPGRAM_ENV).submit({
        audio: { kind: "url", url: "https://cdn.example.com/four-hour-conference.mp3" },
        diarize: true,
        durationSeconds: 14_400,
        fetcher,
      })
    );

    expect(failure).toEqual({
      code: "source_too_long",
      durationSeconds: 14_400,
      maxSeconds: TRANSCRIPTION_MAX_SOURCE_SECONDS,
    });
    // Deepgram bills per minute of audio it accepted — never post it at all.
    expect(calls).toHaveLength(0);
  });

  it("posts a source that is exactly at the ceiling", async () => {
    const { calls, fetcher } = recordingFetcher(() => Response.json(fixtureResponse(MULTILINGUAL_WORDS)));

    await deepgramProvider(DEEPGRAM_ENV).submit({
      audio: { kind: "url", url: "https://cdn.example.com/ninety-minutes.mp3" },
      diarize: true,
      durationSeconds: TRANSCRIPTION_MAX_SOURCE_SECONDS,
      fetcher,
    });

    expect(calls).toHaveLength(1);
  });

  it("surfaces a network-level throw as provider_unavailable", async () => {
    const fetcher: typeof fetch = async () => {
      throw new TypeError("network error");
    };

    const failure = await failureFrom(() =>
      deepgramProvider(DEEPGRAM_ENV).submit({
        audio: { kind: "url", url: "https://cdn.example.com/a.mp3" },
        diarize: true,
        fetcher,
      })
    );

    expect(failure).toEqual({ code: "provider_unavailable", provider: "deepgram" });
  });

  it("fails honestly when a 200 body is not JSON", async () => {
    const { fetcher } = recordingFetcher(() => new Response("<html>maintenance</html>", { status: 200 }));

    const failure = await failureFrom(() =>
      deepgramProvider(DEEPGRAM_ENV).submit({
        audio: { kind: "url", url: "https://cdn.example.com/a.mp3" },
        diarize: true,
        fetcher,
      })
    );

    expect(failure.code).toBe("provider_failed");
  });

  it.each([
    ["a non-object body", "just a string"],
    ["a missing results block", { metadata: { request_id: "abc" } }],
    ["an empty channel list", { results: { channels: [] } }],
    ["a channel with no alternative", { results: { channels: [{ alternatives: [] }] } }],
    ["an alternative with no word list", { results: { channels: [{ alternatives: [{ transcript: "hi" }] }] } }],
  ])("refuses to invent a transcript from %s", (_label, payload) => {
    expect(() => normaliseDeepgramTranscript(payload)).toThrowError();
    const failure = (() => {
      try {
        normaliseDeepgramTranscript(payload);
      } catch (error) {
        return isTranscriptionError(error) ? error.failure : null;
      }
      return null;
    })();
    expect(failure?.code).toBe("provider_failed");
  });

  it("refuses a word list where nothing has usable text and timings", () => {
    const payload = {
      metadata: { request_id: "abc", duration: 3, channels: 1 },
      results: { channels: [{ alternatives: [{ words: [{ word: "salut" }, { start: 0, end: 1 }] }] }] },
    };
    expect(() => normaliseDeepgramTranscript(payload)).toThrowError();
  });

  it("rejects a handle that belongs to another provider", async () => {
    const failure = await failureFrom(() =>
      deepgramProvider(DEEPGRAM_ENV).fetchTranscript({
        provider: "groq",
        providerJobId: "req-1",
        model: "whisper-large-v3-turbo",
        ready: true,
        raw: {},
      })
    );
    expect(failure.code).toBe("provider_failed");
  });

  it("rejects an unready handle instead of pretending to poll", async () => {
    const failure = await failureFrom(() =>
      deepgramProvider(DEEPGRAM_ENV).fetchTranscript({
        provider: "deepgram",
        providerJobId: null,
        model: DEEPGRAM_MODEL,
        ready: false,
        raw: null,
      })
    );
    expect(failure.code).toBe("provider_failed");
  });

  it("refuses to build a provider without a key", () => {
    expect(() => deepgramProvider(envWith({}))).toThrowError();
    for (const key of [undefined, "", "   "]) {
      const failure = (() => {
        try {
          deepgramProvider(envWith({ DEEPGRAM_API_KEY: key }));
        } catch (error) {
          return isTranscriptionError(error) ? error.failure : null;
        }
        return null;
      })();
      expect(failure).toEqual({ code: "provider_unavailable", provider: "deepgram" });
    }
  });
});

// The tier-1 rule and the "never substitute another provider's key" guarantee,
// asserted against the surviving API. Slice 1's `getProvider` /
// `describeProviderChoice` are gone — they had no production caller once the seam
// moved to `runTranscription`, and a second copy of this policy was free to drift
// from the one the cascade actually plans with.
describe("provider router", () => {
  it("routes a speaker-labelling request to Deepgram", () => {
    const env = envWith({ DEEPGRAM_API_KEY: "dg", GROQ_API_KEY: "gsk" });
    const provider = buildProvider(env, selectTranscriptionProvider({ diarize: true }));
    expect(provider.id).toBe("deepgram");
    expect(provider.model).toBe("nova-3");
    expect(provider.capabilities.diarization).toBe(true);
  });

  it("routes everything else to Groq, which cannot diarize", () => {
    const env = envWith({ DEEPGRAM_API_KEY: "dg", GROQ_API_KEY: "gsk" });
    const provider = buildProvider(env, selectTranscriptionProvider({ diarize: false }));
    expect(provider.id).toBe("groq");
    // Whisper has no diarization. The router must not pretend otherwise.
    expect(provider.capabilities.diarization).toBe(false);
  });

  it("never falls back to Groq for a speaker-labelling job when Deepgram is unconfigured", async () => {
    // Only a Groq key. The diarized lane is Deepgram → AssemblyAI, so the plan
    // comes back EMPTY rather than quietly serving an unlabelled transcript.
    const plan = await planTranscriptionRoute(envWith({ GROQ_API_KEY: "gsk" }), {
      diarize: true,
      durationSeconds: 600,
      sizeBytes: null,
    });
    expect(plan.steps).toEqual([]);
    expect(plan.requested).toBe("deepgram");
  });

  // The mirror case — a plain job with no Groq key drops the tier rather than
  // substituting a key — needs the real KV for Groq's budget read, so it lives in
  // router.test.ts ("drops an unconfigured tier instead of trying it").

  it("exposes the tier-1 decision without building anything", () => {
    expect(selectTranscriptionProvider({ diarize: true })).toBe("deepgram");
    expect(selectTranscriptionProvider({ diarize: false })).toBe("groq");
  });

  it("reads configuration per provider, never pooled", () => {
    const env = envWith({ GROQ_API_KEY: "gsk" });
    expect(isTranscriptionProviderConfigured(env, "groq")).toBe(true);
    expect(isTranscriptionProviderConfigured(env, "deepgram")).toBe(false);
    expect(isTranscriptionProviderConfigured(envWith({ GROQ_API_KEY: "  " }), "groq")).toBe(false);
  });
});
