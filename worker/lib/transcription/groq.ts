// Transcription Studio — Groq provider (`whisper-large-v3-turbo`).
//
// This is the DEFAULT path: fast, cheap, multilingual, word-level timings.
// One HTTPS POST to the OpenAI-compatible endpoint returns the whole payload, so
// `submit` already carries the transcript and `fetchTranscript` only normalises.
//
// ---------------------------------------------------------------------------
// WHAT WHISPER CANNOT DO — and we never pretend otherwise
// ---------------------------------------------------------------------------
// * NO DIARIZATION. Whisper has no notion of "who spoke". `capabilities.diarization`
//   is false, every `TranscriptWord.speaker` is null, `speakers` is empty and
//   `metadata.speakerCount` is null. If a caller still asks for `diarize: true`
//   we transcribe anyway (a transcript without speakers is far better than no
//   transcript) and log it — the honest `metadata.diarization: false` is exactly
//   the signal the UI already knows how to explain.
// * NO PER-WORD CONFIDENCE. Every `TranscriptWord.confidence` is null, exactly as
//   the contract prescribes for "the provider does not report per-word confidence".
//   Whisper's only probability signal is `avg_logprob`, reported PER SEGMENT; its
//   `exp()` is a real 0..1 quantity, but stamping that one number onto each word of
//   the segment would make it look per-word when it is not — and the reading UI
//   thresholds `word.confidence` per word to flag "worth a second listen", so a
//   broadcast value flips a whole segment from 0 flagged to ALL flagged at
//   avg_logprob ≈ -0.511, while Whisper itself treats avg_logprob down to -1.0 as
//   acceptable output. Deepgram nova-3 and AssemblyAI both report genuine per-word
//   confidence, so broadcasting here would also silently miscalibrate Groq against
//   the other two tiers under one shared threshold. We therefore report null and drop `avg_logprob`: the contract's
//   `TranscriptSegment` has no confidence field, and inventing a per-word number to
//   keep a segment-level one is precisely the fabrication we refuse.
// * NO PER-WORD LANGUAGE. Whisper commits to ONE language for the whole media, so
//   we report it on the metadata (and on each segment) and leave every word's
//   `language` null, exactly as the contract prescribes.
//
// ---------------------------------------------------------------------------
// BILLING / CHANNELS
// ---------------------------------------------------------------------------
// * Groq downsamples to 16 kHz MONO server-side before inference. There is no
//   channel parameter to pass and no per-channel multiplier — a stereo podcast is
//   billed once. Hence `metadata.channels` is always 1.
// * Only the FIRST audio track of a container is transcribed. Extra tracks
//   (alternate dubs, commentary) are ignored by the provider, not by us.
// * Groq applies a 10-second MINIMUM per request. `metadata.durationSeconds` stays
//   the true measured length (the contract says "as the provider measured it", and
//   the teacher must never see an inflated duration); `groqBilledSeconds()` below
//   is the documented helper for anyone who wants to charge the real minimum.
//   The job consumer currently bills the raw duration, so clips under 10 s are
//   very slightly under-charged. That direction of error is deliberate: we absorb
//   fractions of a cent rather than over-charge a teacher.
// * Upload ceiling depends on the ACCOUNT TIER, which a key does not reveal:
//   25 MB on the free tier, 100 MB on the dev tier. Our own ceiling
//   (TRANSCRIPTION_MAX_UPLOAD_BYTES, 64 MB — set by the isolate's memory, not by
//   Groq) is enforced up front, and a provider 413 is translated into
//   `source_too_large` quoting the free-tier number, so a free-tier key still
//   yields a true message.

import type { Env } from "../../env";
import {
  TRANSCRIPTION_MAX_SOURCE_SECONDS,
  TRANSCRIPTION_MAX_UPLOAD_BYTES,
  TranscriptionError,
  type NormalisedTranscript,
  type TranscriptSegment,
  type TranscriptWord,
  type TranscriptionCapabilities,
  type TranscriptionJobHandle,
  type TranscriptionProvider,
  type TranscriptionRequest,
} from "./types";

export const GROQ_TRANSCRIPTIONS_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
export const GROQ_MODEL = "whisper-large-v3-turbo";

/** Groq bills a 10-second minimum per request, however short the clip. */
export const GROQ_MINIMUM_BILLED_SECONDS = 10;
/**
 * Multipart ceiling on the FREE tier, which is the tier we are on.
 *
 * The dev tier's ceiling is 100 MB, and there is deliberately no constant for
 * it: nothing routes on a number we cannot reach, and an exported constant with
 * no caller reads as a supported configuration. The dev-tier figure lives in the
 * header comment above, where it belongs, until an upgrade actually lands.
 */
