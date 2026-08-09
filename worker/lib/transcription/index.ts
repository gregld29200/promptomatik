// Transcription provider router — THE FAILOVER CASCADE.
//
// ---------------------------------------------------------------------------
// THE POLICY, IN FULL
// ---------------------------------------------------------------------------
//   job asks for        1st                2nd            3rd
//   ------------------  -----------------  -------------  ------------
//   a plain transcript  Groq (free)        Deepgram       AssemblyAI
//   speaker labels      Deepgram           AssemblyAI     never Groq
//
// Groq is first for a plain transcript because it is free and an order of
// magnitude cheaper than the paid tiers ($0.04/h against $0.31/h). It is NEVER
// used for a job that asked for speaker labels: Whisper has no diarization of
// any kind, so that is a capability fact, not a preference — see the HARD GUARD
// below, which enforces it in code rather than by convention.
//
// GROQ IS SKIPPED ENTIRELY — straight to tier 2, no round trip — when any of:
//   (a) the job asked for speaker labels;
//   (b) the source is over Groq's free-tier 25 MB file ceiling;
//   (c) `hasGroqCapacityFor` says it will not fit the remaining hourly/daily
//       audio-seconds budget;
//   (d) `isGroqBreakerOpen` is true (someone just took a 429).
// (c) and (d) are one KV read each, taken together by `canRouteGroq`.
//
// ON A GROQ 429 the job moves to the next tier IMMEDIATELY, inside this call.
// It is deliberately NOT left to the queue's retry ladder: a retry a few seconds
// later would hit the same exhausted free tier and fail again, three times, and
// the teacher would watch a 90-minute transcription die for a reason that had a
// working answer sitting one tier down. The 429 also opens the breaker, so the
// nineteen jobs behind this one skip Groq without paying their own 429.
//
// ---------------------------------------------------------------------------
// WHICH FAILURES FALL THROUGH, AND WHICH ARE TERMINAL
// ---------------------------------------------------------------------------
// Only a failure that is ABOUT THE PROVIDER earns another tier:
// `provider_unavailable` (no key, 401, 429, any 5xx) and `provider_failed` (it
// answered with something unusable). A failure about the MEDIA — a dead link, a
// file over our own 90-minute cap, a format nothing can read — is terminal on the
// first tier: three providers failing the same way costs three waits and tells
// the teacher nothing new.
//
// The one nuance is `source_too_large` from GROQ, which means its free-tier
// 25 MB multipart ceiling, not ours. Deepgram and AssemblyAI have no such
// ceiling, so that one falls through. (Condition (b) usually pre-empts it; this
// is the backstop for a file we could not measure up front.)
//
// ---------------------------------------------------------------------------
// DEGRADING HONESTLY WHEN A KEY IS MISSING
// ---------------------------------------------------------------------------
// An unconfigured tier is dropped from the plan rather than tried and failed.
// If that empties the plan, the job fails with `provider_unavailable` — the warm
// "the transcription service is not reachable right now" sentence — instead of
// crashing or, worse, silently returning an unlabelled transcript.
//
// ---------------------------------------------------------------------------
// WHAT STAYS FROM SLICE 1
// ---------------------------------------------------------------------------
// `selectTranscriptionProvider` is the TIER-1 rule and is unchanged. It is the
// ONE definition of that rule: `createTranscriptionJob` calls it for the row's
// `requested_provider` (the immutable record of what was asked) and
// `planTranscriptionRoute` calls it for the plan, so the two cannot drift. The
// cascade is what actually runs, and `provider` + `provider_choice_reason`
// record what happened.
//
// Slice 1's `getProvider` / `describeProviderChoice` are GONE. They were
// documented as "what the UI reads", nothing in src/ ever imported them, and
// once the seam moved to `runTranscription` they had no production caller left —
// a second, drifting copy of the tier-1 policy kept alive by its own tests.

