// YouTube resolver unit tests — submit → poll → fetch protocol.
//
// There is NO ingest sidecar in this environment, so nothing here talks to
// one. Every response below is HANDWRITTEN against the contract in
// containers/youtube-ingest/README.md — it is a fixture, not a recording, and
// no assertion claims otherwise. The R2 side is the real binding from the
// Workers test pool, so the stream-through-FixedLengthStream path is exercised
// for real, not mocked.

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Env } from "../env";
import { resolveYouTube, youtubeIngestConfigured } from "./transcription-youtube";
import { TranscriptionError } from "./transcription/types";

const baseEnv = env as unknown as Env;

const WATCH_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
/** Test seam: instant polls, short deadline — the logic, not the clock. */
const FAST = { pollIntervalMs: 1, timeoutMs: 3_000 };

function configuredEnv(): Env {
  return {
    ...baseEnv,
    YOUTUBE_INGEST_URL: "https://ingest.test",
    YOUTUBE_INGEST_SECRET: "s3cret",
  };
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TranscriptionError) return error.failure;
    throw error;
  }
  throw new Error("expected resolveYouTube to throw");
}

/**
 * A scripted sidecar: each entry answers one request, in order. `null` entries
 * throw a network error instead. The last entry repeats, so an "endless
 * working" script needs only two entries.
 */
function scriptedFetcher(script: Array<(() => Response) | null>): typeof fetch {
  let call = 0;
  return (async () => {
    const step = script[Math.min(call, script.length - 1)];
    call += 1;
    if (step === null) throw new TypeError("fetch failed");
    return step();
  }) as unknown as typeof fetch;
}

const accepted = () => Response.json({ taskId: "t-1" }, { status: 202 });
const working = () => Response.json({ status: "working" });
const ready = () => Response.json({ status: "ready", durationSeconds: 1832, bytes: 18 });
const failed = (status_code: number, extra: Record<string, unknown> = {}) => () =>
  Response.json({ status: "failed", code: "download_error", status_code, ...extra });

function audioFile(options: { title?: string; omitLength?: boolean } = {}): Response {
  const bytes = new TextEncoder().encode("OPUS-FIXTURE-AUDIO");
  const headers = new Headers({
    "Content-Type": "audio/ogg",
    "X-Duration-Seconds": "1832",
  });
  if (options.title !== undefined) {
    headers.set(
      "X-Title-B64",
      btoa(String.fromCharCode(...new TextEncoder().encode(options.title)))
    );
  }
  if (!options.omitLength) headers.set("Content-Length", String(bytes.length));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers });
}

describe("youtubeIngestConfigured", () => {
  it("requires BOTH halves — a URL without its secret is unconfigured", () => {
    expect(youtubeIngestConfigured(baseEnv)).toBe(false);
    expect(youtubeIngestConfigured({ ...baseEnv, YOUTUBE_INGEST_URL: "https://x.test" })).toBe(false);
    expect(youtubeIngestConfigured({ ...baseEnv, YOUTUBE_INGEST_SECRET: "s" })).toBe(false);
    expect(youtubeIngestConfigured(configuredEnv())).toBe(true);
  });
});

