// The FAILOVER CASCADE: which provider runs, in which order, and why.
//
// Four claims are defended here, and the first one is a correctness claim rather
// than a cost one:
//
//  1. A JOB THAT ASKED FOR SPEAKER LABELS IS NEVER SERVED BY A PROVIDER THAT
//     CANNOT LABEL THEM. Whisper has no diarization at all, so Groq is absent
//     from that lane entirely — and if a plan ever put it there anyway, the hard
//     guard refuses before a single byte is sent. Failing loudly is correct;
//     quietly returning an unlabelled transcript is not.
//  2. GROQ IS SKIPPED, NOT TRIED AND FAILED, when the job cannot fit its free
//     tier: over the 25 MB file ceiling, over the remaining audio-seconds, or
//     behind an open breaker.
//  3. A GROQ 429 MOVES THE JOB TO THE NEXT TIER INSIDE THE SAME CALL, and opens
//     the breaker so the jobs behind it skip Groq. Leaving it to the queue would
//     retry into the same exhausted free tier three times.
//  4. THE FALLBACK IS VISIBLE. Every result names the provider that actually ran
//     and the reason it did, which is what `provider_choice_reason` stores.
//
// Nothing here touches a network: providers are fakes built through the
// `TranscriptionRunDeps` seam, and Groq's budget lives in the test KV.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../../env";
import {
  GROQ_BREAKER_KEY,
  GROQ_CAPACITY_KEY,
  GROQ_HOUR_AUDIO_SECONDS,
  getGroqCapacity,
  isGroqBreakerOpen,
  type GroqCapacitySource,
} from "../transcription-budget";
import {
  planTranscriptionRoute,
  runTranscription,
  type TranscriptionRouteReason,
  type TranscriptionRunDeps,
} from "./index";
import { GROQ_FREE_TIER_MAX_UPLOAD_BYTES } from "./groq";
import {
  TranscriptionError,
  isTranscriptionError,
  type NormalisedTranscript,
  type TranscriptionAudioSource,
  type TranscriptionFailure,
  type TranscriptionProvider,
  type TranscriptionProviderId,
  type TranscriptionRequest,
} from "./types";

const baseEnv = env as unknown as Env;

/** Every key present, so a test that wants a tier missing says so explicitly. */
function envWith(overrides: Partial<Env> = {}): Env {
  return {
    ...baseEnv,
    GROQ_API_KEY: "gsk-test",
    DEEPGRAM_API_KEY: "dg-test",
    ASSEMBLYAI_API_KEY: "aai-test",
    ...overrides,
  } as Env;
}

async function resetBudget(): Promise<void> {
  await baseEnv.SESSIONS.delete(GROQ_CAPACITY_KEY);
  await baseEnv.SESSIONS.delete(GROQ_BREAKER_KEY);
}

const URL_AUDIO: TranscriptionAudioSource = {
  kind: "url",
  url: "https://cdn.example.test/episode.mp3",
};

function bytesAudio(sizeBytes: number): TranscriptionAudioSource {
  return {
    kind: "bytes",
    blob: new Blob([new Uint8Array(1)], { type: "audio/mpeg" }),
    sizeBytes,
    contentType: "audio/mpeg",
    filename: "lesson.mp3",
  };
}

function transcriptFrom(provider: TranscriptionProviderId, diarization: boolean): NormalisedTranscript {
  return {
    metadata: {
      provider,
      providerJobId: `${provider}-req-1`,
      model: `${provider}-model`,
      durationSeconds: 600,
      detectedLanguages: ["fr"],
      diarization,
      speakerCount: diarization ? 2 : null,
      channels: 1,
    },
    speakers: [],
    segments: [],
    text: `transcript from ${provider}`,
  };
}