export const GROQ_FREE_TIER_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Provider detail strings are for support, never for a teacher. Keep them short. */
const MAX_DETAIL_CHARS = 300;

/**
 * Wall-clock ceiling for the one POST that does the work.
 *
 * whisper-large-v3-turbo runs at many times real time, so ten minutes is
 * generous for a 90-minute source and still bounded. Without a deadline a
 * provider that accepts the connection and then stalls holds the queue consumer
 * until the platform kills the isolate — and the redelivered message would then
 * be a second billed submission. Every other outbound fetch in this feature is
 * capped; this one was the exception.
 */
const GROQ_TIMEOUT_MS = 10 * 60 * 1000;

const GROQ_CAPABILITIES: TranscriptionCapabilities = {
  // Whisper cannot diarize. This flag is the contract for the whole UI.
  diarization: false,
  wordTimestamps: true,
  // Whisper detects one language per file; it does not mix languages within one.
  multilingualWithinFile: false,
  languageDetection: true,
  maxSourceSeconds: TRANSCRIPTION_MAX_SOURCE_SECONDS,
};

/** Seconds we would actually be billed for a media of this length. */
export function groqBilledSeconds(durationSeconds: number): number {
  const safe = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
  return Math.max(GROQ_MINIMUM_BILLED_SECONDS, Math.ceil(safe));
}

/** A blank string counts as absent, so a half-filled secret never looks configured. */
export function hasGroqApiKey(env: Env): boolean {
  return typeof env.GROQ_API_KEY === "string" && env.GROQ_API_KEY.trim().length > 0;
}

// ---- Language tags ----

/**
 * Whisper's `verbose_json` reports the language as an English NAME ("french"),
 * while Deepgram reports a BCP-47 code ("fr"). Two vocabularies in one field
 * would be a real bug downstream, so we translate the names via Whisper's own
 * published table. Only entries we are certain of are listed; anything else is
 * passed through untouched (lower-cased) rather than guessed at.
 */
const WHISPER_LANGUAGE_TAGS: Readonly<Record<string, string>> = {
  english: "en",
  french: "fr",
  spanish: "es",
  german: "de",
  italian: "it",
  portuguese: "pt",
  dutch: "nl",
  russian: "ru",
  polish: "pl",
  catalan: "ca",
  arabic: "ar",
  turkish: "tr",
  japanese: "ja",
  korean: "ko",
  chinese: "zh",
};

export function whisperLanguageToTag(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  return WHISPER_LANGUAGE_TAGS[trimmed] ?? trimmed;
}

/**
 * Groq wants an ISO-639-1 code for its `language` hint. A hint improves BOTH
 * accuracy and latency, so it is worth sending — but only when it is actually a
 * language code. "fr-CA" becomes "fr"; anything unrecognisable is dropped so we
 * never make the provider reject an otherwise good request.
 */
export function normaliseLanguageHint(hint: string | null | undefined): string | null {
  if (typeof hint !== "string") return null;
  const primary = hint.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return /^[a-z]{2,3}$/.test(primary) ? primary : null;
}

// ---- Retry-After ----

const RETRY_AFTER_DURATION = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/;

/**
 * Groq's 429 responses carry `retry-after`. Three shapes exist in the wild:
 * delta-seconds ("30"), an HTTP date, and Groq's own rate-limit duration
 * ("2m59.56s"). We parse all three so the number we log is usable, and return
 * null rather than 0 when we cannot tell — 0 would read as "retry immediately".
 *
 * We do not sleep on it: a Worker consumer retrying in-band burns wall clock we
 * do not control, and the job queue already owns the retry ladder. The value is
 * logged for support and the failure surfaces as `provider_unavailable` (HTTP
 * 503), which is what a rate limit honestly is from the teacher's side.
 */
export function parseRetryAfterSeconds(value: string | null, now: number = Date.now()): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.max(0, Number(trimmed));

  const duration = RETRY_AFTER_DURATION.exec(trimmed.toLowerCase());
  if (duration && (duration[1] || duration[2] || duration[3])) {
    const hours = Number(duration[1] ?? 0);
    const minutes = Number(duration[2] ?? 0);
    const seconds = Number(duration[3] ?? 0);
    return hours * 3600 + minutes * 60 + seconds;
  }

  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, (at - now) / 1000);
}

