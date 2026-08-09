// Transcription Studio — the Groq FREE-TIER capacity tracker.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
// Groq's `whisper-large-v3-turbo` is our cheapest transcription path by an order
// of magnitude ($0.04/h against Deepgram's $0.31/h), and we are on the FREE
// tier, where the ceiling is not money but AUDIO SECONDS:
//
//     7,200 audio-seconds per HOUR   (2 audio-hours)
//    28,800 audio-seconds per DAY    (8 audio-hours)
//
// Developer-tier upgrades are unavailable at the moment, so those two numbers
// are the whole budget. The failure scenario is not "someone spends too much",
// it is a LIVE TRAINING SESSION: twenty teachers press "Transcrire" inside the
// same two minutes and the hourly ceiling is gone before the room has finished
// reading the instructions. From that moment every remaining submission gets a
// cold 429 and, without this module, fails in front of a class.
//
// The requirement is therefore not "refuse work". It is: EVERY JOB STILL
// SUCCEEDS, by routing to Deepgram (which has a $200 credit, ~641 hours, and no
// per-hour ceiling) or AssemblyAI. This module answers exactly one question for
// the router — "is Groq worth trying for this job right now?" — and it must
// answer it from KV, without a round trip to Groq.
//
// ---------------------------------------------------------------------------
// THE THREE PIECES, AND WHICH ONE IS THE ACTUAL GUARANTEE
// ---------------------------------------------------------------------------
//   1. `recordGroqUsage`      — after every Groq response, persist what is left.
//   2. `hasGroqCapacityFor`   — pre-flight: skip Groq for a job that cannot fit.
//   3. `openGroqBreaker` / `isGroqBreakerOpen` — the circuit breaker.
//
// Pieces 1 and 2 are ADVISORY. They are a counter in an eventually-consistent
// store, so two isolates can both read the same healthy number and both spend
// it (see "KV RACES" below). They exist to keep the common case off Groq's
// limiter and to avoid pointless round trips — not to make 429s impossible.
//
// Piece 3 is the GUARANTEE. Whoever actually receives the 429 writes a
// "paused until <timestamp>" marker; everyone after that reads the marker and
// routes away without touching Groq. That is what turns "20 teachers, 20 cold
// 429s, 20 delays" into "one job pays a 429, nineteen route instantly".
//
// The call order, as `runTranscription` (worker/lib/transcription/index.ts)
// actually performs it:
//
//     const decision = await canRouteGroq(env, estimatedSeconds);
//     if (!decision.route) → use Deepgram / AssemblyAI
//     … POST to Groq …
//     await recordGroqUsage(env, { audioSeconds, headers });   // 200 AND failure
//     if (429 && no usable header reading) await exhaustGroqHourWindow(env);
//     if (429) await openGroqBreaker(env, retryAfterSeconds);
//
// `recordGroqUsage` is called on the 429 too — that is the whole reason the
// header parser below exists. A 429 still carries rate-limit headers, they are
// the most accurate reading we will ever get, and the response that says "the
// window is gone" is the one response the counter cannot afford to miss. The
// headers reach the router on `TranscriptionJobHandle.rateLimitHeaders` (success)
// and on `TranscriptionError.rateLimitHeaders` (failure), neither of which is
// ever persisted or sent to a browser.
//
// ---------------------------------------------------------------------------
// THE HEADERS WE READ, AND WHY THESE NAMES
// ---------------------------------------------------------------------------
// Groq returns its limiter state on EVERY response, success or failure. On the
// audio endpoints the "tokens" dimension of the OpenAI-compatible limiter is
// denominated in AUDIO SECONDS, and Groq names it accordingly:
//
//     x-ratelimit-limit-audio-seconds       e.g. "7200"
//     x-ratelimit-remaining-audio-seconds   e.g. "7180"
//     x-ratelimit-reset-audio-seconds       e.g. "2m59.56s"
//     retry-after                           on 429 only
//
// MEASURED, 2026-08-09, on Greg's free-tier key: across eight live responses
// ONLY the request-count headers came back — `x-ratelimit-limit-requests`,
// `-remaining-requests`, `-reset-requests`. Not one audio-seconds header
// appeared. So on this account `parseGroqRateLimitHeaders` returns
// `remainingSeconds: null` every time, and the LOCAL counters below are not a
// backstop, they are the whole pre-flight guarantee: `applyReading` is a no-op,
// `recordGroqUsage` books the media's real length (or the 90-minute ceiling when
// it is unmeasurable), and a 429 always takes the `exhaustGroqHourWindow` path.
// The parser stays because it costs one map lookup and the headers are Groq's
// documented behaviour — if they appear, we get sharper; if they never do,
// nothing here degrades. Do NOT "simplify" it away on the grounds that it
// currently reads null: that null is exactly what the fallbacks are sized for.
//
// Because Groq inherits the OpenAI-compatible header format, the generic
// `-tokens` / `-seconds` spellings are kept as ordered fallbacks: whichever
// candidate is present first wins. If Groq renames a header tomorrow, the
// module degrades to its local counters instead of silently reading zero — see
// `parseGroqRateLimitHeaders`, which returns nulls, never zeros, for absent or
// unparseable values. A missing header must never look like "no capacity left",
// and an unparseable one must never look like "full capacity".
//
// ONE READING, TWO WINDOWS. Groq reports a single remaining figure, not one per
// window, so we have to decide which of the hour/day buckets it describes. The
// reset horizon is the honest signal: a bucket that refills within an hour is
// the hourly one, anything longer is the daily one. When the reset header is
// missing we attribute the reading to the HOURLY window, because that is the
// tighter of the two and `remainingSeconds` below is the MINIMUM of both — so an
// immediate routing decision comes out identical either way, and the next
// response re-states the truth.
//
// A HEADER ONLY EVER TAKES CAPACITY AWAY. We keep `max(localUsed, impliedUsed)`,
// never the header's more generous view. Groq's limiter refills continuously,
// so a reading can legitimately be rosier than our counter; believing it would
// hand back capacity that a concurrent isolate has already spent but not yet
// published. Under-using free seconds costs nothing. A 429 in a classroom does.
//
// ---------------------------------------------------------------------------
// WINDOW ROLLOVER
// ---------------------------------------------------------------------------
// Groq's real limiter is a continuously-refilling bucket. We model it as a fixed
// window anchored at first use and advanced in whole window-lengths
// (`start += n * HOUR_MS`), which keeps the anchor's phase stable no matter when
// we happen to read — two isolates reading at different instants agree on which
// window they are in, which a "reset the anchor to now" model cannot promise.
//
// The approximation is safe in the direction that matters. Spending the whole
// hourly allowance in the first five minutes of a window leaves the real bucket
// refilling for the remaining fifty-five, so by the time our window rolls the
// bucket is at least as full as we think it is. We are never rosier than Groq;
// at worst we sit on seconds Groq would already have granted.
//
// ---------------------------------------------------------------------------
// KV RACES — what happens when two isolates collide, and which way we err
// ---------------------------------------------------------------------------
// Workers KV is eventually consistent (~60 s worst case; far faster inside the
// colo that wrote the value). Three collisions are possible, and the module
// takes the conservative side of each.
//
// 1. TWO READS OF THE CAPACITY COUNTER, THEN TWO WRITES. Read-modify-write is
//    not atomic and there is no compare-and-swap, so the later `put` wins whole.
//    If A spends 500 s and B (which read before A wrote) spends 20 s, the stored
//    counter can end up showing only B's 20 s: we OVER-report capacity by 500 s.
//    We do not try to fix this — a second read just before the write would not
//    have propagated either, and would cost latency on every job. Instead the
//    error is bounded and absorbed: over-reporting capacity means at most a few
//    extra submissions reach Groq, the first of which gets a 429 and opens the
//    breaker, which is the mechanism we actually rely on. The counter's job is
//    to make that rare, not to make it impossible.
//
// 2. THE BREAKER MARKER RACING WITH ITSELF. Two isolates that both took a 429
//    both call `openGroqBreaker`. The merge rule is "never shorten a pause": a
//    write that would move `pausedUntil` earlier is dropped in favour of the
//    stored value, so opens that CAN see each other converge on the longest.
//    An open whose read predates the other's write cannot see it and will
//    clobber it, which is the one case where a pause gets shorter than someone
//    asked for. The damage is bounded on both sides: the surviving pause still
//    runs at least the clobbering isolate's own `retry-after` from its own 429,
//    so we are never sent back at Groq sooner than Groq itself suggested, and if
//    that turns out to be too soon the resulting 429 simply re-opens the
//    breaker. Guaranteeing more would need a compare-and-swap KV does not have,
//    and would buy a smoother log rather than a better outcome for a teacher.
//
// 3. THE BREAKER MARKER NOT YET VISIBLE. A job served by a colo that has not
//    seen the write yet will still try Groq and may pay a second 429. The
//    guarantee is therefore precisely "at most one 429 per colo per pause
//    window", and the realistic path — the transcription queue consumer, which
//    processes a burst as a batch through one isolate reading its own writes —
//    pays exactly one. Every additional 429 re-opens the breaker rather than
//    resetting it, so the pause converges rather than flapping.
//
// A missing or corrupt breaker marker reads as CLOSED. That is the one place we
// deliberately fail open: a KV blip must not be able to exile us from the free
// tier indefinitely, and the cost of getting it wrong is a single 429 that
// immediately re-opens the breaker.
//
// ---------------------------------------------------------------------------
// SCOPE OF THE STATE
// ---------------------------------------------------------------------------
// Groq's limits are per API KEY, not per user, so both keys are global — one
// counter and one breaker for the whole Worker. Never key these by user: a
// per-user counter would let twenty teachers each believe they own the full
// 7,200 s, which is the exact scenario this module exists to prevent.
//
// If the account is ever upgraded off the free tier, change
// `GROQ_HOUR_AUDIO_SECONDS` / `GROQ_DAY_AUDIO_SECONDS` and bump the `:v` suffix
// on the KV keys so stale free-tier state is abandoned rather than merged.