interface FakeProviderOptions {
  /** What `submit` throws, if anything. */
  fails?: TranscriptionFailure;
  /** Rate-limit headers on the thrown failure, as a real Groq response carries. */
  failHeaders?: Record<string, string>;
  /** Rate-limit headers on a SUCCESSFUL response's handle. */
  okHeaders?: Record<string, string>;
  /** Overrides the real capability flag — used only to prove the hard guard. */
  diarization?: boolean;
}

/** A provider that answers from memory, and records that it was asked. */
function fakeProvider(
  id: TranscriptionProviderId,
  calls: TranscriptionProviderId[],
  options: FakeProviderOptions = {}
): TranscriptionProvider {
  const canDiarize = options.diarization ?? id !== "groq";
  return {
    id,
    model: `${id}-model`,
    capabilities: {
      diarization: canDiarize,
      wordTimestamps: true,
      multilingualWithinFile: id !== "groq",
      languageDetection: true,
      maxSourceSeconds: 5_400,
    },
    async submit(request: TranscriptionRequest) {
      calls.push(id);
      if (options.fails) {
        throw new TranscriptionError(options.fails, {
          rateLimitHeaders: options.failHeaders ? new Headers(options.failHeaders) : null,
        });
      }
      return {
        provider: id,
        providerJobId: `${id}-req-1`,
        model: `${id}-model`,
        ready: true,
        raw: { diarize: request.diarize },
        rateLimitHeaders: options.okHeaders ? new Headers(options.okHeaders) : null,
      };
    },
    async fetchTranscript() {
      return transcriptFrom(id, canDiarize);
    },
  };
}

interface Harness {
  /** Providers actually asked to submit, in order. */
  calls: TranscriptionProviderId[];
  deps: TranscriptionRunDeps;
}

function harness(perProvider: Partial<Record<TranscriptionProviderId, FakeProviderOptions>> = {}): Harness {
  const calls: TranscriptionProviderId[] = [];
  return {
    calls,
    deps: {
      buildProvider: (_env, provider) => fakeProvider(provider, calls, perProvider[provider] ?? {}),
      planRoute: planTranscriptionRoute,
    },
  };
}

function requestFor(overrides: Partial<TranscriptionRequest> = {}): TranscriptionRequest {
  return { audio: URL_AUDIO, diarize: false, durationSeconds: 600, ...overrides };
}

async function failureFrom(run: () => Promise<unknown>): Promise<TranscriptionFailure | null> {
  try {
    await run();
  } catch (error) {
    return isTranscriptionError(error) ? error.failure : null;
  }
  return null;
}

/** Marks the hourly window as nearly spent, so Groq cannot take a long job. */
async function spendGroqHourDownTo(remainingSeconds: number): Promise<void> {
  await baseEnv.SESSIONS.put(
    GROQ_CAPACITY_KEY,
    JSON.stringify({
      hourStart: Date.now(),
      hourUsed: GROQ_HOUR_AUDIO_SECONDS - remainingSeconds,
      dayStart: Date.now(),
      dayUsed: 0,
      fromHeaders: false,
    })
  );
}

