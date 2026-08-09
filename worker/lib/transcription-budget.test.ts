import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../env";
import {
  GROQ_BREAKER_DEFAULT_SECONDS,
  GROQ_BREAKER_KEY,
  GROQ_BREAKER_MAX_SECONDS,
  GROQ_BREAKER_MIN_SECONDS,
  GROQ_CAPACITY_HEADROOM_SECONDS,
  GROQ_CAPACITY_KEY,
  GROQ_DAY_AUDIO_SECONDS,
  GROQ_HOUR_AUDIO_SECONDS,
  canRouteGroq,
  exhaustGroqHourWindow,
  getGroqCapacity,
  groqPauseSeconds,
  groqRateLimitSeconds,
  hasGroqCapacityFor,
  isGroqBreakerOpen,
  openGroqBreaker,
  parseGroqRateLimitHeaders,
  parseGroqResetSeconds,
  recordGroqUsage,
  type GroqRouteReason,
} from "./transcription-budget";
import { TRANSCRIPTION_MAX_SOURCE_SECONDS } from "./transcription/types";

const testEnv = env as unknown as Env;

/**
 * Both keys are global — Groq's limiter is per API key, not per user — so there
 * is no per-test id to isolate behind. Every test starts from an empty store.
 */
async function resetBudget(): Promise<void> {
  await testEnv.SESSIONS.delete(GROQ_CAPACITY_KEY);
  await testEnv.SESSIONS.delete(GROQ_BREAKER_KEY);
}

function at(iso: string): Date {
  return new Date(iso);
}

/** The three headers Groq puts on every transcription response, plus retry-after. */
function rateLimitHeaders(fields: {
  limit?: string;
  remaining?: string;
  reset?: string;
  retryAfter?: string;
}): Headers {
  const headers = new Headers();
  if (fields.limit !== undefined) headers.set("x-ratelimit-limit-audio-seconds", fields.limit);
  if (fields.remaining !== undefined) {
    headers.set("x-ratelimit-remaining-audio-seconds", fields.remaining);
  }
  if (fields.reset !== undefined) headers.set("x-ratelimit-reset-audio-seconds", fields.reset);
  if (fields.retryAfter !== undefined) headers.set("retry-after", fields.retryAfter);
  return headers;
}

/**
 * An isolate whose read of one key predates someone else's write to it, while
 * its own writes still land for real. This is the only honest way to model KV's
 * eventual consistency: the value is not "wrong", it is simply the one this
 * colo could still see.
 */
function staleReaderEnv(base: Env, key: string, seen: string | null): Env {
  const kv = {
    get: (requested: string) =>
      requested === key ? Promise.resolve(seen) : base.SESSIONS.get(requested),
    put: (requested: string, value: string, options?: KVNamespacePutOptions) =>
      base.SESSIONS.put(requested, value, options),
    delete: (requested: string) => base.SESSIONS.delete(requested),
  } as unknown as KVNamespace;
  return { ...base, SESSIONS: kv };
}

