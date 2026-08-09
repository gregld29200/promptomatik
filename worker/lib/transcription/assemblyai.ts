// AssemblyAI `universal-3.5-pro` — the Transcription Studio's UNIVERSAL BACKSTOP.
//
// Unlike the other two providers this one can serve BOTH lanes: it transcribes
// plainly and it diarizes, so it is the fallback whichever box the teacher
// ticked. That is the whole reason it exists as tier 3: Groq is cheap but cannot
// label speakers at all, Deepgram labels them but costs 8x, and when either is
// rate-limited or down there has to be one provider that can still finish the
// job the teacher asked for.
//
// ---------------------------------------------------------------------------
// WHY universal-3.5-pro AND NOT THE CHEAPER TIER
// ---------------------------------------------------------------------------
// Our allowance is denominated in HOURS (185 of them), not in dollars, so an
// hour of audio costs exactly one hour of allowance on every model AssemblyAI
// offers. The better model is therefore free-equivalent here, and it is the one
// with the strongest French diarization and native code-switching — which is the
// classroom case (a French teacher playing an English clip mid-lesson).
//
// ---------------------------------------------------------------------------
// ASYNC, UNLIKE GROQ AND DEEPGRAM
// ---------------------------------------------------------------------------
// This is the first genuinely two-step provider, which is exactly what the
// contract's `submit` / `fetchTranscript` split was kept for:
//   POST /v2/transcript  -> { id, status: "queued" }     (`ready: false`)
//   GET  /v2/transcript/{id} until status is "completed" or "error".
// Uploaded bytes need one extra hop first — POST /v2/upload returns a private
// `upload_url` that only AssemblyAI can read — because `audio_url` is the only
// way to give this API media.
//
// ---------------------------------------------------------------------------
// UNITS — THE ONE THING THIS FILE MUST NOT GET WRONG
// ---------------------------------------------------------------------------
// A single AssemblyAI payload mixes two units:
//   * `words[].start/end` and `utterances[].start/end` are MILLISECONDS.
//   * `audio_duration` is SECONDS.
// The shared contract is seconds everywhere, so every word timing is divided by
// 1000 and the duration is NOT. Dropping that division would multiply every
// timestamp by 1000: a 4-second clip would render as a 75-minute one, the
// reading cursor would never move, and per-speaker "speaking time" would read in
// hours. `msToSeconds` is the only place the conversion happens.
//
// ---------------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------------
// `Authorization: <key>` — a bare key, with NO "Bearer" and no "Token" prefix.
// AssemblyAI answers a prefixed key with a 401 that looks exactly like an
// expired key, so this is worth a test rather than a comment alone.

import type { Env } from "../../env";
import {
  TRANSCRIPTION_MAX_SOURCE_SECONDS,
  TRANSCRIPTION_MAX_UPLOAD_BYTES,
  TranscriptionError,
  type NormalisedTranscript,
  type TranscriptSegment,
  type TranscriptSpeaker,
  type TranscriptWord,
  type TranscriptionAudioSource,
  type TranscriptionCapabilities,
  type TranscriptionFailure,
  type TranscriptionJobHandle,
  type TranscriptionProvider,
  type TranscriptionRequest,
} from "./types";

export const ASSEMBLYAI_BASE_URL = "https://api.assemblyai.com/v2";
export const ASSEMBLYAI_MODEL = "universal-3.5-pro";

export const ASSEMBLYAI_CAPABILITIES: TranscriptionCapabilities = {
  // The point of tier 3: it can honour "identify speakers" as well as Deepgram,
  // so it is a valid substitute for BOTH lanes.
  diarization: true,
  wordTimestamps: true,
  multilingualWithinFile: true,
  languageDetection: true,
  maxSourceSeconds: TRANSCRIPTION_MAX_SOURCE_SECONDS,
};

/** Provider error bodies are for our logs only — never shown to a teacher. */
const MAX_DETAIL_LENGTH = 300;

/** Statuses that mean "not us, try later" rather than "your request was wrong". */
const UNAVAILABLE_STATUSES: ReadonlySet<number> = new Set([401, 402, 403, 408, 429, 500, 502, 503, 504]);

/**
 * Wall-clock ceiling for one HTTP call. The create/upload calls are quick; a poll
 * is a tiny JSON read. Without a deadline a stalled socket holds the queue
 * consumer until the platform kills the isolate, and the redelivered message
 * would be a second submission — billed again against the free hours.
 */