describe("planTranscriptionRoute — the policy", () => {
  beforeEach(resetBudget);

  it("puts Groq first for a plain transcript, then Deepgram, then AssemblyAI", async () => {
    const plan = await planTranscriptionRoute(envWith(), {
      diarize: false,
      durationSeconds: 600,
      sizeBytes: null,
    });
    expect(plan.steps.map((step) => step.provider)).toEqual(["groq", "deepgram", "assemblyai"]);
    expect(plan.steps[0].reason).toBe<TranscriptionRouteReason>("groq_free_tier");
  });

  it("never lists Groq for a speaker-labelling job — Whisper cannot diarize", async () => {
    const plan = await planTranscriptionRoute(envWith(), {
      diarize: true,
      durationSeconds: 600,
      sizeBytes: null,
    });
    expect(plan.steps.map((step) => step.provider)).toEqual(["deepgram", "assemblyai"]);
    expect(plan.steps[0].reason).toBe<TranscriptionRouteReason>("diarization_required");
    // Not consulted at all: the lane never contained Groq, so no KV read happened.
    expect(plan.groqDecision).toBeNull();
  });

  it("skips Groq for a file over its free-tier 25 MB ceiling, before any round trip", async () => {
    const plan = await planTranscriptionRoute(envWith(), {
      diarize: false,
      durationSeconds: 600,
      sizeBytes: GROQ_FREE_TIER_MAX_UPLOAD_BYTES + 1,
    });
    expect(plan.steps.map((step) => step.provider)).toEqual(["deepgram", "assemblyai"]);
    expect(plan.steps[0].reason).toBe<TranscriptionRouteReason>("groq_over_free_tier_file_limit");
    // The size check comes first precisely so this KV read is not paid for.
    expect(plan.groqDecision).toBeNull();
  });

  it("keeps Groq for a file exactly at the ceiling", async () => {
    const plan = await planTranscriptionRoute(envWith(), {
      diarize: false,
      durationSeconds: 600,
      sizeBytes: GROQ_FREE_TIER_MAX_UPLOAD_BYTES,
    });
    expect(plan.steps[0].provider).toBe("groq");
  });

  it("skips Groq when the job does not fit the remaining free audio-seconds", async () => {
    await spendGroqHourDownTo(120);
    const plan = await planTranscriptionRoute(envWith(), {
      diarize: false,
      durationSeconds: 600,
      sizeBytes: null,
    });
    expect(plan.steps.map((step) => step.provider)).toEqual(["deepgram", "assemblyai"]);
    expect(plan.steps[0].reason).toBe<TranscriptionRouteReason>("groq_out_of_capacity");
  });

  it("skips Groq while the breaker is open", async () => {
    await baseEnv.SESSIONS.put(
      GROQ_BREAKER_KEY,
      JSON.stringify({ pausedUntil: Date.now() + 120_000, openedAt: Date.now() })
    );
    const plan = await planTranscriptionRoute(envWith(), {
      diarize: false,
      durationSeconds: 600,
      sizeBytes: null,
    });
    expect(plan.steps[0].provider).toBe("deepgram");
    expect(plan.steps[0].reason).toBe<TranscriptionRouteReason>("groq_breaker_open");
  });

  it("charges an unmeasurable duration as the 90-minute ceiling rather than gambling", async () => {
    // 2 h of hourly budget minus a 90-minute unknown leaves too little headroom,
    // so an unknown length must NOT be treated as a cheap job.
    await spendGroqHourDownTo(5_000);
    const plan = await planTranscriptionRoute(envWith(), {
      diarize: false,
      durationSeconds: null,
      sizeBytes: null,
    });
    expect(plan.steps[0].provider).toBe("deepgram");
    expect(plan.steps[0].reason).toBe<TranscriptionRouteReason>("groq_out_of_capacity");
  });

  it("drops an unconfigured tier instead of trying it, and says so", async () => {
    const plan = await planTranscriptionRoute(envWith({ GROQ_API_KEY: undefined }), {
      diarize: false,
      durationSeconds: 600,
      sizeBytes: null,
    });
    expect(plan.steps.map((step) => step.provider)).toEqual(["deepgram", "assemblyai"]);
    expect(plan.steps[0].reason).toBe<TranscriptionRouteReason>("provider_key_missing");
  });

  it("returns no steps at all when nothing in the lane is configured", async () => {
    const plan = await planTranscriptionRoute(
      envWith({ DEEPGRAM_API_KEY: undefined, ASSEMBLYAI_API_KEY: undefined }),
      { diarize: true, durationSeconds: 600, sizeBytes: null }
    );
    expect(plan.steps).toEqual([]);
    expect(plan.requested).toBe("deepgram");
  });
});