describe("groq budget — header parsing", () => {
  it("reads Groq's audio-seconds rate-limit headers", () => {
    const reading = parseGroqRateLimitHeaders(
      rateLimitHeaders({ limit: "7200", remaining: "7180", reset: "2m59.56s" })
    );
    expect(reading.limitSeconds).toBe(7_200);
    expect(reading.remainingSeconds).toBe(7_180);
    expect(reading.resetSeconds).toBeCloseTo(179.56, 5);
    expect(reading.window).toBe("hour");
  });

  it("falls back to the generic OpenAI-compatible spellings", () => {
    const headers = new Headers({
      "x-ratelimit-limit-tokens": "7200",
      "x-ratelimit-remaining-tokens": "3600",
      "x-ratelimit-reset-tokens": "30s",
    });
    const reading = parseGroqRateLimitHeaders(headers);
    expect(reading.remainingSeconds).toBe(3_600);
    expect(reading.resetSeconds).toBe(30);
  });

  it("prefers the audio-seconds spelling when both are present", () => {
    const headers = rateLimitHeaders({ remaining: "100" });
    headers.set("x-ratelimit-remaining-tokens", "9999");
    expect(parseGroqRateLimitHeaders(headers).remainingSeconds).toBe(100);
  });

  it("attributes a reading to the day window when the reset horizon exceeds an hour", () => {
    expect(parseGroqRateLimitHeaders(rateLimitHeaders({ reset: "3h" })).window).toBe("day");
    expect(parseGroqRateLimitHeaders(rateLimitHeaders({ reset: "59m" })).window).toBe("hour");
    // Exactly an hour is still the hourly bucket — only "longer than" promotes it.
    expect(parseGroqRateLimitHeaders(rateLimitHeaders({ reset: "1h" })).window).toBe("hour");
  });

  it("attributes a reading with no reset header to the tighter hourly window", () => {
    expect(parseGroqRateLimitHeaders(rateLimitHeaders({ remaining: "500" })).window).toBe("hour");
  });

  it("returns nulls — never zeros — for absent, blank or garbled values", () => {
    const absent = parseGroqRateLimitHeaders(new Headers());
    expect(absent).toEqual({
      limitSeconds: null,
      remainingSeconds: null,
      resetSeconds: null,
      window: "hour",
    });

    const garbled = parseGroqRateLimitHeaders(
      rateLimitHeaders({ limit: "  ", remaining: "not-a-number", reset: "soon" })
    );
    expect(garbled.limitSeconds).toBeNull();
    expect(garbled.remainingSeconds).toBeNull();
    expect(garbled.resetSeconds).toBeNull();

    // A negative remaining is nonsense, not "over budget".
    expect(parseGroqRateLimitHeaders(rateLimitHeaders({ remaining: "-40" })).remainingSeconds).toBeNull();
  });

  it("survives a null Headers object", () => {
    expect(parseGroqRateLimitHeaders(null).remainingSeconds).toBeNull();
    expect(parseGroqRateLimitHeaders(undefined).remainingSeconds).toBeNull();
  });

  it("parses Groq's duration grammar and rejects anything else", () => {
    expect(parseGroqResetSeconds("8.5s")).toBeCloseTo(8.5, 5);
    expect(parseGroqResetSeconds("1h30m")).toBe(5_400);
    expect(parseGroqResetSeconds("2m59.56s")).toBeCloseTo(179.56, 5);
    expect(parseGroqResetSeconds("42")).toBe(42);
    expect(parseGroqResetSeconds("")).toBeNull();
    expect(parseGroqResetSeconds(null)).toBeNull();
    expect(parseGroqResetSeconds("tomorrow")).toBeNull();
    // An HTTP date belongs on retry-after, not on a reset horizon.
    expect(parseGroqResetSeconds("Wed, 09 Aug 2026 14:00:00 GMT")).toBeNull();
  });
});

describe("groq budget — the cost of a request", () => {
  it("applies Groq's 10-second minimum", () => {
    expect(groqRateLimitSeconds(0)).toBe(10);
    expect(groqRateLimitSeconds(4)).toBe(10);
    expect(groqRateLimitSeconds(10)).toBe(10);
    expect(groqRateLimitSeconds(300.2)).toBe(301);
  });

  it("charges an unmeasurable duration as the 90-minute per-file ceiling", () => {
    expect(groqRateLimitSeconds(Number.NaN)).toBe(TRANSCRIPTION_MAX_SOURCE_SECONDS);
    expect(groqRateLimitSeconds(Number.POSITIVE_INFINITY)).toBe(TRANSCRIPTION_MAX_SOURCE_SECONDS);
    expect(groqRateLimitSeconds(-12)).toBe(TRANSCRIPTION_MAX_SOURCE_SECONDS);
  });
});

describe("groq budget — fresh capacity", () => {
  beforeEach(resetBudget);

  it("assumes the whole free-tier allowance when nothing is stored", async () => {
    const now = at("2026-08-09T14:00:00.000Z");
    const capacity = await getGroqCapacity(testEnv, { now });

    expect(capacity.hourRemainingSeconds).toBe(GROQ_HOUR_AUDIO_SECONDS);
    expect(capacity.dayRemainingSeconds).toBe(GROQ_DAY_AUDIO_SECONDS);
    expect(capacity.remainingSeconds).toBe(GROQ_HOUR_AUDIO_SECONDS);
    expect(capacity.source).toBe("fresh");
    expect(capacity.hourResetsAt).toBe("2026-08-09T15:00:00.000Z");
    expect(capacity.dayResetsAt).toBe("2026-08-10T14:00:00.000Z");
  });

  it("derives every timestamp from the injected clock, never the ambient one", async () => {
    // A date far outside any plausible real "now": if Date.now() leaked in
    // anywhere, these two assertions could not both hold.
    const now = at("2020-01-01T00:00:00.000Z");
    const capacity = await getGroqCapacity(testEnv, { now });
    expect(capacity.hourResetsAt).toBe("2020-01-01T01:00:00.000Z");
    expect(capacity.dayResetsAt).toBe("2020-01-02T00:00:00.000Z");
  });

  it("lets a normal 60-minute lecture through", async () => {
    const check = await hasGroqCapacityFor(testEnv, 3_600, { now: at("2026-08-09T14:00:00.000Z") });
    expect(check.ok).toBe(true);
    expect(check.requestedSeconds).toBe(3_600);
  });

  it("treats unreadable stored state as fresh rather than as exhausted", async () => {
    await testEnv.SESSIONS.put(GROQ_CAPACITY_KEY, "{not json");
    const capacity = await getGroqCapacity(testEnv, { now: at("2026-08-09T14:00:00.000Z") });
    expect(capacity.remainingSeconds).toBe(GROQ_HOUR_AUDIO_SECONDS);
    expect(capacity.source).toBe("fresh");
  });
});

