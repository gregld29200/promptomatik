# Transcription Slice 2 — YouTube ingest via a yt-dlp container

**Status: CLOSED — decided against, 2026-08-10.** Kept as the record of why.

## Closure

Two findings killed this plan when it came up for scheduling, one of them fatal
to its own recommended option:

1. **The captions-only milestone (§4, steps 1–6) does not exist as a cheap
   path.** Tested live on 2026-08-09/10: the watch page and metadata (title,
   duration, full caption-track list with `kind: "asr"` flags) are fetchable
   with plain HTTP — but every caption cue URL returns **HTTP 200 with zero
   bytes**, in every format (`json3`, `vtt`, `srv3`, `ttml`, default). The
   `baseUrl` carries `ip`/`ipbits`/`signature`/`expire` — IP-bound and signed —
   and YouTube now requires a PO token to get cue text at all. So captions need
   the same yt-dlp machinery and the same monthly arms race as `/extract`; the
   plan's "valuable, low-risk half" was neither. (The official Data API is no
   escape: it only serves captions for videos you own.)
2. **Demand was zero.** The §1 query returned no `source_kind = 'youtube'`
   rows — not one teacher had tried. (Docker was also not installed on the
   build machine, but that is incidental; finding 1 is the reason.)

**Decision (Greg, 2026-08-10): teach the workaround instead of building the
container.** The refusal copy (`error_youtube_not_yet_supported`) now tells
teachers what to do — paste the podcast version if one exists, otherwise save
the audio track and upload it — and `source_hint` says up front that YouTube is
not supported. No container, no cron-fed dependency, no ToS exposure, and
uploads already handle the resulting file.

**Reopen only if** the demand query starts returning real numbers from several
teachers AND someone accepts the §5 operational burden as a standing monthly
cost. Everything below survives as the blueprint for that day.

### Addendum 2026-08-10 — a reopen path with no container