describe("runTranscription — the hard guard", () => {
  beforeEach(resetBudget);

  it("refuses to run a speaker-labelling job on a provider that cannot diarize", async () => {
    // A plan that puts a non-diarizing provider in the diarized lane is OUR bug.
    // The guard is what stops that bug from reaching a teacher as a transcript
    // with no speakers in it and no explanation.
    const calls: TranscriptionProviderId[] = [];
    const deps: TranscriptionRunDeps = {
      buildProvider: (_env, provider) => fakeProvider(provider, calls, { diarization: false }),
      planRoute: async () => ({
        steps: [{ provider: "deepgram", reason: "diarization_required" }],
        requested: "deepgram",
        groqDecision: null,
      }),
    };

    const failure = await failureFrom(() =>
      runTranscription(envWith(), requestFor({ diarize: true }), deps)
    );
    expect(failure?.code).toBe("internal");
    // Nothing was sent. The guard is a precondition, not a cleanup.
    expect(calls).toEqual([]);
  });

  it("runs the same provider happily when speaker labels were not asked for", async () => {
    const calls: TranscriptionProviderId[] = [];
    const deps: TranscriptionRunDeps = {
      buildProvider: (_env, provider) => fakeProvider(provider, calls, { diarization: false }),
      planRoute: async () => ({
        steps: [{ provider: "groq", reason: "groq_free_tier" }],
        requested: "groq",
        groqDecision: null,
      }),
    };
    const run = await runTranscription(envWith(), requestFor({ diarize: false }), deps);
    expect(run.provider).toBe("groq");
    expect(calls).toEqual(["groq"]);
  });
});