describe("groq budget — recording usage", () => {
  beforeEach(resetBudget);

  it("accumulates locally when the response carries no rate-limit headers", async () => {
    const now = at("2026-08-09T14:00:00.000Z");
    const after = await recordGroqUsage(testEnv, { audioSeconds: 1_800, headers: null }, { now });

    expect(after.hourRemainingSeconds).toBe(5_400);
    expect(after.dayRemainingSeconds).toBe(27_000);
    expect(after.remainingSeconds).toBe(5_400);
    expect(after.source).toBe("local");
  });

  it("lets Groq's headers overrule a locally optimistic counter", async () => {
    const now = at("2026-08-09T14:00:00.000Z");
    // We think we spent 1,800 s; Groq says only 5,000 s are left, i.e. 2,200 s
    // are gone — traffic from another isolate we never observed.
    const after = await recordGroqUsage(
      testEnv,
      { audioSeconds: 1_800, headers: rateLimitHeaders({ limit: "7200", remaining: "5000", reset: "40m" }) },
      { now }
    );

    expect(after.hourRemainingSeconds).toBe(5_000);
    expect(after.source).toBe("headers");
  });

  it("never lets a rosier header hand capacity back", async () => {
    const now = at("2026-08-09T14:00:00.000Z");
    // Groq's bucket refills continuously, so it can genuinely report more than
    // we counted. Believing it would return seconds a concurrent isolate has
    // already spent but not yet published.
    const after = await recordGroqUsage(
      testEnv,
      { audioSeconds: 1_800, headers: rateLimitHeaders({ limit: "7200", remaining: "7200", reset: "10s" }) },
      { now }
    );
    expect(after.hourRemainingSeconds).toBe(5_400);
  });

  it("applies a long-horizon reading to the daily window only", async () => {
    const now = at("2026-08-09T14:00:00.000Z");
    const after = await recordGroqUsage(
      testEnv,
      {
        audioSeconds: 300,
        headers: rateLimitHeaders({ limit: "28800", remaining: "1000", reset: "5h" }),
      },
      { now }
    );

    // The hour only carries the local spend…
    expect(after.hourRemainingSeconds).toBe(6_900);
    // …while the day is pinned by the reading, and the day is now the binding one.
    expect(after.dayRemainingSeconds).toBe(1_000);
    expect(after.remainingSeconds).toBe(1_000);
  });

  it("books Groq's 10-second minimum for a very short clip", async () => {
    const now = at("2026-08-09T14:00:00.000Z");
    const after = await recordGroqUsage(testEnv, { audioSeconds: 3 }, { now });
    expect(after.hourRemainingSeconds).toBe(GROQ_HOUR_AUDIO_SECONDS - 10);
  });

  it("charges an unmeasurable duration as the per-file ceiling when headers are absent", async () => {
    const now = at("2026-08-09T14:00:00.000Z");
    const after = await recordGroqUsage(testEnv, { audioSeconds: Number.NaN }, { now });
    expect(after.hourRemainingSeconds).toBe(GROQ_HOUR_AUDIO_SECONDS - TRANSCRIPTION_MAX_SOURCE_SECONDS);
  });

  it("defers to the headers instead of guessing when the duration is unmeasurable", async () => {
    const now = at("2026-08-09T14:00:00.000Z");
    const after = await recordGroqUsage(
      testEnv,
      {
        audioSeconds: Number.NaN,
        headers: rateLimitHeaders({ limit: "7200", remaining: "7000", reset: "55m" }),
      },
      { now }
    );
    // 7,000 from the reading — not 7,200 - 5,400 from a guess we did not need.
    expect(after.hourRemainingSeconds).toBe(7_000);
  });

  it("persists across calls so a second isolate sees the first one's spend", async () => {
    const now = at("2026-08-09T14:00:00.000Z");
    await recordGroqUsage(testEnv, { audioSeconds: 1_200 }, { now });
    await recordGroqUsage(testEnv, { audioSeconds: 1_200 }, { now: at("2026-08-09T14:05:00.000Z") });

    const capacity = await getGroqCapacity(testEnv, { now: at("2026-08-09T14:10:00.000Z") });
    expect(capacity.hourRemainingSeconds).toBe(GROQ_HOUR_AUDIO_SECONDS - 2_400);
    expect(capacity.dayRemainingSeconds).toBe(GROQ_DAY_AUDIO_SECONDS - 2_400);
  });

  it("writes only its own KV key", async () => {
    await recordGroqUsage(testEnv, { audioSeconds: 60 }, { now: at("2026-08-09T14:00:00.000Z") });
    await openGroqBreaker(testEnv, 30, { now: at("2026-08-09T14:00:00.000Z") });

    const listed = await testEnv.SESSIONS.list();
    const names = listed.keys.map((key) => key.name).filter((name) => name.startsWith("groq"));
    expect(new Set(names)).toEqual(new Set([GROQ_CAPACITY_KEY, GROQ_BREAKER_KEY]));
    expect((await testEnv.SESSIONS.list({ prefix: "transq:" })).keys).toEqual([]);
    expect((await testEnv.SESSIONS.list({ prefix: "audioq:" })).keys).toEqual([]);
  });
});

