// Transcription Studio — THE shared contract.
//
// One normalised transcript shape, one provider interface, one error union.
// Everything else in the feature (ingest, providers, quota, jobs, routes, UI)
// imports from here. Zero runtime dependencies on purpose: this file is a
// contract, not behaviour.
//
// ---------------------------------------------------------------------------
// AGREED SIGNATURES FOR THE PARALLEL MODULES — implement these VERBATIM.
// ---------------------------------------------------------------------------
//
// `./index` (provider router — worker/lib/transcription/index.ts)
//
//   export function selectTranscriptionProvider(
//     options: { diarize: boolean }
//   ): TranscriptionProviderId;
//
//   export function runTranscription(
//     env: Env, request: TranscriptionRequest, deps?: TranscriptionRunDeps
//   ): Promise<TranscriptionRunResult>;
//
//   `selectTranscriptionProvider` is the pure TIER-1 rule: Deepgram when
//   `options.diarize` is true, Groq otherwise. `runTranscription` is what
//   actually runs — a THREE-TIER cascade (plain: Groq → Deepgram → AssemblyAI;
//   diarized: Deepgram → AssemblyAI, never Groq), which drops an unconfigured
//   tier from the plan and THROWS
//   `new TranscriptionError({ code: "provider_unavailable", provider })` only
//   once every tier of the lane is gone. Also re-exports the three concrete
//   providers for direct testing:
//     export function groqProvider(env: Env): TranscriptionProvider;
//     export function deepgramProvider(env: Env): TranscriptionProvider;
//     export function assemblyAiProvider(env: Env): TranscriptionProvider;
//
//   Slice 1's `getProvider` / `describeProviderChoice` are gone: they were a
//   second copy of the tier-1 rule with no production caller once the seam moved
//   to `runTranscription`. Read that module's header for the full policy.
//
// `../transcription-quota` (worker/lib/transcription-quota.ts)
//
//   export function getTranscriptionQuotaBalance(
//     env: Env, userId: string, options?: { now?: Date }
//   ): Promise<TranscriptionQuotaBalance>;
//
//   export function precheckTranscriptionQuota(
//     env: Env, userId: string, estimatedSeconds: number, options?: { now?: Date }
//   ): Promise<TranscriptionQuotaPrecheck>;
//
//   export function chargeTranscriptionQuota(
//     env: Env, userId: string, jobId: string, seconds: number,
//     provider: TranscriptionProviderId, options?: { now?: Date }
//   ): Promise<TranscriptionQuotaBalance>;
//
//   Its OWN KV prefix `transq:<userId>:<YYYY-MM>` and its OWN D1 table
//   `transcription_quota_ledger`. It must NEVER read or write
//   `audioq:*`, `quota_ledger`, or `credit_balances` — Gemini TTS costs
//   5-15x more per minute than STT and pooling would misprice both.
//   The three types above are declared in THIS file; import them from here.
//
// `../transcription-ingest` (worker/lib/transcription-ingest.ts)
//
//   export function classifySource(input: string): ClassifiedSource;
//
//   Pure and synchronous — no network. Recognises YouTube and returns
//   `{ supported: false, failure: { code: "youtube_not_yet_supported" } }`
//   (Slice 2), and Spotify as `{ code: "spotify_not_supported" }`.
//
//   export function resolveSource(
//     env: Env, ref: TranscriptionSourceRef, fetcher?: typeof fetch
//   ): Promise<ResolvedSource>;
//
//   Network-touching. Follows an RSS feed / Apple Podcasts page to the actual
//   enclosure URL, HEADs the media to learn content-type + byte length, and
//   for uploads reads the R2 object. THROWS TranscriptionError for
//   source_unreachable / no_audio_found / source_too_long / source_too_large /
//   youtube_not_yet_supported.
//
// ---------------------------------------------------------------------------
// MONO / SINGLE-CHANNEL BILLING — a provider that bills PER CHANNEL bills twice
// for a stereo podcast, so every tier is pinned to one channel.
// ---------------------------------------------------------------------------
// Groq: `whisper-large-v3-turbo` downsamples to 16 kHz mono server-side before
//   inference. There is no channel parameter to pass and no per-channel
//   multiplier — a stereo upload is billed once. Nothing to do.
// Deepgram: `multichannel=true` transcribes and BILLS each channel separately.
//   The provider module must therefore send `multichannel=false` EXPLICITLY
//   (rather than relying on the default) so a stereo podcast is downmixed to a
//   single channel and billed once. `diarize=true` also requires multichannel
//   to be off — speakers are separated statistically, not by channel.
// AssemblyAI: bills per audio-HOUR of the source, not per channel, and its
//   allowance is denominated in hours; multichannel is off by default and is
//   never requested. Nothing to do.
// Consequence for the shape below: `TranscriptMetadata.channels` is always 1,
// for all three.