`deAPI` (https://deapi.ai, docs `https://deapi.ai/llms.txt`) exposes
`POST /api/v2/audio/transcriptions` with a `source_url` that accepts **YouTube,
X, Twitch, Kick, TikTok and X Spaces directly**. If YouTube is ever reopened,
this removes §3, §5.1 and §5.2 entirely — no Dockerfile, no yt-dlp pinning, no
monthly rebuild, no canary, no datacenter-IP arms race. They carry it.

It is **not** a candidate to replace any existing tier, for four reasons found
on inspection (not assumed):

1. **No diarization.** The endpoint takes only `source_url`/`source_file`,
   `include_ts` and `model`; the model is `WhisperLargeV3`, which cannot
   diarize. The "separate the voices" path is impossible there.
2. **Decentralised GPU infrastructure** — self-described as "thousands of GPUs
   worldwide", with no EU-residency guarantee. Classroom recordings carry
   learners' voices, i.e. personal data; this is a materially weaker posture
   than Deepgram's `api.eu.deepgram.com` and cuts against the reason retention
   is 7 days at all.
3. **Smaller ceilings than ours:** 20 MB audio / 50 MB video vs our 64 MB.
4. **No language parameter**, so the `fr` hint that improves accuracy has
   nowhere to go. Free-tier limits are also 1 RPM / 10 RPD on transcriptions.

Pricing was NOT verified — the public pricing page shows only an image
calculator and the transcription figure needs an authenticated price call. The
"up to 20× lower" claim is against traditional providers; Groq is already
$0.04/hr, so treat any cost advantage as unproven.

So the shape of a reopen changes: **a fourth tier used ONLY for
`source_kind = 'youtube'`, plain transcripts only, never for a diarized job and
never the default for uploaded classroom audio.** Steps 5–7 below (the
container) become unnecessary; steps 1–4 (the failure codes, the zero-charge
transcript branch) still apply, and the provider CHECK would widen to a vendor
slug rather than `'youtube_captions'`. Demand was still zero when this was
written — this is a cheaper door, not a reason to open it.

---

**Original plan follows** (historical — nothing below is wired: no container
config in `wrangler.jsonc`, no Dockerfile in the repo, no code).

**Prerequisite:** Slice 1 shipped and running — see
`docs/transcription-workbench.md`.

**Read §5 before scheduling this.** Three operational realities decide whether
this is worth building at all, and one of them keeps it out of the Module 2
tutorial permanently.

---

## 1. Why a container, and why not before now

Slice 1 recognises YouTube and refuses it with a distinct, friendly state
(`youtube_not_yet_supported`, HTTP **501**, classified *before* the SSRF verdict so
the teacher never sees a generic error). That refusal is deliberate scaffolding:
`source_kind = 'youtube'` rows are stored, so **demand is countable before
anything is built.**

Query it first:

```sql
SELECT COUNT(*) AS attempts, COUNT(DISTINCT user_id) AS teachers
FROM transcription_jobs
WHERE source_kind = 'youtube';
```

If that is a handful of rows from one teacher, this slice is not the next thing
to build.

A Worker cannot do this job. YouTube's audio is behind a signed, throttled,
adaptive-manifest flow that needs `yt-dlp`'s signature-decipher logic — a Python
program that changes weekly. There is no Workers-compatible port and there will
not be one. So: **Cloudflare Containers**, one small HTTP service, called from the
existing queue consumer.

---

## 2. Where it plugs in

The insertion point is exactly **one function**: `resolveSource` in
`worker/lib/transcription-ingest.ts`. Nothing else in Slice 1 changes shape.

```
POST /api/transcriptions/jobs        (unchanged)
  classifySource → kind: "youtube"   → today: throws youtube_not_yet_supported
                                       Slice 2: accepted, row inserted
        │
        ▼
  transcription-jobs queue           (unchanged, max_batch_size 1, max_retries 3)
        │
        ▼
  processTranscriptionJob            (unchanged control flow)
    claim → status 'resolving'
        │
        ├── resolveSource(env, ref)
        │     ├── kind "upload"      → R2                       (unchanged)
        │     ├── kind "direct_url"  → probeMedia                (unchanged)
        │     ├── kind "podcast"     → feed/page → probeMedia    (unchanged)
        │     └── kind "youtube"     → NEW: resolveYouTube()
        │           │
        │           ├── POST container /captions ──► caption track exists?
        │           │       └── YES → return a NormalisedTranscript directly
        │           │                 (§4 — the free instant path, no provider)
        │           │
        │           └── NO → POST container /extract
        │                     container downloads bestaudio, transcodes to
        │                     16 kHz mono Opus, PUTs to R2 via a presigned URL,
        │                     returns { r2Key, durationSeconds, title, bytes }
        │                     → ResolvedSource { audio: { kind: "bytes" }, … }
        │
        ├── duration cap re-checked  (unchanged — container reports real duration)
        ├── getProvider(diarize)     (unchanged — Groq or Deepgram)
        └── charge, persist          (unchanged)
```

Two consequences of plugging in here rather than anywhere else:

1. **The quota gate, the 90-minute cap, the ownership SQL, the five statuses, the
   error union, the downloads and the whole reading UI are untouched.** A YouTube
   job is an ordinary job whose `resolveSource` took a detour.
2. **The captions shortcut needs one new seam** (§4), because it produces a
   transcript *instead of* audio — which `ResolvedSource` cannot express.

### The one new type

`ResolvedSource` currently promises media. The captions path promises a
transcript. So `resolveSource` for `kind: "youtube"` returns a union:

```ts
// worker/lib/transcription/types.ts
export type YouTubeResolution =
  | { kind: "media"; source: ResolvedSource }
  /** A published caption track — already a transcript, no provider needed. */
  | { kind: "transcript"; transcript: NormalisedTranscript };
```

`processTranscriptionJob` gains one branch: a `transcript` resolution skips
`getProvider`/`submit`/`fetchTranscript` entirely, persists, and **charges zero
seconds** (`chargeTranscriptionQuota` already no-ops on 0 and writes no ledger
row — an empty audit entry is noise, not audit). The row records
`provider = 'youtube_captions'`, which means **migration 0018 must widen two
CHECK constraints**: `transcription_jobs.provider` and
`transcription_quota_ledger.provider`. Do not smuggle it in as `'groq'`.

### New failure codes

Three, added to `TranscriptionFailure` with their own translated sentences —
never folded into `provider_failed`, because the teacher's next action differs
for each:

| Code | HTTP | Means | Teacher's next move |
| --- | --- | --- | --- |
| `youtube_unavailable` | 502 | Private, deleted, geo-blocked, age-gated, members-only. | Check the link, or pick another video. |
| `youtube_blocked` | 503 | YouTube refused *us* — bot check, datacenter IP. **Not the teacher's fault.** | Try again later; retryable, so the queue ladder applies. |
| `youtube_too_long` | 413 | Over 90 min, known from metadata before any download. | Same as `source_too_long`, but named so we can count it. |

`youtube_not_yet_supported` **stays in the union** and stays translated: it is
what a teacher sees if the container is not deployed, is scaled to zero and
failing, or the feature is turned off. Deleting it would leave that state with no
honest message.

---

## 3. The container's HTTP contract

One tiny service. **Not** a general-purpose downloader: it accepts a YouTube
watch URL and nothing else, and it is reachable only from our Worker's container
binding — never from the internet.

Base URL is the container binding. Every request carries
`Authorization: Bearer <INGEST_SHARED_SECRET>`; a missing or wrong token is a
`401` with no body. The container is stateless.

### `GET /health`

```json
{ "ok": true, "ytdlp": "2026.08.04" }
```

Used by a readiness probe and — more usefully — to **alert on a stale `yt-dlp`**
(§5.2).

### `POST /captions`

Ask whether YouTube already has a transcript. **Cheap: metadata only, no media
download.**

```jsonc
// request
{ "url": "https://www.youtube.com/watch?v=…", "preferLanguages": ["fr", "en", "es"] }
```

```jsonc
// 200 — a caption track exists
{
  "found": true,
  "language": "fr",
  "automatic": false,          // false = human-authored. Say so in the UI.
  "title": "…",
  "durationSeconds": 1832,
  "cues": [
    { "start": 0.0, "end": 3.4, "text": "Bonjour à tous et bienvenue" }
  ]
}

// 200 — no usable track. Not an error: fall through to /extract.
{ "found": false, "title": "…", "durationSeconds": 1832 }
```

Errors: `404` → `youtube_unavailable`; `429`/`403` → `youtube_blocked`;
`413` → `youtube_too_long` (checked from metadata, before anything is fetched);
`5xx` → `youtube_blocked` (retryable).

**Cues, not words.** Caption tracks have no word-level timing and no speakers, and
the container must not invent either. Normalisation (`cues → TranscriptSegment[]`,
one word span per cue with `confidence: null`, `speaker: null`) happens in a **new
pure Worker module**, `worker/lib/transcription/youtube-captions.ts`, unit-tested
against fixture cue payloads exactly as `groq.ts` and `deepgram.ts` are.
`metadata.diarization` is **`false`**, `speakerCount` is `null`,
`providerJobId` is `null`, `model` is `"youtube-captions"`.

### `POST /extract`

Download and transcode. This is the expensive call.

```jsonc
// request
{
  "url": "https://www.youtube.com/watch?v=…",
  "maxDurationSeconds": 5400,          // TRANSCRIPTION_MAX_SOURCE_SECONDS
  "uploadUrl": "https://…presigned-r2-put…", // expires in 15 min
  "uploadContentType": "audio/ogg"
}
```

```jsonc
// 200 — bytes are already in R2; the container never returns audio in its body
{
  "durationSeconds": 1832,
  "bytes": 4183920,
  "contentType": "audio/ogg",
  "title": "…",
  "channel": "…",
  "ytdlp": "2026.08.04"
}
```

Contract rules, all load-bearing:

- **Metadata first, then decide.** Duration is read from metadata and compared to
  `maxDurationSeconds` **before a single audio byte is fetched**. A 4-hour stream
  costs one metadata call, not a 4-hour download.
- **The container never streams media through the Worker.** It `PUT`s to the
  presigned URL. A Worker isolate has 128 MB, and Slice 1 lowered its own upload
  ceiling to 64 MB for exactly this reason — routing a video's audio through the
  Worker would undo that.
- **Mono, 16 kHz, Opus, always.** Both providers bill per channel (see
  `transcription-workbench.md` §2), and Groq downsamples to 16 kHz mono anyway.
  Transcoding here means we never upload a stereo 48 kHz stream we then pay
  double for. Opus at 32 kbps is a ~13 MB hour — comfortably inside the 64 MB
  ceiling for a 90-minute cap.
- **One URL per request, one process, hard timeout.** No batching, no playlists.
  A playlist URL is `unsupported_source`.
- **Timeout: 10 minutes**, matching the Deepgram ceiling and well under a queue
  consumer's wall clock. The Worker sets its own `AbortSignal` too.
- **Nothing persists.** `/tmp` is wiped after every request, success or failure.

### Worker-side call site

`resolveYouTube(env, url, jobId, fetcher?)` lives in a new
`worker/lib/transcription-youtube.ts`, takes a `fetcher` seam like every other
network module in Slice 1, and is unit-tested against fixture container
responses. **The R2 key follows the existing helper layout** —
`transcription/youtube/<jobId>/audio.ogg` under the job's own prefix, so
`deleteTranscriptionJobForUser`'s existing prefix sweep already removes it and no
second cleanup path is introduced.

---

## 4. The YouTube-captions shortcut

**This is the most valuable part of Slice 2, and the cheapest.**

A large share of the videos a language teacher wants — institutional channels,
news, most educational content, anything the uploader captioned — already has a
caption track. When one exists:

- **Cost: zero.** No Groq, no Deepgram, no ledger row.
- **Latency: a second or two.** One metadata call, no download, no transcode, no
  provider round trip.
- **Quality: often better than ASR**, when the track is human-authored.

So `/captions` is tried **first, always**, and `/extract` is the fallback.

Three honesty requirements, none negotiable:

1. **Say where it came from.** The UI must show that this transcript is the
   video's own captions, not something we transcribed — a new
   `transcription.source_youtube_captions` note. A teacher comparing two
   transcripts of different provenance deserves to know which is which.
2. **Distinguish human from automatic.** `automatic: true` means YouTube's own
   ASR, which is *not* obviously better than Groq and has no word timings worth
   trusting. Show it differently, and consider offering "transcribe it properly
   instead" as an explicit second action.
3. **No speakers, ever, and no fabricated confidence.** Caption tracks carry
   neither. If the teacher asked for speakers, this path **cannot honour it** —
   so either fall through to `/extract` + Deepgram (correct, costs money), or
   return the captions and say plainly that speakers were not available. Pick one
   in the plan review; do not let the code decide implicitly. Slice 1 already
   established the pattern for this exact conversation with `diarizeRequested`
   vs `diarization`.

Cue-level timing is coarse (2–6 s), which is fine for reading and for
SRT/VTT — that is what the cues *are* — and poor for the "click an uncertain word
to hear it" affordance. Since `confidence` is `null` throughout, the reader's
uncertain-passages feature simply finds nothing to flag. That is correct
behaviour, not a gap to paper over.

---

## 5. Three operational realities

These are the reasons this stays best-effort. State them to yourself before
building, and to teachers before shipping.

### 5.1 Datacenter IPs get blocked

YouTube actively blocks datacenter address space with bot checks
("Sign in to confirm you're not a bot"). Cloudflare Containers run in
Cloudflare's address space. **Expect `/extract` to fail a meaningful fraction of
the time, and expect that fraction to change without notice.**

What follows from that:

- `youtube_blocked` (503) is a **first-class, translated, retryable** state, not
  an edge case. The queue ladder retries it; after the attempts are spent the row
  says "YouTube refused us, try again later", which is true and actionable.
- **The captions path is unaffected by most of this** — another reason to try it
  first, and a reason the feature is worth shipping even if `/extract` is flaky.
- **Do not build a cookie-jar or proxy workaround.** Supplying account cookies
  gets a Google account banned and is a straightforward ToS violation. If
  `/extract` proves unusable in practice, the honest answer is to ship
  captions-only and keep refusing the rest — not to escalate the arms race.
- Instrument it: `error_code` is already denormalised on the row, so
  `GROUP BY error_code` gives the real block rate within a week.

### 5.2 yt-dlp needs feeding

YouTube changes its signature/manifest logic roughly monthly; `yt-dlp` ships
fixes within days. **A container image pinned once and forgotten will silently
stop working**, and the failure looks like §5.1 — which is exactly why they must
be distinguishable.

- **Pin an exact version** in the Dockerfile (below). Never `pip install yt-dlp`
  unpinned: a rebuild would then change behaviour without a commit, and an
  unreproducible ingest container is worse than a stale one.
- **Rebuild and redeploy monthly**, deliberately. Put it on the same cadence as
  dependency review, not on an autoupdater inside the container.
- `GET /health` returns the running version. **Alert when it is more than ~6
  weeks old** — that alert is the actual mechanism; a note in a doc is not.
- Add a **canary**: one known-good, permanently-public, captioned video, fetched
  on a schedule. When the canary fails, `yt-dlp` is stale or YouTube changed —
  and you learn it before a teacher does.

### 5.3 YouTube's Terms of Service

Downloading YouTube content outside their API is **against YouTube's Terms of
Service.** That is not a technicality to route around; it is a constraint on how
this feature may be presented.

Consequences, all binding:

- **This never appears in the Module 2 tutorial**, in course material, in
  marketing copy, or in a screenshot of the Studio used to sell it. The tutorial
  teaches direct audio URLs, podcast feeds and file uploads — all unambiguously
  fine.
- **It is best-effort, and labelled as such in the interface.** No SLA, no
  promise, no "supported input" badge. A teacher who relies on it for a lesson
  tomorrow has been mis-sold.
- **Consider gating it** — a per-user flag, or participants-only — so it is
  something a teacher discovers rather than something the product advertises.
- The **captions path is on materially better footing** than the audio path
  (still not the official Data API, but no media is downloaded). If a
  conservative reading of the ToS is preferred, **ship §4 only and leave
  `/extract` unbuilt.** That is a legitimate and defensible outcome of this plan,
  and it is the option I would put first.
- Note that the `youtube_not_yet_supported` state Slice 1 already ships is a
  perfectly good permanent answer. "Not available" is honest; over-promising is
  not.

---

## 6. Dockerfile

Not in the repo — copy it into `containers/youtube-ingest/` when this slice is
actually scheduled.

```dockerfile
# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# TeachInspire — YouTube ingest sidecar for the Transcription Studio.
#
# Does exactly two things (see docs/plans/transcription-slice-2-youtube.md §3):
#   POST /captions  → metadata + caption cues, no media download
#   POST /extract   → bestaudio → 16 kHz mono Opus → PUT to a presigned R2 URL
#
# NOT a general-purpose downloader. Reachable only through the Worker's
# container binding, never from the internet, and every request must carry
# INGEST_SHARED_SECRET.
# ---------------------------------------------------------------------------

FROM python:3.13-slim-bookworm

# ffmpeg is the only system dependency: yt-dlp shells out to it for the
# downmix/transcode. --no-install-recommends keeps the image near ~180 MB, which
# matters because a container that scales to zero pays that size on every cold
# start.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# PIN THE EXACT VERSION. See §5.2: an unpinned yt-dlp means a rebuild can change
# behaviour with no commit, and YouTube breaks it roughly monthly anyway. Bump
# this line deliberately, once a month, as its own reviewed change — and keep
# /health reporting it so a stale image is visible from outside.
ARG YTDLP_VERSION=2026.08.04
RUN pip install --no-cache-dir \
      "yt-dlp==${YTDLP_VERSION}" \
      "fastapi==0.120.4" \
      "uvicorn[standard]==0.40.0" \
      "httpx==0.29.2"
ENV YTDLP_VERSION=${YTDLP_VERSION}

# Non-root, and a writable scratch dir that is wiped after every request.
# Nothing here is ever persisted: the audio's only home is R2.
RUN useradd --create-home --shell /usr/sbin/nologin ingest \
 && mkdir -p /scratch \
 && chown ingest:ingest /scratch
ENV TMPDIR=/scratch \
    HOME=/home/ingest \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app
COPY --chown=ingest:ingest app/ /app/
USER ingest

EXPOSE 8080

# One worker per container instance, on purpose. A yt-dlp run is IO-bound but
# ffmpeg is not, and two concurrent transcodes in one small instance make both
# slow enough to hit the Worker's 10-minute deadline. Concurrency is the
# platform's job (more instances), not this process's.
#
# --timeout-keep-alive is short: the Worker makes one request and leaves.
CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", "--port", "8080", \
     "--workers", "1", \
     "--timeout-keep-alive", "5"]

HEALTHCHECK --interval=60s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import httpx,sys; sys.exit(0 if httpx.get('http://127.0.0.1:8080/health', timeout=4).status_code==200 else 1)"
```

---

## 7. Work breakdown

Ordered so the valuable, low-risk half ships first and can ship *alone*.

| # | Work | Notes |
| --- | --- | --- |
| 0 | Count the demand (§1). | Decide whether to proceed at all. |
| 1 | `worker/lib/transcription/youtube-captions.ts` — pure cue → `NormalisedTranscript` normaliser + unit tests against fixture cues. | No container needed. Testable today. |
| 2 | Migration 0018: widen the two `provider` CHECKs for `'youtube_captions'`. Append to `db:migrate` — it is a hand-written `&&` chain. | Slice 1's cap: forgetting the append breaks local dev. |
| 3 | `YouTubeResolution` union + the one new branch in `processTranscriptionJob`. | Zero-second charge path. |
| 4 | The three new failure codes + fr/en/es copy. **All three files** — `es.json` reached parity in Slice 1; do not regress it. | `worker/lib/i18n-fr-lint.test.ts` enforces accents. |
| 5 | Container: `/health` + `/captions` only. Deploy. Add container config to `wrangler.jsonc` **here**, not before. | **Shippable milestone: captions-only YouTube.** |
| 6 | Canary + stale-`yt-dlp` alert (§5.2). | Before `/extract`, not after. |
| 7 | Container `/extract` + presigned R2 PUT + `resolveYouTube` media path. | The ToS-heavier half. Gate it (§5.3). |
| 8 | Instrument the block rate; revisit whether step 7 earns its keep. | `GROUP BY error_code`. |

Steps 1–6 are defensible, useful, and stop cleanly. **Step 7 is optional and
should stay optional.**