describe("groq budget — capacity consumed, then exhausted", () => {
  beforeEach(resetBudget);

  it("drains the hourly window to zero and then refuses everything", async () => {
    const start = Date.parse("2026-08-09T14:00:00.000Z");
    for (let i = 0; i < 4; i += 1) {
      await recordGroqUsage(testEnv, { audioSeconds: 1_800 }, { now: new Date(start + i * 60_000) });
    }

    const now = new Date(start + 5 * 60_000);
    const capacity = await getGroqCapacity(testEnv, { now });
    expect(capacity.hourRemainingSeconds).toBe(0);
    // The day is far from spent — the hour is simply the binding constraint.
    expect(capacity.dayRemainingSeconds).toBe(GROQ_DAY_AUDIO_SECONDS - 7_200);
    expect(capacity.remainingSeconds).toBe(0);

    expect((await hasGroqCapacityFor(testEnv, 60, { now })).ok).toBe(false);
    expect((await hasGroqCapacityFor(testEnv, 1, { now })).ok).toBe(false);
  });

  it("routes away with insufficient_capacity, not with a breaker that never tripped", async () => {
    const now = at("2026-08-09T14:00:00.000Z");
    await recordGroqUsage(testEnv, { audioSeconds: 7_200 }, { now });

    const decision = await canRouteGroq(testEnv, 600, { now });
    expect(decision.route).toBe(false);
    expect(decision.reason).toBe("insufficient_capacity");
    expect(decision.breaker.open).toBe(false);
  });

  it("withholds the headroom at the boundary", async () => {
    const now = at("2026-08-09T14:00:00.000Z");
    await recordGroqUsage(testEnv, { audioSeconds: GROQ_HOUR_AUDIO_SECONDS - 610 }, { now });
    expect((await getGroqCapacity(testEnv, { now })).remainingSeconds).toBe(610);

    // 550 + 60 headroom == 610: fits exactly.
    expect((await hasGroqCapacityFor(testEnv, 550, { now })).ok).toBe(true);
    // 551 + 60 headroom > 610: the marginal job is the one that would 429.
    expect((await hasGroqCapacityFor(testEnv, 551, { now })).ok).toBe(false);
    expect(GROQ_CAPACITY_HEADROOM_SECONDS).toBe(60);
  });

  it("clamps a request against the smaller of the two windows", async () => {
    const now = at("2026-08-09T14:00:00.000Z");
    // Day nearly spent, hour untouched.
    await recordGroqUsage(
      testEnv,
      { audioSeconds: 10, headers: rateLimitHeaders({ limit: "28800", remaining: "200", reset: "4h" }) },
      { now }
    );

    const check = await hasGroqCapacityFor(testEnv, 600, { now });
    expect(check.ok).toBe(false);
    expect(check.capacity.hourRemainingSeconds).toBeGreaterThan(600);
    expect(check.capacity.remainingSeconds).toBe(200);
  });
});