import type { Env } from "../env";
import { GROQ_MINIMUM_BILLED_SECONDS, groqBilledSeconds } from "./transcription/groq";
import { TRANSCRIPTION_MAX_SOURCE_SECONDS } from "./transcription/types";

// ---- Limits ----

/** Groq free tier: 7,200 audio-seconds (2 h) per rolling hour. */
export const GROQ_HOUR_AUDIO_SECONDS = 7_200;
/** Groq free tier: 28,800 audio-seconds (8 h) per rolling day. */
export const GROQ_DAY_AUDIO_SECONDS = 28_800;

/**
 * Audio-seconds held back from the pre-flight check.
 *
 * The counter can be stale by one concurrent job (race 1 above), so a job that
 * fits the remaining budget to the second is exactly the job most likely to be
 * the one that tips us into a 429. 60 s is 0.8 % of the hourly ceiling — cheap
 * insurance, and it makes the boundary behaviour of `hasGroqCapacityFor`
 * deliberate rather than accidental.
 */
export const GROQ_CAPACITY_HEADROOM_SECONDS = 60;

// ---- Breaker pause bounds ----

/** Never pause for less than this: "retry immediately" is how a 429 loop starts. */
export const GROQ_BREAKER_MIN_SECONDS = 10;
/**
 * Never pause for more than an hour. The hourly window is the longest one a
 * `retry-after` can legitimately be waiting for; a DAILY exhaustion is already
 * held back by the day counter, which survives the breaker expiring.
 */
