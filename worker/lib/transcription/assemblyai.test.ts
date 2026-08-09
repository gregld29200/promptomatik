import { describe, expect, it } from "vitest";
import type { Env } from "../../env";
import {
  ASSEMBLYAI_MODEL,
  assemblyAiProvider,
  hasAssemblyAiApiKey,
  msToSeconds,
  normaliseAssemblyAiTranscript,
} from "./assemblyai";
import { isTranscriptionProviderConfigured } from "./index";
import {
  TRANSCRIPTION_MAX_SOURCE_SECONDS,
  TRANSCRIPTION_MAX_UPLOAD_BYTES,
  isTranscriptionError,
  type TranscriptionAudioSource,
  type TranscriptionFailure,
  type TranscriptionJobHandle,
} from "./types";

// NOTE ON FIXTURES: no live AssemblyAI call was made here. Every payload below is
// HANDWRITTEN to the documented shape of a `/v2/transcript` read: `id`, `status`,
// `audio_duration` in SECONDS, `words[]` and `utterances[]` with start/end in
// MILLISECONDS, `utterances[].speaker` as a letter. They prove our normalisation,
// our unit conversion and our error handling — not AssemblyAI's accuracy.

interface FixtureWord {
  text: string;
  /** Milliseconds, exactly as AssemblyAI reports them. */
  start: number;
  end: number;
  confidence?: number;
  speaker?: string;
  language?: string;
}

interface FixtureUtterance {
  speaker: string;
  start: number;
  end: number;
  text: string;
  confidence?: number;
  words?: FixtureWord[];
}

/** Two speakers, one French turn, one English turn, one French turn. */
const TURN_A1: FixtureWord[] = [
  { text: "Bonjour", start: 80, end: 560, confidence: 0.9987, speaker: "A" },
  { text: "tout", start: 560, end: 800, confidence: 0.9931, speaker: "A" },
  { text: "le", start: 800, end: 960, confidence: 0.9954, speaker: "A" },
  { text: "monde.", start: 960, end: 1440, confidence: 0.9902, speaker: "A" },
];
const TURN_B1: FixtureWord[] = [
  { text: "Hello", start: 1720, end: 2100, confidence: 0.988, speaker: "B" },
  { text: "everyone.", start: 2100, end: 2860, confidence: 0.9765, speaker: "B" },
];
const TURN_A2: FixtureWord[] = [
  { text: "Alors,", start: 3020, end: 3440, confidence: 0.9812, speaker: "A" },
  { text: "on", start: 3440, end: 3580, confidence: 0.9899, speaker: "A" },
  { text: "commence.", start: 3580, end: 4220, confidence: 0.993, speaker: "A" },
];

function utteranceFrom(words: FixtureWord[]): FixtureUtterance {
  return {
    speaker: words[0].speaker ?? "A",
    start: words[0].start,
    end: words[words.length - 1].end,
    text: words.map((word) => word.text).join(" "),
    confidence: 0.97,
    words,
  };
}

const DIARIZED_UTTERANCES: FixtureUtterance[] = [
  utteranceFrom(TURN_A1),
  utteranceFrom(TURN_B1),
  utteranceFrom(TURN_A2),
];
const ALL_WORDS: FixtureWord[] = [...TURN_A1, ...TURN_B1, ...TURN_A2];

function completedTranscript(
  overrides: {
    words?: FixtureWord[];
    utterances?: FixtureUtterance[] | null;
    audioDuration?: number;
    languageCode?: string;
    id?: string;
  } = {}
): Record<string, unknown> {
  const words = overrides.words ?? ALL_WORDS;
  const utterances = overrides.utterances === undefined ? DIARIZED_UTTERANCES : overrides.utterances;
  const payload: Record<string, unknown> = {
    id: overrides.id ?? "6f9a1c74-2b3d-4e5f-8a09-1c2d3e4f5a6b",
    status: "completed",
    speech_model: ASSEMBLYAI_MODEL,
    language_code: overrides.languageCode ?? "fr",
    // SECONDS in the very same payload whose words are in milliseconds.
    audio_duration: overrides.audioDuration ?? 4.51,
    text: words.map((word) => word.text).join(" "),
    confidence: 0.9871,
    words,
  };
  if (utterances !== null) payload.utterances = utterances;
  return payload;
}

function queuedTranscript(id = "6f9a1c74-2b3d-4e5f-8a09-1c2d3e4f5a6b"): Record<string, unknown> {
  return { id, status: "queued", speech_model: ASSEMBLYAI_MODEL, audio_url: "https://cdn.example.com/a.mp3" };
}

function envWith(keys: Partial<Pick<Env, "ASSEMBLYAI_API_KEY" | "GROQ_API_KEY" | "DEEPGRAM_API_KEY">>): Env {
  return keys as unknown as Env;
}

const ASSEMBLYAI_ENV = envWith({ ASSEMBLYAI_API_KEY: "aai-test-key" });

// ---------------------------------------------------------------------------
// Fetch scripting
// ---------------------------------------------------------------------------

type ResponseFactory = () => Response | Promise<Response>;

interface RecordedCall {
  url: string;
  method: string;
  init: RequestInit | undefined;
}

interface Script {
  upload?: ResponseFactory[];
  create?: ResponseFactory[];
  poll?: ResponseFactory[];
}

interface ScriptedFetch {
  calls: RecordedCall[];
  uploads: RecordedCall[];
  creates: RecordedCall[];
  polls: RecordedCall[];
  fetcher: typeof fetch;
}