import type { Env } from "../../env";
import {
  TranscriptionError,
  toTranscriptionFailure,
  type NormalisedTranscript,
  type TranscriptionAttempt,
  type TranscriptionFailure,
  type TranscriptionJobHandle,
  type TranscriptionProvider,
  type TranscriptionProviderId,
  type TranscriptionRequest,
  type TranscriptionRouteReason,
} from "./types";
import { deepgramProvider } from "./deepgram";
import { GROQ_FREE_TIER_MAX_UPLOAD_BYTES, groqProvider } from "./groq";
import { assemblyAiProvider } from "./assemblyai";
import {
  canRouteGroq,
  exhaustGroqHourWindow,
  openGroqBreaker,
  parseGroqRateLimitHeaders,
  recordGroqUsage,
  type GroqRouteDecision,
} from "../transcription-budget";

export { assemblyAiProvider, deepgramProvider, groqProvider };
// The persisted reason column's type lives in the contract, next to the failure
// union it sits beside on the row. Re-exported so callers keep one import.
export type { TranscriptionRouteReason } from "./types";

/** Pure: the tier-1 routing rule on its own, with no environment and no side effects. */
export function selectTranscriptionProvider(options: { diarize: boolean }): TranscriptionProviderId {
  return options.diarize ? "deepgram" : "groq";
}

/**
 * Each provider reads its OWN key. Written as an exhaustive switch rather than a
 * ternary so that adding a provider to `TranscriptionProviderId` cannot silently
 * make it "configured" because some other provider's key happens to be set.
 */
function apiKeyFor(env: Env, provider: TranscriptionProviderId): string | undefined {
  switch (provider) {
    case "groq":
      return env.GROQ_API_KEY;
    case "deepgram":
      return env.DEEPGRAM_API_KEY;
    case "assemblyai":
      return env.ASSEMBLYAI_API_KEY;
  }
}

export function isTranscriptionProviderConfigured(env: Env, provider: TranscriptionProviderId): boolean {
  const key = apiKeyFor(env, provider);
  return typeof key === "string" && key.trim().length > 0;
}

/** Builds ONE provider by id. The only place a provider is constructed. */
export function buildProvider(env: Env, provider: TranscriptionProviderId): TranscriptionProvider {
  switch (provider) {
    case "groq":
      return groqProvider(env);
    case "deepgram":
      return deepgramProvider(env);
    case "assemblyai":
      return assemblyAiProvider(env);
  }
}

// ---------------------------------------------------------------------------
// The cascade
// ---------------------------------------------------------------------------

export interface TranscriptionRouteStep {
  provider: TranscriptionProviderId;
  reason: TranscriptionRouteReason;
}

export interface TranscriptionRoutePlan {
  /** Providers to try, in order. Empty only when nothing is configured. */
  steps: TranscriptionRouteStep[];
  /** The tier-1 provider the lane asked for, configured or not. */
  requested: TranscriptionProviderId;
  /** Groq's budget verdict, when it was consulted. Null in the diarized lane. */
  groqDecision: GroqRouteDecision | null;
}

export interface TranscriptionRouteInput {
  diarize: boolean;
  /** Media length in seconds when ingest measured it, else null. */
  durationSeconds: number | null;
  /** Upload size in bytes. Null for a URL source — nothing is buffered. */
  sizeBytes: number | null;
}

/** The lane's provider order, before any budget or configuration is considered. */
function laneOrder(diarize: boolean): TranscriptionProviderId[] {
  // Groq is absent from the diarized lane by construction, not by a later filter.
  // A filter can be forgotten; a list that never contained it cannot.
  return diarize ? ["deepgram", "assemblyai"] : ["groq", "deepgram", "assemblyai"];
}

/**
 * Decides the order, and why. One KV read pair when Groq is a candidate, none
 * otherwise.
 *
 * Exported so the plan can be asserted directly: the policy above is the thing
 * most worth testing, and testing it through three HTTP fakes would test the
 * fakes.
 */