/**
 * The providers behind the adapter. Persisted per job.
 *
 * `assemblyai` is tier 3 — the universal backstop. Unlike the other two it can
 * serve BOTH lanes (plain and diarized), which is why it is the fallback
 * whichever box the teacher ticked.
 */
export type TranscriptionProviderId = "groq" | "deepgram" | "assemblyai";

/**
 * How the teacher gave us the media. Persisted as `transcription_jobs.source_kind`.
 * - `upload`     — a file the teacher uploaded; the bytes live in R2 under our key.
 * - `direct_url` — a URL that already points at an audio file.
 * - `podcast`    — an RSS feed, an episode page, or an Apple Podcasts link that
 *                  we follow to the real enclosure URL.
 * - `youtube`    — recognised, NOT yet transcribable (Slice 2 = yt-dlp container).
 *                  Stored so we can count demand, never processed.
 */
export type TranscriptionSourceKind = "upload" | "direct_url" | "podcast" | "youtube";

/** 10 transcription hours per user per month. Its own ledger — never pooled with TTS minutes. */
export const TRANSCRIPTION_INCLUDED_SECONDS_PER_MONTH = 36_000;

/** A single file or URL is capped at 90 minutes. */
export const TRANSCRIPTION_MAX_SOURCE_SECONDS = 5_400;

/**
 * How long a finished transcript is kept — 7 days, the same window the Audio
 * Studio gives an mp3.
 *
 * It is a PRIVACY choice before it is a storage one: a transcript of a lesson is
 * a recording of the people in the room, and keeping every one of them forever
 * is a promise we should not make. The teacher's own copy is a download away, and
 * the interface says so from the moment the transcript appears.
 *
 * Unlike the mp3s, nothing outside our code can enforce this: the audio expires
 * because an R2 lifecycle rule removes the bytes, and a transcript is TEXT in D1
 * that no lifecycle rule can reach. Hence two enforcement points, both required:
 *   * `purgeExpiredTranscriptions` (worker/lib/transcription-retention.ts), run
 *     by the daily cron, which actually deletes;
 *   * `isTranscriptExpired`, checked on every read, so an expired transcript is
 *     never served no matter when the cron last ran.
 */
export const TRANSCRIPTION_RETENTION_DAYS = 7;

/**
 * Upload byte ceiling — set by our own memory, not by the providers.
 *
 * Groq's paid multipart limit is 100 MB and Deepgram accepts far more, but an
 * uploaded file is read out of R2 into the Worker's heap before it is posted,
 * and a Worker isolate has 128 MB for everything it is doing. One 64 MB copy
 * leaves real headroom; 100 MB left 28 MB and the failure mode was an OOM the
 * job could not even record as failed. 64 MB is a 90-minute mono lecture at
 * ~95 kbps, and anything above it gets a specific, translated refusal instead.
 *
 * DECIMAL megabytes, not binary. This number is read aloud by the interface
 * ("jusqu'à 64 Mo"), and the number a teacher sees next to it is the one Finder
 * and the iOS Files app show them — both decimal. A 64 MiB ceiling would be
 * "67,1 Mo" in Finder, so a file Finder calls 65 Mo would be refused by a limit
 * the interface calls 64 Mo. Losing 3 MiB of headroom is cheaper than a limit
 * that cannot be checked against the number on the teacher's own screen.
 *
 * URL sources are never buffered — the provider pulls them itself — so this
 * ceiling applies to uploads only.
 */