/**
 * Routes by endpoint and consumes each list in order; the LAST entry repeats, so
 * "poll returns processing forever" is one entry, and a three-step
 * queued → processing → completed sequence is three.
 */
function scriptedFetcher(script: Script): ScriptedFetch {
  const state: ScriptedFetch = {
    calls: [],
    uploads: [],
    creates: [],
    polls: [],
    fetcher: async () => new Response(null),
  };
  const cursors = { upload: 0, create: 0, poll: 0 };

  const next = (kind: keyof Script): ResponseFactory => {
    const list = script[kind];
    if (list === undefined || list.length === 0) {
      throw new Error(`The test script has no ${kind} response.`);
    }
    const index = Math.min(cursors[kind], list.length - 1);
    cursors[kind] += 1;
    return list[index];
  };

  state.fetcher = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const call: RecordedCall = { url, method, init };
    state.calls.push(call);
    if (url.endsWith("/upload")) {
      state.uploads.push(call);
      return next("upload")();
    }
    if (url.endsWith("/transcript") && method === "POST") {
      state.creates.push(call);
      return next("create")();
    }
    state.polls.push(call);
    return next("poll")();
  };

  return state;
}

/** A clock the poll loop advances only by sleeping — no real timers, no waiting. */
function fakeClock(): { now: () => number; sleep: (ms: number) => Promise<void>; sleeps: number[] } {
  let current = 1_700_000_000_000;
  const sleeps: number[] = [];
  return {
    now: () => current,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      current += ms;
    },
    sleeps,
  };
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

function syncFailureFrom(run: () => unknown): TranscriptionFailure | null {
  try {
    run();
  } catch (error) {
    return isTranscriptionError(error) ? error.failure : null;
  }
  return null;
}

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

const URL_AUDIO: TranscriptionAudioSource = { kind: "url", url: "https://cdn.example.com/episode-12.mp3" };

/** Submit + poll to completion with one scripted transport. */
async function runToTranscript(script: Script, options: { diarize?: boolean } = {}) {
  const transport = scriptedFetcher(script);
  const clock = fakeClock();
  const provider = assemblyAiProvider(ASSEMBLYAI_ENV, {
    fetcher: transport.fetcher,
    sleep: clock.sleep,
    now: clock.now,
  });
  const handle = await provider.submit({ audio: URL_AUDIO, diarize: options.diarize ?? true });
  const transcript = await provider.fetchTranscript(handle);
  return { transport, clock, handle, transcript };
}

// ---------------------------------------------------------------------------

describe("assemblyai capabilities", () => {
  it("is the universal backstop: it diarizes AND serves the plain lane", () => {
    const provider = assemblyAiProvider(ASSEMBLYAI_ENV);
    expect(provider.id).toBe("assemblyai");
    expect(provider.model).toBe("universal-3.5-pro");
    // The reason tier 3 exists: it can substitute for either provider above it.
    expect(provider.capabilities.diarization).toBe(true);
    expect(provider.capabilities.wordTimestamps).toBe(true);
    expect(provider.capabilities.multilingualWithinFile).toBe(true);
    expect(provider.capabilities.languageDetection).toBe(true);
    expect(provider.capabilities.maxSourceSeconds).toBe(TRANSCRIPTION_MAX_SOURCE_SECONDS);
  });

  it("refuses to build a provider without a key", () => {
    for (const key of [undefined, "", "   "]) {
      const failure = syncFailureFrom(() => assemblyAiProvider(envWith({ ASSEMBLYAI_API_KEY: key })));
      expect(failure).toEqual({ code: "provider_unavailable", provider: "assemblyai" });
    }
    expect(hasAssemblyAiApiKey(envWith({}))).toBe(false);
    expect(hasAssemblyAiApiKey(envWith({ ASSEMBLYAI_API_KEY: " " }))).toBe(false);
    expect(hasAssemblyAiApiKey(ASSEMBLYAI_ENV)).toBe(true);
  });

  it("reads its own key, never another provider's", () => {
    const env = envWith({ GROQ_API_KEY: "gsk", DEEPGRAM_API_KEY: "dg" });
    expect(isTranscriptionProviderConfigured(env, "assemblyai")).toBe(false);
    expect(isTranscriptionProviderConfigured(ASSEMBLYAI_ENV, "assemblyai")).toBe(true);
    expect(isTranscriptionProviderConfigured(ASSEMBLYAI_ENV, "groq")).toBe(false);
  });
});