export async function planTranscriptionRoute(
  env: Env,
  input: TranscriptionRouteInput
): Promise<TranscriptionRoutePlan> {
  const requested = selectTranscriptionProvider({ diarize: input.diarize });
  const order = laneOrder(input.diarize);

  let groqDecision: GroqRouteDecision | null = null;
  let groqSkip: TranscriptionRouteReason | null = null;

  if (order[0] === "groq") {
    if (input.sizeBytes !== null && input.sizeBytes > GROQ_FREE_TIER_MAX_UPLOAD_BYTES) {
      // Checked before the KV reads: a file we already know Groq will refuse with
      // a 413 does not deserve two round trips to find that out.
      groqSkip = "groq_over_free_tier_file_limit";
    } else {
      // NaN when the duration is unknown, which `groqRateLimitSeconds` charges as
      // the 90-minute per-file ceiling — a job of unknown length is exactly the
      // one not to gamble the shared hourly window on.
      groqDecision = await canRouteGroq(env, input.durationSeconds ?? Number.NaN);
      if (!groqDecision.route) {
        groqSkip = groqDecision.reason === "breaker_open" ? "groq_breaker_open" : "groq_out_of_capacity";
      }
    }
  }

  // The reason a step carries answers "why are YOU at this position".
  //   * The very first step of the lane is there because the lane says so.
  //   * A step that moved up because the tier above it was skipped inherits the
  //     reason for that skip — that is the fact worth persisting.
  //   * Everything else is a plain fallback position.
  const laneReason: TranscriptionRouteReason = input.diarize
    ? "diarization_required"
    : "groq_free_tier";
  const steps: TranscriptionRouteStep[] = [];
  let inheritedReason: TranscriptionRouteReason | null = null;

  for (const provider of order) {
    if (provider === "groq" && groqSkip !== null) {
      inheritedReason = groqSkip;
      continue;
    }
    if (!isTranscriptionProviderConfigured(env, provider)) {
      inheritedReason = inheritedReason ?? "provider_key_missing";
      continue;
    }
    const first = steps.length === 0;
    steps.push({
      provider,
      reason: inheritedReason ?? (first ? laneReason : "previous_tier_failed"),
    });
    inheritedReason = null;
  }

  return { steps, requested, groqDecision };
}

export interface TranscriptionRunResult {
  transcript: NormalisedTranscript;
  handle: TranscriptionJobHandle;
  /** The provider that ACTUALLY produced this transcript. */
  provider: TranscriptionProviderId;
  model: string;
  /** Why it was this one. Persisted, so a fallback is never silent. */
  reason: TranscriptionRouteReason;
  /** Tiers tried and rejected before this one, in order. Logged. */
  fellBackFrom: TranscriptionProviderId[];
}

/** Test seam. Production passes nothing and the real providers are built. */
export interface TranscriptionRunDeps {
  buildProvider: (env: Env, provider: TranscriptionProviderId) => TranscriptionProvider;
  planRoute: (env: Env, input: TranscriptionRouteInput) => Promise<TranscriptionRoutePlan>;
}

const DEFAULT_RUN_DEPS: TranscriptionRunDeps = { buildProvider, planRoute: planTranscriptionRoute };

/**
 * THE HARD GUARD.
 *
 * A job that asked for speaker labels must never be served by a provider whose
 * own capability flag says it cannot label them. Silently returning an unlabelled
 * transcript would look like a success and be a lie — the teacher asked "who
 * said what" and would get a wall of text with no way to know why.
 *
 * It is checked against the constructed provider's `capabilities`, not against a
 * hard-coded id list, so a provider that loses diarization tomorrow is caught by
 * the same line. `internal` and a loud log: a plan that reaches here is OUR bug,
 * and the teacher gets the warm generic sentence plus a job id support can trace.
 *
 * Note what is NOT checked: whether the finished transcript actually contains
 * speakers. A single-voice recording legitimately comes back with one speaker (or
 * none, if it is silent) from a provider that diarizes perfectly well, and
 * failing on that would refuse correct work.
 */