export const TRANSCRIPTION_MAX_UPLOAD_BYTES = 64 * 1_000_000;

// ---- Normalised transcript ----

/**
 * One word with its timing. This is the atom every provider normalises to.
 *
 * `speaker` is null whenever diarization is absent — which is ALWAYS the case
 * for Groq/Whisper. Whisper has no diarization; do not pretend otherwise.
 * `language` is null for Groq (Whisper reports one language for the whole
 * media, surfaced on the metadata instead) and populated per word by Deepgram
 * nova-3 with `language=multi`.
 */
export interface TranscriptWord {
  text: string;
  /** Seconds from the start of the media. */
  start: number;
  end: number;
  /** Opaque stable speaker id, or null when the provider cannot diarize. */
  speaker: string | null;
  /** 0..1, or null when the provider does not report per-word confidence. */
  confidence: number | null;
  /** BCP-47-ish tag as the provider reported it, or null. */
  language: string | null;
}

/**
 * A speaker turn: consecutive words attributed to one speaker. When there is no
 * diarization the whole transcript is still chunked into segments (the provider
 * module uses the provider's own segment boundaries) with `speaker: null`, so
 * the reading UI has one rendering path for all three providers.
 */
export interface TranscriptSegment {
  /** 0-based position in the transcript. */
  idx: number;
  speaker: string | null;
  start: number;
  end: number;
  /** The joined, punctuated text of this turn. */
  text: string;
  words: TranscriptWord[];
  /** Dominant language of the turn, or null. */
  language: string | null;
}

/**
 * A speaker the UI can label. Ordered by first appearance so "Speaker 1" in the
 * interface is the first voice heard. `label` is a machine default (never
 * user-facing prose — the UI renders its own localised label from `index`).
 */
export interface TranscriptSpeaker {
  /** Matches `TranscriptWord.speaker`. Deepgram's integer N is stored as String(N). */
  id: string;
  /** 0-based order of first appearance. */
  index: number;
  /** Provider-side raw label, kept for debugging. */
  label: string;
  /** Total speaking time in seconds. */
  seconds: number;
}

export interface TranscriptMetadata {
  provider: TranscriptionProviderId;
  /** Provider-side request/job id, kept for support and reconciliation. */
  providerJobId: string | null;
  /** Concrete model id, e.g. "whisper-large-v3-turbo" or "nova-3". */
  model: string;
  /** Media length in seconds as the provider measured it. */
  durationSeconds: number;
  /** Every language the provider reported, first = dominant. Empty when unknown. */
  detectedLanguages: string[];
  /** True only when words actually carry speakers. False for every Groq job. */
  diarization: boolean;
  /** Distinct speakers found, or null when diarization is absent. */
  speakerCount: number | null;
  /** Always 1 — we force a single channel so neither provider double-bills. */
  channels: number;
}

export interface NormalisedTranscript {
  metadata: TranscriptMetadata;
  speakers: TranscriptSpeaker[];
  segments: TranscriptSegment[];
  /** Full plain text, paragraph-joined. Cheap for copy-to-clipboard and search. */
  text: string;
}

// ---- Provider interface ----

/**
 * What a provider can actually do. Modelled as data, not as optional methods,
 * because the three providers are genuinely asymmetric and the UI must be able
 * to say so before the teacher presses the button.
 */
export interface TranscriptionCapabilities {
  /** Groq: false. Deepgram: true. AssemblyAI: true — which is why it backs both lanes. */
  diarization: boolean;
  wordTimestamps: boolean;
  /** Detects and mixes languages within one file (Deepgram nova-3 `language=multi`). */
  multilingualWithinFile: boolean;
  languageDetection: boolean;
  /** Provider-side ceiling, in seconds, if any. */
  maxSourceSeconds: number;
}