describe("assemblyai submit", () => {
  it("posts universal-3.5-pro with speaker labels and language detection", async () => {
    const transport = scriptedFetcher({ create: [() => Response.json(queuedTranscript())] });

    await assemblyAiProvider(ASSEMBLYAI_ENV, { fetcher: transport.fetcher }).submit({
      audio: URL_AUDIO,
      diarize: true,
    });

    expect(transport.creates).toHaveLength(1);
    expect(transport.creates[0].url).toBe("https://api.assemblyai.com/v2/transcript");
    const body: unknown = JSON.parse(String(transport.creates[0].init?.body));
    expect(body).toMatchObject({
      audio_url: "https://cdn.example.com/episode-12.mp3",
      speech_model: "universal-3.5-pro",
      speaker_labels: true,
      language_detection: true,
    });
  });

  it("asks for no speaker labels on the plain lane", async () => {
    const transport = scriptedFetcher({ create: [() => Response.json(queuedTranscript())] });

    await assemblyAiProvider(ASSEMBLYAI_ENV, { fetcher: transport.fetcher }).submit({
      audio: URL_AUDIO,
      diarize: false,
    });

    const body = JSON.parse(String(transport.creates[0].init?.body)) as { speaker_labels: boolean };
    expect(body.speaker_labels).toBe(false);
  });

  it("authenticates with a BARE key — no Bearer, no Token", async () => {
    const transport = scriptedFetcher({ create: [() => Response.json(queuedTranscript())] });

    await assemblyAiProvider(ASSEMBLYAI_ENV, { fetcher: transport.fetcher }).submit({
      audio: URL_AUDIO,
      diarize: true,
    });

    const headers = transport.creates[0].init?.headers as Record<string, string>;
    // A prefixed key comes back as a 401 that looks exactly like an expired one.
    expect(headers.Authorization).toBe("aai-test-key");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("keeps language detection on even when the caller passes a hint", async () => {
    const transport = scriptedFetcher({ create: [() => Response.json(queuedTranscript())] });

    await assemblyAiProvider(ASSEMBLYAI_ENV, { fetcher: transport.fetcher }).submit({
      audio: URL_AUDIO,
      diarize: true,
      languageHint: "fr",
    });

    // Pinning a code-switching classroom recording to the teacher's interface
    // language would make the other language worse.
    const body = JSON.parse(String(transport.creates[0].init?.body)) as Record<string, unknown>;
    expect(body.language_detection).toBe(true);
    expect(body.language_code).toBeUndefined();
  });

  it("returns an UNREADY handle carrying the transcript id", async () => {
    const transport = scriptedFetcher({ create: [() => Response.json(queuedTranscript("t-42"))] });

    const handle = await assemblyAiProvider(ASSEMBLYAI_ENV, { fetcher: transport.fetcher }).submit({
      audio: URL_AUDIO,
      diarize: true,
    });

    expect(handle.provider).toBe("assemblyai");
    expect(handle.model).toBe(ASSEMBLYAI_MODEL);
    // The first genuinely async provider: the transcript does not exist yet.
    expect(handle.ready).toBe(false);
    expect(handle.providerJobId).toBe("t-42");
  });

  it("carries a wall-clock deadline on every call", async () => {
    const transport = scriptedFetcher({ create: [() => Response.json(queuedTranscript())] });

    await assemblyAiProvider(ASSEMBLYAI_ENV, { fetcher: transport.fetcher }).submit({
      audio: URL_AUDIO,
      diarize: true,
    });

    const signal = transport.creates[0].init?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });

  it("uploads bytes first, then transcribes the private upload_url", async () => {
    const transport = scriptedFetcher({
      upload: [() => Response.json({ upload_url: "https://cdn.assemblyai.com/upload/abc123" })],
      create: [() => Response.json(queuedTranscript())],
    });
    const audio = bytesAudio({
      payload: new Uint8Array([0x49, 0x44, 0x33, 0x04]),
      contentType: "audio/mpeg",
      filename: "cours.mp3",
    });

    await assemblyAiProvider(ASSEMBLYAI_ENV, { fetcher: transport.fetcher }).submit({ audio, diarize: true });

    expect(transport.uploads).toHaveLength(1);
    expect(transport.uploads[0].url).toBe("https://api.assemblyai.com/v2/upload");
    const uploadHeaders = transport.uploads[0].init?.headers as Record<string, string>;
    expect(uploadHeaders.Authorization).toBe("aai-test-key");
    expect(uploadHeaders["Content-Type"]).toBe("audio/mpeg");
    if (audio.kind !== "bytes") throw new Error("expected an uploaded source");
    // The very Blob ingest read out of R2, sent without a second copy of it.
    expect(transport.uploads[0].init?.body).toBe(audio.blob);

    const body = JSON.parse(String(transport.creates[0].init?.body)) as { audio_url: string };
    expect(body.audio_url).toBe("https://cdn.assemblyai.com/upload/abc123");
  });

  it("refuses a source longer than the ceiling before spending an hour of allowance", async () => {
    const transport = scriptedFetcher({ create: [() => Response.json(queuedTranscript())] });

    const failure = await failureFrom(() =>
      assemblyAiProvider(ASSEMBLYAI_ENV, { fetcher: transport.fetcher }).submit({
        audio: URL_AUDIO,
        diarize: true,
        durationSeconds: 14_400,
      })
    );

    expect(failure).toEqual({
      code: "source_too_long",
      durationSeconds: 14_400,
      maxSeconds: TRANSCRIPTION_MAX_SOURCE_SECONDS,
    });
    expect(transport.calls).toHaveLength(0);
  });

  it("refuses an upload over our own byte ceiling before uploading it", async () => {
    const transport = scriptedFetcher({ create: [() => Response.json(queuedTranscript())] });

    const failure = await failureFrom(() =>
      assemblyAiProvider(ASSEMBLYAI_ENV, { fetcher: transport.fetcher }).submit({
        audio: bytesAudio({
          sizeBytes: TRANSCRIPTION_MAX_UPLOAD_BYTES + 1,
          contentType: "audio/mpeg",
          filename: "enorme.mp3",
        }),
        diarize: true,
      })
    );

    expect(failure).toEqual({
      code: "source_too_large",
      bytes: TRANSCRIPTION_MAX_UPLOAD_BYTES + 1,
      maxBytes: TRANSCRIPTION_MAX_UPLOAD_BYTES,
    });
    expect(transport.calls).toHaveLength(0);
  });

  it("accepts a source that is exactly at the duration ceiling", async () => {
    const transport = scriptedFetcher({ create: [() => Response.json(queuedTranscript())] });

    await assemblyAiProvider(ASSEMBLYAI_ENV, { fetcher: transport.fetcher }).submit({
      audio: URL_AUDIO,
      diarize: true,
      durationSeconds: TRANSCRIPTION_MAX_SOURCE_SECONDS,
    });

    expect(transport.creates).toHaveLength(1);
  });

  it("remembers the fetcher the request handed it, so polling uses the same seam", async () => {
    // `fetchTranscript` takes only a handle: the contract gives it no fetcher.
    const transport = scriptedFetcher({
      create: [() => Response.json(queuedTranscript())],
      poll: [() => Response.json(completedTranscript())],
    });
    const clock = fakeClock();
    const provider = assemblyAiProvider(ASSEMBLYAI_ENV, { sleep: clock.sleep, now: clock.now });

    const handle = await provider.submit({ audio: URL_AUDIO, diarize: true, fetcher: transport.fetcher });
    const transcript = await provider.fetchTranscript(handle);

    expect(transport.polls).toHaveLength(1);
    expect(transcript.metadata.provider).toBe("assemblyai");
  });
});

describe("assemblyai polling", () => {
  it("polls the transcript until it is completed", async () => {
    const { transport, clock, transcript } = await runToTranscript({
      create: [() => Response.json(queuedTranscript("t-7"))],
      poll: [
        () => Response.json({ id: "t-7", status: "queued" }),
        () => Response.json({ id: "t-7", status: "processing" }),
        () => Response.json(completedTranscript({ id: "t-7" })),
      ],
    });

    expect(transport.polls).toHaveLength(3);
    expect(transport.polls[0].url).toBe("https://api.assemblyai.com/v2/transcript/t-7");
    expect(transport.polls[0].method).toBe("GET");
    const headers = transport.polls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("aai-test-key");
    // It waited between polls, and backed off rather than hammering.
    expect(clock.sleeps).toEqual([2000, 3000]);
    expect(transcript.segments).toHaveLength(3);
  });

  it("keeps waiting through a transient 429, a 500 and a network blip", async () => {
    // The job is already running on their side; resubmitting would bill it twice.
    let call = 0;
    const transport = scriptedFetcher({
      create: [() => Response.json(queuedTranscript())],
      poll: [
        () => new Response("slow down", { status: 429 }),
        () => new Response("boom", { status: 500 }),
        () => {
          call += 1;
          if (call === 1) throw new TypeError("network error");
          return Response.json(completedTranscript());
        },
      ],
    });
    const clock = fakeClock();
    const provider = assemblyAiProvider(ASSEMBLYAI_ENV, {
      fetcher: transport.fetcher,
      sleep: clock.sleep,
      now: clock.now,
    });

    const handle = await provider.submit({ audio: URL_AUDIO, diarize: true });
    const transcript = await provider.fetchTranscript(handle);

    expect(transport.polls).toHaveLength(4);
    expect(transport.creates).toHaveLength(1);
    expect(transcript.text.startsWith("Bonjour")).toBe(true);
  });

  it("gives up terminally after the poll deadline instead of re-billing the media", async () => {
    const transport = scriptedFetcher({
      create: [() => Response.json(queuedTranscript("t-slow"))],
      poll: [() => Response.json({ id: "t-slow", status: "processing" })],
    });
    const clock = fakeClock();
    const provider = assemblyAiProvider(ASSEMBLYAI_ENV, {
      fetcher: transport.fetcher,
      sleep: clock.sleep,
      now: clock.now,
    });
    const handle = await provider.submit({ audio: URL_AUDIO, diarize: true });

    const failure = await failureFrom(() => provider.fetchTranscript(handle));

    // provider_failed, not provider_unavailable: the queue must NOT retry, because
    // a retry re-submits the same media against the free hours.
    expect(failure.code).toBe("provider_failed");
    expect(clock.sleeps.reduce((total, ms) => total + ms, 0)).toBeGreaterThanOrEqual(12 * 60 * 1000);
    // The backoff is capped, so it never sleeps longer than ten seconds at a time.
    expect(Math.max(...clock.sleeps)).toBe(10_000);
    expect(transport.creates).toHaveLength(1);
  });

  it("stops on a 404, which no amount of waiting will fix", async () => {
    const transport = scriptedFetcher({
      create: [() => Response.json(queuedTranscript())],
      poll: [() => Response.json({ error: "Transcript not found" }, { status: 404 })],
    });
    const clock = fakeClock();
    const provider = assemblyAiProvider(ASSEMBLYAI_ENV, {
      fetcher: transport.fetcher,
      sleep: clock.sleep,
      now: clock.now,
    });
    const handle = await provider.submit({ audio: URL_AUDIO, diarize: true });

    const failure = await failureFrom(() => provider.fetchTranscript(handle));

    expect(failure.code).toBe("provider_failed");
    expect(transport.polls).toHaveLength(1);
  });

  it("treats a revoked key mid-poll as provider_unavailable", async () => {
    const transport = scriptedFetcher({
      create: [() => Response.json(queuedTranscript())],
      poll: [() => new Response("Unauthorized", { status: 401 })],
    });
    const clock = fakeClock();
    const provider = assemblyAiProvider(ASSEMBLYAI_ENV, {
      fetcher: transport.fetcher,
      sleep: clock.sleep,
      now: clock.now,
    });
    const handle = await provider.submit({ audio: URL_AUDIO, diarize: true });

    const failure = await failureFrom(() => provider.fetchTranscript(handle));

    expect(failure).toEqual({ code: "provider_unavailable", provider: "assemblyai", status: 401 });
  });

  it("does not poll at all when the create call already returned a completed transcript", async () => {
    const transport = scriptedFetcher({ create: [() => Response.json(completedTranscript())] });
    const provider = assemblyAiProvider(ASSEMBLYAI_ENV, { fetcher: transport.fetcher });

    const handle = await provider.submit({ audio: URL_AUDIO, diarize: true });
    expect(handle.ready).toBe(true);

    const transcript = await provider.fetchTranscript(handle);
    expect(transport.polls).toHaveLength(0);
    expect(transcript.segments).toHaveLength(3);
  });

  it("rejects a handle that belongs to another provider", async () => {
    const other: TranscriptionJobHandle = {
      provider: "deepgram",
      providerJobId: "req-1",
      model: "nova-3",
      ready: true,
      raw: {},
    };
    const failure = await failureFrom(() => assemblyAiProvider(ASSEMBLYAI_ENV).fetchTranscript(other));
    expect(failure.code).toBe("provider_failed");
  });

  it("rejects a handle carrying no transcript id", async () => {
    const failure = await failureFrom(() =>
      assemblyAiProvider(ASSEMBLYAI_ENV).fetchTranscript({
        provider: "assemblyai",
        providerJobId: null,
        model: ASSEMBLYAI_MODEL,
        ready: false,
        raw: { nothing: true },
      })
    );
    expect(failure.code).toBe("provider_failed");
  });
});

describe("assemblyai unit conversion", () => {
  const transcript = normaliseAssemblyAiTranscript(completedTranscript());

  it("converts millisecond word timings into seconds", () => {
    // If the /1000 were dropped, every one of these would be 1000x larger.
    const first = transcript.segments[0].words[0];
    expect(first.start).toBe(0.08);
    expect(first.end).toBe(0.56);
    const hello = transcript.segments[1].words[0];
    expect(hello.start).toBe(1.72);
    expect(hello.end).toBe(2.1);
    expect(transcript.segments[2].words[2].end).toBe(4.22);
  });

  it("keeps every timestamp inside the media, which a dropped conversion could not", () => {
    // The pinned guard: audio_duration is 4.51 s, so a word ending at 4220 would
    // be 936x past the end of a five-second clip.
    const last = transcript.segments[2].words[2];
    expect(transcript.metadata.durationSeconds).toBe(4.51);
    expect(last.end).toBeLessThanOrEqual(transcript.metadata.durationSeconds);
  });

  it("does NOT divide audio_duration, which is already in seconds", () => {
    // The same payload mixes the two units; halving the bug is still a bug.
    const long = normaliseAssemblyAiTranscript(completedTranscript({ audioDuration: 3_600 }));
    expect(long.metadata.durationSeconds).toBe(3_600);
  });

  it("rounds to the millisecond instead of leaking float noise", () => {
    expect(msToSeconds(1720)).toBe(1.72);
    expect(msToSeconds(3580)).toBe(3.58);
    expect(msToSeconds(0)).toBe(0);
    expect(msToSeconds(4220.4)).toBe(4.22);
  });

  it("falls back to the last word's end, in seconds, when audio_duration is absent", () => {
    const payload = completedTranscript();
    delete payload.audio_duration;
    const withoutDuration = normaliseAssemblyAiTranscript(payload);
    // 4220 ms, not 4220 s.
    expect(withoutDuration.metadata.durationSeconds).toBe(4.22);
  });
});

describe("assemblyai diarized normalisation", () => {
  const transcript = normaliseAssemblyAiTranscript(completedTranscript());

  it("uses AssemblyAI's own utterances as the turns", () => {
    expect(transcript.segments).toHaveLength(3);
    expect(transcript.segments.map((segment) => segment.speaker)).toEqual(["A", "B", "A"]);
    expect(transcript.segments.map((segment) => segment.words.length)).toEqual([4, 2, 3]);
    expect(transcript.segments.map((segment) => segment.idx)).toEqual([0, 1, 2]);
  });

  it("bounds each turn by its own first and last word", () => {
    expect(transcript.segments[0].start).toBe(0.08);
    expect(transcript.segments[0].end).toBe(1.44);
    expect(transcript.segments[1].start).toBe(1.72);
    expect(transcript.segments[2].end).toBe(4.22);
  });

  it("keeps the formatted turn text and paragraph-joins the transcript", () => {
    expect(transcript.segments[0].text).toBe("Bonjour tout le monde.");
    expect(transcript.text).toBe("Bonjour tout le monde.\n\nHello everyone.\n\nAlors, on commence.");
  });

  it("keeps the letter speaker ids, ordered by first appearance", () => {
    expect(transcript.speakers.map((speaker) => speaker.id)).toEqual(["A", "B"]);
    expect(transcript.speakers.map((speaker) => speaker.index)).toEqual([0, 1]);
    expect(transcript.speakers.map((speaker) => speaker.label)).toEqual(["speaker_A", "speaker_B"]);
    expect(transcript.metadata.diarization).toBe(true);
    expect(transcript.metadata.speakerCount).toBe(2);
  });

  it("passes per-word confidence straight through", () => {
    expect(transcript.segments[0].words.map((word) => word.confidence)).toEqual([
      0.9987, 0.9931, 0.9954, 0.9902,
    ]);
    expect(transcript.segments[1].words[1].confidence).toBe(0.9765);
  });

  it("labels every word with its turn's speaker", () => {
    expect(transcript.segments[1].words.every((word) => word.speaker === "B")).toBe(true);
  });

  it("records the model, the transcript id and a single billed channel", () => {
    expect(transcript.metadata.provider).toBe("assemblyai");
    expect(transcript.metadata.model).toBe("universal-3.5-pro");
    expect(transcript.metadata.providerJobId).toBe("6f9a1c74-2b3d-4e5f-8a09-1c2d3e4f5a6b");
    expect(transcript.metadata.channels).toBe(1);
    expect(transcript.metadata.detectedLanguages).toEqual(["fr"]);
  });
});

describe("assemblyai speaking time", () => {
  it("sums word durations, never the wall clock of the turn", () => {
    // 0.48 + 0.24 + 0.16 + 0.48 for the first turn and 0.42 + 0.14 + 0.64 for the
    // third; 0.38 + 0.76 for B. This fixture is word-contiguous inside every turn,
    // so on its own it cannot tell speaking time from wall clock — the two tests
    // below are the ones that pin the definition down.
    const transcript = normaliseAssemblyAiTranscript(completedTranscript());
    expect(transcript.speakers[0].seconds).toBeCloseTo(2.56, 5);
    expect(transcript.speakers[1].seconds).toBeCloseTo(1.14, 5);
  });

  it("counts spoken seconds only, never the silence sitting inside one turn", () => {
    // A teacher says one word, writes on the board for twenty seconds, says one
    // more. AssemblyAI reports that as ONE utterance spanning 20.4 s. Reading the
    // span as speaking time would tell the teacher they spoke for 20 seconds when
    // they spoke for 0.8 — the exact defect just fixed in deepgram.ts.
    const words: FixtureWord[] = [
      { text: "Alors...", start: 0, end: 400, speaker: "A" },
      { text: "voilà.", start: 20_000, end: 20_400, speaker: "A" },
    ];
    const transcript = normaliseAssemblyAiTranscript(
      completedTranscript({ words, utterances: [utteranceFrom(words)], audioDuration: 21 })
    );

    expect(transcript.segments).toHaveLength(1);
    expect(transcript.segments[0].end - transcript.segments[0].start).toBeCloseTo(20.4, 5);
    expect(transcript.speakers).toHaveLength(1);
    expect(transcript.speakers[0].seconds).toBeCloseTo(0.8, 5);
  });

  it("keeps each speaker's own silences out of the other speaker's total", () => {
    // Interleaved turns, each with a breath INSIDE it, so no total may absorb a
    // gap: A's two turns span 3.6 s and 0.85 s of wall clock for 1.6 s of speech,
    // B's span 0.5 s and 11 s for 2 s. The order of first appearance must survive.
    const turns: FixtureWord[][] = [
      [
        { text: "Oui,", start: 0, end: 500, speaker: "A" },
        { text: "effectivement.", start: 3_000, end: 3_600, speaker: "A" },
      ],
      [{ text: "Hmm.", start: 10_000, end: 10_500, speaker: "B" }],
      [
        { text: "Donc", start: 30_000, end: 30_250, speaker: "A" },
        { text: "voilà.", start: 30_600, end: 30_850, speaker: "A" },
      ],
      [
        { text: "Exact,", start: 60_000, end: 61_000, speaker: "B" },
        { text: "oui.", start: 70_500, end: 71_000, speaker: "B" },
      ],
    ];
    const transcript = normaliseAssemblyAiTranscript(
      completedTranscript({
        words: turns.flat(),
        utterances: turns.map(utteranceFrom),
        audioDuration: 72,
      })
    );

    expect(transcript.speakers.map((speaker) => speaker.id)).toEqual(["A", "B"]);
    expect(transcript.speakers[0].seconds).toBeCloseTo(1.6, 5);
    expect(transcript.speakers[1].seconds).toBeCloseTo(2, 5);
    // The media is 72 s long; the two of them spoke for 3.6 s of it.
    expect(transcript.metadata.durationSeconds).toBe(72);
  });
});

describe("assemblyai undiarized normalisation", () => {
  it("still segments a speaker-less transcript, so the UI has one rendering path", () => {
    const words: FixtureWord[] = [
      { text: "Bonjour", start: 100, end: 500, confidence: 0.99 },
      { text: "monde.", start: 500, end: 900, confidence: 0.98 },
    ];
    const transcript = normaliseAssemblyAiTranscript(
      completedTranscript({ words, utterances: null, audioDuration: 1 })
    );

    expect(transcript.metadata.diarization).toBe(false);
    expect(transcript.metadata.speakerCount).toBeNull();
    expect(transcript.speakers).toEqual([]);
    expect(transcript.segments).toHaveLength(1);
    expect(transcript.segments[0].speaker).toBeNull();
    expect(transcript.segments[0].text).toBe("Bonjour monde.");
    expect(transcript.segments[0].start).toBe(0.1);
  });

  it("breaks a very long speaker-less monologue into readable segments", () => {
    const words: FixtureWord[] = Array.from({ length: 120 }, (_, index) => ({
      text: `mot${index}`,
      start: index * 300,
      end: index * 300 + 200,
    }));
    // A one-second breath after the 95th word gives the grouper a place to cut.
    words[95].start = words[94].end + 1_000;
    words[95].end = words[95].start + 200;
    for (let index = 96; index < words.length; index += 1) {
      words[index].start = words[index - 1].end + 50;
      words[index].end = words[index].start + 200;
    }

    const transcript = normaliseAssemblyAiTranscript(
      completedTranscript({ words, utterances: null, audioDuration: 60 })
    );

    expect(transcript.segments.length).toBeGreaterThan(1);
    expect(transcript.segments.every((segment) => segment.speaker === null)).toBe(true);
  });

  it("accepts a silent recording as an empty transcript, not a failure", () => {
    const empty = normaliseAssemblyAiTranscript({
      id: "t-silent",
      status: "completed",
      audio_duration: 12,
      text: "",
      words: [],
      utterances: null,
    });
    expect(empty.segments).toEqual([]);
    expect(empty.text).toBe("");
    expect(empty.metadata.durationSeconds).toBe(12);
    expect(empty.metadata.diarization).toBe(false);
  });
});

describe("assemblyai languages", () => {
  it("drops the multilingual placeholder rather than showing it as a language", () => {
    const transcript = normaliseAssemblyAiTranscript(completedTranscript({ languageCode: "multi" }));
    expect(transcript.metadata.detectedLanguages).toEqual([]);
  });

  it("keeps a concrete file-level language on every turn", () => {
    const transcript = normaliseAssemblyAiTranscript(
      completedTranscript({ languageCode: "es", utterances: null })
    );
    expect(transcript.metadata.detectedLanguages).toEqual(["es"]);
    expect(transcript.segments[0].language).toBe("es");
  });

  it("ranks per-word languages by spoken seconds when the payload carries them", () => {
    // Opportunistic: only the multilingual models tag words individually. When
    // they do, French-then-English must come back most-spoken first.
    const words: FixtureWord[] = [
      ...TURN_A1.map((word) => ({ ...word, language: "fr" })),
      ...TURN_B1.map((word) => ({ ...word, language: "en" })),
      ...TURN_A2.map((word) => ({ ...word, language: "fr" })),
    ];
    const transcript = normaliseAssemblyAiTranscript(
      completedTranscript({
        words,
        utterances: [
          utteranceFrom(words.slice(0, 4)),
          utteranceFrom(words.slice(4, 6)),
          utteranceFrom(words.slice(6)),
        ],
        languageCode: "multi",
      })
    );

    expect(transcript.metadata.detectedLanguages).toEqual(["fr", "en"]);
    expect(transcript.segments.map((segment) => segment.language)).toEqual(["fr", "en", "fr"]);
  });
});

describe("assemblyai terminal errors", () => {
  async function runWithErrorStatus(error: string, audio: TranscriptionAudioSource) {
    const transport = scriptedFetcher({
      upload: [() => Response.json({ upload_url: "https://cdn.assemblyai.com/upload/abc123" })],
      create: [() => Response.json(queuedTranscript())],
      poll: [() => Response.json({ id: "t-1", status: "error", error })],
    });
    const clock = fakeClock();
    const provider = assemblyAiProvider(ASSEMBLYAI_ENV, {
      fetcher: transport.fetcher,
      sleep: clock.sleep,
      now: clock.now,
    });
    const handle = await provider.submit({ audio, diarize: true });
    return failureFrom(() => provider.fetchTranscript(handle));
  }

  it("blames the teacher's link when AssemblyAI could not download it", async () => {
    // We HEAD the URL from a Worker; AssemblyAI pulls it from its own network. A
    // CDN that refused AssemblyAI is the link the teacher can actually fix.
    const failure = await runWithErrorStatus(
      "Download error, unable to download https://cdn.example.com/episode-12.mp3",
      URL_AUDIO
    );
    expect(failure).toEqual({ code: "source_unreachable" });
  });

  it("never blames the teacher's link when WE uploaded the bytes", async () => {
    // The audio_url that failed is AssemblyAI's own storage — there is no link to fix.
    const failure = await runWithErrorStatus(
      "Download error, unable to download https://cdn.assemblyai.com/upload/abc123",
      bytesAudio({ payload: new Uint8Array(8), contentType: "audio/mpeg", filename: "cours.mp3" })
    );
    expect(failure.code).toBe("provider_failed");
  });

  it("reports undecodable media as an unsupported media type", async () => {
    const failure = await runWithErrorStatus(
      "Transcoding failed: file does not appear to contain audio",
      bytesAudio({ payload: new Uint8Array(8), contentType: "audio/x-weird", filename: "cours.dat" })
    );
    expect(failure).toEqual({ code: "unsupported_media_type", contentType: "audio/x-weird" });
  });

  it("keeps any other error sentence as loggable detail on provider_failed", async () => {
    const failure = await runWithErrorStatus("Internal transcription failure", URL_AUDIO);
    expect(failure.code).toBe("provider_failed");
    if (failure.code !== "provider_failed") throw new Error("narrowing");
    expect(failure.provider).toBe("assemblyai");
    expect(failure.detail).toBe("Internal transcription failure");
  });

  it("still fails honestly when the error status carries no message", async () => {
    const failure = await runWithErrorStatus("", URL_AUDIO);
    expect(failure.code).toBe("provider_failed");
  });
});

describe("assemblyai http failures", () => {
  async function submitWith(response: () => Response, audio: TranscriptionAudioSource = URL_AUDIO) {
    const transport = scriptedFetcher({ upload: [response], create: [response] });
    return failureFrom(() =>
      assemblyAiProvider(ASSEMBLYAI_ENV, { fetcher: transport.fetcher }).submit({ audio, diarize: true })
    );
  }

  it.each([401, 403, 429, 500, 503])("treats HTTP %i as provider_unavailable", async (status) => {
    const failure = await submitWith(() => new Response("nope", { status }));
    expect(failure).toEqual({ code: "provider_unavailable", provider: "assemblyai", status });
  });

  it("keeps a 400 we caused as provider_failed with the message as detail", async () => {
    const failure = await submitWith(() =>
      Response.json({ error: "speaker_labels is not supported for this speech_model" }, { status: 400 })
    );
    expect(failure.code).toBe("provider_failed");
    if (failure.code !== "provider_failed") throw new Error("narrowing");
    expect(failure.status).toBe(400);
    expect(failure.detail).toBe("speaker_labels is not supported for this speech_model");
  });

  it("reads a 400 download error as an unreachable source on the URL path", async () => {
    const failure = await submitWith(() =>
      Response.json({ error: "Unable to fetch the audio url provided" }, { status: 400 })
    );
    expect(failure).toEqual({ code: "source_unreachable", status: 400 });
  });

  it("maps a 413 to source_too_large, carrying the bytes we tried to upload", async () => {
    const failure = await submitWith(
      () => new Response("Payload Too Large", { status: 413 }),
      bytesAudio({ payload: new Uint8Array(2048), contentType: "audio/mpeg", filename: "long.mp3" })
    );
    expect(failure).toEqual({
      code: "source_too_large",
      bytes: 2048,
      maxBytes: TRANSCRIPTION_MAX_UPLOAD_BYTES,
    });
  });

  it("maps a 415 to unsupported_media_type, omitting an unknown content type", async () => {
    const failure = await submitWith(() => new Response("Unsupported Media Type", { status: 415 }));
    expect(failure).toEqual({ code: "unsupported_media_type" });
  });

  it("surfaces a network-level throw as provider_unavailable", async () => {
    const fetcher: typeof fetch = async () => {
      throw new TypeError("network error");
    };
    const failure = await failureFrom(() =>
      assemblyAiProvider(ASSEMBLYAI_ENV, { fetcher }).submit({ audio: URL_AUDIO, diarize: true })
    );
    expect(failure).toEqual({ code: "provider_unavailable", provider: "assemblyai" });
  });

  it("reports an aborted request as provider_unavailable, never as the teacher's fault", async () => {
    const fetcher: typeof fetch = async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    };
    const failure = await failureFrom(() =>
      assemblyAiProvider(ASSEMBLYAI_ENV, { fetcher }).submit({ audio: URL_AUDIO, diarize: true })
    );
    expect(failure).toEqual({ code: "provider_unavailable", provider: "assemblyai" });
  });

  it("fails honestly when a 200 body is not JSON", async () => {
    const transport = scriptedFetcher({ create: [() => new Response("<html>maintenance</html>")] });
    const failure = await failureFrom(() =>
      assemblyAiProvider(ASSEMBLYAI_ENV, { fetcher: transport.fetcher }).submit({
        audio: URL_AUDIO,
        diarize: true,
      })
    );
    expect(failure.code).toBe("provider_failed");
  });

  it("fails when the create call returns no transcript id", async () => {
    const transport = scriptedFetcher({ create: [() => Response.json({ status: "queued" })] });
    const failure = await failureFrom(() =>
      assemblyAiProvider(ASSEMBLYAI_ENV, { fetcher: transport.fetcher }).submit({
        audio: URL_AUDIO,
        diarize: true,
      })
    );
    expect(failure.code).toBe("provider_failed");
  });

  it("fails when the upload returns no upload_url", async () => {
    const transport = scriptedFetcher({
      upload: [() => Response.json({ ok: true })],
      create: [() => Response.json(queuedTranscript())],
    });
    const failure = await failureFrom(() =>
      assemblyAiProvider(ASSEMBLYAI_ENV, { fetcher: transport.fetcher }).submit({
        audio: bytesAudio({ payload: new Uint8Array(4), contentType: "audio/mpeg", filename: "a.mp3" }),
        diarize: true,
      })
    );
    expect(failure.code).toBe("provider_failed");
    expect(transport.creates).toHaveLength(0);
  });
});

describe("assemblyai malformed payloads", () => {
  it.each([
    ["a non-object body", "just a string"],
    ["a payload with no words, utterances or text", { id: "t-1", status: "completed", audio_duration: 3 }],
    ["a transcript that is not completed", { id: "t-1", status: "processing", text: "…" }],
  ])("refuses to invent a transcript from %s", (_label, payload) => {
    const failure = syncFailureFrom(() => normaliseAssemblyAiTranscript(payload));
    expect(failure?.code).toBe("provider_failed");
  });

  it("refuses a word list where nothing has usable text and timings", () => {
    const failure = syncFailureFrom(() =>
      normaliseAssemblyAiTranscript({
        id: "t-1",
        status: "completed",
        audio_duration: 3,
        words: [{ text: "salut" }, { start: 0, end: 1000 }],
      })
    );
    expect(failure?.code).toBe("provider_failed");
  });

  it("skips an unusable utterance instead of dropping the whole transcript", () => {
    const transcript = normaliseAssemblyAiTranscript(
      completedTranscript({
        utterances: [
          utteranceFrom(TURN_A1),
          { speaker: "B", start: 1720, end: 2860, text: "", words: [] },
          utteranceFrom(TURN_A2),
        ],
      })
    );
    expect(transcript.segments).toHaveLength(2);
    expect(transcript.segments.map((segment) => segment.idx)).toEqual([0, 1]);
  });

  it("uses the utterance's own bounds when it carries no word list", () => {
    // Degenerate, but the turn's bounds are then the only honest timing we have.
    const transcript = normaliseAssemblyAiTranscript(
      completedTranscript({
        words: [],
        utterances: [{ speaker: "A", start: 500, end: 2500, text: "Bonjour à toutes et à tous." }],
        audioDuration: 3,
      })
    );
    expect(transcript.segments).toHaveLength(1);
    expect(transcript.segments[0].start).toBe(0.5);
    expect(transcript.segments[0].end).toBe(2.5);
    expect(transcript.speakers[0].seconds).toBeCloseTo(2, 5);
  });
});