// ---- Payload readers (no `any`, no blind casts) ----

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" ? value : null;
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readRecordArray(source: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = source[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function truncate(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_DETAIL_CHARS ? `${collapsed.slice(0, MAX_DETAIL_CHARS)}…` : collapsed;
}

/**
 * Groq's per-request trace id. The documented home is the RESPONSE BODY —
 * `{"text": "...", "x_groq": {"id": "req_..."}}` — and Groq's API reference
 * documents no response headers at all, so the body is the primary source.
 * `x-request-id` is kept as a fallback because edge proxies do send it and a
 * traceable id is what migration 0017's `(provider_job_id) WHERE NOT NULL`
 * index exists for.
 */
export function groqRequestId(raw: unknown, headers: Headers): string | null {
  if (isRecord(raw) && isRecord(raw.x_groq)) {
    const fromBody = readString(raw.x_groq, "id");
    if (fromBody !== null && fromBody.trim().length > 0) return fromBody;
  }
  const fromHeader = headers.get("x-request-id");
  return fromHeader !== null && fromHeader.trim().length > 0 ? fromHeader : null;
}

function providerFailed(
  status: number | undefined,
  detail: string,
  rateLimitHeaders?: Headers | null
): TranscriptionError {
  return new TranscriptionError(
    { code: "provider_failed", provider: "groq", status, detail },
    { rateLimitHeaders }
  );
}

function providerUnavailable(status?: number, rateLimitHeaders?: Headers | null): TranscriptionError {
  return new TranscriptionError(
    { code: "provider_unavailable", provider: "groq", status },
    { rateLimitHeaders }
  );
}

// ---- Normalisation ----

interface PlainWord {
  text: string;
  start: number;
  end: number;
}

interface SegmentShell {
  start: number;
  end: number;
  text: string;
}

function toPlainWord(source: Record<string, unknown>): PlainWord | null {
  const text = (readString(source, "word") ?? readString(source, "text") ?? "").trim();
  const start = readNumber(source, "start");
  const end = readNumber(source, "end");
  if (text.length === 0 || start === null || end === null) return null;
  return { text, start, end: Math.max(start, end) };
}

function toSegmentShell(source: Record<string, unknown>): SegmentShell | null {
  const start = readNumber(source, "start");
  const end = readNumber(source, "end");
  if (start === null || end === null) return null;
  // `avg_logprob` is deliberately not read: it is a segment-level quantity and the
  // contract has nowhere honest to put it. See the header comment.
  return { start, end: Math.max(start, end), text: (readString(source, "text") ?? "").trim() };
}

/**
 * Buckets ordered words into ordered segments by time. Words arriving before the
 * first segment land in it, and words past the last segment land in the last one,
 * so no word is ever silently dropped.
 */
function bucketWords(shells: SegmentShell[], words: PlainWord[]): PlainWord[][] {
  const buckets: PlainWord[][] = shells.map(() => []);
  if (shells.length === 0) return buckets;
  let cursor = 0;
  for (const word of words) {
    while (cursor < shells.length - 1 && word.start >= shells[cursor].end) cursor += 1;
    buckets[cursor].push(word);
  }
  return buckets;
}

function toTranscriptWord(word: PlainWord): TranscriptWord {
  return {
    text: word.text,
    start: word.start,
    end: word.end,
    // Whisper cannot diarize, reports no per-word probability, and commits to one
    // language per file. Three nulls, three honest absences.
    speaker: null,
    confidence: null,
    language: null,
  };
}

function buildSegments(
  shells: SegmentShell[],
  buckets: PlainWord[][],
  language: string | null
): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  shells.forEach((shell, index) => {
    const bucket = buckets[index] ?? [];
    // With no word timings for this stretch we keep the segment as ONE coarse
    // word carrying the segment's own real bounds. Callers then always have a
    // non-empty `words` array, and no timing is fabricated.
    const words: TranscriptWord[] =
      bucket.length > 0
        ? bucket.map(toTranscriptWord)
        : shell.text.length > 0
          ? [toTranscriptWord({ text: shell.text, start: shell.start, end: shell.end })]
          : [];
    // Groq's `segments[].text` and top-level `text` truncate tokens at their first
    // accented character or apostrophe - "c'est" arrives as "c", "sécurité" as "s",
    // "extérieurs" as "ext". Byte offsets applied to a UTF-8 string. The `words[]`
    // array carries the same audio uncorrupted, so we rebuild the prose from it
    // whenever we have word timings for this stretch, and keep `shell.text` only
    // for stretches Groq gave us no words for. Measured on a real InnerFrench
    // episode: this is the difference between 4.24% and 1.72% word error rate,
    // and the damage lands precisely on elisions and accents - the two things a
    // French learner most needs to be right.
    const text = bucket.length > 0 ? bucket.map((word) => word.text).join(" ") : shell.text;
    if (text.length === 0) return;
    const start = words.length > 0 ? Math.min(shell.start, words[0].start) : shell.start;
    const end = words.length > 0 ? Math.max(shell.end, words[words.length - 1].end) : shell.end;
    segments.push({ idx: segments.length, speaker: null, start, end, text, words, language });
  });
  return segments;
}

/** One segment per sentence-ish chunk is Whisper's job; if it gave us only words, group them all. */
function shellsFromWords(words: PlainWord[]): SegmentShell[] {
  if (words.length === 0) return [];
  return [
    {
      start: words[0].start,
      end: words[words.length - 1].end,
      text: words.map((word) => word.text).join(" "),
    },
  ];
}

export interface GroqNormaliseContext {
  providerJobId: string | null;
  model: string;
}

/**
 * Turns one Groq `verbose_json` payload into the contract's transcript.
 * Throws `provider_failed` when the payload carries none of the three fields a
 * transcription response must have — better an honest failure than an empty
 * transcript that looks like a silent recording.
 */
export function normaliseGroqTranscript(raw: unknown, context: GroqNormaliseContext): NormalisedTranscript {
  if (!isRecord(raw)) {
    throw providerFailed(undefined, "Groq returned a payload that was not an object.");
  }
  const hasShape =
    typeof raw.text === "string" || Array.isArray(raw.segments) || Array.isArray(raw.words);
  if (!hasShape) {
    throw providerFailed(undefined, "Groq returned a payload with no text, segments or words.");
  }

  const language = whisperLanguageToTag(readString(raw, "language"));
  const words = readRecordArray(raw, "words")
    .map(toPlainWord)
    .filter((word): word is PlainWord => word !== null);
  const shellsFromPayload = readRecordArray(raw, "segments")
    .map(toSegmentShell)
    .filter((shell): shell is SegmentShell => shell !== null);

  let shells = shellsFromPayload;
  if (shells.length === 0) shells = shellsFromWords(words);
  const fullText = (readString(raw, "text") ?? "").trim();
  if (shells.length === 0 && fullText.length > 0) {
    // Text but no timings at all: still a usable transcript, with the media's own
    // bounds as the only honest timing we have.
    const duration = readNumber(raw, "duration") ?? 0;
    shells = [{ start: 0, end: Math.max(0, duration), text: fullText }];
  }

  const segments = buildSegments(shells, bucketWords(shells, words), language);
  const lastSegment = segments[segments.length - 1];
  const measured = readNumber(raw, "duration");
  const durationSeconds = Math.max(0, measured ?? lastSegment?.end ?? 0);

  return {
    metadata: {
      provider: "groq",
      providerJobId: context.providerJobId,
      model: context.model,
      durationSeconds,
      detectedLanguages: language === null ? [] : [language],
      diarization: false,
      speakerCount: null,
      // Groq downmixes to 16 kHz mono server-side — one channel, billed once.
      channels: 1,
    },
    speakers: [],
    segments,
    // Built from the (repaired) segments, never from `raw.text` - the top-level
    // string carries the same truncation as `segments[].text`. `fullText` survives
    // only as the last resort for a payload that has text but no segments at all.
    // Space-joined, matching what `raw.text` used to deliver, so this fix changes
    // the CHARACTERS in the transcript and nothing else about its shape.
    text: segments.length > 0 ? segments.map((segment) => segment.text).join(" ") : fullText,
  };
}

// ---- Request ----

function buildForm(request: TranscriptionRequest): FormData {
  const form = new FormData();
  form.set("model", GROQ_MODEL);
  form.set("response_format", "verbose_json");
  // Repeated field, not a JSON array. Both granularities are needed: `word` gives
  // the timings the reading cursor follows, `segment` gives the sentence-ish turn
  // boundaries the transcript is paragraphed by.
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");

  const language = normaliseLanguageHint(request.languageHint);
  if (language !== null) form.set("language", language);

  if (request.audio.kind === "url") {
    // A URL is pulled by Groq: we never buffer the media in Worker memory.
    form.set("url", request.audio.url);
  } else {
    const filename = request.audio.filename.trim().length > 0 ? request.audio.filename : "audio";
    const type = request.audio.contentType.trim().length > 0
      ? request.audio.contentType
      : "application/octet-stream";
    // The Blob ingest already holds goes straight in. Re-wrapping it (or
    // building one from an ArrayBuffer) would put a second full copy of the
    // media in a 128 MB isolate; `File` only restates the name and the type.
    form.set("file", new File([request.audio.blob], filename, { type }), filename);
  }
  return form;
}

async function errorDetail(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  if (body.length === 0) return `Groq answered HTTP ${response.status} with an empty body.`;
  try {
    const parsed: unknown = JSON.parse(body);
    if (isRecord(parsed) && isRecord(parsed.error)) {
      const message = readString(parsed.error, "message");
      if (message !== null) return truncate(message);
    }
  } catch {
    // Not JSON — the raw text is the best detail we have.
  }
  return truncate(body);
}

/**
 * "I could not pull the media" comes back from Groq as a bare 400 with prose —
 * there is no machine-readable code to route on, unlike Deepgram's
 * REMOTE_CONTENT_ERROR. So the three ingredients of that sentence are matched
 * together: the act of pulling, the fact that it did not work, and the thing
 * being pulled. All three must be present, so a parameter or model rejection
 * ("Invalid model ...", "you must provide either file or url") never matches.
 */
const FETCH_VERB = /\b(download|downloading|downloaded|fetch|fetching|fetched|retriev(?:e|ing|ed)|access(?:ing|ed)?|reach(?:ing|ed)?)\b/i;
const FETCH_FAILED = /\b(could ?not|couldn'?t|cannot|can'?t|unable|fail(?:ed|s|ure)?|invalid|error|timed? ?out|refused|forbidden)\b/i;
const FETCH_TARGET = /\b(url|uri|link|audio|file|media|content|source)\b/i;

/**
 * True when a 4xx body says Groq itself could not download the URL we handed it.
 *
 * This is NOT redundant with the ingest HEAD check: we probe the link from
 * Cloudflare's egress, Groq pulls it from Groq's. Hotlink/referer protection,
 * geo-blocks, IP-range blocks and the short-lived signed URLs inside
 * Apple/Megaphone redirect chains all make a link that answered us refuse Groq.
 * Calling that `provider_failed` tells the teacher the service is broken and to
 * retry — when only a DIFFERENT link can ever work, so they retry the dead link
 * forever. `source_unreachable` names the real culprit (same HTTP 502 out).
 */
function namesUrlDownloadFailure(detail: string): boolean {
  return FETCH_VERB.test(detail) && FETCH_FAILED.test(detail) && FETCH_TARGET.test(detail);
}

/**
 * Every failure built here carries the response's headers, because Groq reports
 * its limiter state on EVERY response and the 429's reading is the sharpest one
 * we will ever see. `runTranscription` books it through `recordGroqUsage`; the
 * headers never leave the Worker and are never stored. See
 * `TranscriptionErrorContext`.
 */
async function failureForResponse(
  response: Response,
  request: TranscriptionRequest
): Promise<TranscriptionError> {
  const status = response.status;
  const headers = response.headers;
  const requestId = headers.get("x-request-id");

  if (status === 429) {
    const retryAfterSeconds = parseRetryAfterSeconds(headers.get("retry-after"));
    console.warn("Groq transcription rate-limited", { status, retryAfterSeconds, requestId });
    // The wait travels ON the failure, not only in the log. `runTranscription`
    // feeds it to `openGroqBreaker` so every job behind this one skips Groq
    // instead of collecting its own 429 — the whole point of the breaker. It is
    // stripped by `publicTranscriptionFailure` before any response leaves.
    return new TranscriptionError(
      retryAfterSeconds === null
        ? { code: "provider_unavailable", provider: "groq", status }
        : { code: "provider_unavailable", provider: "groq", status, retryAfterSeconds },
      { rateLimitHeaders: headers }
    );
  }
  // Bad or missing credentials, and everything 5xx, are all "the provider is not
  // available to us right now" from the teacher's side — HTTP 503, retry later.
  if (status === 401 || status === 403 || status >= 500) {
    console.warn("Groq transcription unavailable", { status, requestId });
    return providerUnavailable(status, headers);
  }
  if (status === 413) {
    // We already enforced our own upload ceiling, so a 413 means this key is on
    // the free tier. Quote the number that is actually true for this account.
    return new TranscriptionError(
      {
        code: "source_too_large",
        bytes: request.audio.kind === "bytes" ? request.audio.sizeBytes : 0,
        maxBytes: GROQ_FREE_TIER_MAX_UPLOAD_BYTES,
      },
      { rateLimitHeaders: headers }
    );
  }
  if (status === 415) {
    return new TranscriptionError(
      {
        code: "unsupported_media_type",
        contentType: request.audio.kind === "bytes" ? request.audio.contentType : undefined,
      },
      { rateLimitHeaders: headers }
    );
  }

  const detail = await errorDetail(response);
  // Only the URL path can blame the link: on the `bytes` path we uploaded the
  // media ourselves, so there is no source URL that could have been unreachable.
  if (request.audio.kind === "url" && status >= 400 && status < 500 && namesUrlDownloadFailure(detail)) {
    console.warn("Groq could not download the source URL", { status, requestId });
    return new TranscriptionError({ code: "source_unreachable", status }, { rateLimitHeaders: headers });
  }
  return providerFailed(status, detail, headers);
}

async function submitToGroq(env: Env, request: TranscriptionRequest): Promise<TranscriptionJobHandle> {
  if (!hasGroqApiKey(env)) throw providerUnavailable();
  const apiKey = (env.GROQ_API_KEY ?? "").trim();

  if (request.audio.kind === "bytes" && request.audio.sizeBytes > TRANSCRIPTION_MAX_UPLOAD_BYTES) {
    throw new TranscriptionError({
      code: "source_too_large",
      bytes: request.audio.sizeBytes,
      maxBytes: TRANSCRIPTION_MAX_UPLOAD_BYTES,
    });
  }
  const known = request.durationSeconds ?? null;
  if (known !== null && known > GROQ_CAPABILITIES.maxSourceSeconds) {
    throw new TranscriptionError({
      code: "source_too_long",
      durationSeconds: Math.ceil(known),
      maxSeconds: GROQ_CAPABILITIES.maxSourceSeconds,
    });
  }
  if (request.diarize) {
    // Never silent: the router should not have sent this here, and the stored
    // `diarization: false` is what the UI will explain to the teacher.
    console.warn("Groq cannot diarize — transcribing without speaker labels.");
  }

  const fetcher = request.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(GROQ_TRANSCRIPTIONS_URL, {
      method: "POST",
      // No Content-Type: fetch must set the multipart boundary itself.
      headers: { Authorization: `Bearer ${apiKey}` },
      body: buildForm(request),
      signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
    });
  } catch {
    // We never reached Groq, or it stalled past the deadline. Both are "not
    // available to us right now" (503) from the teacher's side, and both let the
    // queue's retry ladder apply without inventing a new failure code.
    throw providerUnavailable();
  }

  if (!response.ok) throw await failureForResponse(response, request);

  const body = await response.text().catch(() => "");
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    throw providerFailed(
      response.status,
      "Groq returned a body we could not parse as JSON.",
      response.headers
    );
  }

  return {
    provider: "groq",
    // Groq's per-request trace id, read from the body first. Persisted on the job
    // for support traceback — hence the read happens after the parse, not before.
    providerJobId: groqRequestId(raw, response.headers),
    model: GROQ_MODEL,
    // One POST returns everything: nothing to poll for.
    ready: true,
    raw,
    // A 200 carries the limiter state too, and it is a sharper reading than the
    // media's own length. `runTranscription` books it. Never stored, never sent.
    rateLimitHeaders: response.headers,
  };
}

export function groqProvider(env: Env): TranscriptionProvider {
  return {
    id: "groq",
    model: GROQ_MODEL,
    capabilities: GROQ_CAPABILITIES,
    submit: (request) => submitToGroq(env, request),
    fetchTranscript: async (handle) => {
      if (handle.provider !== "groq") {
        throw new TranscriptionError({
          code: "internal",
          detail: `Groq provider received a ${handle.provider} handle.`,
        });
      }
      if (!handle.ready) {
        // Groq has no polling mode, so an unready handle is a bug, not a wait.
        throw providerFailed(undefined, "Groq handle was not ready and Groq has no polling mode.");
      }
      return normaliseGroqTranscript(handle.raw, {
        providerJobId: handle.providerJobId,
        model: handle.model.length > 0 ? handle.model : GROQ_MODEL,
      });
    },
  };
}