const ASSEMBLYAI_REQUEST_TIMEOUT_MS = 60 * 1000;
/** Uploads carry the media itself, so they get the same generous window as a Groq POST. */
const ASSEMBLYAI_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Ceiling for the WHOLE poll loop. universal-3.5-pro runs at several times real
 * time, so a 90-minute lecture lands well inside this; 12 minutes leaves the
 * consumer room to finish its own bookkeeping afterwards.
 */
const ASSEMBLYAI_POLL_DEADLINE_MS = 12 * 60 * 1000;
const ASSEMBLYAI_POLL_INITIAL_MS = 2_000;
const ASSEMBLYAI_POLL_MAX_INTERVAL_MS = 10_000;
const ASSEMBLYAI_POLL_BACKOFF = 1.5;

/** A new segment starts once a turn is this long AND the speaker pauses. */
const SEGMENT_SOFT_MAX_WORDS = 90;
const SEGMENT_PAUSE_SECONDS = 0.4;
/** Absolute ceiling, so a pause-free monologue still breaks into readable turns. */
const SEGMENT_HARD_MAX_WORDS = 220;

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
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_DETAIL_LENGTH ? `${collapsed.slice(0, MAX_DETAIL_LENGTH)}…` : collapsed;
}

/**
 * THE conversion. AssemblyAI reports word and utterance timings in milliseconds;
 * the shared transcript shape is seconds everywhere. Rounding to the millisecond
 * first keeps `1720 → 1.72` exact instead of leaking binary-float noise into
 * every timestamp the reading view renders.
 */
export function msToSeconds(milliseconds: number): number {
  return Math.round(milliseconds) / 1000;
}

function providerFailed(detail: string, status?: number): TranscriptionError {
  return new TranscriptionError({ code: "provider_failed", provider: "assemblyai", status, detail });
}

function providerUnavailable(status?: number): TranscriptionError {
  return new TranscriptionError({ code: "provider_unavailable", provider: "assemblyai", status });
}

/** A blank string counts as absent, so a half-filled secret never looks configured. */
export function hasAssemblyAiApiKey(env: Env): boolean {
  return readString(env.ASSEMBLYAI_API_KEY) !== null;
}

// ---------------------------------------------------------------------------
// Error prose
// ---------------------------------------------------------------------------
// AssemblyAI has no machine-readable error code — neither on a rejected create
// call nor on a terminal `status: "error"` transcript. Both carry one English
// sentence in `error`. So, exactly as groq.ts does, a download failure is
// recognised from THREE ingredients that must all be present: the act of
// pulling, the fact that it did not work, and the thing being pulled. Requiring
// all three keeps "Invalid speech_model" or "authentication failed" from ever
// being read as a broken link.

const FETCH_VERB =
  /\b(download|downloading|downloaded|fetch|fetching|fetched|retriev(?:e|ing|ed)|access(?:ing|ed)?|reach(?:ing|ed)?)\b/i;
const FETCH_FAILED =
  /\b(could ?not|couldn'?t|cannot|can'?t|unable|fail(?:ed|s|ure)?|invalid|error|timed? ?out|refused|forbidden|not found)\b/i;
/**
 * The thing being pulled. A literal URL counts: AssemblyAI's own download failure
 * reads "Download error, unable to download https://…", where the link itself is
 * the only noun naming the target.
 */
const FETCH_TARGET = /\b(url|uri|link|audio|file|media|content|source)\b|https?:\/\//i;

/**
 * True when a message says AssemblyAI itself could not download the media.
 *
 * This is NOT redundant with our ingest HEAD: we probe the link from
 * Cloudflare's egress, AssemblyAI pulls it from its own. Hotlink protection,
 * geo-blocks and the short-lived signed URLs inside Apple/Megaphone redirect
 * chains all make a link that answered us refuse a provider. Reporting that as
 * `provider_failed` tells the teacher the service is broken and to retry the
 * dead link forever; `source_unreachable` names the thing they can actually fix.
 */
function namesDownloadFailure(detail: string): boolean {
  return FETCH_VERB.test(detail) && FETCH_FAILED.test(detail) && FETCH_TARGET.test(detail);
}

/**
 * AssemblyAI's documented wording for media it could read but not decode. Kept
 * separate from the download matcher because the verdict is different: the link
 * worked, the file is the problem.
 */
