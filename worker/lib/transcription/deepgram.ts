// Deepgram `nova-3` — the "identify speakers" path of the Transcription Studio.
//
// One HTTPS POST to https://api.deepgram.com/v1/listen returns the whole
// payload, so `submit` hands back a ready handle and `fetchTranscript` only
// normalises. The two-step split stays because the contract keeps room for a
// genuinely async provider later.
//
// ---------------------------------------------------------------------------
// BILLING — Deepgram charges PER CHANNEL.
// ---------------------------------------------------------------------------
// `multichannel=true` transcribes AND bills every channel separately, so a
// plain stereo podcast would cost exactly twice what the same audio costs in
// mono. We therefore send `multichannel=false` EXPLICITLY rather than trusting
// the account default (which an admin could flip in the Deepgram console), and
// we only ever read `results.channels[0]`. Deepgram downmixes to a single
// channel for us, which is also a hard requirement of `diarize=true`: speakers
// are separated statistically from one mixed channel, never by channel index.
// Consequence: `TranscriptMetadata.channels` is always 1.
//
// `diarize` and `smart_format` are included in the per-minute price — there is
// no reason to ever ask for this model without them.
//
// LANGUAGE — we always send `language=multi` and deliberately ignore
// `request.languageHint`. nova-3 multilingual detects and mixes languages
// inside one file, which is exactly the classroom case (a French teacher
// playing an English clip). Narrowing to a single hinted language would make a
// code-switching recording worse, and a hint Deepgram does not accept would
// turn a good job into a hard 400.

import {
  TRANSCRIPTION_MAX_SOURCE_SECONDS,
  TRANSCRIPTION_MAX_UPLOAD_BYTES,
  TranscriptionError,
  type NormalisedTranscript,
  type TranscriptionFailure,
  type TranscriptSegment,
  type TranscriptSpeaker,
  type TranscriptWord,
  type TranscriptionAudioSource,
  type TranscriptionCapabilities,
  type TranscriptionJobHandle,
  type TranscriptionProvider,
  type TranscriptionRequest,
} from "./types";
import type { Env } from "../../env";

const DEEPGRAM_ENDPOINT = "https://api.deepgram.com/v1/listen";

export const DEEPGRAM_MODEL = "nova-3";

export const DEEPGRAM_CAPABILITIES: TranscriptionCapabilities = {
  diarization: true,
  wordTimestamps: true,
  multilingualWithinFile: true,
  languageDetection: true,
  maxSourceSeconds: TRANSCRIPTION_MAX_SOURCE_SECONDS,
};

/** Statuses that mean "not us, try later" rather than "your request was wrong". */
const UNAVAILABLE_STATUSES: ReadonlySet<number> = new Set([401, 402, 403, 408, 429, 500, 502, 503, 504]);

/** A new segment starts once a turn is this long AND the speaker pauses. */
const SEGMENT_SOFT_MAX_WORDS = 90;
const SEGMENT_PAUSE_SECONDS = 0.4;
/** Absolute ceiling, so a pause-free monologue still breaks into readable turns. */
const SEGMENT_HARD_MAX_WORDS = 220;

/** Provider error bodies are for our logs only — never shown to a teacher. */
const MAX_DETAIL_LENGTH = 300;

/**
 * Wall-clock ceiling for the one POST that does the work.
 *
 * nova-3 transcribes far faster than real time, so ten minutes is generous for a
 * 90-minute source. Without a deadline a stalled connection holds the queue
 * consumer until the platform kills the isolate, and the redelivered message
 * would be a second billed submission.
 */
const DEEPGRAM_TIMEOUT_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Unknown-payload readers. `raw` is `unknown` by contract; only this module is
// allowed to narrow it, and it narrows field by field with no casts.
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function truncate(value: string): string {
  return value.length > MAX_DETAIL_LENGTH ? `${value.slice(0, MAX_DETAIL_LENGTH)}…` : value;
}

function providerFailed(detail: string, status?: number): TranscriptionError {
  return new TranscriptionError({ code: "provider_failed", provider: "deepgram", status, detail });
}

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