export const GROQ_BREAKER_MAX_SECONDS = 3_600;
/**
 * Used when `retry-after` is absent or unparseable. Long enough to drain a
 * classroom-sized burst without a single retry, short enough that we do not
 * abandon two free hours over one malformed header.
 */
export const GROQ_BREAKER_DEFAULT_SECONDS = 300;

// ---- KV keys ----

/** Global, not per user: Groq's limiter is per API key. */
export const GROQ_CAPACITY_KEY = "groqcap:v1";
export const GROQ_BREAKER_KEY = "groqbrk:v1";

/**
 * Two days, so a day window can never expire out from under itself mid-window.
 * Correctness does not depend on it — `rollWindows` treats an ancient record as
 * a fresh one — it just keeps abandoned state from lingering.
 */
const CAPACITY_TTL_SECONDS = 60 * 60 * 48;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const HOUR_SECONDS = 3_600;

// ---- Header names ----

/**
 * Candidate header names, most specific first. The first one present on the
 * response wins; see the module header for why the `-audio-seconds` spelling is
 * primary on Groq's transcription endpoints.
 */
export const GROQ_LIMIT_HEADERS = [
  "x-ratelimit-limit-audio-seconds",
  "x-ratelimit-limit-seconds",
  "x-ratelimit-limit-tokens",
] as const;