const UNREADABLE_MEDIA = /transcod(?:e|ing)|does not appear to contain audio|no audio|corrupt|unsupported (?:file|format|media)/i;

/**
 * What we handed AssemblyAI, reduced to the three facts a failure needs.
 *
 * It is plain JSON so it can ride on the handle: `fetchTranscript` never sees the
 * request, and a terminal error that arrives minutes later still has to name the
 * right culprit and quote the teacher's own content type.
 */
interface MediaContext {
  /** True when the media was the teacher's own URL, not bytes we uploaded. */
  remoteSource: boolean;
  contentType: string | null;
  sizeBytes: number | null;
}

function mediaContextFor(audio: TranscriptionAudioSource): MediaContext {
  return audio.kind === "url"
    ? { remoteSource: true, contentType: null, sizeBytes: null }
    : { remoteSource: false, contentType: readString(audio.contentType), sizeBytes: audio.sizeBytes };
}

function unsupportedMediaType(context: MediaContext): TranscriptionFailure {
  return context.contentType === null
    ? { code: "unsupported_media_type" }
    : { code: "unsupported_media_type", contentType: context.contentType };
}

function sourceTooLarge(context: MediaContext): TranscriptionFailure {
  return {
    code: "source_too_large",
    // 0 is this contract's "unknown" sentinel — the same one `parseStoredFailure` uses.
    bytes: context.sizeBytes ?? 0,
    maxBytes: TRANSCRIPTION_MAX_UPLOAD_BYTES,
  };
}

/**
 * Maps a failure sentence to the failure that names the real culprit.
 *
 * `remoteSource` is what keeps an upload from ever being blamed on the teacher's
 * link: when we uploaded the bytes ourselves, the `audio_url` AssemblyAI failed
 * to download is AssemblyAI's OWN storage, so a download error there is theirs,
 * not a link the teacher could fix.
 */
function failureForMessage(detail: string, context: MediaContext, status?: number): TranscriptionFailure | null {
  if (UNREADABLE_MEDIA.test(detail)) return unsupportedMediaType(context);
  if (context.remoteSource && namesDownloadFailure(detail)) {
    return status === undefined ? { code: "source_unreachable" } : { code: "source_unreachable", status };
  }
  return null;
}

interface ErrorBody {
  /** For our logs only — never shown to a teacher. */
  detail: string;
}

function errorBodyFrom(body: string): ErrorBody {
  const parsed: unknown = (() => {
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return null;
    }
  })();
  const record = asRecord(parsed);
  const message = record ? readString(record.error) ?? readString(record.message) : null;
  return { detail: truncate(message ?? body) };
}

