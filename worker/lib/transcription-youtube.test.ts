// YouTube resolver unit tests.
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

function audioResponse(options: {
  bytes?: Uint8Array;
  duration?: string;
  title?: string;
  omitLength?: boolean;
}): Response {
  const bytes = options.bytes ?? new TextEncoder().encode("OPUS-FIXTURE-AUDIO");
  const headers = new Headers({
    "Content-Type": "audio/ogg",
    "X-Duration-Seconds": options.duration ?? "1832",
  });
  if (options.title !== undefined) {
    headers.set(
      "X-Title-B64",
      btoa(String.fromCharCode(...new TextEncoder().encode(options.title)))
    );
  }
  if (!options.omitLength) headers.set("Content-Length", String(bytes.length));
  // A hand-rolled streamed body: `new Response(bytes)` would re-derive
  // Content-Length and defeat the omitLength case.
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
      resolveYouTube(baseEnv, WATCH_URL, (() => {
        throw new Error("must not fetch");
      }) as unknown as typeof fetch)
    );
    expect(failure.code).toBe("youtube_not_yet_supported");
  });

  it("maps 404 to youtube_unavailable — only a different link will ever work", async () => {
    const failure = await failureOf(
      resolveYouTube(configuredEnv(), WATCH_URL, async () =>
        Response.json({ code: "download_error" }, { status: 404 })
      )
    );
    expect(failure).toMatchObject({ code: "youtube_unavailable", status: 404 });
  });

  it.each([403, 429, 500, 401])("maps %s to the retryable youtube_blocked", async (status) => {
    const failure = await failureOf(
      resolveYouTube(configuredEnv(), WATCH_URL, async () => new Response(null, { status }))
    );
    expect(failure).toMatchObject({ code: "youtube_blocked", status });
  });

  it("maps the metadata-first 413 to source_too_long with the sidecar's measured duration", async () => {
    const failure = await failureOf(
      resolveYouTube(configuredEnv(), WATCH_URL, async () =>
        Response.json({ code: "source_too_long", durationSeconds: 7200 }, { status: 413 })
      )
    );
    expect(failure).toMatchObject({
      code: "source_too_long",
      durationSeconds: 7200,
      maxSeconds: 5400,
    });
  });

  it("maps 422 (a playlist) to unsupported_source", async () => {
    const failure = await failureOf(
      resolveYouTube(configuredEnv(), WATCH_URL, async () =>
        Response.json({ code: "unsupported_source" }, { status: 422 })
      )
    );
    expect(failure.code).toBe("unsupported_source");
  });

  it("treats an unreachable sidecar as retryable, never as the teacher's fault", async () => {
    const failure = await failureOf(
      resolveYouTube(configuredEnv(), WATCH_URL, (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch)
    );
    expect(failure.code).toBe("youtube_blocked");
  });

  it("treats a 200 without a Content-Length as a sidecar bug, retryable", async () => {
    const failure = await failureOf(
      resolveYouTube(configuredEnv(), WATCH_URL, async () => audioResponse({ omitLength: true }))
    );
    expect(failure.code).toBe("youtube_blocked");
  });
});

describe("resolveYouTube — the happy path", () => {
  it("authenticates, streams the audio into R2, and returns an ordinary bytes source", async () => {
    const captured: { url?: string; auth?: string | null; body?: unknown } = {};
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = String(input);
      captured.auth = new Headers(init?.headers).get("authorization");
      captured.body = JSON.parse(String(init?.body));
      return audioResponse({ title: "Épisode : l'école en 2026", duration: "1832" });
    }) as unknown as typeof fetch;

    const resolved = await resolveYouTube(configuredEnv(), WATCH_URL, fetcher);

    // The request honoured the contract.
    expect(captured.url).toBe("https://ingest.test/extract");
    expect(captured.auth).toBe("Bearer s3cret");
    expect(captured.body).toEqual({ url: WATCH_URL, maxDurationSeconds: 5400 });

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

    // And the bytes really are in R2 under the key the job row will carry —
    // the object retention and deletion will later remove.
    const stored = await baseEnv.MEDIA.get(resolved.r2Key!);
    expect(stored).not.toBeNull();
    expect(await stored!.text()).toBe("OPUS-FIXTURE-AUDIO");
    expect(stored!.httpMetadata?.contentType).toBe("audio/ogg");
    await baseEnv.MEDIA.delete(resolved.r2Key!);
  });

  it("survives a missing or garbled title header — the filename falls back, nothing throws", async () => {
    const resolved = await resolveYouTube(configuredEnv(), WATCH_URL, (async () =>
      audioResponse({})) as unknown as typeof fetch);
    expect(resolved.title).toBeNull();
    if (resolved.audio.kind !== "bytes") throw new Error("expected a bytes source");
    expect(resolved.audio.filename).toBe("youtube-audio.ogg");
    await baseEnv.MEDIA.delete(resolved.r2Key!);
  });
});