export const GROQ_REMAINING_HEADERS = [
  "x-ratelimit-remaining-audio-seconds",
  "x-ratelimit-remaining-seconds",
  "x-ratelimit-remaining-tokens",
] as const;

export const GROQ_RESET_HEADERS = [
  "x-ratelimit-reset-audio-seconds",
  "x-ratelimit-reset-seconds",
  "x-ratelimit-reset-tokens",
] as const;

// ---- Public shapes ----

/** Which window a single rate-limit reading was attributed to. */
export type GroqBudgetWindow = "hour" | "day";

/** Where the numbers in a `GroqCapacity` came from. */
export type GroqCapacitySource =
  /** Nothing stored (or unreadable): the full free-tier allowance is assumed. */
  | "fresh"
  /** Locally accumulated only — no usable provider header has been seen this window. */
  | "local"
  /** Clamped by Groq's own rate-limit headers. */
  | "headers";

export interface GroqCapacity {
  hourRemainingSeconds: number;
  dayRemainingSeconds: number;
  /** The binding figure: the smaller of the two. This is what a job spends against. */
  remainingSeconds: number;
  /** ISO timestamp at which the hourly window next rolls. */
  hourResetsAt: string;
  /** ISO timestamp at which the daily window next rolls. */
  dayResetsAt: string;
  source: GroqCapacitySource;
}

export interface GroqCapacityCheck {
  /** The boolean the router wants. True = worth sending to Groq. */
  ok: boolean;
  /** What the job will actually cost the limiter, after the 10 s minimum. */
  requestedSeconds: number;
  capacity: GroqCapacity;
}

export interface GroqBreakerState {
  open: boolean;
  /** ISO timestamp Groq becomes eligible again, or null when closed. */
  pausedUntil: string | null;
  /** Whole seconds left in the pause; 0 when closed. Safe to log, never shown to a teacher. */
  retryInSeconds: number;
}

export type GroqRouteReason = "ok" | "breaker_open" | "insufficient_capacity";

export interface GroqRouteDecision {
  route: boolean;
  reason: GroqRouteReason;
  requestedSeconds: number;
  breaker: GroqBreakerState;
  capacity: GroqCapacity;
}

/** One parsed rate-limit reading. Every field is null when Groq did not say. */
export interface GroqRateLimitReading {
  limitSeconds: number | null;
  remainingSeconds: number | null;
  resetSeconds: number | null;
  /** Which bucket the reading describes, inferred from the reset horizon. */
  window: GroqBudgetWindow;
}

export interface GroqBudgetOptions {
  /** Injected clock. Nothing in this module reads the ambient one. */
  now?: Date;
}

export interface GroqUsageReport {
  /** Media length actually sent to Groq, in seconds. */
  audioSeconds: number;
  /** The response's headers — from a 200 or a 429, both carry limiter state. */
  headers?: Headers | null;
}

// ---- Small readers (no `any`, no blind casts) ----

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFiniteNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function millisToIso(millis: number): string {
  return new Date(millis).toISOString();
}