describe("groq budget — the circuit breaker", () => {
  beforeEach(resetBudget);

  it("is closed when nothing has tripped it", async () => {
    const state = await isGroqBreakerOpen(testEnv, { now: at("2026-08-09T14:00:00.000Z") });
    expect(state).toEqual({ open: false, pausedUntil: null, retryInSeconds: 0 });
  });

  it("opens for exactly retry-after and closes at the instant it expires", async () => {
    const start = Date.parse("2026-08-09T14:00:00.000Z");
    const opened = await openGroqBreaker(testEnv, 45, { now: new Date(start) });
    expect(opened.open).toBe(true);
    expect(opened.pausedUntil).toBe("2026-08-09T14:00:45.000Z");
    expect(opened.retryInSeconds).toBe(45);

    // One millisecond before the deadline it is still open…
    const justBefore = await isGroqBreakerOpen(testEnv, { now: new Date(start + 44_999) });
    expect(justBefore.open).toBe(true);
    expect(justBefore.retryInSeconds).toBe(1);

    // …and at the deadline itself it is closed. Not a millisecond later.
    expect((await isGroqBreakerOpen(testEnv, { now: new Date(start + 45_000) })).open).toBe(false);
    expect((await isGroqBreakerOpen(testEnv, { now: new Date(start + 45_001) })).open).toBe(false);
  });

  it("never shortens a pause it can see", async () => {
    const start = Date.parse("2026-08-09T14:00:00.000Z");
    await openGroqBreaker(testEnv, 600, { now: new Date(start) });

    const shorter = await openGroqBreaker(testEnv, 30, { now: new Date(start + 10_000) });
    expect(shorter.pausedUntil).toBe("2026-08-09T14:10:00.000Z");
    expect(shorter.retryInSeconds).toBe(590);
  });

  it("extends a pause when the new one runs longer", async () => {
    const start = Date.parse("2026-08-09T14:00:00.000Z");
    await openGroqBreaker(testEnv, 60, { now: new Date(start) });

    const longer = await openGroqBreaker(testEnv, 1_200, { now: new Date(start + 10_000) });
    expect(longer.pausedUntil).toBe("2026-08-09T14:20:10.000Z");
  });

  it("falls back to a sane pause when retry-after is missing or garbled", () => {
    expect(groqPauseSeconds(null)).toBe(GROQ_BREAKER_DEFAULT_SECONDS);
    expect(groqPauseSeconds(undefined)).toBe(GROQ_BREAKER_DEFAULT_SECONDS);
    expect(groqPauseSeconds(Number.NaN)).toBe(GROQ_BREAKER_DEFAULT_SECONDS);
    expect(groqPauseSeconds(Number.POSITIVE_INFINITY)).toBe(GROQ_BREAKER_DEFAULT_SECONDS);
    expect(groqPauseSeconds(-90)).toBe(GROQ_BREAKER_DEFAULT_SECONDS);

    // "Retry immediately" is how a 429 loop starts.
    expect(groqPauseSeconds(0)).toBe(GROQ_BREAKER_MIN_SECONDS);
    expect(groqPauseSeconds(3)).toBe(GROQ_BREAKER_MIN_SECONDS);

    expect(groqPauseSeconds(45)).toBe(45);
    expect(groqPauseSeconds(12.3)).toBe(13);
    expect(groqPauseSeconds(99_999)).toBe(GROQ_BREAKER_MAX_SECONDS);
  });

  it("uses the fallback pause end to end when retry-after was unreadable", async () => {
    const start = Date.parse("2026-08-09T14:00:00.000Z");
    const opened = await openGroqBreaker(testEnv, null, { now: new Date(start) });
    expect(opened.retryInSeconds).toBe(GROQ_BREAKER_DEFAULT_SECONDS);
    expect((await isGroqBreakerOpen(testEnv, { now: new Date(start + 299_000) })).open).toBe(true);
    expect((await isGroqBreakerOpen(testEnv, { now: new Date(start + 300_000) })).open).toBe(false);
  });

  it("reads a corrupt or half-written marker as CLOSED", async () => {
    const now = at("2026-08-09T14:00:00.000Z");

    await testEnv.SESSIONS.put(GROQ_BREAKER_KEY, "{oops");
    expect((await isGroqBreakerOpen(testEnv, { now })).open).toBe(false);

    await testEnv.SESSIONS.put(GROQ_BREAKER_KEY, JSON.stringify({ pausedUntil: "soon" }));
    expect((await isGroqBreakerOpen(testEnv, { now })).open).toBe(false);

    await testEnv.SESSIONS.put(GROQ_BREAKER_KEY, JSON.stringify({ nothing: true }));
    expect((await isGroqBreakerOpen(testEnv, { now })).open).toBe(false);
  });

  it("takes precedence over a perfectly healthy capacity reading", async () => {
    const now = at("2026-08-09T14:00:00.000Z");
    await openGroqBreaker(testEnv, 180, { now });

    const decision = await canRouteGroq(testEnv, 300, { now });
    expect(decision.route).toBe(false);
    expect(decision.reason).toBe("breaker_open");
    expect(decision.capacity.remainingSeconds).toBe(GROQ_HOUR_AUDIO_SECONDS);
    expect(decision.breaker.retryInSeconds).toBe(180);
  });

  it("lets Groq back in the moment the pause expires", async () => {
    const start = Date.parse("2026-08-09T14:00:00.000Z");
    await openGroqBreaker(testEnv, 180, { now: new Date(start) });

    expect((await canRouteGroq(testEnv, 300, { now: new Date(start + 179_999) })).route).toBe(false);
    const reopened = await canRouteGroq(testEnv, 300, { now: new Date(start + 180_000) });
    expect(reopened.route).toBe(true);
    expect(reopened.reason).toBe("ok");
  });
});