function assertCanDiarize(provider: TranscriptionProvider, diarize: boolean): void {
  if (!diarize || provider.capabilities.diarization) return;
  console.error("Refused to run a speaker-labelling job on a provider that cannot diarize", {
    provider: provider.id,
    model: provider.model,
  });
  throw new TranscriptionError({
    code: "internal",
    detail: `${provider.id} cannot diarize and must never serve a speaker-labelling job`,
  });
}

/**
 * Does this failure deserve the next tier?
 *
 * Only provider-side failures do. See the module header for why a media failure
 * is terminal on the first tier, and why Groq's own 25 MB ceiling is the one
 * `source_too_large` that is not about the media.
 */
function shouldTryNextTier(provider: TranscriptionProviderId, failure: TranscriptionFailure): boolean {
  switch (failure.code) {
    case "provider_unavailable":
    case "provider_failed":
      return true;
    case "source_too_large":
      return provider === "groq" && failure.maxBytes <= GROQ_FREE_TIER_MAX_UPLOAD_BYTES;
    default:
      return false;
  }
}

/**
 * Stamps WHICH TIER died on the error, on its way out of the cascade.
 *
 * The provider throws; only the router knows it was tier 2 and that tier 1 had
 * rate-limited us. `processTranscriptionJob` reads this back and stores
 * `provider` / `provider_choice_reason` on the failed row, so a job that burned a
 * Groq 429 and then a Deepgram 500 is as auditable as a completed one. Before
 * this, a fallback on the failure path survived only as a `console.warn` — which
 * is the one place a Deepgram bill cannot be explained from.
 *
 * The original error is returned unchanged (same identity, same message, same
 * stack): a thrown provider failure is data the job layer already knows how to
 * store, and wrapping it would cost the real message.
 */
function withAttempt(error: unknown, attempt: TranscriptionAttempt): unknown {
  if (error instanceof TranscriptionError) error.attempt = attempt;
  return error;
}

/**
 * Everything a GROQ FAILURE has to teach the free-tier counter.
 *
 * The counter used to learn only from successes, which made it structurally
 * unable to discover that the window was exhausted: the one response that says so
 * is the 429, and it was the one response nobody booked. The breaker alone is not
 * enough — it expires, the counter still reports a nearly full tier, and the next
 * job pays another cold 429. That repeats for the rest of the window.
 *
 * Three moves, in order of authority:
 *
 *   1. BOOK THE RESPONSE. Groq publishes its limiter state on every answer, and a
 *      rejected request is the sharpest reading we ever get. `audioSeconds: 0` is
 *      deliberate: Groq transcribed nothing here, so the only honest local charge
 *      is its 10-second per-request minimum, and the header reading does the real
 *      work. Charging the media's full length for a 413 would exhaust a free hour
 *      over a file Groq never even read.
 *   2. IF THE 429 TOLD US NOTHING USABLE, spend the hourly window anyway. A
 *      malformed or absent `x-ratelimit-remaining-*` must not leave the counter
 *      believing we have two free hours immediately after Groq refused us.
 *   3. OPEN THE BREAKER, so the jobs behind this one skip Groq without each
 *      collecting a 429 of their own.
 *
 * A failure with no headers never reached a Groq response at all (missing key,
 * dead socket, our own timeout): nothing was spent and nothing is booked.
 */
async function bookGroqFailure(
  env: Env,
  error: unknown,
  failure: TranscriptionFailure
): Promise<void> {
  const headers = error instanceof TranscriptionError ? error.rateLimitHeaders : null;
  // Narrowed once, so the retry-after below needs no second discriminant check.
  const rateLimit =
    failure.code === "provider_unavailable" && failure.status === 429
      ? { retryAfterSeconds: failure.retryAfterSeconds ?? null }
      : null;

  if (headers !== null) {
    await recordGroqUsage(env, { audioSeconds: 0, headers });
    if (rateLimit !== null && parseGroqRateLimitHeaders(headers).remainingSeconds === null) {
      await exhaustGroqHourWindow(env);
    }
  }
  if (rateLimit !== null) await openGroqBreaker(env, rateLimit.retryAfterSeconds);
}