/**
 * The audio handed to a provider. A URL is preferred — the provider pulls it and
 * we never buffer it. Uploaded media arrives as bytes because our R2 objects are
 * not publicly fetchable.
 *
 * The bytes variant carries a `Blob`, not an `ArrayBuffer`, and that is
 * deliberate: a Blob is handed straight to `FormData.set` / `fetch` as the body,
 * so the media exists in memory exactly ONCE. Reading it into an ArrayBuffer and
 * then wrapping that in a Blob (what the Groq path used to do) held two full
 * copies at the same time, which put a 100 MB upload over the 128 MB isolate
 * limit and killed the consumer before it could mark the job failed.
 * `sizeBytes` is R2's own object size, so nobody has to touch the payload to
 * learn how big it is.
 */
export type TranscriptionAudioSource =
  | { kind: "url"; url: string }
  | { kind: "bytes"; blob: Blob; sizeBytes: number; contentType: string; filename: string };

export interface TranscriptionRequest {
  audio: TranscriptionAudioSource;
  /** True = the teacher asked to identify speakers. Only Deepgram can honour it. */
  diarize: boolean;
  /** BCP-47-ish hint; undefined/null = let the provider detect. */
  languageHint?: string | null;
  /** Known media length, when ingest measured it. Used for the provider ceiling check. */
  durationSeconds?: number | null;
  /**
   * Media size in bytes, for a URL source we already measured.
   *
   * `audio.sizeBytes` only exists on the `bytes` variant, so without this the
   * router saw `null` for every link and every podcast episode — and Groq's
   * free-tier 25 MB pre-skip could never fire on the common case. Ingest reads
   * the Content-Length (or the RSS enclosure's declared `length`) long before
   * the provider is chosen, so the number is already in hand; this is where it
   * travels. Null when nothing could measure it.
   */
  sizeBytes?: number | null;
  /** Dependency injection seam for tests — defaults to global fetch. */
  fetcher?: typeof fetch;
}

/**
 * The handle returned by `submit`.
 *
 * Both current providers answer in-band: one HTTPS POST returns the whole
 * payload, so `ready` is true and `raw` already carries it. The two-step
 * submit/fetch split exists so a future genuinely-async provider (or Deepgram's
 * callback mode) can set `ready: false` and let `fetchTranscript` poll, without
 * changing any caller.
 *
 * `raw` is `unknown` on purpose: only the provider that produced a payload is
 * allowed to narrow it. Never `any`, never a shared "provider response" type
 * that pretends the two schemas match.
 */
export interface TranscriptionJobHandle {
  provider: TranscriptionProviderId;
  /** Groq: `x-request-id`. Deepgram: `metadata.request_id`. Null if absent. */
  providerJobId: string | null;
  model: string;
  ready: boolean;
  raw: unknown;
  /**
   * The response's rate-limit headers, when the provider publishes any.
   *
   * TRANSIENT AND OPERATOR-ONLY: never persisted, never serialised, never part of
   * any API response. It exists so `recordGroqUsage` can book the free tier
   * against Groq's OWN limiter reading rather than against our local guess — the
   * budget module's whole header parser is unreachable otherwise. Only Groq sets
   * it today; the other two providers leave it undefined.
   */
  rateLimitHeaders?: Headers | null;
}

export interface TranscriptionProvider {
  readonly id: TranscriptionProviderId;
  readonly model: string;
  readonly capabilities: TranscriptionCapabilities;
  /** Sends the media. Throws TranscriptionError on any provider failure. */
  submit(request: TranscriptionRequest): Promise<TranscriptionJobHandle>;
  /** Normalises (polling first if `handle.ready` is false). Throws TranscriptionError. */
  fetchTranscript(handle: TranscriptionJobHandle): Promise<NormalisedTranscript>;
}

// ---- Ingest contract ----

/**
 * A source reference, as persisted in `transcription_jobs.request_payload`.
 * Uploads name an R2 key; everything else names a URL.
 */
export type TranscriptionSourceRef =
  | {
      kind: "upload";
      r2Key: string;
      filename: string;
      contentType: string | null;
      bytes: number | null;
    }
  | { kind: Exclude<TranscriptionSourceKind, "upload">; url: string };

/** Where a podcast URL came from. UI hint only — never affects billing. */
export type PodcastSourceHint = "apple" | "rss" | "episode_page" | "generic";

