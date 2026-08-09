// Groq provider unit tests.
//
// There is NO Groq API key in this environment, so nothing here talks to Groq.
// Every payload below is HANDWRITTEN against Groq's documented `verbose_json`
// schema (task / language / duration / text / segments[] / words[]) — it is a
// fixture, not a recording, and no assertion claims otherwise.

import { describe, expect, it } from "vitest";
import type { Env } from "../../env";
import {
  GROQ_FREE_TIER_MAX_UPLOAD_BYTES,
  GROQ_MINIMUM_BILLED_SECONDS,
  GROQ_MODEL,
  GROQ_TRANSCRIPTIONS_URL,
  groqBilledSeconds,
  groqProvider,
  hasGroqApiKey,
  normaliseGroqTranscript,
  normaliseLanguageHint,
  parseRetryAfterSeconds,
  whisperLanguageToTag,
} from "./groq";
import {
  TRANSCRIPTION_MAX_UPLOAD_BYTES,
  TranscriptionError,
  isTranscriptionError,
  type NormalisedTranscript,
  type TranscriptWord,
  type TranscriptionAudioSource,
  type TranscriptionJobHandle,
  type TranscriptionRequest,
} from "./types";

const keyedEnv = { GROQ_API_KEY: "gsk_test_key" } as Env;
const keylessEnv = {} as Env;
const blankKeyEnv = { GROQ_API_KEY: "   " } as Env;

/**
 * Real `avg_logprob` values, present because Whisper really does report this field
 * per segment — the fixture would be a lie without it. exp() of them is 0.8 and 0.5
 * respectively, which is exactly why they are here: they are the values that would
 * expose a per-word confidence broadcast if we ever reintroduced one. Whisper's own
 * quality gate accepts avg_logprob down to -1.0, so none of these means "uncertain".
 */
const AVG_LOGPROB_08 = -0.2231435513;
const AVG_LOGPROB_05 = -0.6931471806;

/** Every word of a transcript, flattened. */
function allWords(transcript: NormalisedTranscript): TranscriptWord[] {
  return transcript.segments.flatMap((segment) => segment.words);
}

/** Groq documents the request id in the response BODY, under `x_groq.id`. */
const FIXTURE_REQUEST_ID = "req_01jadbd1e2f8sdb0z8s0p0h0q";

function verboseJsonFixture(): Record<string, unknown> {
  return {
    task: "transcribe",
    language: "french",
    duration: 12.48,
    text: "Bonjour à tous. Aujourd'hui nous parlons de la conjugaison.",
    segments: [
      {
        id: 0,
        seek: 0,
        start: 0,
        end: 3.24,
        text: " Bonjour à tous.",
        tokens: [50365, 33858, 3985],
        temperature: 0,
        avg_logprob: AVG_LOGPROB_08,
        compression_ratio: 1.18,
        no_speech_prob: 0.0142,
      },
      {
        id: 1,
        seek: 0,
        start: 3.24,
        end: 12.48,
        text: " Aujourd'hui nous parlons de la conjugaison.",
        tokens: [50528, 12007, 4123],
        temperature: 0,
        avg_logprob: AVG_LOGPROB_05,
        compression_ratio: 1.31,
        no_speech_prob: 0.0031,
      },
    ],
    words: [
      { word: "Bonjour", start: 0.12, end: 0.68 },
      { word: "à", start: 0.68, end: 0.8 },
      { word: "tous.", start: 0.8, end: 1.24 },
      { word: "Aujourd'hui", start: 3.3, end: 4.02 },
      { word: "nous", start: 4.02, end: 4.24 },
      { word: "parlons", start: 4.24, end: 4.8 },
      { word: "de", start: 4.8, end: 4.92 },
      { word: "la", start: 4.92, end: 5.04 },
      { word: "conjugaison.", start: 5.04, end: 6.1 },
    ],
    x_groq: { id: FIXTURE_REQUEST_ID },
  };
}

interface Capture {
  url: string;
  init: RequestInit | undefined;
}