/**
 * `diarize` follows THE REQUEST, not the provider's ability.
 *
 * Hard-coding it to true made the shape of the answer depend on which tier the
 * cascade happened to reach: the same plain job came back with speaker labels
 * from Deepgram and without them from Groq, and `transcription_jobs.diarization`
 * then recorded which provider ran rather than what the teacher asked for — while
 * its own doc comment says the opposite. Diarization is included in Deepgram's
 * per-minute price, so this costs nothing either way; it just makes the stored
 * flag mean what it claims to mean. AssemblyAI already sends `request.diarize`.
 */
function buildListenUrl(request: TranscriptionRequest): string {
  const url = new URL(DEEPGRAM_ENDPOINT);
  url.searchParams.set("model", DEEPGRAM_MODEL);
  url.searchParams.set("language", "multi");
  url.searchParams.set("diarize", request.diarize ? "true" : "false");
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("punctuate", "true");
  // Word-level timings are what the reading view is built on.
  url.searchParams.set("utterances", "false");
  // See the billing note at the top of this file: explicit, never defaulted.
  url.searchParams.set("multichannel", "false");
  return url.toString();
}

interface RequestBody {
  body: BodyInit;
  contentType: string;
}

function bodyFor(audio: TranscriptionAudioSource): RequestBody {
  if (audio.kind === "url") {
    return { body: JSON.stringify({ url: audio.url }), contentType: "application/json" };
  }
  // The Blob goes in as the body untouched: `fetch` sends it without our making
  // a second copy of the media in a 128 MB isolate, and it carries its own length.
  return {
    body: audio.blob,
    contentType: readString(audio.contentType) ?? "application/octet-stream",
  };
}

// ---------------------------------------------------------------------------
// Error bodies
// ---------------------------------------------------------------------------
// Deepgram answers a rejection with `{ err_code, err_msg, request_id }`.
// `err_code` is the machine-readable half and we must not throw it away:
// flattening every 4xx into `provider_failed` tells the teacher "the
// transcription service had a problem" when the actual problem is on their
// side and fixable by them.

/** The two halves of a Deepgram error body: the machine code and the sentence. */
interface DeepgramErrorBody {
  errCode: string | null;
  /** For our logs only — never shown to a teacher. */
  detail: string;
}

/**
 * Deepgram's documented sentence for REMOTE_CONTENT_ERROR, used only as a
 * fallback when `err_code` is absent. Deliberately narrow so a generic outage
 * page can never be mistaken for a broken link.
 */
const REMOTE_CONTENT_MESSAGE = /remote content/i;

/**
 * Corrupt or unreadable media arrives as `err_code: "Bad Request"` — too generic
 * to route on — so this case is identified by Deepgram's documented sentence
 * "failed to process audio: corrupt or unsupported data".
 */
const CORRUPT_AUDIO_MESSAGE = /failed to process audio|corrupt or unsupported/i;

/**
 * Deepgram publishes no exhaustive `err_code` list, so this matches the *shape*
 * of a code that names Deepgram's own side. It is only ever used to refuse to
 * blame the teacher — never to build a failure — so a false positive costs at
 * most a generic provider failure instead of a wrong diagnosis.
 */
const SERVER_FAULT_ERR_CODE = /INTERNAL|SERVER_ERROR|UPSTREAM|UNAVAILABLE|TIMEOUT/;

function isClientError(status: number): boolean {
  return status >= 400 && status < 500;
}

function namesServerFault(errCode: string | null): boolean {
  return errCode !== null && SERVER_FAULT_ERR_CODE.test(errCode);
}

function errorBodyFrom(body: string): DeepgramErrorBody {
  const parsed: unknown = (() => {
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return null;
    }
  })();
  const record = asRecord(parsed);
  const message = record ? readString(record.err_msg) ?? readString(record.message) : null;
  return {
    errCode: record ? readString(record.err_code) : null,
    detail: truncate(message ?? body.trim()),
  };
}

function unsupportedMediaType(audio: TranscriptionAudioSource): TranscriptionFailure {
  const contentType = audio.kind === "bytes" ? readString(audio.contentType) : null;
  return contentType === null ? { code: "unsupported_media_type" } : { code: "unsupported_media_type", contentType };
}

function sourceTooLarge(audio: TranscriptionAudioSource): TranscriptionFailure {
  return {
    code: "source_too_large",
    // Deepgram never reports the size it refused. 0 is this contract's
    // "unknown" sentinel — the same one `parseStoredFailure` uses.
    bytes: audio.kind === "bytes" ? audio.sizeBytes : 0,
    maxBytes: TRANSCRIPTION_MAX_UPLOAD_BYTES,
  };
}