/** Result of `classifySource` — pure, synchronous, no network. */
export interface ClassifiedSource {
  kind: TranscriptionSourceKind;
  /** Normalised URL, or null when the input was not a URL at all. */
  url: string | null;
  supported: boolean;
  /** Set iff `supported` is false. Carries the exact code the UI must explain. */
  failure: TranscriptionFailure | null;
  /** Present when `kind === "podcast"`. */
  podcastHint: PodcastSourceHint | null;
}

/** Result of `resolveSource` — the provider-ready media plus what we learned. */
export interface ResolvedSource {
  kind: TranscriptionSourceKind;
  audio: TranscriptionAudioSource;
  /** Media length when we could determine it cheaply, else null. */
  durationSeconds: number | null;
  contentType: string | null;
  bytes: number | null;
  /** Episode/file title we can pre-fill the job title with. */
  title: string | null;
  /** The URL we actually resolved to (after RSS/Apple redirection), or null for uploads. */
  resolvedUrl: string | null;
  /** Our R2 key, for uploads only. */
  r2Key: string | null;
}

// ---- Quota contract ----

export interface TranscriptionQuotaBalance {
  /** Always TRANSCRIPTION_INCLUDED_SECONDS_PER_MONTH. */
  includedLimit: number;
  includedUsed: number;
  includedRemaining: number;
  /** YYYY-MM. */
  month: string;
  /** ISO timestamp of the next monthly reset. */
  monthResetsOn: string;
}

export type TranscriptionQuotaPrecheck =
  | { ok: true; balance: TranscriptionQuotaBalance }
  | {
      ok: false;
      balance: TranscriptionQuotaBalance;
      estimatedSeconds: number;
      allowedSeconds: number;
      reason: "transcription_quota_exceeded";
    };

// ---- Failures ----

/**
 * Every failure a teacher can actually hit, as a discriminated union.
 *
 * The `code` is the i18n key suffix: the client renders
 * `t(`transcription.error_${code}`)`. Extra fields exist so the message can be
 * specific ("this episode is 2 h 14 — the limit is 90 minutes") rather than
 * generic. Never thrown as a bare string, never `any`.
 */
export type TranscriptionFailure =
  /** Not a URL we can do anything with (a webpage, a paywalled player, a bad link). */
  | { code: "unsupported_source"; detail?: string }
  /** Recognised YouTube. Slice 2. A distinct friendly state, not an error. */
  | { code: "youtube_not_yet_supported"; url?: string }
  /** Spotify is a closed platform with no public audio URL. Politely out of scope. */
  | { code: "spotify_not_supported"; url?: string }
  /** The URL did not answer, timed out, or refused us. */
  | { code: "source_unreachable"; status?: number }
  /** We reached a feed or a page but found no audio enclosure in it. */
  | { code: "no_audio_found"; detail?: string }
  /** Over the 90-minute per-file cap. */
  | { code: "source_too_long"; durationSeconds: number; maxSeconds: number }
  /** Over the upload byte ceiling. */
  | { code: "source_too_large"; bytes: number; maxBytes: number }
  /** The media is not audio we can send (e.g. a DRM stream, an unknown container). */
  | { code: "unsupported_media_type"; contentType?: string }
  /**
   * No API key configured, or the provider is down / rate-limiting us.
   *
   * `retryAfterSeconds` is set only on a 429 that told us how long to wait. It is
   * OPERATOR information, exactly like `detail`: the router feeds it to
   * `openGroqBreaker` so every job behind this one skips the exhausted tier, and
   * `publicTranscriptionFailure` strips it before the failure leaves the Worker.
   * A teacher never learns which provider was busy or for how long — they learn
   * that their transcription is running.
   */
  | {
      code: "provider_unavailable";
      provider: TranscriptionProviderId;
      status?: number;
      retryAfterSeconds?: number;
    }
  /** The provider answered, but with an error or an unusable payload. */
  | { code: "provider_failed"; provider: TranscriptionProviderId; status?: number; detail?: string }
  /** The monthly transcription hours are spent. Its own ledger, its own message. */
  | { code: "quota_exceeded"; requestedSeconds: number; remainingSeconds: number }
  /** Anything we did not anticipate. Always warm and generic in the UI. */
  | { code: "internal"; detail?: string };