describe("groq budget — the primitives in the order bookGroqFailure calls them", () => {
  beforeEach(resetBudget);

  /**
   * The end-to-end classroom burst — twenty teachers press "Transcrire", one job
   * pays the 429, the nineteen behind it finish on Deepgram — is owned by
   * `transcription/router.test.ts`, which drives the real cascade. What is
   * pinned HERE is narrower and one layer down: the budget primitives, called in
   * the exact order and with the exact arguments `bookGroqFailure`
   * (transcription/index.ts) uses on a 429, twenty times over.
   *
   *     recordGroqUsage({ audioSeconds: 0, headers })
   *     exhaustGroqHourWindow()          // only when the headers taught us nothing
   *     openGroqBreaker(retryAfterSeconds)
   *
   * `audioSeconds: 0` is not a shortcut for the test's benefit — it is what
   * production books, because Groq transcribed nothing on a 429 and the only
   * honest local charge is its 10-second per-request minimum. A helper that
   * booked the media's full length here would read as the spec for a booking
   * policy the code does not have.
   */
  async function runBurst(options: { headersOn429: Headers }): Promise<{
    paid429: number;
    reasons: GroqRouteReason[];
  }> {
    const start = Date.parse("2026-08-09T14:00:00.000Z");
    const reasons: GroqRouteReason[] = [];
    let paid429 = 0;

    for (let index = 0; index < 20; index += 1) {
      const now = new Date(start + index * 400);
      const decision = await canRouteGroq(testEnv, 300, { now });
      reasons.push(decision.reason);
      if (!decision.route) continue;

      paid429 += 1;
      await recordGroqUsage(testEnv, { audioSeconds: 0, headers: options.headersOn429 }, { now });
      if (parseGroqRateLimitHeaders(options.headersOn429).remainingSeconds === null) {
        await exhaustGroqHourWindow(testEnv, { now });
      }
      await openGroqBreaker(testEnv, 180, { now });
    }

    return { paid429, reasons };
  }

  it("pays exactly one 429 and routes the other nineteen away", async () => {
    const { paid429, reasons } = await runBurst({
      headersOn429: rateLimitHeaders({
        limit: "7200",
        remaining: "0",
        reset: "2m59.56s",
        retryAfter: "180",
      }),
    });

    expect(paid429).toBe(1);
    expect(reasons).toHaveLength(20);
    expect(reasons[0]).toBe("ok");
    expect(reasons.slice(1).filter((reason) => reason === "ok")).toHaveLength(0);
  });

  it("routes the nineteen on the breaker, not on the counter, when the 429 taught us nothing", async () => {
    // A 429 stripped of its rate-limit headers by a proxy. Two things follow,
    // and they must not be confused: the hourly window is forfeited outright
    // (step 2 above — we will not believe we hold two free hours the instant
    // Groq refused us), AND the breaker opens. The breaker is checked first, so
    // the reason on every one of the nineteen names the breaker; that is what
    // proves the cheap KV gate is the one answering.
    const { paid429, reasons } = await runBurst({
      headersOn429: rateLimitHeaders({ retryAfter: "180" }),
    });

    expect(paid429).toBe(1);
    expect(new Set(reasons.slice(1))).toEqual(new Set<GroqRouteReason>(["breaker_open"]));

    const capacity = await getGroqCapacity(testEnv, { now: at("2026-08-09T14:01:00.000Z") });
    expect(capacity.remainingSeconds).toBe(0);
  });

  it("keeps Groq out after the pause expires, because that 429 also spent the hour", async () => {
    await runBurst({
      headersOn429: rateLimitHeaders({ retryAfter: "180" }),
    });

    // 180 s later the breaker really is closed…
    const at1403 = at("2026-08-09T14:03:00.000Z");
    expect((await isGroqBreakerOpen(testEnv, { now: at1403 })).open).toBe(false);

    // …and the second gate takes over: a header-less 429 forfeited the window,
    // so Groq stays out on capacity until that window rolls. The reason is how
    // the two gates stay distinguishable in a log.
    const stillOut = await canRouteGroq(testEnv, 300, { now: at1403 });
    expect(stillOut.route).toBe(false);
    expect(stillOut.reason).toBe<GroqRouteReason>("insufficient_capacity");

    // 15:00 — the hourly window rolls and Groq is back in the rotation. The day
    // was never forfeited: a 429 can be the 20-requests-per-minute limit, and
    // eight hours is too much to give up on that guess.
    const rolled = await canRouteGroq(testEnv, 300, { now: at("2026-08-09T15:00:00.000Z") });
    expect(rolled.route).toBe(true);
    expect(rolled.reason).toBe<GroqRouteReason>("ok");
  });
});