/** One place where an HTTP rejection becomes a failure, for all three endpoints. */
function failureForResponse(status: number, body: ErrorBody, context: MediaContext): TranscriptionError {
  if (status === 413) return new TranscriptionError(sourceTooLarge(context));
  if (status === 415) return new TranscriptionError(unsupportedMediaType(context));
  // A 5xx is AssemblyAI's own failure by definition, and its outage pages mention
  // "audio" too — reading that prose off a 500 would tell a teacher their
  // recording is corrupt and terminally fail a job a retry would have completed.
  if (status < 500) {
    const mapped = failureForMessage(body.detail, context, status);
    if (mapped !== null) return new TranscriptionError(mapped);
  }
  if (UNAVAILABLE_STATUSES.has(status) || status >= 500) return providerUnavailable(status);
  return providerFailed(body.detail.length > 0 ? body.detail : "AssemblyAI rejected the request.", status);
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** One raw word as AssemblyAI writes it, before any unit conversion. */
function readWord(value: unknown, fallbackSpeaker: string | null): TranscriptWord | null {
  const record = asRecord(value);
  if (!record) return null;
  const text = readString(record.text);
  const startMs = readNumber(record.start);
  const endMs = readNumber(record.end);
  if (text === null || startMs === null || endMs === null) return null;
  const start = msToSeconds(startMs);
  const end = msToSeconds(endMs);
  // `speaker` is "A", "B", … and is already a stable opaque id; the UI renders its
  // own localised label from `index`, never this string.
  const speaker = readString(record.speaker) ?? fallbackSpeaker;
  return {
    text,
    start,
    end: Math.max(start, end),
    speaker,
    confidence: readNumber(record.confidence),
    // Only the multilingual models tag words individually; most payloads leave
    // this absent and the file-level `language_code` is the only signal.
    language: readString(record.language) ?? readString(record.language_code),
  };
}

function readWords(value: unknown, fallbackSpeaker: string | null): TranscriptWord[] {
  const raw = asArray(value);
  if (raw === null) return [];
  const words: TranscriptWord[] = [];
  for (const entry of raw) {
    const word = readWord(entry, fallbackSpeaker);
    if (word !== null) words.push(word);
  }
  return words;
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

function dominantLanguage(words: readonly TranscriptWord[], fallback: string | null): string | null {
  const totals = languageTotals(words);
  return totals.length > 0 ? totals[0][0] : fallback;
}

/**
 * Speakers in order of first appearance, with their total SPEAKING time.
 *
 * `seconds` sums each WORD's own duration — never the wall-clock span of the turn
 * the word sits in. An AssemblyAI utterance runs from the speaker's first word to
 * their last, so it swallows every pause inside the turn: a teacher who says one
 * word, writes on the board for twenty seconds and says one more has ONE
 * utterance spanning 20.4 s and 0.8 s of speech. types.ts documents this field as
 * "total speaking time" and the transcript view shows it to the teacher, so it
 * has to be speech. (The same defect was fixed in deepgram.ts; it is not coming
 * back through this door.)
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
 * Turns from AssemblyAI's own `utterances[]`.
 *
 * WHY UTTERANCES AND NOT `words[].speaker`: both carry the same labels, but the
 * utterance list is the diarization model's OWN grouping — the boundaries its
 * dashboard shows and the ones its confidence is computed over. Re-deriving turns
 * by scanning `words[].speaker` for changes gives different, worse boundaries: a
 * single mislabelled word in the middle of a long answer splits one turn into
 * three (and invents a phantom speaker turn of one word), which is visible noise
 * in the reading view. `utterances[].text` is also the formatted, punctuated turn,
 * whereas joining words re-punctuates by hand. When speaker_labels is off there
 * are no utterances at all, and that is the only case that falls back to grouping
 * the flat word list.
 */
function segmentsFromUtterances(rawUtterances: unknown[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  for (const entry of rawUtterances) {
    const record = asRecord(entry);
    if (!record) continue;
    const speaker = readString(record.speaker);
    const startMs = readNumber(record.start);
    const endMs = readNumber(record.end);
    const words = readWords(record.words, speaker);
    const text = readString(record.text) ?? words.map((word) => word.text).join(" ");
    if (text.length === 0) continue;

    // A word list is always present in practice; when it is not, the utterance's
    // own bounds are the only honest timing that exists, so it becomes one coarse
    // word rather than a fabricated per-word breakdown. This is the single path
    // where a speaker's seconds can include an intra-turn pause — because in that
    // payload nothing finer than the turn was ever reported.
    const start = words.length > 0 ? words[0].start : startMs === null ? 0 : msToSeconds(startMs);
    const end =
      words.length > 0 ? words[words.length - 1].end : endMs === null ? start : Math.max(start, msToSeconds(endMs));
    const segmentWords: TranscriptWord[] =
      words.length > 0
        ? words
        : [{ text, start, end, speaker, confidence: readNumber(record.confidence), language: null }];

    segments.push({
      idx: segments.length,
      speaker,
      start,
      end,
      text,
      words: segmentWords,
      language: dominantLanguage(segmentWords, null),
    });
  }
  return segments;
}

/**
 * Groups a flat word list into paragraph-sized turns. Used only when there are no
 * utterances (speaker_labels off): a speaker change still breaks a turn, and
 * inside one long run we break on a pause so the reading view gets paragraphs
 * instead of one wall of text.
 */
function segmentsFromWords(words: readonly TranscriptWord[], fallbackLanguage: string | null): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let current: TranscriptWord[] = [];

  const flush = (): void => {
    if (current.length === 0) return;
    const group = current;
    segments.push({
      idx: segments.length,
      speaker: group[0].speaker,
      start: group[0].start,
      end: group[group.length - 1].end,
      text: group.map((word) => word.text).join(" "),
      words: group,
      language: dominantLanguage(group, fallbackLanguage),
    });
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

/** The file-level language, ignoring the placeholder a multilingual job reports. */
function fileLanguage(root: Record<string, unknown>): string | null {
  const code = readString(root.language_code);
  return code === null || code === "multi" ? null : code;
}

/**
 * Turns one completed AssemblyAI transcript into the shared shape.
 * Exported so fixtures can be normalised directly in tests.
 */
export function normaliseAssemblyAiTranscript(payload: unknown): NormalisedTranscript {
  const root = asRecord(payload);
  if (!root) throw providerFailed("Response body was not an object.");

  const status = readString(root.status);
  if (status !== null && status !== "completed") {
    throw providerFailed(`Transcript was not completed (status: ${status}).`);
  }

  const rawUtterances = asArray(root.utterances);
  const rawWords = asArray(root.words);
  const fullText = readString(root.text);
  if (rawUtterances === null && rawWords === null && fullText === null) {
    // Not a silent recording — a payload with none of the three fields a
    // transcript must have. Say so instead of returning a plausible-looking blank.
    throw providerFailed("Transcript carried no words, no utterances and no text.");
  }

  const language = fileLanguage(root);
  const flatWords = readWords(rawWords, null);
  if (flatWords.length === 0 && rawWords !== null && rawWords.length > 0) {
    throw providerFailed("No word in the response carried usable text and timings.");
  }

  const segments =
    rawUtterances !== null && rawUtterances.length > 0
      ? segmentsFromUtterances(rawUtterances)
      : segmentsFromWords(flatWords, language);

  // Speakers come from the words the segments actually carry: with utterances the
  // flat `words[]` may be absent from the payload entirely, and either way the
  // total must be a sum of word durations, never of turn spans.
  const words = segments.flatMap((segment) => segment.words);
  const speakers = buildSpeakers(words);
  const diarization = speakers.length > 0;

  const languages = languageTotals(words).map(([tag]) => tag);
  if (languages.length === 0 && language !== null) languages.push(language);

  // `audio_duration` is in SECONDS while every word timing above was in
  // milliseconds. Do not "fix" this by dividing it.
  const reported = readNumber(root.audio_duration);
  const lastWordEnd = words.length > 0 ? words[words.length - 1].end : 0;

  return {
    metadata: {
      provider: "assemblyai",
      providerJobId: readString(root.id),
      model: readString(root.speech_model) ?? ASSEMBLYAI_MODEL,
      durationSeconds: reported !== null && reported > 0 ? reported : lastWordEnd,
      detectedLanguages: languages,
      diarization,
      speakerCount: diarization ? speakers.length : null,
      // AssemblyAI transcribes a downmixed single channel and bills per audio
      // hour, not per channel — a stereo podcast costs the same as a mono one.
      channels: 1,
    },
    speakers,
    segments,
    text: segments.map((segment) => segment.text).join("\n\n"),
  };
}

// ---------------------------------------------------------------------------
// Handle state
// ---------------------------------------------------------------------------

/**
 * What `submit` puts in `TranscriptionJobHandle.raw`.
 *
 * `raw` is `unknown` by contract and only this module reads it, so it carries
 * exactly what polling needs: the transcript id and the media context above. It
 * is plain JSON, so a handle survives serialisation.
 */
interface AssemblyAiHandleState {
  transcriptId: string;
  media: MediaContext;
  /** The completed payload, when the create call already returned one. */
  completed: unknown;
}

function isCompletedPayload(value: unknown): boolean {
  const record = asRecord(value);
  return record !== null && readString(record.status) === "completed";
}

const UNKNOWN_MEDIA: MediaContext = { remoteSource: false, contentType: null, sizeBytes: null };

function readMediaContext(value: unknown): MediaContext {
  const record = asRecord(value);
  if (!record) return UNKNOWN_MEDIA;
  return {
    remoteSource: record.remoteSource === true,
    contentType: readString(record.contentType),
    sizeBytes: readNumber(record.sizeBytes),
  };
}

function readHandleState(raw: unknown): AssemblyAiHandleState | null {
  const record = asRecord(raw);
  if (!record) return null;
  const transcriptId = readString(record.transcriptId);
  if (transcriptId !== null) {
    return {
      transcriptId,
      media: readMediaContext(record.media),
      completed: isCompletedPayload(record.completed) ? record.completed : null,
    };
  }
  // Tolerated: a bare AssemblyAI payload rather than our wrapper. Nothing is then
  // known about the media, so no failure can be blamed on the teacher's link.
  const id = readString(record.id);
  if (id === null) return null;
  return { transcriptId: id, media: UNKNOWN_MEDIA, completed: isCompletedPayload(record) ? record : null };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Test seams. Production passes nothing: the provider uses global `fetch`, real
 * timers and the real clock.
 */
export interface AssemblyAiProviderOptions {
  fetcher?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function nextInterval(current: number): number {
  return Math.min(ASSEMBLYAI_POLL_MAX_INTERVAL_MS, Math.round(current * ASSEMBLYAI_POLL_BACKOFF));
}

export function assemblyAiProvider(env: Env, options: AssemblyAiProviderOptions = {}): TranscriptionProvider {
  const apiKey = readString(env.ASSEMBLYAI_API_KEY);
  if (apiKey === null) {
    throw new TranscriptionError({ code: "provider_unavailable", provider: "assemblyai" });
  }

  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  // `fetchTranscript` takes only a handle — the contract gives it no fetcher — so
  // the seam `submit` was handed is remembered for the polling that follows it.
  // The consumer submits and polls inside one invocation, so this never leaks
  // across jobs; a provider that only ever polls falls back to the injected or
  // global fetch.
  let fetcher: typeof fetch = options.fetcher ?? fetch;

  const authHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
    // NO "Bearer": AssemblyAI wants the bare key.
    Authorization: apiKey,
    Accept: "application/json",
    ...extra,
  });

  /** Uploads the bytes and returns the private URL only AssemblyAI can read. */
  async function uploadMedia(audio: Extract<TranscriptionAudioSource, { kind: "bytes" }>): Promise<string> {
    let response: Response;
    try {
      response = await fetcher(`${ASSEMBLYAI_BASE_URL}/upload`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": readString(audio.contentType) ?? "application/octet-stream" }),
        // The Blob ingest read out of R2 goes in untouched: re-wrapping it would
        // hold a second full copy of the media in a 128 MB isolate.
        body: audio.blob,
        signal: AbortSignal.timeout(ASSEMBLYAI_UPLOAD_TIMEOUT_MS),
      });
    } catch {
      throw providerUnavailable();
    }

    if (!response.ok) {
      const body = errorBodyFrom(await response.text().catch(() => ""));
      throw failureForResponse(response.status, body, mediaContextFor(audio));
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw providerFailed("AssemblyAI answered the upload with a body we could not read.", response.status);
    }
    const uploadUrl = readString(asRecord(payload)?.upload_url);
    if (uploadUrl === null) throw providerFailed("AssemblyAI accepted the upload but returned no upload_url.");
    return uploadUrl;
  }

  async function createTranscript(
    audioUrl: string,
    request: TranscriptionRequest,
    media: MediaContext
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetcher(`${ASSEMBLYAI_BASE_URL}/transcript`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          audio_url: audioUrl,
          speech_model: ASSEMBLYAI_MODEL,
          speaker_labels: request.diarize,
          // Always detection, never `language_code`, and `request.languageHint` is
          // deliberately ignored — same reasoning as Deepgram's `language=multi`.
          // The hint we hold is the teacher's interface language, and pinning a
          // code-switching classroom recording to it would make the other language
          // worse; universal-3.5-pro handles the mix natively.
          language_detection: true,
          punctuate: true,
          format_text: true,
        }),
        signal: AbortSignal.timeout(ASSEMBLYAI_REQUEST_TIMEOUT_MS),
      });
    } catch {
      // Never reached, or stalled past the deadline: nothing about the request was
      // wrong, so this is 503 and the queue may retry it.
      throw providerUnavailable();
    }

    if (!response.ok) {
      const body = errorBodyFrom(await response.text().catch(() => ""));
      throw failureForResponse(response.status, body, media);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw providerFailed("AssemblyAI answered with a body we could not read.", response.status);
    }
    const record = asRecord(payload);
    if (record === null || readString(record.id) === null) {
      throw providerFailed("AssemblyAI accepted the job but returned no transcript id.", response.status);
    }
    return record;
  }

  /** One poll. Returns the payload, or null when the caller should wait and retry. */
  async function pollOnce(state: AssemblyAiHandleState): Promise<Record<string, unknown> | null> {
    let response: Response;
    try {
      response = await fetcher(`${ASSEMBLYAI_BASE_URL}/transcript/${encodeURIComponent(state.transcriptId)}`, {
        method: "GET",
        headers: authHeaders(),
        signal: AbortSignal.timeout(ASSEMBLYAI_REQUEST_TIMEOUT_MS),
      });
    } catch {
      // A blip while polling must not throw away a transcript we have already
      // paid for: wait and ask again until the deadline.
      return null;
    }

    if (!response.ok) {
      const status = response.status;
      // Rate limits and outages are transient — the job is still running on their
      // side, so keep waiting rather than resubmitting and billing it twice.
      if (status === 429 || status >= 500) return null;
      const body = errorBodyFrom(await response.text().catch(() => ""));
      throw failureForResponse(status, body, state.media);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw providerFailed("AssemblyAI answered a poll with a body we could not read.", response.status);
    }
    const record = asRecord(payload);
    if (record === null) throw providerFailed("AssemblyAI answered a poll with a body that was not an object.");

    const status = readString(record.status);
    if (status === "completed") return record;
    if (status === "error") {
      const detail = truncate(readString(record.error) ?? "AssemblyAI reported an error with no message.");
      const mapped = failureForMessage(detail, state.media);
      throw mapped !== null ? new TranscriptionError(mapped) : providerFailed(detail);
    }
    // "queued" / "processing", or a status we do not know: still in flight.
    return null;
  }

  async function pollUntilCompleted(state: AssemblyAiHandleState): Promise<Record<string, unknown>> {
    const startedAt = now();
    let interval = ASSEMBLYAI_POLL_INITIAL_MS;
    for (;;) {
      const payload = await pollOnce(state);
      if (payload !== null) return payload;
      if (now() - startedAt >= ASSEMBLYAI_POLL_DEADLINE_MS) {
        console.warn("AssemblyAI transcript did not finish inside the poll deadline", {
          transcriptId: state.transcriptId,
          deadlineMs: ASSEMBLYAI_POLL_DEADLINE_MS,
        });
        // Terminal on purpose. `provider_unavailable` would let the queue retry,
        // and a retry re-submits the SAME media — a second charge against the
        // free hours for a transcript that is very likely already finished.
        throw providerFailed(`Transcript ${state.transcriptId} was still running after the poll deadline.`);
      }
      await sleep(interval);
      interval = nextInterval(interval);
    }
  }

  return {
    id: "assemblyai",
    model: ASSEMBLYAI_MODEL,
    capabilities: ASSEMBLYAI_CAPABILITIES,

    async submit(request: TranscriptionRequest): Promise<TranscriptionJobHandle> {
      if (request.fetcher !== undefined) fetcher = request.fetcher;

      // The job pipeline already refuses an over-long source, but a provider must
      // not depend on its caller to avoid spending hours we would then reject.
      const knownDuration = request.durationSeconds ?? null;
      if (knownDuration !== null && knownDuration > ASSEMBLYAI_CAPABILITIES.maxSourceSeconds) {
        throw new TranscriptionError({
          code: "source_too_long",
          durationSeconds: Math.ceil(knownDuration),
          maxSeconds: ASSEMBLYAI_CAPABILITIES.maxSourceSeconds,
        });
      }
      if (request.audio.kind === "bytes" && request.audio.sizeBytes > TRANSCRIPTION_MAX_UPLOAD_BYTES) {
        throw new TranscriptionError({
          code: "source_too_large",
          bytes: request.audio.sizeBytes,
          maxBytes: TRANSCRIPTION_MAX_UPLOAD_BYTES,
        });
      }

      const audio = request.audio;
      const media = mediaContextFor(audio);
      // `audio_url` is the only way in, so uploaded bytes get a private
      // AssemblyAI-hosted URL first.
      const audioUrl = audio.kind === "url" ? audio.url : await uploadMedia(audio);

      const created = await createTranscript(audioUrl, request, media);
      const transcriptId = readString(created.id) ?? "";
      const alreadyDone = readString(created.status) === "completed";

      return {
        provider: "assemblyai",
        providerJobId: transcriptId,
        model: readString(created.speech_model) ?? ASSEMBLYAI_MODEL,
        // The whole point of the two-step contract: nothing is ready yet.
        ready: alreadyDone,
        raw: {
          transcriptId,
          media,
          completed: alreadyDone ? created : null,
        },
      };
    },

    async fetchTranscript(handle: TranscriptionJobHandle): Promise<NormalisedTranscript> {
      if (handle.provider !== "assemblyai") {
        throw providerFailed(`Handle belongs to ${handle.provider}, not assemblyai.`);
      }
      const state = readHandleState(handle.raw);
      if (state === null) {
        throw providerFailed("Handle carried no AssemblyAI transcript id to poll.");
      }
      const payload = state.completed ?? (await pollUntilCompleted(state));
      return normaliseAssemblyAiTranscript(payload);
    },
  };
}