/** Whole, non-negative seconds, or null when the text cannot mean a count. */
function parseSecondsCount(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

const DURATION_PATTERN = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/;

/**
 * Groq writes its reset horizon as a duration ("2m59.56s", "1h30m", "8.5s") and
 * occasionally as bare delta-seconds. Both are accepted; anything else is null,
 * which downstream reads as "we do not know", never as zero.
 *
 * This intentionally mirrors `parseRetryAfterSeconds` in the Groq provider
 * without importing it: that one also accepts an HTTP date, which is right for
 * `retry-after` and meaningless for a reset *horizon*. Two parsers because they
 * accept two different grammars, not because of duplication.
 */
export function parseGroqResetSeconds(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) return null;

  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

  const match = DURATION_PATTERN.exec(trimmed);
  if (match === null) return null;
  if (match[1] === undefined && match[2] === undefined && match[3] === undefined) return null;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

function firstHeader(headers: Headers, names: readonly string[]): string | null {
  for (const name of names) {
    const value = headers.get(name);
    if (value !== null && value.trim().length > 0) return value;
  }
  return null;
}

/**
 * Reads Groq's limiter state off a response.
 *
 * Absent, blank and unparseable values all become null — the caller then keeps
 * its local counters, which is the only safe reading. A garbled header that
 * parsed as 0 would falsely exhaust Groq for the whole window; one that parsed
 * as the full limit would falsely refill it.
 */
export function parseGroqRateLimitHeaders(headers: Headers | null | undefined): GroqRateLimitReading {
  if (!headers) {
    return { limitSeconds: null, remainingSeconds: null, resetSeconds: null, window: "hour" };
  }
  const resetSeconds = parseGroqResetSeconds(firstHeader(headers, GROQ_RESET_HEADERS));
  return {
    limitSeconds: parseSecondsCount(firstHeader(headers, GROQ_LIMIT_HEADERS)),
    remainingSeconds: parseSecondsCount(firstHeader(headers, GROQ_REMAINING_HEADERS)),
    resetSeconds,
    // A bucket refilling within the hour is the hourly one. No reset header at
    // all falls back to "hour": it is the tighter window, and `remainingSeconds`
    // is the min of both, so today's decision is the same either way.
    window: resetSeconds !== null && resetSeconds > HOUR_SECONDS ? "day" : "hour",
  };
}

// ---- Stored state ----

interface CapacityState {
  hourStart: number;
  hourUsed: number;
  dayStart: number;
  dayUsed: number;
  /** True once a provider header has clamped the current hour window. */
  fromHeaders: boolean;
}

function freshState(nowMs: number): CapacityState {
  return { hourStart: nowMs, hourUsed: 0, dayStart: nowMs, dayUsed: 0, fromHeaders: false };
}

function parseCapacityState(raw: string | null): CapacityState | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const hourStart = readFiniteNumber(parsed, "hourStart");
  const dayStart = readFiniteNumber(parsed, "dayStart");
  if (hourStart === null || dayStart === null) return null;
  return {
    hourStart,
    hourUsed: Math.max(0, readFiniteNumber(parsed, "hourUsed") ?? 0),
    dayStart,
    dayUsed: Math.max(0, readFiniteNumber(parsed, "dayUsed") ?? 0),
    fromHeaders: parsed.fromHeaders === true,
  };
}

/**
 * Advances the two windows in whole window-lengths, preserving the anchor's
 * phase so concurrent readers agree on which window they are in.
 *
 * A `start` in the future means a clock that moved backwards or a record we
 * cannot trust; we restart the window at `now` rather than crediting an
 * arbitrary amount of unspent capacity.
 */
function rollWindows(state: CapacityState, nowMs: number): CapacityState {
  const rolled: CapacityState = { ...state };

  if (nowMs < rolled.hourStart) {
    rolled.hourStart = nowMs;
    rolled.hourUsed = 0;
    rolled.fromHeaders = false;
  } else if (nowMs - rolled.hourStart >= HOUR_MS) {
    rolled.hourStart += Math.floor((nowMs - rolled.hourStart) / HOUR_MS) * HOUR_MS;
    rolled.hourUsed = 0;
    // The header reading described the window that just ended.
    rolled.fromHeaders = false;
  }

  if (nowMs < rolled.dayStart) {
    rolled.dayStart = nowMs;
    rolled.dayUsed = 0;
  } else if (nowMs - rolled.dayStart >= DAY_MS) {
    rolled.dayStart += Math.floor((nowMs - rolled.dayStart) / DAY_MS) * DAY_MS;
    rolled.dayUsed = 0;
  }

  return rolled;
}

function toCapacity(state: CapacityState, source: GroqCapacitySource): GroqCapacity {
  const hourRemainingSeconds = Math.max(0, GROQ_HOUR_AUDIO_SECONDS - state.hourUsed);
  const dayRemainingSeconds = Math.max(0, GROQ_DAY_AUDIO_SECONDS - state.dayUsed);
  return {
    hourRemainingSeconds,
    dayRemainingSeconds,
    remainingSeconds: Math.min(hourRemainingSeconds, dayRemainingSeconds),
    hourResetsAt: millisToIso(state.hourStart + HOUR_MS),
    dayResetsAt: millisToIso(state.dayStart + DAY_MS),
    source,
  };
}