/**
 * Maps a Deepgram rejection to the failure that names the real culprit, or null
 * when the rejection genuinely is ours or theirs to explain.
 *
 * REMOTE_CONTENT_ERROR is the single most likely real-world failure of the whole
 * URL path: our ingest HEADs the link from a Cloudflare Worker, while Deepgram
 * fetches it from its own network with its own user agent. Podcast CDNs
 * routinely refuse non-browser clients, and Apple/RSS redirect targets expire —
 * so a HEAD that worked for us is no proof Deepgram can download it. Reporting
 * that as our provider's fault would send the teacher looking in the wrong
 * place; `source_unreachable` tells them the *link* is the problem.
 *
 * Every verdict here is terminal — it blames the teacher's link or file and the
 * job never retries. So apart from the one explicit REMOTE_CONTENT_ERROR code,
 * nothing fires outside the 4xx class: Deepgram's own outage bodies say things
 * like "failed to process audio" too, and reading that off a 500 would tell a
 * teacher their recording is corrupt and permanently fail a job a retry would
 * have completed.
 */
function failureForErrorBody(
  status: number,
  body: DeepgramErrorBody,
  audio: TranscriptionAudioSource
): TranscriptionFailure | null {
  const errCode = body.errCode === null ? null : body.errCode.toUpperCase();
  // The one deliberate cross-status override: this code is machine-readable and
  // names the teacher's link, whatever status carried it.
  if (errCode === "REMOTE_CONTENT_ERROR") {
    return { code: "source_unreachable", status };
  }
  // A machine-readable code naming Deepgram's side outranks any prose below, and
  // a 5xx is Deepgram's failure by definition. Both mean: not the teacher's fault.
  if (namesServerFault(errCode) || !isClientError(status)) {
    return null;
  }
  if (errCode === null && REMOTE_CONTENT_MESSAGE.test(body.detail)) {
    return { code: "source_unreachable", status };
  }
  if (status === 415 || CORRUPT_AUDIO_MESSAGE.test(body.detail)) {
    return unsupportedMediaType(audio);
  }
  if (status === 413) {
    return sourceTooLarge(audio);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function readWord(value: unknown): TranscriptWord | null {
  const record = asRecord(value);
  if (!record) return null;
  // smart_format puts the capitalised, punctuated form in `punctuated_word`;
  // `word` is the bare token. Preferring the former is what keeps sentences
  // readable in the transcript view.
  const text = readString(record.punctuated_word) ?? readString(record.word);
  const start = readNumber(record.start);
  const end = readNumber(record.end);
  if (text === null || start === null || end === null) return null;
  const speaker = readNumber(record.speaker);
  return {
    text,
    start,
    end: Math.max(start, end),
    // Deepgram numbers its speakers from 0; String(N) is the stable id the
    // whole app keys on, and the UI renders its own localised label from index.
    speaker: speaker === null ? null : String(Math.trunc(speaker)),
    confidence: readNumber(record.confidence),
    language: readString(record.language),
  };
}

function dominantLanguage(words: readonly TranscriptWord[]): string | null {
  const totals = languageTotals(words);
  return totals.length > 0 ? totals[0][0] : null;
}

/** Languages ranked by spoken seconds, most spoken first. */
function languageTotals(words: readonly TranscriptWord[]): Array<[string, number]> {
  const totals = new Map<string, number>();
  for (const word of words) {
    if (word.language === null) continue;
    totals.set(word.language, (totals.get(word.language) ?? 0) + Math.max(0, word.end - word.start));
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}

function makeSegment(idx: number, words: TranscriptWord[]): TranscriptSegment {
  return {
    idx,
    speaker: words[0].speaker,
    start: words[0].start,
    end: words[words.length - 1].end,
    text: words.map((word) => word.text).join(" "),
    words,
    language: dominantLanguage(words),
  };
}

/**
 * Groups consecutive words into turns. A speaker change always starts a new
 * segment; inside one long turn (or in an undiarized transcript, where there
 * are no turns at all) we break on a pause so the reading view still gets
 * paragraph-sized blocks instead of one wall of text.
 */
function buildSegments(words: readonly TranscriptWord[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let current: TranscriptWord[] = [];

  const flush = (): void => {
    if (current.length === 0) return;
    segments.push(makeSegment(segments.length, current));
    current = [];
  };

  for (const word of words) {
    const previous = current[current.length - 1];
    if (previous !== undefined) {
      const speakerChanged = previous.speaker !== word.speaker;
      const gap = word.start - previous.end;
      const pauseBreak = current.length >= SEGMENT_SOFT_MAX_WORDS && gap >= SEGMENT_PAUSE_SECONDS;
      if (speakerChanged || pauseBreak || current.length >= SEGMENT_HARD_MAX_WORDS) flush();
    }
    current.push(word);
  }
  flush();
  return segments;
}

/**
 * Speakers in order of first appearance, with their total SPEAKING time.
 *
 * `seconds` sums each WORD's own duration — never the wall-clock span of the turn
 * the word sits in. `buildSegments` only cuts a same-speaker run after
 * SEGMENT_SOFT_MAX_WORDS *and* a SEGMENT_PAUSE_SECONDS pause, so every shorter
 * silence (a breath, a teacher writing on the board, a student answering off-mic)
 * stays inside one segment. Measuring `segment.end - segment.start` would bill all
 * of it to that speaker as speech: two words carrying 0.4 s of audio 30 s apart
 * would read as 30 seconds spoken. types.ts documents this field as "total
 * speaking time" and the transcript view shows it to the teacher, so it has to be
 * speech, not elapsed time.
 *
 * Words arrive in media order, so first appearance here is the same order the
 * segments have.
 */
function buildSpeakers(words: readonly TranscriptWord[]): TranscriptSpeaker[] {
  const speakers = new Map<string, TranscriptSpeaker>();
  for (const word of words) {
    if (word.speaker === null) continue;
    const seconds = Math.max(0, word.end - word.start);
    const existing = speakers.get(word.speaker);
    if (existing) {
      existing.seconds += seconds;
      continue;
    }
    speakers.set(word.speaker, {
      id: word.speaker,
      index: speakers.size,
      label: `speaker_${word.speaker}`,
      seconds,
    });
  }
  return [...speakers.values()];
}

/**
 * Turns a Deepgram pre-recorded response into the shared transcript shape.
 * Exported so fixtures can be normalised directly in tests.
 */
export function normaliseDeepgramTranscript(payload: unknown): NormalisedTranscript {
  const root = asRecord(payload);
  if (!root) throw providerFailed("Response body was not an object.");

  const results = asRecord(root.results);
  const channels = results ? asArray(results.channels) : null;
  const channel = channels && channels.length > 0 ? asRecord(channels[0]) : null;
  const alternatives = channel ? asArray(channel.alternatives) : null;
  const alternative = alternatives && alternatives.length > 0 ? asRecord(alternatives[0]) : null;
  if (!alternative) throw providerFailed("Response carried no transcript alternative.");

  const rawWords = asArray(alternative.words);
  if (!rawWords) throw providerFailed("Transcript alternative carried no word list.");

  const words: TranscriptWord[] = [];
  for (const entry of rawWords) {
    const word = readWord(entry);
    if (word !== null) words.push(word);
  }
  // A response with words we cannot read at all is malformed, not an empty
  // recording — say so instead of returning a plausible-looking blank.
  if (words.length === 0 && rawWords.length > 0) {
    throw providerFailed("No word in the response carried usable text and timings.");
  }

  const metadata = asRecord(root.metadata);
  const reportedChannels = metadata ? readNumber(metadata.channels) : null;
  if (reportedChannels !== null && reportedChannels > 1) {
    // We asked for multichannel=false, so this would mean per-channel billing.
    console.warn("Deepgram reported multiple channels despite multichannel=false", {
      channels: reportedChannels,
    });
  }

  const segments = buildSegments(words);
  // Built from the words, not the segments: speaking time must exclude the
  // silences a segment span swallows. See buildSpeakers.
  const speakers = buildSpeakers(words);
  const diarization = speakers.length > 0;

  const languages = languageTotals(words).map(([language]) => language);
  const channelLanguage = channel ? readString(channel.detected_language) : null;
  // `language=multi` answers "multi" (or nothing) at channel level, which is not
  // a language a teacher can read — only keep a concrete fallback.
  if (languages.length === 0 && channelLanguage !== null && channelLanguage !== "multi") {
    languages.push(channelLanguage);
  }

  const lastWordEnd = words.length > 0 ? words[words.length - 1].end : 0;
  const duration = metadata ? readNumber(metadata.duration) : null;

  return {
    metadata: {
      provider: "deepgram",
      providerJobId: metadata ? readString(metadata.request_id) : null,
      model: readModel(metadata) ?? DEEPGRAM_MODEL,
      durationSeconds: duration !== null && duration > 0 ? duration : lastWordEnd,
      detectedLanguages: languages,
      diarization,
      speakerCount: diarization ? speakers.length : null,
      // Always 1 by construction — see the billing note at the top.
      channels: 1,
    },
    speakers,
    segments,
    text: segments.map((segment) => segment.text).join("\n\n"),
  };
}

function readModel(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null;
  const models = asArray(metadata.models);
  const first = models && models.length > 0 ? readString(models[0]) : null;
  // `models` holds opaque model UUIDs; only accept something that reads like a
  // model name, otherwise keep our own constant.
  return first !== null && first.includes("nova") ? first : null;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function deepgramProvider(env: Env): TranscriptionProvider {
  const apiKey = readString(env.DEEPGRAM_API_KEY);
  if (apiKey === null) {
    throw new TranscriptionError({ code: "provider_unavailable", provider: "deepgram" });
  }

  return {
    id: "deepgram",
    model: DEEPGRAM_MODEL,
    capabilities: DEEPGRAM_CAPABILITIES,

    async submit(request: TranscriptionRequest): Promise<TranscriptionJobHandle> {
      // `durationSeconds` is the contract's provider ceiling check. The job
      // pipeline already refuses an over-long source, but a provider must not
      // depend on its caller to avoid billing us for audio we would reject.
      const knownDuration = request.durationSeconds ?? null;
      if (knownDuration !== null && knownDuration > DEEPGRAM_CAPABILITIES.maxSourceSeconds) {
        throw new TranscriptionError({
          code: "source_too_long",
          durationSeconds: Math.ceil(knownDuration),
          maxSeconds: DEEPGRAM_CAPABILITIES.maxSourceSeconds,
        });
      }

      const doFetch = request.fetcher ?? fetch;
      const { body, contentType } = bodyFor(request.audio);

      let response: Response;
      try {
        response = await doFetch(buildListenUrl(request), {
          method: "POST",
          headers: {
            Authorization: `Token ${apiKey}`,
            "Content-Type": contentType,
            Accept: "application/json",
          },
          body,
          signal: AbortSignal.timeout(DEEPGRAM_TIMEOUT_MS),
        });
      } catch {
        // Network-level failure or a stall past the deadline: nothing about the
        // request was wrong, so this is 503 and the queue may retry it.
        throw new TranscriptionError({ code: "provider_unavailable", provider: "deepgram" });
      }

      if (!response.ok) {
        const body = errorBodyFrom(await response.text().catch(() => ""));
        // Deepgram's own error code outranks the HTTP status class: a body that
        // says REMOTE_CONTENT_ERROR is about the teacher's link whatever status
        // carried it, and calling that a provider outage would hide the fix.
        const mapped = failureForErrorBody(response.status, body, request.audio);
        if (mapped !== null) throw new TranscriptionError(mapped);
        if (UNAVAILABLE_STATUSES.has(response.status)) {
          throw new TranscriptionError({
            code: "provider_unavailable",
            provider: "deepgram",
            status: response.status,
          });
        }
        throw providerFailed(body.detail.length > 0 ? body.detail : "Deepgram rejected the request.", response.status);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw providerFailed("Deepgram answered with a body we could not read.", response.status);
      }

      const metadata = asRecord(asRecord(payload)?.metadata);
      return {
        provider: "deepgram",
        providerJobId: metadata ? readString(metadata.request_id) : null,
        model: DEEPGRAM_MODEL,
        // Pre-recorded transcription answers in-band; there is nothing to poll.
        ready: true,
        raw: payload,
      };
    },

    async fetchTranscript(handle: TranscriptionJobHandle): Promise<NormalisedTranscript> {
      if (handle.provider !== "deepgram") {
        throw providerFailed(`Handle belongs to ${handle.provider}, not deepgram.`);
      }
      if (!handle.ready) {
        throw providerFailed("Deepgram pre-recorded jobs answer in-band; there is nothing to poll.");
      }
      return normaliseDeepgramTranscript(handle.raw);
    },
  };
}