export type TranscriptionFailureCode = TranscriptionFailure["code"];

// ---- The failover cascade's own vocabulary ----

/**
 * WHY the provider that ran was the one that ran. Persisted as
 * `transcription_jobs.provider_choice_reason`.
 *
 * A machine value, like `error_code`: it is for us and for the admin view, so it
 * is never translated and never rendered to a teacher. Its whole job is to make a
 * tier fallback VISIBLE in the data — a Deepgram row for a job that asked for
 * nothing special is an unexplained cost unless this column says
 * `groq_rate_limited`.
 *
 * It lives HERE rather than in the router because it is a persisted column type
 * that both the job layer and the error below have to name, and a contract value
 * two modules share belongs in the contract. `./index` re-exports it.
 */
export type TranscriptionRouteReason =
  /** Tier 1 of the plain lane: the free Groq path. */
  | "groq_free_tier"
  /** Tier 1 of the diarized lane. Whisper cannot label speakers, ever. */
  | "diarization_required"
  /** Groq skipped before being tried: over its free-tier 25 MB file ceiling. */
  | "groq_over_free_tier_file_limit"
  /** Groq skipped: the job does not fit the remaining hourly/daily audio-seconds. */
  | "groq_out_of_capacity"
  /** Groq skipped: the breaker is open after a recent 429. */
  | "groq_breaker_open"
  /** The tier above this one has no API key configured. */
  | "provider_key_missing"
  /** Groq answered 429 during THIS job: the breaker opened and the job moved on. */
  | "groq_rate_limited"
  /** The tier above this one failed for some other provider-side reason. */
  | "previous_tier_failed";

/** Which tier was running when something went wrong, and why it was that tier. */
export interface TranscriptionAttempt {
  provider: TranscriptionProviderId;
  reason: TranscriptionRouteReason;
}

const FAILURE_CODES: ReadonlySet<string> = new Set<TranscriptionFailureCode>([
  "unsupported_source",
  "youtube_not_yet_supported",
  "spotify_not_supported",
  "source_unreachable",
  "no_audio_found",
  "source_too_long",
  "source_too_large",
  "unsupported_media_type",
  "provider_unavailable",
  "provider_failed",
  "quota_exceeded",
  "internal",
]);

export function isTranscriptionFailureCode(value: unknown): value is TranscriptionFailureCode {
  return typeof value === "string" && FAILURE_CODES.has(value);
}

/** Operator-only context a thrower can hang on the error. Never serialised. */
export interface TranscriptionErrorContext {
  /**
   * The failing response's rate-limit headers.
   *
   * On a Groq 429 these are the most accurate reading of the free tier we will
   * ever get, and the counter is blind without them — see `recordGroqUsage`.
   * They ride on the ERROR rather than on the `failure` object precisely because
   * the failure is JSON-serialised onto the job row and sent to the browser, and
   * this is neither storable nor a teacher's business.
   */
  rateLimitHeaders?: Headers | null;
}

/**
 * The one throwable. `message` is the code, so an accidental `error.message`
 * leak is still a machine code the client can translate — never English prose
 * or a provider's raw sentence in front of a teacher.
 */
export class TranscriptionError extends Error {
  readonly failure: TranscriptionFailure;

  /** See `TranscriptionErrorContext`. Null when the provider never answered. */
  readonly rateLimitHeaders: Headers | null;

  /**
   * Which tier was running, stamped by the cascade on its way out.
   *
   * Mutable and initially null because the thrower is the PROVIDER, which knows
   * nothing about tiers, while the fact worth recording — "this job burned Groq,
   * then Deepgram, and died on AssemblyAI" — is only known to the router. The job
   * layer reads it so a failed row carries the same provider/reason columns a
   * completed one does; without it a fallback survives only as a console line,
   * which is the one place a Deepgram bill cannot be explained from.
   */
  attempt: TranscriptionAttempt | null = null;