async function loadCapacityState(
  env: Env,
  nowMs: number
): Promise<{ state: CapacityState; source: GroqCapacitySource }> {
  const stored = parseCapacityState(await env.SESSIONS.get(GROQ_CAPACITY_KEY));
  if (stored === null) return { state: freshState(nowMs), source: "fresh" };
  const state = rollWindows(stored, nowMs);
  return { state, source: state.fromHeaders ? "headers" : "local" };
}

/**
 * Folds one header reading into the counters.
 *
 * `max` on the used side (equivalently `min` on the remaining side) is the whole
 * policy: a reading can shrink what we believe we have, never grow it. See the
 * module header.
 *
 * When Groq reports a `limit` we prefer it over our constant — it is the only
 * way an account tier ever announces itself — but the remaining figure is still
 * capped by our own ceiling, so a dev-tier limit cannot silently unlock capacity
 * the rest of this module is not sized for.
 */
function applyReading(state: CapacityState, reading: GroqRateLimitReading): CapacityState {
  if (reading.remainingSeconds === null) return state;

  const isHour = reading.window === "hour";
  const declaredLimit = isHour ? GROQ_HOUR_AUDIO_SECONDS : GROQ_DAY_AUDIO_SECONDS;
  const limit = reading.limitSeconds !== null && reading.limitSeconds > 0 ? reading.limitSeconds : declaredLimit;
  const impliedUsed = Math.max(0, limit - reading.remainingSeconds);

  return isHour
    ? { ...state, hourUsed: Math.max(state.hourUsed, impliedUsed), fromHeaders: true }
    : { ...state, dayUsed: Math.max(state.dayUsed, impliedUsed), fromHeaders: true };
}

// ---- Public API ----

/**
 * Audio-seconds a request of this length costs Groq's limiter.
 *
 * Groq applies a 10-second minimum per request, so a 4-second clip still spends
 * 10. `fallback` covers a duration we could not measure (NaN from a resolver
 * that found no duration field, Infinity from a division); callers pick a
 * fallback that errs towards spending more, never less.
 *
 * The rounding rule itself is `groqBilledSeconds` in the provider module, which
 * is where Groq's per-request minimum is defined. This function is that rule
 * plus the unmeasurable-duration substitution — spelling the arithmetic out a
 * second time is how the two would come to disagree about a 0.4-second clip.
 */
export function groqRateLimitSeconds(seconds: number, fallback = TRANSCRIPTION_MAX_SOURCE_SECONDS): number {
  return groqBilledSeconds(Number.isFinite(seconds) && seconds >= 0 ? seconds : fallback);
}

/**
 * Reads the current capacity without changing it. Cheap: one KV get.
 *
 * Display and logging. Route with `hasGroqCapacityFor` / `canRouteGroq`, which
 * apply the headroom.
 */
export async function getGroqCapacity(env: Env, options: GroqBudgetOptions = {}): Promise<GroqCapacity> {
  const nowMs = (options.now ?? new Date()).getTime();
  const { state, source } = await loadCapacityState(env, nowMs);
  return toCapacity(state, source);
}

/**
 * Books what a Groq call cost and republishes the remaining budget.
 *
 * Call it after EVERY Groq response, including the 429 — a 429 carries the most
 * accurate limiter reading we will ever see, and throwing it away is how a
 * counter drifts.
 *
 * The local increment happens first and the header clamp lands on top, so a
 * response with no usable headers still consumes budget. When headers ARE
 * present, an unmeasurable duration only books Groq's 10-second minimum locally
 * and lets the authoritative reading do the work; when they are absent, the same
 * unmeasurable duration books the 90-minute per-file ceiling instead. Both are
 * the pessimistic choice given what we know.
 *
 * This never throws. It is bookkeeping that runs after a transcript already
 * exists; a KV hiccup must not be able to fail a job whose work is done. A lost
 * write is corrected by the next response's headers.
 */
export async function recordGroqUsage(
  env: Env,
  usage: GroqUsageReport,
  options: GroqBudgetOptions = {}
): Promise<GroqCapacity> {
  const nowMs = (options.now ?? new Date()).getTime();
  const reading = parseGroqRateLimitHeaders(usage.headers);
  const spent = groqRateLimitSeconds(
    usage.audioSeconds,
    reading.remainingSeconds === null ? TRANSCRIPTION_MAX_SOURCE_SECONDS : GROQ_MINIMUM_BILLED_SECONDS
  );

  const { state } = await loadCapacityState(env, nowMs);
  const spentState: CapacityState = {
    ...state,
    hourUsed: state.hourUsed + spent,
    dayUsed: state.dayUsed + spent,
  };
  const next = applyReading(spentState, reading);

  await env.SESSIONS.put(GROQ_CAPACITY_KEY, JSON.stringify(next), {
    expirationTtl: CAPACITY_TTL_SECONDS,
  });

  return toCapacity(next, next.fromHeaders ? "headers" : "local");
}