describe("runTranscription — the cascade in motion", () => {
  beforeEach(resetBudget);

  it("uses Groq and records why, when the free tier is healthy", async () => {
    const run = await runTranscription(envWith(), requestFor(), harness().deps);
    expect(run.provider).toBe("groq");
    expect(run.reason).toBe<TranscriptionRouteReason>("groq_free_tier");
    expect(run.fellBackFrom).toEqual([]);
  });

  it("moves to Deepgram on a Groq 429 and opens the breaker for everyone behind it", async () => {
    const run = harness({
      groq: {
        fails: { code: "provider_unavailable", provider: "groq", status: 429, retryAfterSeconds: 45 },
      },
    });

    const outcome = await runTranscription(envWith(), requestFor(), run.deps);

    // The job finished. It did not fail, and it did not wait for a queue retry
    // that would have hit the same exhausted free tier.
    expect(outcome.provider).toBe("deepgram");
    expect(outcome.reason).toBe<TranscriptionRouteReason>("groq_rate_limited");
    expect(outcome.fellBackFrom).toEqual(["groq"]);
    expect(run.calls).toEqual(["groq", "deepgram"]);

    const breaker = await isGroqBreakerOpen(envWith());
    expect(breaker.open).toBe(true);
    // The provider's own retry-after was honoured, not a guessed default.
    expect(breaker.retryInSeconds).toBeGreaterThan(30);
    expect(breaker.retryInSeconds).toBeLessThanOrEqual(45);
  });

  it("falls through Deepgram to AssemblyAI, and names the tier that ran", async () => {
    const run = harness({
      groq: { fails: { code: "provider_unavailable", provider: "groq", status: 503 } },
      deepgram: { fails: { code: "provider_failed", provider: "deepgram", status: 500 } },
    });

    const outcome = await runTranscription(envWith(), requestFor(), run.deps);

    expect(run.calls).toEqual(["groq", "deepgram", "assemblyai"]);
    expect(outcome.provider).toBe("assemblyai");
    expect(outcome.transcript.text).toBe("transcript from assemblyai");
    expect(outcome.fellBackFrom).toEqual(["groq", "deepgram"]);
    // A 503 is not a 429: the breaker stays closed, because nothing said we are
    // over a limit.
    expect((await isGroqBreakerOpen(envWith())).open).toBe(false);
  });

  it("falls through Groq's own 25 MB rejection — the paid tiers have no such ceiling", async () => {
    const run = harness({
      groq: {
        fails: {
          code: "source_too_large",
          bytes: 30 * 1024 * 1024,
          maxBytes: GROQ_FREE_TIER_MAX_UPLOAD_BYTES,
        },
      },
    });
    const outcome = await runTranscription(
      envWith(),
      requestFor({ audio: bytesAudio(30 * 1024 * 1024) }),
      run.deps
    );
    expect(outcome.provider).toBe("deepgram");
  });

  it("stops on a failure about the media instead of burning two more providers", async () => {
    const run = harness({
      groq: { fails: { code: "source_unreachable", status: 404 } },
    });
    const failure = await failureFrom(() => runTranscription(envWith(), requestFor(), run.deps));
    expect(failure?.code).toBe("source_unreachable");
    // A dead link is dead for all three of them.
    expect(run.calls).toEqual(["groq"]);
  });

  it("reports provider_unavailable only once every configured tier has refused", async () => {
    const run = harness({
      groq: { fails: { code: "provider_unavailable", provider: "groq", status: 500 } },
      deepgram: { fails: { code: "provider_unavailable", provider: "deepgram", status: 500 } },
      assemblyai: { fails: { code: "provider_unavailable", provider: "assemblyai", status: 500 } },
    });
    const failure = await failureFrom(() => runTranscription(envWith(), requestFor(), run.deps));
    expect(failure?.code).toBe("provider_unavailable");
    expect(run.calls).toEqual(["groq", "deepgram", "assemblyai"]);
  });

  it("degrades to the warm provider_unavailable when no key is configured at all", async () => {
    const run = harness();
    const failure = await failureFrom(() =>
      runTranscription(
        envWith({ GROQ_API_KEY: undefined, DEEPGRAM_API_KEY: undefined, ASSEMBLYAI_API_KEY: undefined }),
        requestFor(),
        run.deps
      )
    );
    expect(failure).toEqual({ code: "provider_unavailable", provider: "groq" });
    expect(run.calls).toEqual([]);
  });

  it("routes a speaker-labelling job Deepgram → AssemblyAI, and never to Groq", async () => {
    const run = harness({
      deepgram: { fails: { code: "provider_unavailable", provider: "deepgram", status: 429 } },
    });
    const outcome = await runTranscription(envWith(), requestFor({ diarize: true }), run.deps);
    expect(run.calls).toEqual(["deepgram", "assemblyai"]);
    expect(outcome.provider).toBe("assemblyai");
    expect(outcome.transcript.metadata.diarization).toBe(true);
    // A Deepgram 429 must not touch the GROQ breaker.
    expect((await isGroqBreakerOpen(envWith())).open).toBe(false);
  });

  it("books what a successful Groq run spent, so the next job routes on a number", async () => {
    await runTranscription(envWith(), requestFor(), harness().deps);
    const stored = await baseEnv.SESSIONS.get(GROQ_CAPACITY_KEY);
    expect(stored).not.toBeNull();
    // The fixture transcript is 600 measured seconds.
    expect(JSON.parse(stored ?? "{}")).toMatchObject({ hourUsed: 600, dayUsed: 600 });
  });

  it("prefers Groq's own limiter reading over our count of the seconds we sent", async () => {
    // The header says 1,200 audio-seconds are left of the hourly 7,200 — Groq has
    // been spent by traffic from another isolate we never saw. Booking only our
    // own 600 seconds would leave the counter reporting 6,600 free and send the
    // next long job straight into a 429.
    const run = harness({
      groq: {
        okHeaders: {
          "x-ratelimit-limit-audio-seconds": "7200",
          "x-ratelimit-remaining-audio-seconds": "1200",
          "x-ratelimit-reset-audio-seconds": "12m30s",
        },
      },
    });
    await runTranscription(envWith(), requestFor(), run.deps);

    const capacity = await getGroqCapacity(envWith());
    expect(capacity.source).toBe<GroqCapacitySource>("headers");
    expect(capacity.hourRemainingSeconds).toBe(1_200);
  });

  it("books the 429 as well, so the counter can learn the window is gone", async () => {
    // The response that says "you are out" was the one response nobody booked:
    // `recordGroqUsage` was only ever called on success. The breaker alone does
    // not fix it — it expires, and the counter still believes the tier is free.
    const run = harness({
      groq: {
        fails: { code: "provider_unavailable", provider: "groq", status: 429, retryAfterSeconds: 180 },
        failHeaders: {
          "x-ratelimit-limit-audio-seconds": "7200",
          "x-ratelimit-remaining-audio-seconds": "0",
          "x-ratelimit-reset-audio-seconds": "40m",
        },
      },
    });
    await runTranscription(envWith(), requestFor(), run.deps);

    const capacity = await getGroqCapacity(envWith());
    expect(capacity.source).toBe<GroqCapacitySource>("headers");
    expect(capacity.hourRemainingSeconds).toBe(0);
  });

  it("spends the hourly window on a 429 that carried no usable reading", async () => {
    // A 429 with unparseable rate-limit headers must not leave the counter
    // believing we still hold two free hours the moment Groq refused us.
    const run = harness({
      groq: {
        fails: { code: "provider_unavailable", provider: "groq", status: 429 },
        failHeaders: { "x-ratelimit-remaining-audio-seconds": "  " },
      },
    });
    await runTranscription(envWith(), requestFor(), run.deps);

    const capacity = await getGroqCapacity(envWith());
    expect(capacity.hourRemainingSeconds).toBe(0);
    // The DAY is deliberately left alone: a 429 may be the 20-requests-per-minute
    // limit, and eight hours is too much to forfeit on that guess.
    expect(capacity.dayRemainingSeconds).toBeGreaterThan(0);
  });

  it("books nothing when Groq never answered at all", async () => {
    // No key, a dead socket, our own timeout: no response, no headers, no spend.
    const run = harness({
      groq: { fails: { code: "provider_unavailable", provider: "groq", status: 503 } },
    });
    await runTranscription(envWith(), requestFor(), run.deps);
    expect(await baseEnv.SESSIONS.get(GROQ_CAPACITY_KEY)).toBeNull();
  });

  it("skips Groq for a URL source ingest already measured over its 25 MB ceiling", async () => {
    // Only the `bytes` variant carries its own size, so a link or a podcast
    // episode used to look size-less here — and most episodes are over 25 MB.
    // Every one of them paid a full round trip to be told 413.
    const run = harness();
    const outcome = await runTranscription(
      envWith(),
      requestFor({ sizeBytes: GROQ_FREE_TIER_MAX_UPLOAD_BYTES + 1 }),
      run.deps
    );
    expect(run.calls).toEqual(["deepgram"]);
    expect(outcome.reason).toBe<TranscriptionRouteReason>("groq_over_free_tier_file_limit");
  });

  // THE CLASSROOM CASE, end to end through the router rather than through a
  // hand-rolled call sequence: twenty teachers press "Transcrire" inside two
  // minutes. One job pays the 429; the nineteen behind it must skip Groq
  // entirely and still finish.
  it("sends one job into a Groq 429 and routes the nineteen behind it away", async () => {
    const calls: TranscriptionProviderId[] = [];
    const deps: TranscriptionRunDeps = {
      buildProvider: (_env, provider) =>
        fakeProvider(
          provider,
          calls,
          provider === "groq"
            ? {
                fails: {
                  code: "provider_unavailable",
                  provider: "groq",
                  status: 429,
                  retryAfterSeconds: 180,
                },
              }
            : {}
        ),
      planRoute: planTranscriptionRoute,
    };

    for (let job = 0; job < 20; job += 1) {
      const outcome = await runTranscription(envWith(), requestFor(), deps);
      expect(outcome.provider).toBe("deepgram");
    }

    expect(calls.filter((provider) => provider === "groq")).toHaveLength(1);
    expect(calls.filter((provider) => provider === "deepgram")).toHaveLength(20);
    expect((await isGroqBreakerOpen(envWith())).open).toBe(true);
  });
});