describe("groq budget — window rollover", () => {
  beforeEach(resetBudget);

  it("rolls the hourly window at the boundary and not a millisecond early", async () => {
    const start = at("2026-08-09T10:00:00.000Z");
    await recordGroqUsage(testEnv, { audioSeconds: GROQ_HOUR_AUDIO_SECONDS }, { now: start });

    const justBefore = await getGroqCapacity(testEnv, { now: at("2026-08-09T10:59:59.999Z") });
    expect(justBefore.hourRemainingSeconds).toBe(0);
    expect(justBefore.hourResetsAt).toBe("2026-08-09T11:00:00.000Z");

    const justAfter = await getGroqCapacity(testEnv, { now: at("2026-08-09T11:00:00.000Z") });
    expect(justAfter.hourRemainingSeconds).toBe(GROQ_HOUR_AUDIO_SECONDS);
    expect(justAfter.hourResetsAt).toBe("2026-08-09T12:00:00.000Z");
    // The day window did NOT roll with it.
    expect(justAfter.dayRemainingSeconds).toBe(GROQ_DAY_AUDIO_SECONDS - GROQ_HOUR_AUDIO_SECONDS);
    expect(justAfter.remainingSeconds).toBe(GROQ_HOUR_AUDIO_SECONDS);
  });

  it("keeps the window anchor's phase across a long silence", async () => {
    await recordGroqUsage(testEnv, { audioSeconds: 600 }, { now: at("2026-08-09T10:00:00.000Z") });

    // Two and a half hours later we are in the 12:00 window, not a window that
    // started when we happened to look.
    const capacity = await getGroqCapacity(testEnv, { now: at("2026-08-09T12:30:00.000Z") });
    expect(capacity.hourResetsAt).toBe("2026-08-09T13:00:00.000Z");
    expect(capacity.hourRemainingSeconds).toBe(GROQ_HOUR_AUDIO_SECONDS);
  });

  it("forgets a header clamp once the window it described has ended", async () => {
    await recordGroqUsage(
      testEnv,
      { audioSeconds: 300, headers: rateLimitHeaders({ limit: "7200", remaining: "0", reset: "50m" }) },
      { now: at("2026-08-09T10:00:00.000Z") }
    );
    expect((await getGroqCapacity(testEnv, { now: at("2026-08-09T10:30:00.000Z") })).source).toBe("headers");

    const next = await getGroqCapacity(testEnv, { now: at("2026-08-09T11:00:00.000Z") });
    expect(next.hourRemainingSeconds).toBe(GROQ_HOUR_AUDIO_SECONDS);
    expect(next.source).toBe("local");
  });

  it("rolls the daily window a full day after its anchor", async () => {
    const anchor = at("2026-08-09T09:00:00.000Z");
    await recordGroqUsage(
      testEnv,
      { audioSeconds: 300, headers: rateLimitHeaders({ limit: "28800", remaining: "0", reset: "6h" }) },
      { now: anchor }
    );

    const sameDay = await getGroqCapacity(testEnv, { now: at("2026-08-10T08:59:59.999Z") });
    expect(sameDay.dayRemainingSeconds).toBe(0);
    expect(sameDay.remainingSeconds).toBe(0);
    expect(sameDay.dayResetsAt).toBe("2026-08-10T09:00:00.000Z");
    // The hourly window rolled many times over and is full again — the day is
    // what keeps us out.
    expect(sameDay.hourRemainingSeconds).toBe(GROQ_HOUR_AUDIO_SECONDS);

    const nextDay = await getGroqCapacity(testEnv, { now: at("2026-08-10T09:00:00.000Z") });
    expect(nextDay.dayRemainingSeconds).toBe(GROQ_DAY_AUDIO_SECONDS);
    expect(nextDay.remainingSeconds).toBe(GROQ_HOUR_AUDIO_SECONDS);
    expect(nextDay.dayResetsAt).toBe("2026-08-11T09:00:00.000Z");
  });

  it("restarts a window whose anchor is in the future rather than crediting free seconds", async () => {
    const now = at("2026-08-09T14:00:00.000Z");
    // A clock that jumped backwards, or a record we cannot trust.
    await testEnv.SESSIONS.put(
      GROQ_CAPACITY_KEY,
      JSON.stringify({
        hourStart: Date.parse("2026-08-09T20:00:00.000Z"),
        hourUsed: 7_000,
        dayStart: Date.parse("2026-08-09T20:00:00.000Z"),
        dayUsed: 20_000,
        fromHeaders: true,
      })
    );

    const capacity = await getGroqCapacity(testEnv, { now });
    expect(capacity.hourResetsAt).toBe("2026-08-09T15:00:00.000Z");
    expect(capacity.dayResetsAt).toBe("2026-08-10T14:00:00.000Z");
    expect(capacity.hourRemainingSeconds).toBe(GROQ_HOUR_AUDIO_SECONDS);
  });
});