  constructor(failure: TranscriptionFailure, context: TranscriptionErrorContext = {}) {
    super(failure.code);
    this.name = "TranscriptionError";
    this.failure = failure;
    this.rateLimitHeaders = context.rateLimitHeaders ?? null;
  }
}

export function isTranscriptionError(error: unknown): error is TranscriptionError {
  return error instanceof TranscriptionError;
}

/**
 * Wraps anything unknown into a failure, so no code path can leak a raw throw.
 *
 * The exception's own message is deliberately DROPPED. A D1 constraint error, a
 * KV fault or a TypeError from an unexpected payload is operator information:
 * callers log it and store it in `transcription_jobs.error_message` (which is
 * never serialised to a client), while the failure itself stays a bare code the
 * UI can translate. The job id is already in every response and is the support
 * handle — raw internal prose in front of a teacher is not.
 */
export function toTranscriptionFailure(error: unknown): TranscriptionFailure {
  if (isTranscriptionError(error)) return error.failure;
  return { code: "internal" };
}

/**
 * The client-facing projection of a failure: same code, same numbers, no
 * `detail`.
 *
 * `detail` exists for logs and for support ("upload_missing", "blocked_host", a
 * truncated provider sentence). It is never translated and never rendered, so
 * shipping it to a browser only risks leaking our internals or a provider's
 * English prose into a French interface. Every route and every job read passes
 * failures through here before they leave the Worker.
 */
export function publicTranscriptionFailure(failure: TranscriptionFailure): TranscriptionFailure {
  // `provider_unavailable` carries no `detail`, but it does carry the 429's
  // `retry-after` — which is how long OUR router pauses OUR tier, and is neither
  // translatable nor actionable for the teacher reading the page.
  if (failure.code === "provider_unavailable") {
    if (failure.retryAfterSeconds === undefined) return failure;
    const { retryAfterSeconds: _retryAfterSeconds, ...rest } = failure;
    return rest;
  }
  if (!("detail" in failure) || failure.detail === undefined) return failure;
  const { detail: _detail, ...rest } = failure;
  return rest;
}

/**
 * Rebuilds a failure from what we stored on the row. Falls back to the bare code,
 * then to `internal`, so a malformed stored payload can never break a poll.
 */
export function parseStoredFailure(code: string | null, payload: string | null): TranscriptionFailure | null {
  if (!code && !payload) return null;
  if (payload) {
    try {
      const parsed: unknown = JSON.parse(payload);
      if (parsed && typeof parsed === "object" && isTranscriptionFailureCode((parsed as { code?: unknown }).code)) {
        // Safe: the discriminant is validated above and we authored every payload.
        return parsed as TranscriptionFailure;
      }
    } catch {
      // fall through to the bare code
    }
  }
  if (isTranscriptionFailureCode(code)) {
    switch (code) {
      case "source_too_long":
        return { code, durationSeconds: 0, maxSeconds: TRANSCRIPTION_MAX_SOURCE_SECONDS };
      case "source_too_large":
        return { code, bytes: 0, maxBytes: TRANSCRIPTION_MAX_UPLOAD_BYTES };
      case "quota_exceeded":
        return { code, requestedSeconds: 0, remainingSeconds: 0 };
      case "provider_unavailable":
      case "provider_failed":
        return { code, provider: "groq" };
      default:
        return { code };
    }
  }
  return { code: "internal" };
}

/**
 * HTTP status for a failure, so every route maps codes the same way.
 * 501 for YouTube: recognised, not implemented — never a generic 400.
 */
export function httpStatusForFailure(failure: TranscriptionFailure): 400 | 402 | 413 | 415 | 501 | 502 | 503 | 500 {
  switch (failure.code) {
    case "unsupported_source":
    case "no_audio_found":
      return 400;
    case "youtube_not_yet_supported":
    case "spotify_not_supported":
      return 501;
    case "source_unreachable":
      return 502;
    case "source_too_long":
      return 413;
    case "source_too_large":
      return 413;
    case "unsupported_media_type":
      return 415;
    case "provider_unavailable":
      return 503;
    case "provider_failed":
      return 502;
    case "quota_exceeded":
      return 402;
    case "internal":
      return 500;
  }
}
