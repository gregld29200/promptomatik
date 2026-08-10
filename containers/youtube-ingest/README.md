# YouTube ingest sidecar

The small HTTP service that lets the Transcription Studio accept YouTube
links. The Worker (`worker/lib/transcription-youtube.ts`) POSTs a watch URL
here; this service checks the video's duration from metadata, downloads the
best audio, transcodes it to 16 kHz mono Opus, and streams it back. The Worker
stores it in R2 and the normal provider cascade (Groq → Deepgram → AssemblyAI,
diarization included) takes over.

**Until this is deployed and the two secrets are set, YouTube links get the
honest "not available right now" message — nothing breaks.**

## Deploy on Fly.io (no local Docker needed)

Fly builds the image remotely, and machines scale to zero between requests.

```bash
brew install flyctl
```

```bash
fly auth login
```

Then, from this directory (`containers/youtube-ingest/`):

```bash
fly launch --no-deploy --copy-config
```

Generate a strong shared secret and give it to the machine:

```bash
fly secrets set INGEST_SHARED_SECRET=$(openssl rand -hex 32)
```

```bash
fly deploy --remote-only
```

## Wire the Worker to it

The same two values, on the Worker (production):

```bash
npx wrangler secret put YOUTUBE_INGEST_URL
```

(enter `https://teachinspire-yt-ingest.fly.dev` — your app's URL)

```bash
npx wrangler secret put YOUTUBE_INGEST_SECRET
```

(enter the same hex string you gave Fly)

For local dev, add both lines to `.dev.vars`. No redeploy of the Worker is
needed — the code already routes YouTube jobs here the moment both values
exist.

## Verify

```bash
curl -s -H "Authorization: Bearer <secret>" https://teachinspire-yt-ingest.fly.dev/health
```

Expect `{"ok":true,"ytdlp":"<version>"}`. Then paste a YouTube link into the
Studio.

## The residential proxy is REQUIRED, not optional

Measured 2026-08-10: from Fly's datacenter IP, YouTube bot-checks ~100% of
extractions ("Sign in to confirm you're not a bot"), and the `tv`/`ios`/
`android` player clients do not get around it. With a residential proxy the
same video extracts in ~46 s. So `YTDLP_PROXY` is a hard requirement for this
feature to work at all — not a hardening measure.

Currently: DataImpulse residential, `gw.dataimpulse.com:823`, pay-as-you-go with
no expiry. Consumption is ~15 MB per hour of video (the audio is downmixed
before transfer), so 5 GB is roughly 330 hours — a few euros a year at this
volume. Top up in the DataImpulse dashboard; `407 TRAFFIC_EXHAUSTED` in the logs
is what an empty balance looks like.

`GET /proxy-check` (auth required) diagnoses the proxy in isolation from
YouTube: it reports the parsed shape of `YTDLP_PROXY` (never the password) and
makes one request through it, returning the exit IP or the proxy's own error.
Use it FIRST whenever extraction fails — a `407` from the proxy and a `403`
from YouTube both surface as one opaque `download_error` otherwise.

## Maintenance — the part that is genuinely recurring

- **Bump `YTDLP_VERSION` in the Dockerfile about once a month** and
  `fly deploy --remote-only`. YouTube changes its player regularly; a pinned
  yt-dlp more than ~6 weeks old will start failing, and the failure looks
  identical to IP blocking. `/health` reports the running version so you can
  tell the two apart.
- **Expect some `youtube_blocked` failures regardless.** YouTube bot-checks
  datacenter IPs. The Studio retries them automatically and tells the teacher
  it was not their fault. If the block rate becomes unacceptable, the honest
  options are documented in `docs/plans/transcription-slice-2-youtube.md` §5 —
  do NOT add account cookies to this service; that gets a Google account
  banned.
- **ToS note:** downloading YouTube audio is against YouTube's Terms of
  Service. This feature stays best-effort and out of the Module 2 tutorial and
  marketing material.

## Contract v2 — submit → poll → fetch (all endpoints auth required)

Async BY NECESSITY, not taste: v1 answered POST with the audio itself, and
Fly's edge kills a connection that moves no bytes for ~60 s, then auto-stops
the "idle" machine mid-download (measured: a 42 MiB extraction died at 85%
with `os error 110`). Short polls fix both — and double as the keep-alive.

- `GET /health` → `{ ok, ytdlp, proxy }`
- `POST /extract` `{ url, maxDurationSeconds }` → `202 { taskId }`
  (`422` non-YouTube/playlist URL, `401` bad secret)
- `GET /extract/{taskId}` →
  - `{ status: "working" }` — poll again
  - `{ status: "ready", durationSeconds, bytes }`
  - `{ status: "failed", status_code, code, durationSeconds? }` where
    `status_code` speaks the v1 vocabulary: 404 video unavailable, 403 bot
    check (retry), 413 over the cap (with durationSeconds), 422 playlist,
    502 anything else (retry)
  - HTTP `404` — task unknown: the machine restarted; retry the whole job
- `GET /extract/{taskId}/file` → the Opus audio (`Content-Length`,
  `X-Duration-Seconds`, `X-Title-B64`), served once, then deleted.
  Tasks and files are swept after 15 minutes regardless.