describe("resolveYouTube — refusals", () => {
  it("throws the not-yet code when the sidecar is unconfigured, without fetching", async () => {
    const failure = await failureOf(
      resolveYouTube(baseEnv, WATCH_URL, scriptedFetcher([null]), FAST)
    );
    expect(failure.code).toBe("youtube_not_yet_supported");
  });

  it("treats an unreachable sidecar at SUBMIT as retryable, never the teacher's fault", async () => {
    const failure = await failureOf(
      resolveYouTube(configuredEnv(), WATCH_URL, scriptedFetcher([null]), FAST)
    );
    expect(failure.code).toBe("youtube_blocked");
  });

  it("maps a failed task with 404 to youtube_unavailable — only a different link will work", async () => {
    const failure = await failureOf(
      resolveYouTube(configuredEnv(), WATCH_URL, scriptedFetcher([accepted, failed(404)]), FAST)
    );
    expect(failure).toMatchObject({ code: "youtube_unavailable", status: 404 });
  });

  it.each([403, 429, 500])("maps a failed task with %s to the retryable youtube_blocked", async (code) => {
    const failure = await failureOf(
      resolveYouTube(configuredEnv(), WATCH_URL, scriptedFetcher([accepted, failed(code)]), FAST)
    );
    expect(failure).toMatchObject({ code: "youtube_blocked" });
  });

  it("maps the metadata-first 413 to source_too_long with the sidecar's measured duration", async () => {
    const failure = await failureOf(
      resolveYouTube(
        configuredEnv(),
        WATCH_URL,
        scriptedFetcher([accepted, failed(413, { durationSeconds: 7200 })]),
        FAST
      )
    );
    expect(failure).toMatchObject({
      code: "source_too_long",
      durationSeconds: 7200,
      maxSeconds: 5400,
    });
  });

  it("maps a failed task with 422 (a playlist) to unsupported_source", async () => {
    const failure = await failureOf(
      resolveYouTube(configuredEnv(), WATCH_URL, scriptedFetcher([accepted, failed(422)]), FAST)
    );
    expect(failure.code).toBe("unsupported_source");
  });

  it("treats a task the sidecar no longer knows (machine restart) as retryable", async () => {
    const failure = await failureOf(
      resolveYouTube(
        configuredEnv(),
        WATCH_URL,
        scriptedFetcher([accepted, () => Response.json({ status: "unknown" }, { status: 404 })]),
        FAST
      )
    );
    expect(failure.code).toBe("youtube_blocked");
  });

  it("gives up as retryable when the task never leaves 'working' before the deadline", async () => {
    const failure = await failureOf(
      resolveYouTube(configuredEnv(), WATCH_URL, scriptedFetcher([accepted, working]), {
        pollIntervalMs: 1,
        timeoutMs: 50,
      })
    );
    expect(failure.code).toBe("youtube_blocked");
  });

  it("rides out ONE flaky poll and still succeeds — the deadline is the limit, not a hiccup", async () => {
    const resolved = await resolveYouTube(
      configuredEnv(),
      WATCH_URL,
      scriptedFetcher([accepted, null, working, ready, () => audioFile({ title: "Ok" })]),
      FAST
    );
    expect(resolved.title).toBe("Ok");
    await baseEnv.MEDIA.delete(resolved.r2Key!);
  });

  it("treats a ready file without a Content-Length as a sidecar bug, retryable", async () => {
    const failure = await failureOf(
      resolveYouTube(
        configuredEnv(),
        WATCH_URL,
        scriptedFetcher([accepted, ready, () => audioFile({ omitLength: true })]),
        FAST
      )
    );
    expect(failure.code).toBe("youtube_blocked");
  });
});

describe("resolveYouTube — the happy path", () => {
  it("submits, polls to ready, streams the audio into R2, returns an ordinary bytes source", async () => {
    const seen: Array<{ url: string; auth: string | null; method: string }> = [];
    let call = 0;
    const script = [accepted, working, working, ready, () => audioFile({ title: "Épisode : l'école en 2026" })];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({
        url: String(input),
        auth: new Headers(init?.headers).get("authorization"),
        method: init?.method ?? "GET",
      });
      const step = script[Math.min(call, script.length - 1)];
      call += 1;
      return step();
    }) as unknown as typeof fetch;

    const resolved = await resolveYouTube(configuredEnv(), WATCH_URL, fetcher, FAST);

    // The protocol, in order: one POST, then polls, then the file.
    expect(seen[0]).toMatchObject({ url: "https://ingest.test/extract", method: "POST" });
    expect(seen[1].url).toBe("https://ingest.test/extract/t-1");
    expect(seen[seen.length - 1].url).toBe("https://ingest.test/extract/t-1/file");
    // Every request carries the shared secret.
    for (const request of seen) expect(request.auth).toBe("Bearer s3cret");

    // The resolution is shaped exactly like an upload's, so the cascade,
    // quota, retention and deletion all treat it as an ordinary job.
    expect(resolved.kind).toBe("youtube");
    expect(resolved.durationSeconds).toBe(1832);
    expect(resolved.title).toBe("Épisode : l'école en 2026");
    expect(resolved.resolvedUrl).toBe(WATCH_URL);
    expect(resolved.contentType).toBe("audio/ogg");
    expect(resolved.r2Key).toMatch(/^transcription\/youtube\/[A-Za-z0-9_-]+\/audio\.ogg$/);
    if (resolved.audio.kind !== "bytes") throw new Error("expected a bytes source");
    expect(resolved.audio.filename).toBe("Episode  lecole en 2026.ogg");
    expect(await resolved.audio.blob.text()).toBe("OPUS-FIXTURE-AUDIO");

    // And the bytes really are in R2 under the key the job row will carry.
    const stored = await baseEnv.MEDIA.get(resolved.r2Key!);
    expect(stored).not.toBeNull();
    expect(await stored!.text()).toBe("OPUS-FIXTURE-AUDIO");
    expect(stored!.httpMetadata?.contentType).toBe("audio/ogg");
    await baseEnv.MEDIA.delete(resolved.r2Key!);
  });

  it("survives a missing title header — the filename falls back, nothing throws", async () => {
    const resolved = await resolveYouTube(
      configuredEnv(),
      WATCH_URL,
      scriptedFetcher([accepted, ready, () => audioFile({})]),
      FAST
    );
    expect(resolved.title).toBeNull();
    if (resolved.audio.kind !== "bytes") throw new Error("expected a bytes source");
    expect(resolved.audio.filename).toBe("youtube-audio.ogg");
    await baseEnv.MEDIA.delete(resolved.r2Key!);
  });
});