/**
 * Declares the current hourly window spent, without touching the daily one.
 *
 * The last-resort reading. Groq answered 429 — so the window IS gone — but its
 * rate-limit headers said nothing we could parse, which leaves the counter
 * believing we still hold two free hours. The breaker alone does not fix that: it
 * expires after `retry-after`, and the counter then waves the next job straight
 * back at an exhausted tier for another cold 429, and again a few minutes later,
 * for the rest of the window.
 *
 * The DAY counter is deliberately untouched. A 429 can equally be Groq's 20
 * requests-per-minute limit rather than the audio-seconds ceiling, and spending
 * eight hours of daily allowance on that guess would exile us from the free tier
 * for the rest of the day over a burst that lasted a minute. The hourly window
 * rolls on its own, which bounds the damage of being wrong here to one hour.
 *
 * Never throws, for the same reason `recordGroqUsage` does not.
 */
export async function exhaustGroqHourWindow(
  env: Env,
  options: GroqBudgetOptions = {}
): Promise<GroqCapacity> {
  const nowMs = (options.now ?? new Date()).getTime();
  const { state } = await loadCapacityState(env, nowMs);
  const next: CapacityState = {
    ...state,
    hourUsed: Math.max(state.hourUsed, GROQ_HOUR_AUDIO_SECONDS),
  };
  await env.SESSIONS.put(GROQ_CAPACITY_KEY, JSON.stringify(next), {
    expirationTtl: CAPACITY_TTL_SECONDS,
  });
  return toCapacity(next, next.fromHeaders ? "headers" : "local");
}

/**
 * Pre-flight: would this job fit in what is left of the free tier?
 *
 * One KV get, no provider round trip. A job that clearly cannot fit is routed to
 * Deepgram immediately instead of being sent to Groq to discover a 429 — which
 * would cost the teacher a failed attempt AND open the breaker for everyone
 * behind them.
 *
 * `GROQ_CAPACITY_HEADROOM_SECONDS` is withheld, so a job that fits only by a
 * hair is treated as not fitting. That is deliberate: the counter can be one
 * concurrent job stale, and the marginal job is precisely the one that would
 * tip the window over.
 *
 * An unmeasurable `estimatedSeconds` is charged as the 90-minute per-file
 * ceiling — a job of unknown length is exactly the job we must not gamble the
 * shared hourly window on.
 */
export async function hasGroqCapacityFor(
  env: Env,
  estimatedSeconds: number,
  options: GroqBudgetOptions = {}
): Promise<GroqCapacityCheck> {
  const requestedSeconds = groqRateLimitSeconds(estimatedSeconds);
  const capacity = await getGroqCapacity(env, options);
  return {
    ok: requestedSeconds + GROQ_CAPACITY_HEADROOM_SECONDS <= capacity.remainingSeconds,
    requestedSeconds,
    capacity,
  };
}

// ---- Circuit breaker ----

interface BreakerState {
  pausedUntil: number;
  openedAt: number;
}

function parseBreakerState(raw: string | null): BreakerState | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const pausedUntil = readFiniteNumber(parsed, "pausedUntil");
  if (pausedUntil === null) return null;
  return { pausedUntil, openedAt: readFiniteNumber(parsed, "openedAt") ?? pausedUntil };
}

function toBreakerState(pausedUntil: number | null, nowMs: number): GroqBreakerState {
  if (pausedUntil === null || pausedUntil <= nowMs) {
    return { open: false, pausedUntil: null, retryInSeconds: 0 };
  }
  return {
    open: true,
    pausedUntil: millisToIso(pausedUntil),
    retryInSeconds: Math.ceil((pausedUntil - nowMs) / 1000),
  };
}