describe("groq budget — KV races between isolates", () => {
  beforeEach(resetBudget);

  /**
   * Race 1: read-modify-write on the counter is not atomic and KV has no
   * compare-and-swap, so the later write survives whole. This test pins the
   * documented consequence rather than pretending it cannot happen: the counter
   * can OVER-report capacity by exactly the lost isolate's spend.
   */
  it("loses one isolate's spend when its neighbour read first — and over-reports, knowingly", async () => {
    const now = at("2026-08-09T14:00:00.000Z");

    // Isolate A spends 2,000 s and publishes.
    await recordGroqUsage(testEnv, { audioSeconds: 2_000 }, { now });
    expect((await getGroqCapacity(testEnv, { now })).hourRemainingSeconds).toBe(5_200);

    // Isolate B read the counter before A wrote it — it still sees an empty
    // store — spends 20 s, and its write lands last.
    const stale = staleReaderEnv(testEnv, GROQ_CAPACITY_KEY, null);
    await recordGroqUsage(stale, { audioSeconds: 20 }, { now });

    const merged = await getGroqCapacity(testEnv, { now });
    expect(merged.hourRemainingSeconds).toBe(GROQ_HOUR_AUDIO_SECONDS - 20);

    // The counter is now 2,000 s too generous. That is survivable precisely
    // because it is not the safety mechanism: the extra submissions it admits
    // hit Groq, the first 429 opens the breaker, and everyone else routes away.
    expect((await canRouteGroq(testEnv, 300, { now })).route).toBe(true);
    await openGroqBreaker(testEnv, 180, { now });
    expect((await canRouteGroq(testEnv, 300, { now })).reason).toBe("breaker_open");
  });

  /**
   * The self-healing half of race 1: the next response's headers restate the
   * truth, so a lost update survives at most until the following Groq call.
   */
  it("repairs a drifted counter from the next response's headers", async () => {
    const now = at("2026-08-09T14:00:00.000Z");
    const stale = staleReaderEnv(testEnv, GROQ_CAPACITY_KEY, null);

    await recordGroqUsage(testEnv, { audioSeconds: 2_000 }, { now });
    await recordGroqUsage(stale, { audioSeconds: 20 }, { now });
    expect((await getGroqCapacity(testEnv, { now })).hourRemainingSeconds).toBe(7_180);

    await recordGroqUsage(
      testEnv,
      { audioSeconds: 20, headers: rateLimitHeaders({ limit: "7200", remaining: "5180", reset: "45m" }) },
      { now }
    );
    expect((await getGroqCapacity(testEnv, { now })).hourRemainingSeconds).toBe(5_180);
  });

  /**
   * Race 2, visible half: two opens that can see each other converge on the
   * longer pause, in either arrival order.
   */
  it("converges on the longest pause when both opens can see each other", async () => {
    const start = Date.parse("2026-08-09T14:00:00.000Z");
    await openGroqBreaker(testEnv, 60, { now: new Date(start) });
    await openGroqBreaker(testEnv, 900, { now: new Date(start) });
    await openGroqBreaker(testEnv, 30, { now: new Date(start) });

    expect((await isGroqBreakerOpen(testEnv, { now: new Date(start) })).retryInSeconds).toBe(900);
  });

  /**
   * Race 2, invisible half. An isolate whose read predates the other's write
   * cannot honour "never shorten" — it has nothing to compare against — so the
   * pause does get shorter. The bound is what matters: the surviving pause still
   * runs the full retry-after that the clobbering isolate's OWN 429 asked for,
   * so we are never sent back at Groq sooner than Groq suggested.
   */
  it("can shorten a pause it never saw, but never below its own retry-after", async () => {
    const start = Date.parse("2026-08-09T14:00:00.000Z");
    await openGroqBreaker(testEnv, 900, { now: new Date(start) });

    const stale = staleReaderEnv(testEnv, GROQ_BREAKER_KEY, null);
    await openGroqBreaker(stale, 120, { now: new Date(start + 1_000) });

    const merged = await isGroqBreakerOpen(testEnv, { now: new Date(start + 1_000) });
    expect(merged.open).toBe(true);
    expect(merged.retryInSeconds).toBe(120);
    expect(merged.pausedUntil).toBe("2026-08-09T14:02:01.000Z");
  });

  /**
   * Race 3: a colo that has not yet seen the marker still routes to Groq and
   * pays a second 429. The guarantee is "at most one 429 per colo per window",
   * and each extra 429 re-opens the breaker rather than resetting it.
   */
  it("pays a second 429 in a colo the marker has not reached, then re-converges", async () => {
    const start = Date.parse("2026-08-09T14:00:00.000Z");
    await openGroqBreaker(testEnv, 180, { now: new Date(start) });

    // The neighbouring colo cannot see the marker yet.
    const stale = staleReaderEnv(testEnv, GROQ_BREAKER_KEY, null);
    const blind = await canRouteGroq(stale, 300, { now: new Date(start + 500) });
    expect(blind.route).toBe(true);
    expect(blind.reason).toBe("ok");

    // It takes its own 429 and re-opens, which is the whole recovery path.
    await openGroqBreaker(stale, 180, { now: new Date(start + 500) });
    const after = await isGroqBreakerOpen(testEnv, { now: new Date(start + 500) });
    expect(after.open).toBe(true);
    expect(after.retryInSeconds).toBe(180);

    // And once the write is visible, that colo routes away like everyone else.
    expect((await canRouteGroq(testEnv, 300, { now: new Date(start + 1_000) })).reason).toBe(
      "breaker_open"
    );
  });
});