/**
 * Runs the cascade and returns the transcript plus who produced it.
 *
 * Throws `TranscriptionError`. The job runner treats `provider_unavailable` as
 * retryable (the queue ladder) and everything else as terminal — unchanged, and
 * still correct: by the time this throws `provider_unavailable`, EVERY configured
 * tier has refused, so the queue retry is the honest next move.
 */
export async function runTranscription(
  env: Env,
  request: TranscriptionRequest,
  deps: TranscriptionRunDeps = DEFAULT_RUN_DEPS
): Promise<TranscriptionRunResult> {
  const plan = await deps.planRoute(env, {
    diarize: request.diarize,
    durationSeconds: request.durationSeconds ?? null,
    // `request.sizeBytes` is what ingest measured, whatever the source was. An
    // upload also carries its own R2 object size, so either is authoritative and
    // the explicit figure wins. Without the first term every link and every
    // podcast episode looked size-less here, and most episodes are over Groq's
    // free-tier 25 MB ceiling — so the common case paid a full round trip
    // (two KV reads, a submit, Groq downloading the whole file) to be told 413.
    sizeBytes: request.sizeBytes ?? (request.audio.kind === "bytes" ? request.audio.sizeBytes : null),
  });

  if (plan.steps.length === 0) {
    // Every tier of this lane is unconfigured. Warm, translated, and honest —
    // never a crash and never an unlabelled transcript.
    throw new TranscriptionError({ code: "provider_unavailable", provider: plan.requested });
  }

  const fellBackFrom: TranscriptionProviderId[] = [];
  let reason: TranscriptionRouteReason = plan.steps[0].reason;
  let lastError: unknown = null;

  for (const [index, step] of plan.steps.entries()) {
    const provider = deps.buildProvider(env, step.provider);
    // Before any byte is sent: the guard is a precondition, not a fallback path.
    assertCanDiarize(provider, request.diarize);

    try {
      const handle = await provider.submit(request);
      const transcript = await provider.fetchTranscript(handle);
      if (step.provider === "groq") {
        // Book what Groq's limiter just spent, so the jobs behind this one route
        // on a number rather than on optimism. `recordGroqUsage` never throws.
        await recordGroqUsage(env, {
          audioSeconds: transcript.metadata.durationSeconds,
          headers: handle.rateLimitHeaders ?? null,
        });
      }
      return {
        transcript,
        handle,
        provider: step.provider,
        model: transcript.metadata.model,
        reason,
        fellBackFrom,
      };
    } catch (error) {
      const failure = toTranscriptionFailure(error);
      lastError = error;

      if (step.provider === "groq") {
        await bookGroqFailure(env, error, failure);
      }

      const next = plan.steps[index + 1];
      if (next === undefined || !shouldTryNextTier(step.provider, failure)) {
        throw withAttempt(error, { provider: step.provider, reason });
      }

      console.warn("Transcription tier failed — moving to the next provider", {
        from: step.provider,
        to: next.provider,
        code: failure.code,
        status: "status" in failure ? failure.status : undefined,
      });
      fellBackFrom.push(step.provider);
      // A Groq 429 is a specific, expensive fact about our free tier. Recording it
      // on the row that DID the work is what makes the cost explainable later.
      reason =
        step.provider === "groq" && failure.code === "provider_unavailable" && failure.status === 429
          ? "groq_rate_limited"
          : next.reason;
    }
  }

  // Unreachable: the loop either returns or throws. Kept so the function has no
  // implicit-undefined path if the loop body is ever edited.
  throw lastError ?? new TranscriptionError({ code: "provider_unavailable", provider: plan.requested });
}