function capturingFetcher(
  captures: Capture[],
  respond: () => Response
): typeof fetch {
  return async (input, init) => {
    captures.push({ url: String(input), init });
    return respond();
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function urlRequest(overrides: Partial<TranscriptionRequest> = {}): TranscriptionRequest {
  return {
    audio: { kind: "url", url: "https://cdn.example.com/episode-42.mp3" },
    diarize: false,
    languageHint: null,
    durationSeconds: null,
    ...overrides,
  };
}

function formFrom(capture: Capture): FormData {
  const body = capture.init?.body;
  if (!(body instanceof FormData)) throw new Error("expected a multipart body");
  return body;
}

async function runToTranscript(
  env: Env,
  fetcher: typeof fetch,
  overrides: Partial<TranscriptionRequest> = {}
) {
  const provider = groqProvider(env);
  const handle = await provider.submit(urlRequest({ ...overrides, fetcher }));
  return { handle, transcript: await provider.fetchTranscript(handle) };
}

// ---------------------------------------------------------------------------

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

describe("groqProvider capabilities", () => {
  it("declares no diarization and word timestamps", () => {
    const provider = groqProvider(keyedEnv);
    expect(provider.id).toBe("groq");
    expect(provider.model).toBe(GROQ_MODEL);
    expect(provider.capabilities.diarization).toBe(false);
    expect(provider.capabilities.wordTimestamps).toBe(true);
    expect(provider.capabilities.multilingualWithinFile).toBe(false);
    expect(provider.capabilities.languageDetection).toBe(true);
  });
});

describe("groqProvider request shape", () => {
  it("posts verbose_json with both timestamp granularities and the url param", async () => {
    const captures: Capture[] = [];
    const fetcher = capturingFetcher(captures, () => jsonResponse(verboseJsonFixture()));

    await runToTranscript(keyedEnv, fetcher);

    expect(captures).toHaveLength(1);
    expect(captures[0].url).toBe(GROQ_TRANSCRIPTIONS_URL);
    expect(captures[0].init?.method).toBe("POST");
    const headers = new Headers(captures[0].init?.headers);
    expect(headers.get("authorization")).toBe("Bearer gsk_test_key");
    // The boundary must be chosen by fetch, so we must not have set it ourselves.
    expect(headers.get("content-type")).toBeNull();

    const form = formFrom(captures[0]);
    expect(form.get("model")).toBe(GROQ_MODEL);
    expect(form.get("response_format")).toBe("verbose_json");
    expect(form.getAll("timestamp_granularities[]")).toEqual(["word", "segment"]);
    expect(form.get("url")).toBe("https://cdn.example.com/episode-42.mp3");
    expect(form.get("file")).toBeNull();
    // No hint given, so no language field — let Whisper detect.
    expect(form.get("language")).toBeNull();
  });

  it("sends a normalised language hint and drops a nonsense one", async () => {
    const withHint: Capture[] = [];
    await runToTranscript(
      keyedEnv,
      capturingFetcher(withHint, () => jsonResponse(verboseJsonFixture())),
      { languageHint: "fr-CA" }
    );
    expect(formFrom(withHint[0]).get("language")).toBe("fr");

    const withJunk: Capture[] = [];
    await runToTranscript(
      keyedEnv,
      capturingFetcher(withJunk, () => jsonResponse(verboseJsonFixture())),
      { languageHint: "français canadien" }
    );
    expect(formFrom(withJunk[0]).get("language")).toBeNull();
  });

  it("carries a wall-clock deadline, so a stalled provider cannot hold the consumer", async () => {
    // See the Deepgram twin of this test: a stall with no deadline ends as an
    // isolate kill, a redelivery, and a second bill for the same media.
    const captures: Capture[] = [];
    await groqProvider(keyedEnv).submit(
      urlRequest({ fetcher: capturingFetcher(captures, () => jsonResponse(verboseJsonFixture())) })
    );
    const signal = captures[0].init?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });

  it("reports an aborted request as provider_unavailable, never as the teacher's fault", async () => {
    const fetcher: typeof fetch = async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    };
    await expect(groqProvider(keyedEnv).submit(urlRequest({ fetcher }))).rejects.toMatchObject({
      failure: { code: "provider_unavailable", provider: "groq" },
    });
  });

  it("multipart-uploads bytes instead of a url", async () => {
    const captures: Capture[] = [];
    const provider = groqProvider(keyedEnv);
    await provider.submit({
      audio: bytesAudio({
        payload: new Uint8Array([0x49, 0x44, 0x33, 0x04]),
        contentType: "audio/mpeg",
        filename: "cours-01.mp3",
      }),
      diarize: false,
      fetcher: capturingFetcher(captures, () => jsonResponse(verboseJsonFixture())),
    });

    const form = formFrom(captures[0]);
    expect(form.get("url")).toBeNull();
    // workers-types narrows FormData.get() to `string | null`, so read it as
    // unknown and narrow at runtime — the real entry is a File.
    const file: unknown = form.get("file");
    if (!(file instanceof File)) throw new Error("expected a file part");
    expect(file.size).toBe(4);
    expect(file.type).toBe("audio/mpeg");
    // The filename matters: Groq infers the container from its extension.
    expect(file.name).toBe("cours-01.mp3");
  });
});

describe("normalisation of a verbose_json payload", () => {
  it("maps metadata honestly for a provider that cannot diarize", async () => {
    // No `x-request-id` header at all: Groq documents the id in the body, so the
    // job must still be traceable from a header-less response.
    const { transcript, handle } = await runToTranscript(keyedEnv, async () =>
      jsonResponse(verboseJsonFixture())
    );

    expect(handle.ready).toBe(true);
    expect(handle.providerJobId).toBe(FIXTURE_REQUEST_ID);
    expect(transcript.metadata).toEqual({
      provider: "groq",
      providerJobId: FIXTURE_REQUEST_ID,
      model: GROQ_MODEL,
      durationSeconds: 12.48,
      detectedLanguages: ["fr"],
      diarization: false,
      speakerCount: null,
      channels: 1,
    });
    expect(transcript.speakers).toEqual([]);
    expect(transcript.text).toBe("Bonjour à tous. Aujourd'hui nous parlons de la conjugaison.");
  });

  it("prefers the documented body id over a proxy x-request-id header", async () => {
    const { handle, transcript } = await runToTranscript(
      keyedEnv,
      async () =>
        new Response(JSON.stringify(verboseJsonFixture()), {
          headers: { "content-type": "application/json", "x-request-id": "req_edge_proxy" },
        })
    );

    expect(handle.providerJobId).toBe(FIXTURE_REQUEST_ID);
    expect(transcript.metadata.providerJobId).toBe(FIXTURE_REQUEST_ID);
  });

  it("falls back to the x-request-id header when the body carries no x_groq", async () => {
    const withoutXGroq = verboseJsonFixture();
    delete withoutXGroq.x_groq;

    const { handle } = await runToTranscript(
      keyedEnv,
      async () =>
        new Response(JSON.stringify(withoutXGroq), {
          headers: { "content-type": "application/json", "x-request-id": "req_from_header" },
        })
    );

    expect(handle.providerJobId).toBe("req_from_header");
  });

  it("reports a null provider job id rather than an empty one when neither source has it", async () => {
    const withoutXGroq = verboseJsonFixture();
    withoutXGroq.x_groq = { id: "   " };

    const { handle, transcript } = await runToTranscript(keyedEnv, async () =>
      jsonResponse(withoutXGroq)
    );

    expect(handle.providerJobId).toBeNull();
    expect(transcript.metadata.providerJobId).toBeNull();
  });

  it("buckets words into the provider's own segments", async () => {
    const { transcript } = await runToTranscript(keyedEnv, async () =>
      jsonResponse(verboseJsonFixture())
    );

    expect(transcript.segments).toHaveLength(2);
    expect(transcript.segments.map((segment) => segment.idx)).toEqual([0, 1]);
    expect(transcript.segments[0].text).toBe("Bonjour à tous.");
    expect(transcript.segments[0].words.map((word) => word.text)).toEqual(["Bonjour", "à", "tous."]);
    expect(transcript.segments[1].words.map((word) => word.text)).toEqual([
      "Aujourd'hui",
      "nous",
      "parlons",
      "de",
      "la",
      "conjugaison.",
    ]);
    // Segment bounds always contain their words.
    expect(transcript.segments[0].start).toBe(0);
    expect(transcript.segments[0].end).toBe(3.24);
    expect(transcript.segments[1].start).toBe(3.24);
    expect(transcript.segments[1].end).toBe(12.48);
  });

  it("preserves every word timing exactly as Groq reported it", async () => {
    const fixture = verboseJsonFixture();
    const expected = fixture.words;
    if (!Array.isArray(expected)) throw new Error("fixture words missing");

    const { transcript } = await runToTranscript(keyedEnv, async () => jsonResponse(fixture));

    const flattened = transcript.segments.flatMap((segment) => segment.words);
    expect(flattened).toHaveLength(expected.length);
    expect(flattened.map((word) => [word.text, word.start, word.end])).toEqual([
      ["Bonjour", 0.12, 0.68],
      ["à", 0.68, 0.8],
      ["tous.", 0.8, 1.24],
      ["Aujourd'hui", 3.3, 4.02],
      ["nous", 4.02, 4.24],
      ["parlons", 4.24, 4.8],
      ["de", 4.8, 4.92],
      ["la", 4.92, 5.04],
      ["conjugaison.", 5.04, 6.1],
    ]);
  });

  it("leaves every speaker null — Whisper cannot diarize", async () => {
    const { transcript } = await runToTranscript(keyedEnv, async () =>
      jsonResponse(verboseJsonFixture())
    );

    expect(transcript.segments.every((segment) => segment.speaker === null)).toBe(true);
    expect(transcript.segments.flatMap((s) => s.words).every((word) => word.speaker === null)).toBe(true);
    expect(transcript.metadata.speakerCount).toBeNull();
  });

  it("still transcribes when diarization was requested, and says diarization did not happen", async () => {
    const { transcript } = await runToTranscript(
      keyedEnv,
      async () => jsonResponse(verboseJsonFixture()),
      { diarize: true }
    );

    expect(transcript.metadata.diarization).toBe(false);
    expect(transcript.speakers).toEqual([]);
    expect(transcript.segments).toHaveLength(2);
  });

  it("reports null per-word confidence — Whisper has no per-word probability", async () => {
    // The fixture's two segments carry avg_logprob -0.223 and -0.693 (exp() = 0.8 and
    // 0.5). Neither number may reach a word: `avg_logprob` describes a whole segment,
    // and the reader thresholds `word.confidence` per word to flag "worth a second
    // listen". A broadcast segment value would make that flagging all-or-nothing per
    // segment and, at exp() < 0.6, mark every word of a perfectly good French
    // sentence. The contract's answer for a provider with no per-word probability is
    // null, and null is what the reader's null-guarded check reads as "not flagged".
    const { transcript } = await runToTranscript(keyedEnv, async () =>
      jsonResponse(verboseJsonFixture())
    );

    expect(allWords(transcript)).toHaveLength(9);
    expect(allWords(transcript).every((word) => word.confidence === null)).toBe(true);
  });

  it("reports null per-word confidence at every avg_logprob Whisper considers acceptable", async () => {
    // -0.511 is where exp(avg_logprob) crosses the reader's 0.6 threshold, and Whisper
    // accepts output down to -1.0. Both sides of that line must behave identically:
    // no word carries a number, so nothing can flip on it.
    for (const avgLogprob of [-0.1, -0.5, -0.511, AVG_LOGPROB_05, -0.8, -1.0, -2.5]) {
      const fixture = verboseJsonFixture();
      const segments = fixture.segments;
      if (!Array.isArray(segments)) throw new Error("fixture segments missing");
      for (const segment of segments) {
        if (typeof segment === "object" && segment !== null) {
          Object.assign(segment, { avg_logprob: avgLogprob });
        }
      }

      const { transcript } = await runToTranscript(keyedEnv, async () => jsonResponse(fixture));
      const scored = allWords(transcript).filter((word) => word.confidence !== null);
      expect(scored).toEqual([]);
    }
  });

  it("leaves per-word language null and reports the media language once", async () => {
    const { transcript } = await runToTranscript(keyedEnv, async () =>
      jsonResponse(verboseJsonFixture())
    );

    expect(transcript.segments.flatMap((s) => s.words).every((word) => word.language === null)).toBe(true);
    expect(transcript.segments.every((segment) => segment.language === "fr")).toBe(true);
    expect(transcript.metadata.detectedLanguages).toEqual(["fr"]);
  });

  it("passes an unknown Whisper language name through untouched", () => {
    expect(whisperLanguageToTag("french")).toBe("fr");
    expect(whisperLanguageToTag("English")).toBe("en");
    expect(whisperLanguageToTag("spanish")).toBe("es");
    expect(whisperLanguageToTag("wolof")).toBe("wolof");
    expect(whisperLanguageToTag("fr")).toBe("fr");
    expect(whisperLanguageToTag("  ")).toBeNull();
    expect(whisperLanguageToTag(null)).toBeNull();
  });

  it("keeps segment text when a stretch has no word timings", () => {
    const transcript = normaliseGroqTranscript(
      {
        language: "english",
        duration: 4,
        text: "One sentence only.",
        segments: [{ start: 0, end: 4, text: "One sentence only.", avg_logprob: AVG_LOGPROB_05 }],
      },
      { providerJobId: null, model: GROQ_MODEL }
    );

    expect(transcript.segments).toHaveLength(1);
    // One coarse word carrying the segment's real bounds — no invented timings.
    expect(transcript.segments[0].words).toEqual([
      {
        text: "One sentence only.",
        start: 0,
        end: 4,
        speaker: null,
        // Still null, even though this shell had an avg_logprob to broadcast.
        confidence: null,
        language: null,
      },
    ]);
  });

  // REGRESSION — observed live on 2026-08-09 against Groq request
  // req_01kzktasakewe91ac7d3795wvy (InnerFrench E89, 05:39-11:03). Groq's
  // `segments[].text` and top-level `text` truncate every token at its first
  // accented character or apostrophe, while `words[]` carries the same audio
  // intact. The corrupted strings below are the SHAPE of that real damage.
  // Before the fix these assertions failed: the reader and the .txt export both
  // rendered segment text, so a teacher downloaded "je vais vous l dans quelques
  // instants". Deleting this test re-opens a 2.5x word-error-rate regression.
  it("rebuilds French segment text from words when Groq truncates at accents and apostrophes", () => {
    const transcript = normaliseGroqTranscript(
      {
        language: "french",
        duration: 6,
        // Corrupted exactly as Groq sends it: c'est -> c, sécurité -> s,
        // l'expliquer -> l, and "États-Unis" dropped entirely.
        text: "si on sait ce que c cette loi s globale Un peu de patience Je vais vous l",
        segments: [
          {
            start: 0,
            end: 3,
            text: "si on sait ce que c cette loi s globale",
            avg_logprob: AVG_LOGPROB_05,
          },
          {
            start: 3,
            end: 6,
            text: "Un peu de patience Je vais vous l",
            avg_logprob: AVG_LOGPROB_05,
          },
        ],
        words: [
          { word: "si", start: 0.0, end: 0.2 },
          { word: "on", start: 0.2, end: 0.4 },
          { word: "sait", start: 0.4, end: 0.7 },
          { word: "ce", start: 0.7, end: 0.9 },
          { word: "que", start: 0.9, end: 1.1 },
          { word: "c'est", start: 1.1, end: 1.5 },
          { word: "cette", start: 1.5, end: 1.8 },
          { word: "loi", start: 1.8, end: 2.1 },
          { word: "sécurité", start: 2.1, end: 2.6 },
          { word: "globale", start: 2.6, end: 3.0 },
          { word: "Un", start: 3.0, end: 3.2 },
          { word: "peu", start: 3.2, end: 3.4 },
          { word: "de", start: 3.4, end: 3.6 },
          { word: "patience", start: 3.6, end: 4.2 },
          { word: "Je", start: 4.2, end: 4.4 },
          { word: "vais", start: 4.4, end: 4.7 },
          { word: "vous", start: 4.7, end: 5.0 },
          { word: "l'expliquer", start: 5.0, end: 6.0 },
        ],
      },
      { providerJobId: "req_01kzktasakewe91ac7d3795wvy", model: GROQ_MODEL }
    );

    // The elision and the accented word survive into the text a teacher reads,
    // downloads and searches — not just into the words array.
    expect(transcript.segments[0].text).toBe("si on sait ce que c'est cette loi sécurité globale");
    expect(transcript.segments[1].text).toBe("Un peu de patience Je vais vous l'expliquer");

    // The whole-transcript string is built from the repaired segments, never from
    // the equally-corrupted top-level `text`.
    expect(transcript.text).toContain("c'est");
    expect(transcript.text).toContain("sécurité");
    expect(transcript.text).toContain("l'expliquer");
    expect(transcript.text).not.toContain("ce que c cette");
    expect(transcript.text).not.toContain("vous l globale");
  });

  it("still uses segment text for a stretch Groq gave no words for", () => {
    const transcript = normaliseGroqTranscript(
      {
        language: "french",
        duration: 4,
        text: "Une phrase entière.",
        segments: [{ start: 0, end: 4, text: "Une phrase entière.", avg_logprob: AVG_LOGPROB_05 }],
        words: [],
      },
      { providerJobId: null, model: GROQ_MODEL }
    );

    // No words to rebuild from, so the shell's own text is the only honest source.
    expect(transcript.segments[0].text).toBe("Une phrase entière.");
    expect(transcript.text).toBe("Une phrase entière.");
  });

  it("synthesises one segment when only words came back", () => {
    const transcript = normaliseGroqTranscript(
      {
        duration: 2,
        words: [
          { word: "Salut", start: 0.1, end: 0.5 },
          { word: "toi", start: 0.5, end: 0.9 },
        ],
      },
      { providerJobId: "req_1", model: GROQ_MODEL }
    );

    expect(transcript.segments).toHaveLength(1);
    expect(transcript.segments[0].text).toBe("Salut toi");
    expect(transcript.segments[0].words).toHaveLength(2);
    expect(transcript.segments[0].words[0].confidence).toBeNull();
    expect(transcript.metadata.detectedLanguages).toEqual([]);
    expect(transcript.text).toBe("Salut toi");
  });

  it("falls back to the last segment end when duration is missing", () => {
    const transcript = normaliseGroqTranscript(
      { text: "Fin.", segments: [{ start: 0, end: 7.5, text: "Fin." }] },
      { providerJobId: null, model: GROQ_MODEL }
    );
    expect(transcript.metadata.durationSeconds).toBe(7.5);
  });

  it("accepts a silent recording as an empty transcript, not a failure", () => {
    const transcript = normaliseGroqTranscript(
      { language: "english", duration: 3, text: "", segments: [], words: [] },
      { providerJobId: null, model: GROQ_MODEL }
    );
    expect(transcript.segments).toEqual([]);
    expect(transcript.text).toBe("");
    expect(transcript.metadata.durationSeconds).toBe(3);
  });
});

describe("groqProvider failures", () => {
  it("reports provider_unavailable without calling out when the key is missing", async () => {
    let called = 0;
    const fetcher: typeof fetch = async () => {
      called += 1;
      return jsonResponse(verboseJsonFixture());
    };

    for (const env of [keylessEnv, blankKeyEnv]) {
      const error = await groqProvider(env)
        .submit(urlRequest({ fetcher }))
        .catch((caught: unknown) => caught);
      expect(isTranscriptionError(error)).toBe(true);
      if (!isTranscriptionError(error)) throw error;
      expect(error.failure).toEqual({ code: "provider_unavailable", provider: "groq", status: undefined });
      expect(error.message).toBe("provider_unavailable");
    }
    expect(called).toBe(0);
    expect(hasGroqApiKey(keylessEnv)).toBe(false);
    expect(hasGroqApiKey(blankKeyEnv)).toBe(false);
    expect(hasGroqApiKey(keyedEnv)).toBe(true);
  });

  it("maps 429 to provider_unavailable and understands every retry-after shape", async () => {
    const fetcher: typeof fetch = async () =>
      jsonResponse(
        { error: { message: "Rate limit reached for model whisper-large-v3-turbo" } },
        { status: 429, headers: { "retry-after": "7" } }
      );

    await expect(groqProvider(keyedEnv).submit(urlRequest({ fetcher }))).rejects.toMatchObject({
      failure: { code: "provider_unavailable", provider: "groq", status: 429 },
    });

    expect(parseRetryAfterSeconds("7")).toBe(7);
    expect(parseRetryAfterSeconds("2m59.56s")).toBeCloseTo(179.56, 6);
    expect(parseRetryAfterSeconds("1h2m3s")).toBe(3723);
    expect(
      parseRetryAfterSeconds("Wed, 21 Oct 2015 07:28:30 GMT", Date.parse("Wed, 21 Oct 2015 07:28:00 GMT"))
    ).toBe(30);
    expect(parseRetryAfterSeconds(null)).toBeNull();
    expect(parseRetryAfterSeconds("later")).toBeNull();
  });

  // Naming note: this asserts the MAPPING only. That the queue then actually
  // retries such a job is a property of the router, and is pinned down by
  // "rethrows provider_unavailable so the queue can retry" in
  // worker/lib/transcription-jobs.test.ts — not here.
  it("maps every 5xx to provider_unavailable, the one retryable code", async () => {
    for (const status of [500, 502, 503]) {
      const fetcher: typeof fetch = async () => new Response("upstream boom", { status });
      await expect(groqProvider(keyedEnv).submit(urlRequest({ fetcher }))).rejects.toMatchObject({
        failure: { code: "provider_unavailable", provider: "groq", status },
      });
    }
  });

  it("maps a bad key (401) to provider_unavailable, never to a teacher-facing auth error", async () => {
    const fetcher: typeof fetch = async () =>
      jsonResponse({ error: { message: "Invalid API Key" } }, { status: 401 });
    await expect(groqProvider(keyedEnv).submit(urlRequest({ fetcher }))).rejects.toMatchObject({
      failure: { code: "provider_unavailable", provider: "groq", status: 401 },
    });
  });

  it("maps a provider 413 to source_too_large quoting the free-tier ceiling", async () => {
    const fetcher: typeof fetch = async () => new Response("too big", { status: 413 });

    await expect(
      groqProvider(keyedEnv).submit({
        audio: bytesAudio({
          payload: new Uint8Array(64),
          contentType: "audio/mpeg",
          filename: "long.mp3",
        }),
        diarize: false,
        fetcher,
      })
    ).rejects.toMatchObject({
      failure: { code: "source_too_large", bytes: 64, maxBytes: GROQ_FREE_TIER_MAX_UPLOAD_BYTES },
    });
  });

  it("maps 415 to unsupported_media_type with the content type we sent", async () => {
    const fetcher: typeof fetch = async () => new Response("nope", { status: 415 });
    await expect(
      groqProvider(keyedEnv).submit({
        audio: bytesAudio({
          payload: new Uint8Array(8),
          contentType: "application/zip",
          filename: "bundle.zip",
        }),
        diarize: false,
        fetcher,
      })
    ).rejects.toMatchObject({
      failure: { code: "unsupported_media_type", contentType: "application/zip" },
    });
  });

  // Groq pulls the link from ITS network, our ingest HEADed it from Cloudflare's.
  // A link that answered us can still refuse Groq (hotlink protection, geo-blocks,
  // expired signed redirect targets), and that must read as "this link will never
  // work" — not as "the service is down, retry" on a link that can only fail again.
  it("maps a 400 that says Groq could not download the link to source_unreachable", async () => {
    for (const message of [
      "could not fetch the url you provided",
      "Failed to download the audio file from the provided URL",
      "Error accessing remote content at url: 403 Forbidden",
    ]) {
      const fetcher: typeof fetch = async () => jsonResponse({ error: { message } }, { status: 400 });

      const error = await groqProvider(keyedEnv)
        .submit(urlRequest({ fetcher }))
        .catch((caught: unknown) => caught);
      if (!isTranscriptionError(error)) throw error;
      expect(error.failure).toEqual({ code: "source_unreachable", status: 400 });
    }
  });

  // The other half of the same branch: a parameter rejection is Groq's or ours to
  // explain, and blaming the teacher's link for it would be the mirror-image lie.
  it("keeps a 400 about our own parameters as provider_failed carrying the provider message", async () => {
    const fetcher: typeof fetch = async () =>
      jsonResponse(
        { error: { message: "The model `whisper-large-v9` does not exist" } },
        { status: 400 }
      );

    const error = await groqProvider(keyedEnv)
      .submit(urlRequest({ fetcher }))
      .catch((caught: unknown) => caught);
    if (!isTranscriptionError(error)) throw error;
    expect(error.failure).toEqual({
      code: "provider_failed",
      provider: "groq",
      status: 400,
      detail: "The model `whisper-large-v9` does not exist",
    });
  });

  // No source URL exists on the upload path, so the same prose cannot mean the
  // teacher's link is dead — it stays the provider's failure to explain.
  it("never blames the link on the upload path, whatever the 400 says", async () => {
    const fetcher: typeof fetch = async () =>
      jsonResponse({ error: { message: "could not fetch the url you provided" } }, { status: 400 });

    const error = await groqProvider(keyedEnv)
      .submit({
        audio: bytesAudio({
          payload: new Uint8Array(8),
          contentType: "audio/mpeg",
          filename: "cours.mp3",
        }),
        diarize: false,
        fetcher,
      })
      .catch((caught: unknown) => caught);
    if (!isTranscriptionError(error)) throw error;
    expect(error.failure).toEqual({
      code: "provider_failed",
      provider: "groq",
      status: 400,
      detail: "could not fetch the url you provided",
    });
  });

  it("maps a malformed 200 body to provider_failed, never to an empty transcript", async () => {
    const fetcher: typeof fetch = async () =>
      new Response("<html>gateway</html>", { status: 200, headers: { "content-type": "text/html" } });

    const error = await groqProvider(keyedEnv)
      .submit(urlRequest({ fetcher }))
      .catch((caught: unknown) => caught);
    if (!isTranscriptionError(error)) throw error;
    expect(error.failure.code).toBe("provider_failed");
  });

  it("maps a well-formed but unusable payload to provider_failed", () => {
    for (const raw of [null, 42, "text", [], { ok: true }]) {
      expect(() => normaliseGroqTranscript(raw, { providerJobId: null, model: GROQ_MODEL })).toThrow(
        TranscriptionError
      );
    }
  });

  it("maps a network throw to provider_unavailable", async () => {
    const fetcher: typeof fetch = async () => {
      throw new TypeError("network error");
    };
    await expect(groqProvider(keyedEnv).submit(urlRequest({ fetcher }))).rejects.toMatchObject({
      failure: { code: "provider_unavailable", provider: "groq" },
    });
  });

  it("refuses an over-ceiling upload before spending a request", async () => {
    let called = 0;
    const fetcher: typeof fetch = async () => {
      called += 1;
      return jsonResponse(verboseJsonFixture());
    };
    await expect(
      groqProvider(keyedEnv).submit({
        // The declared size is the gate; allocating 64 MB in a test to prove it
        // would only measure the test runner's heap.
        audio: bytesAudio({
          sizeBytes: TRANSCRIPTION_MAX_UPLOAD_BYTES + 1,
          contentType: "audio/mpeg",
          filename: "huge.mp3",
        }),
        diarize: false,
        fetcher,
      })
    ).rejects.toMatchObject({
      failure: {
        code: "source_too_large",
        bytes: TRANSCRIPTION_MAX_UPLOAD_BYTES + 1,
        maxBytes: TRANSCRIPTION_MAX_UPLOAD_BYTES,
      },
    });
    expect(called).toBe(0);
  });

  it("refuses a source over the 90-minute cap before spending a request", async () => {
    let called = 0;
    const fetcher: typeof fetch = async () => {
      called += 1;
      return jsonResponse(verboseJsonFixture());
    };

    await expect(
      groqProvider(keyedEnv).submit(urlRequest({ fetcher, durationSeconds: 5_401 }))
    ).rejects.toMatchObject({
      failure: { code: "source_too_long", durationSeconds: 5_401, maxSeconds: 5_400 },
    });
    expect(called).toBe(0);
  });

  it("rejects a handle that belongs to another provider", async () => {
    const handle: TranscriptionJobHandle = {
      provider: "deepgram",
      providerJobId: "dg_1",
      model: "nova-3",
      ready: true,
      raw: {},
    };
    await expect(groqProvider(keyedEnv).fetchTranscript(handle)).rejects.toMatchObject({
      failure: { code: "internal" },
    });
  });

  it("rejects an unready handle — Groq has no polling mode", async () => {
    const handle: TranscriptionJobHandle = {
      provider: "groq",
      providerJobId: null,
      model: GROQ_MODEL,
      ready: false,
      raw: verboseJsonFixture(),
    };
    await expect(groqProvider(keyedEnv).fetchTranscript(handle)).rejects.toMatchObject({
      failure: { code: "provider_failed", provider: "groq" },
    });
  });
});

describe("billing helpers", () => {
  it("applies Groq's 10-second minimum without ever rounding down", () => {
    expect(groqBilledSeconds(0)).toBe(GROQ_MINIMUM_BILLED_SECONDS);
    expect(groqBilledSeconds(3.2)).toBe(GROQ_MINIMUM_BILLED_SECONDS);
    expect(groqBilledSeconds(10)).toBe(10);
    expect(groqBilledSeconds(12.48)).toBe(13);
    expect(groqBilledSeconds(Number.NaN)).toBe(GROQ_MINIMUM_BILLED_SECONDS);
  });

  it("keeps the metadata duration honest rather than pre-inflated to the minimum", () => {
    const transcript = normaliseGroqTranscript(
      { language: "french", duration: 4.2, text: "Bref.", segments: [{ start: 0, end: 4.2, text: "Bref." }] },
      { providerJobId: null, model: GROQ_MODEL }
    );
    expect(transcript.metadata.durationSeconds).toBe(4.2);
    expect(groqBilledSeconds(transcript.metadata.durationSeconds)).toBe(10);
  });

  it("normalises language hints", () => {
    expect(normaliseLanguageHint("fr")).toBe("fr");
    expect(normaliseLanguageHint("EN-GB")).toBe("en");
    expect(normaliseLanguageHint("es_419")).toBe("es");
    expect(normaliseLanguageHint(null)).toBeNull();
    expect(normaliseLanguageHint(undefined)).toBeNull();
    expect(normaliseLanguageHint("")).toBeNull();
    expect(normaliseLanguageHint("gibberish")).toBeNull();
  });
});