/**
 * Turns whatever `retry-after` gave us into a pause we are willing to honour.
 *
 * null / NaN / negative → the default. Zero means "retry now", which is how a
 * 429 loop begins, so it is raised to the minimum. Anything beyond an hour is
 * clamped: the hourly window is the longest wait a Groq 429 can honestly
 * require, and a daily exhaustion is already held back by the day counter, which
 * outlives the breaker.
 */
export function groqPauseSeconds(retryAfterSeconds: number | null | undefined): number {
  if (typeof retryAfterSeconds !== "number" || !Number.isFinite(retryAfterSeconds) || retryAfterSeconds < 0) {
    return GROQ_BREAKER_DEFAULT_SECONDS;
  }
  return Math.min(GROQ_BREAKER_MAX_SECONDS, Math.max(GROQ_BREAKER_MIN_SECONDS, Math.ceil(retryAfterSeconds)));
}

/**
 * Records that Groq has rate-limited us, so every job behind this one skips it.
 *
 * The first 429 in a burst pays the round trip and writes the marker; the rest
 * read the marker and route to Deepgram without touching Groq. That is the whole
 * point of the module.
 *
 * NEVER SHORTENS AN EXISTING PAUSE. Two isolates that both took a 429 converge
 * on the longer of the two, so a lost update can only leave us paused longer
 * than asked — off the limiter, which is where we want to be.
 *
 * The KV TTL is only garbage collection: expiry is decided by comparing
 * `pausedUntil` to the injected clock, never by the key vanishing. KV's TTL
 * floor is 60 s, which is longer than a short pause, so relying on it would keep
 * a 15-second pause alive for a minute.
 */
export async function openGroqBreaker(
  env: Env,
  retryAfterSeconds: number | null,
  options: GroqBudgetOptions = {}
): Promise<GroqBreakerState> {
  const nowMs = (options.now ?? new Date()).getTime();
  const pauseSeconds = groqPauseSeconds(retryAfterSeconds);
  const requested = nowMs + pauseSeconds * 1000;

  const stored = parseBreakerState(await env.SESSIONS.get(GROQ_BREAKER_KEY));
  const pausedUntil = stored !== null && stored.pausedUntil > requested ? stored.pausedUntil : requested;
  const openedAt = stored !== null && stored.pausedUntil > requested ? stored.openedAt : nowMs;

  await env.SESSIONS.put(GROQ_BREAKER_KEY, JSON.stringify({ pausedUntil, openedAt }), {
    expirationTtl: Math.max(60, Math.ceil((pausedUntil - nowMs) / 1000) + 60),
  });

  return toBreakerState(pausedUntil, nowMs);
}

/**
 * Is Groq paused right now? One KV get, and the check every job runs first.
 *
 * A missing, expired or corrupt marker reads as CLOSED — the deliberate
 * fail-open described in the module header. The expired marker is left in place
 * rather than deleted: a delete costs a write, races with a concurrent re-open,
 * and buys nothing that the TTL does not already do.
 */
export async function isGroqBreakerOpen(env: Env, options: GroqBudgetOptions = {}): Promise<GroqBreakerState> {
  const nowMs = (options.now ?? new Date()).getTime();
  const stored = parseBreakerState(await env.SESSIONS.get(GROQ_BREAKER_KEY));
  return toBreakerState(stored?.pausedUntil ?? null, nowMs);
}

/**
 * The single call a router should make: breaker first, capacity second, both
 * reads in flight at once.
 *
 * Exists so the two checks cannot be wired in the wrong order or one of them
 * forgotten. `reason` is for logs and metrics only — it is never rendered, so it
 * needs no translation; a teacher only ever learns that their transcription is
 * running, on whichever provider took it.
 */
export async function canRouteGroq(
  env: Env,
  estimatedSeconds: number,
  options: GroqBudgetOptions = {}
): Promise<GroqRouteDecision> {
  const now = options.now ?? new Date();
  const [breaker, check] = await Promise.all([
    isGroqBreakerOpen(env, { now }),
    hasGroqCapacityFor(env, estimatedSeconds, { now }),
  ]);

  const reason: GroqRouteReason = breaker.open ? "breaker_open" : check.ok ? "ok" : "insufficient_capacity";
  return {
    route: reason === "ok",
    reason,
    requestedSeconds: check.requestedSeconds,
    breaker,
    capacity: check.capacity,
  };
}
