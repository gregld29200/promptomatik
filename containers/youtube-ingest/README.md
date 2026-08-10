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

## Contract (for the Worker's tests and any future host)

- `GET /health` → `{ ok: true, ytdlp: "<version>" }` (auth required)
- `POST /extract` `{ url, maxDurationSeconds }` (auth required) →
  - `200` — body: Opus audio; headers: `Content-Length`,
    `X-Duration-Seconds`, `X-Title-B64` (UTF-8 title, base64)
  - `404` — video unavailable (private / deleted / geo-blocked / age-gated)
  - `403` — YouTube refused us (bot check) → Worker retries
  - `413` — `{ code: "source_too_long", durationSeconds }`, decided from
    metadata before any download
  - `422` — not a single video (playlist, channel, non-YouTube URL)
  - `401` — missing/wrong Bearer secret
  - other `5xx` — transient; Worker retries
