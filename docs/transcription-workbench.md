# Transcription Studio — Slices 1 + 2 (Wave 2)

**Status:** built, typechecked, 639 tests green, and — new in Wave 2 — **run
against the real Groq and Deepgram APIs with real French audio**. Accuracy and
diarization are no longer guesses; §8 records what was measured, including one
defect the live run found that no fixture test could.

**Not ready to put in front of a teacher yet.** One blocking defect stands
between here and that, and it is named at the top of §8.1.

**Date:** 2026-08-09 · **Branch:** `claude/speech-to-text-url-transcribe-d30da5` ·
**Migrations:** `0017_transcription_studio.sql`,
`0018a_transcription_retention_columns.sql`, `0018_transcription_retention.sql`

---

## 0. What Greg still needs to do

Five things need a human. Nothing in this list can be done from the code.

### 0.1 Add an R2 lifecycle rule for uploaded audio *(Cloudflare dashboard, 2 min)*

When a teacher uploads a file instead of pasting a link, that file is stored in
our R2 bucket. The nightly cleanup already deletes those files, but a lifecycle
rule is the belt-and-braces version: it removes them even if our code never runs.

> Cloudflare dashboard → **R2** → bucket **`teachinspire-media`** → **Settings**
> → **Object lifecycle rules** → *Add rule*
> · Prefix: **`transcription/uploads/`**
> · Delete objects **8 days** after upload.

**8, not 7, on purpose.** Our own cleanup owns day 7. If the bucket rule fired on
the same day it could delete a file a second before our code went looking for it,
and the cleanup would log an error every night for no reason. One day of slack
makes the bucket rule the backstop it is meant to be.

This is exactly what the Audio Studio already relies on for its mp3s.

### 0.2 Put the three API keys into production *(terminal, 2 min)*

The keys are in `.dev.vars` on this machine, which only covers local development.
Production reads them from Cloudflare's own secret store, and they are not there
yet. Run these three, pasting each value when prompted:

```bash
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put DEEPGRAM_API_KEY
npx wrangler secret put ASSEMBLYAI_API_KEY
npx wrangler secret list   # confirms the names landed; values are never readable
```

Until this is done, the live site answers every transcription with *"le service de
transcription n'est pas joignable en ce moment"* — honestly, but uselessly.

**The AssemblyAI key is shared with your `video-use` tooling.** It is the same
account, so the 185 free hours are one pot drawn on by both the Studio and
anything you transcribe from the command line. If the Studio ever reports that
tier as exhausted and you did not expect it, check what `video-use` has been
doing before assuming a bug.

### 0.3 Try the Groq Developer upgrade again *(Groq console, 1 min, worth repeating)*

Groq's paid tier was unavailable when this was built ("high demand"). We are on
the free tier, which is **8 hours of audio per day, refilled daily** — generous,
but it is a ceiling that a live training session with twenty teachers can hit
inside two minutes. The code handles that gracefully (it moves to the next
provider, nobody sees an error), but the free path is the cheap one and we would
rather stay on it.

> Groq console → **Settings → Billing → Upgrade to Developer**.

If it goes through, tell the engineer: two numbers in
`worker/lib/transcription-budget.ts` change, and the upload ceiling for that
provider goes from 25 MB to 100 MB.

### 0.4 Apply the three migrations to the live database *(terminal, 1 min)*

The local database has them; the production one does not. Without this the
Transcription Studio pages load and every submission fails.

```bash
npx wrangler d1 execute promptomatik-db --remote --file=./migrations/0017_transcription_studio.sql
npx wrangler d1 execute promptomatik-db --remote --file=./migrations/0018a_transcription_retention_columns.sql
npx wrangler d1 execute promptomatik-db --remote --file=./migrations/0018_transcription_retention.sql
```

**Run them in that order** — `0018a` before `0018`, even though the names sort the
other way. The reason is written at the top of `0018a`. If `0018a` complains about
a duplicate column, that is expected on a second run and it is safe to continue.

### 0.5 Make one product decision: punctuation vs. complete words

The live Groq run found that Groq returns the same transcript twice, in two
different fields, and the two disagree (full detail in §8.1). One is punctuated
but drops accented words; the other is complete but has almost no punctuation. We
currently use the punctuated-and-broken one for the `.txt` download and the
on-screen reader.

Neither option is free, so this is your call, not the engineer's:

- **Complete words, light punctuation.** A teacher gets every word, and adds their
  own commas. Recommended — a missing comma is an edit, a missing word is a
  mistake they may not notice.
- **Keep punctuation, keep the holes.** Not recommended: a teacher opening the
  `.txt` today reads *"je vais vous l dans quelques instants"*.
- **Both, from one job.** Possible later, and more work than it sounds.

---

## 1. What shipped

A teacher pastes a link or uploads a file and gets back a timestamped,
optionally speaker-labelled transcript they can read, search, copy and download —
inside the Studio, beside the Audio Studio, sharing nothing with it.

| Surface | Where |
| --- | --- |
| Workshop page (`/transcribe`) | `src/pages/transcribe.tsx` |
| Library (`/transcribe/library`) | `src/pages/transcribe-library.tsx` |
| Reading experience | `src/components/transcription/transcript-view.tsx` |
| API (`/api/transcriptions/*`) | `worker/routes/transcriptions.ts` |
| Contract (types, errors, constants) | `worker/lib/transcription/types.ts` |
| Provider cascade | `worker/lib/transcription/index.ts` |
| Providers | `worker/lib/transcription/{groq,deepgram,assemblyai}.ts` |
| Groq free-tier budget + breaker | `worker/lib/transcription-budget.ts` |
| Ingest (classify + resolve) | `worker/lib/transcription-ingest.ts` |
| Job lifecycle + queue consumer | `worker/lib/transcription-jobs.ts` |
| Hours ledger | `worker/lib/transcription-quota.ts` |
| 7-day retention + purge | `worker/lib/transcription-retention.ts` |
| Downloads (txt/srt/vtt/json) | `worker/lib/transcription-download.ts` |
| Duration sniffing | `worker/lib/transcription-duration.ts` |
| Client-side display + pre-flight limits | `src/lib/transcription-display.ts` |

### Reachability, checked end to end this pass

Every link in the chain, verified in the tree rather than assumed:

| Link | Where | State |
| --- | --- | --- |
| `/transcribe`, `/transcribe/library` | `src/App.tsx` | Both inside `<ProtectedRoute>` |
| Nav entry | `src/components/layout/shell.tsx` | `AudioLines` icon, `locked` for non-participants |
| Breadcrumb + wide workspace | `shell.tsx` `getPageContext` | Own section, `mainWide` like the Audio Studio |
| API prefix | `worker/index.ts` | `app.route("/api/transcriptions", …)` — **one** prefix, no alias |
| Queue producer | `transcription-jobs.ts:440` | `env.TRANSCRIPTION_JOBS_QUEUE.send(...)` |
| Queue binding | `wrangler.jsonc` + `worker/env.ts` | Producer **and** consumer declared |
| Queue consumer | `worker/index.ts` `queue()` | Dispatches `transcription-jobs` → `handleTranscriptionJobBatch` |
| Cron trigger | `wrangler.jsonc` | `"crons": ["40 3 * * *"]` |
| Cron handler | `worker/index.ts` | `scheduled()` exported, **awaited**, calls `runTranscriptionRetentionSweep` |
| Migrations | `package.json` → `db:migrate` | `0017` → `0018a` → `0018`, in that order |
| Demo fixture excluded from the bundle | `dist/` | `grep -rl "Claire Fontaine" dist/` → nothing |

### Inputs accepted

- **Direct audio URL** — anything whose path ends in a container we accept
  (`mp3 m4a m4b mp4 wav flac ogg oga opus webm aac mpga`).
- **Podcast RSS / Atom feed** — parsed for `<enclosure>`, Atom
  `<link rel="enclosure">`, then `<media:content>`.
- **Podcast episode page** — `og:audio` / player stream / `<audio>`, else the
  page's own feed link.
- **Apple Podcasts link** — resolved through the official iTunes Lookup API
  (`?i=<episodeId>` picks the exact episode).
- **File upload** — up to `TRANSCRIPTION_MAX_UPLOAD_BYTES` (64 MB, decimal),
  streamed into R2.

When a feed resolves, the teacher gets an **episode picker**
(`POST /api/transcriptions/episodes`) rather than us silently transcribing
whatever is newest. If our own parsing fails, the page falls through to a normal
submission and lets the resolver try — our parser is never the reason a teacher
is blocked.

### Deliberately refused, with its own sentence

| Input | Code | HTTP | What the teacher reads |
| --- | --- | --- | --- |
| YouTube | `youtube_not_yet_supported` | **501** | permanent — copy teaches the workaround (podcast link or upload) |
| Spotify | `spotify_not_supported` | **501** | closed platform, politely out of scope |
| Over 90 min | `source_too_long` | 413 | names the real length and the real cap |
| Over 64 MB | `source_too_large` | 413 | names the real size and the real ceiling |
| Live stream / chunked | `unsupported_source` | 400 | nothing to bound, so nothing to promise |

YouTube is classified **before** the SSRF verdict, precisely so a teacher pasting
a YouTube link never sees a generic "unsupported link" message.

### What did NOT ship

- **YouTube ingest.** BUILT 2026-08-10 (closed that morning, reopened on Greg's decision the same day). A host-agnostic yt-dlp sidecar (`containers/youtube-ingest/`, deploy via Fly remote build — no local Docker) extracts 16 kHz mono Opus; the Worker (`transcription-youtube.ts`) streams it into R2 and the normal cascade takes over, diarization included. NOT ACTIVE until `YOUTUBE_INGEST_URL`/`YOUTUBE_INGEST_SECRET` are set — until then a YouTube POST gets an instant honest 501. Activation + monthly yt-dlp bump: `containers/youtube-ingest/README.md`. ToS: stays best-effort and out of the Module 2 tutorial.
- **A purchase path for extra hours.** There is no transcription credit-balance
  table. A positive `admin_adjust` ledger row is the only way to hand time back.
- **`api_cost_usd` on the job row.** Deliberately absent, unlike `audio_jobs`:
  there is no admin cost report to read it and no verified per-second rate table
  to write it. A column populated from a guessed rate reads as an audit trail
  while being a guess. `billed_seconds` is the honest input.
- **A scheduled sweeper** for jobs abandoned by an evicted isolate. Handled where
  it does harm instead: after `TRANSCRIPTION_STALE_JOB_MINUTES` (15) such a row
  stops counting against the allowance and the next delivery may re-claim it.
- **Applying teacher-typed speaker names to downloads.** They are unsaved view
  state; a download using a half-typed name is worse than canonical numbering.
- **Converting the Audio Studio's quota ring** to the shared `Allowance`
  primitive. This feature changed no audio behaviour on purpose.

### Status vocabulary is five wide, not four

`queued → resolving → transcribing → completed | failed`

Resolving a podcast feed and transcribing are visibly different waits, so each
gets its own sentence (`transcription.status_*` and `status_hint_*`, all three
languages).

### Errors are objects, never strings

Every failure response carries `{ error, code, failure }` where `failure` is a
`TranscriptionFailure` with its numbers intact, so the UI can say *"cet épisode
fait 2 h 14 — la limite est de 90 minutes"* instead of something generic. The
`detail` field (`"blocked_host"`, a truncated provider sentence) is stripped by
`publicTranscriptionFailure` on every path out of the Worker: it is operator
information and never reaches a browser. `error_message` on the row keeps the raw
text for support and is not part of any response.

---

## 2. Provider routing — the three-tier cascade

Slice 1 had one rule and no fallback. Wave 2 replaced it with a cascade, because
the free tier we depend on has a ceiling a classroom can hit in two minutes.

```
                     tier 1              tier 2        tier 3
  plain transcript   Groq (free)         Deepgram      AssemblyAI
  speaker labels     Deepgram            AssemblyAI    never Groq
```

Groq is absent from the diarized lane **by construction** — `laneOrder()` never
puts it in the list — rather than by a filter that someone could forget. On top
of that, `assertCanDiarize` re-checks the constructed provider's own
`capabilities.diarization` flag before a single byte is sent, so a provider that
loses diarization tomorrow is caught by the same line.

**Whisper has no diarization of any kind.** Not weak diarization — none.
`capabilities.diarization` is `false` for Groq, every `TranscriptWord.speaker` is
`null`, `speakers` is empty, `speakerCount` is `null`. `diarizeRequested` (intent)
and `diarization` (reality) are separate fields on the job response so the UI can
explain the difference.

Whisper also reports **no per-word confidence**. Its only probability signal is
`avg_logprob`, which is per *segment*. Stamping that one number onto every word
would make it look per-word, and the reader thresholds per word to flag "worth a
second listen" — so a broadcast value flips a whole segment from 0 flagged to ALL
flagged around `avg_logprob ≈ -0.511`, while Whisper itself treats values down to
-1.0 as fine. Deepgram and AssemblyAI both report genuine per-word confidence, so
broadcasting would additionally miscalibrate three providers against one shared
threshold. We report `null` and drop `avg_logprob`.

### The four conditions that skip Groq entirely

No round trip, straight to tier 2. In the order they are evaluated:

| # | Condition | Reason persisted on the row | Cost to check |
| --- | --- | --- | --- |
| a | The job asked for speaker labels | `diarization_required` | free — Groq is not in the lane |
| b | Source is over Groq's free-tier **25 MB** file ceiling | `groq_over_free_tier_file_limit` | free — a number we already hold |
| c | `hasGroqCapacityFor` says it will not fit the remaining hourly/daily audio-seconds | `groq_out_of_capacity` | one KV read |
| d | `isGroqBreakerOpen` — someone just took a 429 | `groq_breaker_open` | one KV read (taken together with c) |

(b) is checked **before** the KV reads on purpose: a file we already know Groq
will refuse with a 413 does not deserve two round trips to find that out. Most
podcast episodes are over 25 MB, so before this check the common case paid a
submit, a full download by Groq, and a 413.

### Which failures earn another tier, and which are terminal

| Failure from tier N | Next tier? | Why |
| --- | --- | --- |
| `provider_unavailable` (no key, 401, 429, any 5xx) | **yes** | about the provider, not the media |
| `provider_failed` (unusable answer) | **yes** | same |
| `source_too_large` **from Groq**, at Groq's own 25 MB | **yes** | that ceiling is Groq's, not ours; the other two have none |
| `source_too_large` at our own 64 MB | no | three providers refusing the same file costs three waits |
| `source_too_long`, `source_unreachable`, `unsupported_media_type`, `no_audio_found` | no | about the media; the answer will not change |
| `quota_exceeded` | no | about the teacher's month |

**A Groq 429 moves tier immediately, inside the same call** — deliberately not via
the queue's retry ladder. A retry a few seconds later hits the same exhausted free
tier and fails again, three times, and the teacher watches a 90-minute
transcription die for a reason that had a working answer one tier down. The 429
also opens the breaker, so the nineteen jobs behind it skip Groq without each
paying a 429 of their own.

**An unconfigured tier is dropped from the plan**, not tried and failed. If that
empties the plan, the job fails with `provider_unavailable` — the warm "not
reachable right now" sentence — rather than crashing or, worse, silently returning
an unlabelled transcript to someone who asked for speakers.

**Nothing about a fallback is silent.** `provider` (who ran) and
`provider_choice_reason` (why) are columns on the row, and `withAttempt` stamps the
tier onto the error on the way out, so even a job that burned a Groq 429 and then
a Deepgram 500 is as auditable as a completed one.

### Cost

| Provider | Model | USD / audio-hour | Diarization | File ceiling |
| --- | --- | --- | --- | --- |
| Groq | `whisper-large-v3-turbo` | **0.04** | none, ever | 25 MB (free tier) |
| Deepgram | `nova-3` multilingual | **0.31** | included | none |
| AssemblyAI | `universal-3.5-pro` | free while hours last | included | none |

Deepgram is **7.75× Groq per hour**, which is the entire reason the speaker
question is asked explicitly on the form instead of being on by default.
`diarize` and `smart_format` are *included* in Deepgram's per-minute price —
there is no reason to ever call nova-3 without them.

`universal-3.5-pro` rather than a cheaper AssemblyAI tier because **our allowance
there is denominated in HOURS, not dollars**: an hour of audio costs one hour of
allowance on every model they offer, so the better model is free-equivalent, and
it is the one with the strongest French diarization and native code-switching.

### The free-capacity picture

| Source | Size | Shape | Which lane draws on it |
| --- | --- | --- | --- |
| **Groq free tier** | **8 audio-hours per day**, refilled daily (and 2 audio-hours per rolling hour) | recurring | the default, non-diarized path |
| **Deepgram credit** | **USD 200 ≈ 641 hours** at the multilingual rate | one-time, drains | the "identify speakers" path |
| **AssemblyAI** | **185 hours** | one-time, drains | tier-3 backstop for both lanes |

Two things to hold about that table:

1. **The Groq row is the only recurring one.** The other two are buckets that
   empty. Keeping the default path on Groq is what makes the recurring row do the
   work, which is why the budget tracker exists at all.
2. **The AssemblyAI 185 hours are SHARED with Greg's `video-use` tooling**, which
   authenticates with the same key. Anything transcribed from the command line
   comes out of the Studio's backstop. This is not visible from inside the app.

### Per-channel billing — pinned to one channel on every tier

A provider that bills per channel bills twice for a stereo podcast.

- **Groq** downsamples to 16 kHz **mono server-side** before inference. No channel
  parameter, no multiplier. Nothing to do.
- **Deepgram** sends `multichannel=false` **explicitly** — not by omission —
  because the account default can be flipped in the Deepgram console, and
  `multichannel=true` transcribes *and bills* every channel. We only ever read
  `results.channels[0]` and log a warning if the response reports more than one.
  `diarize=true` requires multichannel off regardless.
- **AssemblyAI** bills per audio-hour of the source, not per channel, and
  multichannel is never requested.

Consequence: `TranscriptMetadata.channels` is **always 1**, on all three.
**Verified live** on four Deepgram responses, including stereo-sourced mp3s — see
§8.2.

Groq also applies a **10-second minimum per request**. `durationSeconds` stays the
true measured length (a teacher must never see an inflated duration);
`groqBilledSeconds()` is the one place that rounding rule lives, and
`groqRateLimitSeconds()` in the budget module now delegates to it rather than
spelling the arithmetic out a second time.

---

## 3. Quota — why STT is NOT pooled with TTS

**10 transcription hours per user per month (36 000 s), in its own ledger.**

| | TTS (existing) | Transcription |
| --- | --- | --- |
| KV counter | `audioq:<userId>:<YYYY-MM>` | **`transq:<userId>:<YYYY-MM>`** |
| D1 ledger | `quota_ledger` | **`transcription_quota_ledger`** |
| Purchased credits | `credit_balances` | **none** |

`transcription-quota.ts` is a deliberate near-twin of `audio-quota.ts` that shares
**nothing** with it. The reason is pricing, not tidiness: **Gemini TTS costs
roughly 5–15× more per minute than Groq/Deepgram speech-to-text.** A single pooled
counter has to pick one price, so it would either give away TTS minutes or bill
transcription hours at synthesis rates. Both are wrong. If someone arrives to
"simplify" by unifying them, that is the paragraph to re-read.

### Where the truth lives

The **ledger is authoritative** — one negative row per spend, positive rows for
refunds and admin grants. The KV counter is a *derived cache* so the hot read (the
page polls it while a job runs) is one KV get.

The cache is **display only**. `precheckTranscriptionQuota` — the single gate
before a paid provider call — recomputes from the ledger, because a counter that
is missing (a KV write that never landed) or stale (KV is eventually consistent,
~60 s) reads as *zero seconds used*, i.e. a whole fresh 10-hour allowance.

Every charge **rebuilds** the counter from the ledger rather than incrementing it.
That buys idempotency (the ledger insert is guarded by `WHERE NOT EXISTS`, so a
queue retry charges nothing twice), no silent consumption (the durable atomic step
is the audit row), and self-healing (a drifted counter is corrected by the next
charge, because the counter is always *set*, never nudged).

### The gate is two halves, and the second one is the real one

`precheckTranscriptionQuota` reads, and reads cannot gate concurrency: ten
simultaneous submissions all observe the same untouched allowance, all pass, all
insert. So admission is decided by `buildTranscriptionAdmissionGate`, whose
predicate is evaluated **inside the job-row INSERT** — one SQLite statement
re-counts this user's in-flight seconds and inserts only if they still fit. The
loser of a race inserts nothing, `changes` is 0, and the caller reports
`quota_exceeded`. The precheck stays because it produces the specific, *numbered*
refusal a teacher reads; it is no longer what keeps us solvent.

The gate also subtracts hours **committed but not yet charged** — jobs still
`queued`/`resolving`/`transcribing` — because the spend row is only written once a
transcript exists. Without that, burst-submitting three 90-minute podcasts with
thirty minutes left passes all three checks and we pay for 4 h 30.

### Three ordering decisions worth knowing

1. **Unknown duration is gated as the 90-minute cap.** A teacher with four
   minutes left cannot start a long job and discover the problem after we paid
   the provider.
2. **Billing uses `transcript.metadata.durationSeconds`** — what the provider
   measured and charged us for. It is the only number defensible to a teacher.
3. **The charge runs AFTER the transcript is persisted**, and `markFailed`
   carries `AND status != 'completed'` so a failing charge cannot flip a row that
   already holds the teacher's transcript into `failed` and hide it. **A
   bookkeeping glitch costs us money, never their work.**

`source_too_long` (413) and `quota_exceeded` (402) are deliberately different in
kind: the first is a property of the media (buying nothing and waiting for next
month both fail to fix it — split or trim the file), the second resets on
`monthResetsOn`.

Deleting a transcript is **storage cleanup, never a refund**: the ledger's
`job_id` FK is `ON DELETE SET NULL`, so the spend row outlives the job it paid
for.

### The Groq free-tier budget is a separate, GLOBAL counter

Do not confuse it with the per-user quota above. The teacher's 10 hours are a
product promise; Groq's 7 200 s/hour and 28 800 s/day are a **global** ceiling on
one API key, so `transcription-budget.ts` keys its state on `groqcap:v1` and
`groqbrk:v1` with no user id in sight. A per-user version of it would let twenty
teachers each believe they own the whole free hour — the exact scenario it exists
to prevent.

Three pieces, and only one of them is a guarantee:

1. `recordGroqUsage` — book what every Groq response cost. *Advisory.*
2. `hasGroqCapacityFor` — pre-flight skip. *Advisory.*
3. `openGroqBreaker` / `isGroqBreakerOpen` — **the guarantee.** Whoever takes the
   429 writes "paused until *t*"; everyone after that routes away without touching
   Groq. That is what turns "20 teachers, 20 cold 429s" into "one job pays a 429,
   nineteen route instantly".

1 and 2 are advisory because KV has no compare-and-swap: two isolates can read the
same healthy number and both spend it. The module takes the conservative side of
every race — a header reading may only ever take capacity *away*, never hand it
back — and the breaker absorbs what is left.

---

## 4. Retention — 7 days, and why it needed a cron

`TRANSCRIPTION_RETENTION_DAYS = 7`, the same window the Audio Studio gives an mp3.

### It is a privacy decision before it is a storage one

A transcript of a lesson is a **record of the people in the room** — the teacher's
learners, by name, saying whatever they said. Keeping every one of those forever
is a promise we should not make on a teacher's behalf. The teacher's own copy is
one download away, and the interface says so from the moment the transcript
appears (`retention_notice`, and a `retention_nudge_urgent` as the deadline
approaches). "Download the text — it is yours" is the whole framing.

### Why a cron, when the Audio Studio needs none

The Audio Studio's mp3s expire with **no code at all**: they are bytes in R2, and
a bucket lifecycle rule configured in the dashboard removes them. `expiresAtIso()`
in `audio-jobs.ts` only *stamps* the date so the interface can count down.

That works for bytes in a bucket. **A transcript is TEXT in a D1 column, and no
bucket lifecycle rule can reach a D1 row.** There is no equivalent knob. So this
feature ships the deletion the audio path gets for free.

### Two enforcement points, both required

| | What it does | Why it alone is not enough |
| --- | --- | --- |
| `purgeExpiredTranscriptions` (daily cron, 03:40 UTC) | Actually frees storage: `result_payload` out of D1, the uploaded source out of R2 | A cron runs once a day; a transcript expires at a precise timestamp. Up to 24 h of "still there" |
| `isTranscriptExpired` (every read) | The API behaves as if the text were already gone | Frees nothing. Retention that only hides is not retention |

**The row survives a purge.** Title, duration, provider, status and the ledger stay
— exactly as an expired audio take keeps its row after R2 removed its files — so
the library can say "this existed, it expired" instead of silently losing an entry
the teacher remembers making.

**Two ways a row qualifies, and the second is not optional.** (1) `expires_at` has
passed — that column is stamped only in the completion UPDATE, so this branch only
ever sees jobs that *finished*. (2) The row still names an uploaded object and was
created more than 7 days ago — a job that **failed** never reaches the completion
UPDATE, never gets an `expires_at`, and without this branch that teacher's
recording of their learners would sit in R2 forever.

Sizing, and why: `TRANSCRIPTION_PURGE_BATCH_SIZE = 90` because **D1 allows 100
bound parameters per query** and the purge binds one per row — a batch of 200 threw
`too many SQL variables` the moment 100 transcripts expired on the same day.
`MAX_BATCHES = 60` keeps the rows-per-day ceiling at 5 400, unchanged when the
batch size came down.

The 03:40 UTC choice: outside every teaching timezone we serve, and offset off the
hour so we are not queueing behind everyone else's midnight jobs. The exact minute
does not matter, because reads enforce expiry on their own.

---

## 5. SSRF defences

`transcription-ingest.ts` is the **only** place a teacher-supplied URL is fetched
by our Worker, and every fetch in it goes through `assertSafeUrl`.

- **http/https only** — no `file:`, `data:`, `gopher:`, `ftp:`, `blob:`,
  `javascript:`.
- **No credentials in the URL.** `http://user:pass@host` is refused outright: it
  is never a legitimate podcast link and it is a classic filter bypass.
- **Ports 80/443 only.** An internal Redis/Elasticsearch/admin port is never a
  podcast enclosure.
- **IPv4 default-deny of everything non-public**: `0.0.0.0/8`, `10/8`, `127/8`,
  CGNAT `100.64/10`, link-local `169.254/16` (**including cloud metadata**),
  `172.16/12`, `192.168/16`, `192.0.0/24`, TEST-NET-1/2/3, benchmarking
  `198.18/15`, 6to4 relay anycast `192.88.99/24` (RFC 7526), and everything
  `>= 224` (multicast, reserved, broadcast).
- **Numeric-last-label hostnames refused as a class.** `2130706433`,
  `0x7f000001`, `127.1` — decimal/octal/hex/short-form IP literals are the other
  classic bypass, so a hostname whose last label is numeric or hex must parse as
  a *public dotted quad* or it is refused.
- **IPv6 default-deny**: only global unicast `2000::/3` is allowed, which refuses
  `::1`, `::`, `fc00::/7`, `fe80::/10`, `ff00::/8` and `::ffff:`-mapped IPv4 in a
  single rule. Three prefixes are then carved back **out** of that allowance
  because they wear a globally-routable-looking prefix over something else:
  `2002::/16` (6to4 — `[2002:7f00:1::]` *is* 127.0.0.1), `2001:0::/32` (Teredo),
  `2001:db8::/32` (documentation, RFC 3849).
- **Blocked names**: `localhost`, `*.localhost`, `*.local`, `*.internal`,
  `*.home.arpa`, `*.localdomain`, plus `metadata`,
  `metadata.google.internal`, `metadata.goog`, `instance-data`,
  `instance-data.ec2.internal`.
- **Every redirect hop is re-validated.** The whole attack is a public host
  answering `302` with `Location: http://169.254.169.254/…`, so the runtime's
  automatic redirect follower is never used: `redirect: "manual"`, `assertSafeUrl`
  on each hop, `MAX_REDIRECTS = 4`.
- **One `AbortSignal` for the whole chain**, not one per hop — otherwise five
  cooperating redirects could hold a queue consumer for five times the stated
  budget.
- **Untrusted content is re-validated too.** An enclosure URL out of a feed, a
  `feedUrl` out of the iTunes API and an `og:audio` out of a page are all just as
  attacker-controlled as the pasted input, and all go back through
  `assertSafeUrl`.
- **Every document is capped in bytes and wall-clock**: 4 MB feeds, 2 MB pages,
  300 feed items, 256 kB media head, 8–10 s timeouts. A hostile "feed" can be
  endless; `readCappedText` cancels the reader rather than trusting
  `content-length`.
- **`/episodes` is rate-limited** to 10 lookups per minute per user. Being
  outside the quota gate is not the same as being free: it is an authenticated
  primitive that makes our Worker fetch a third party on demand. `/inspect` is
  deliberately *not* limited — `classifySource` is pure and performs no I/O, so a
  KV counter would add a write to something that currently costs nothing.

### Related non-SSRF defences in the same file

- **Duration is enforced before any provider call**, for every source, with no
  "we'll find out when the bill arrives" path: `<itunes:duration>` first, then the
  container header itself (a ranged GET of the first 256 kB, reading MP3
  Xing/CBR, MP4 `mvhd`, WAV `fmt `/`data`, FLAC STREAMINFO), then a byte-derived
  **lower bound** for containers whose head states no length (Ogg/Opus, WebM). A
  URL that declares no length at all is refused — there is nothing to bound.
- **Charsets are honoured, not assumed.** BOM → HTTP `Content-Type` → XML
  declaration / `<meta charset>`, with a hand-rolled windows-1252 table (workerd
  and Node disagree about the legacy tables). Self-hosted French publishers still
  serve ISO-8859-1, and a job titled "�pisode 42" in front of the audience that
  reads French first is not acceptable.
- **Ownership is scoped SQL, never a handler check.** Every read and write carries
  `user_id = ?` in its `WHERE`. A foreign job is a **404, never a 403** — "this id
  exists but is not yours" leaks the existence of someone else's transcript.

---

## 6. The gauntlet — what the critics caught

> **Honesty note.** Rounds A–F are reconstructed, not observed: from the
> retrospective annotations the builders left in the code ("the failure mode was
> an OOM", "this was the one call that…") and from the places where the shipped
> code **diverges from the frozen contract** — each divergence is a review finding
> that won an argument. Treat the round letters as thematic grouping, not as a
> transcript. Round G is different: it records Wave 2, where four defects were
> caught by review and two more by **live API calls**, and those two are cited
> from the runs themselves in §8.

### Round A — money that could leak

| Caught | Fix |
| --- | --- |
| Concurrent submissions all passed one read-only precheck; ten parallel posts could bill 10 × 90 min against one untouched allowance. | The quota predicate moved **inside** the INSERT (`buildTranscriptionAdmissionGate`). Reservation and admission became one atomic statement. |
| A feed that *understates* its episode length got billed for the real thing. | The container header now outranks `<itunes:duration>`: if the bytes say six hours, we refuse whatever the feed claimed. |
| A single 750 kB/s byte ceiling only rejected past ~4 GB — it let a 100-hour 64 kbps file through as "provably fine". | Per-container plausible-bitrate lower bounds (`minimumDurationSeconds`), plus outright refusal of sources that declare no length. |
| An abandoned in-flight row subtracted its assumed 90 minutes from a teacher's month **forever**. | `TRANSCRIPTION_STALE_JOB_MINUTES = 15` — a *started* row gone quiet stops counting and may be re-claimed. A still-`queued` row is never aged out (a backed-up queue must keep counting, or the burst gets through by waiting). |
| At-least-once queue delivery could re-submit and re-bill the same media. | `claimTranscriptionJob`: a single conditional UPDATE decides ownership, so `changes = 0` means "not mine". Completed and freshly-live rows are unclaimable. |
| A `provider_unavailable` blip (429/401/5xx) terminally killed a 90-minute job. | That one code is **rethrown** so the queue's retry ladder is used; everything teacher-caused is swallowed into a `failed` row instead of failing three times (and, for anything that reached a provider, billing three times). |

### Round B — memory and the isolate

| Caught | Fix |
| --- | --- |
| A 100 MB upload was read into an `ArrayBuffer` and then wrapped in a `Blob` — two full copies in a 128 MB isolate. The failure mode was an OOM the job could not even record as failed. | `TranscriptionAudioSource` carries a **`Blob`**, handed straight to `FormData.set`/`fetch`, so the media exists in memory exactly once. `sizeBytes` comes from R2's own object size. |
| Even with one copy, 100 MB left 28 MB of headroom. | `TRANSCRIPTION_MAX_UPLOAD_BYTES` lowered from the contract's 100 MB to **64 MB** — a 90-minute mono lecture at ~95 kbps — with a specific translated refusal above it. |
| `formData()` parsed a 300 MB body before anything could reject it, turning a translated 413 into a bare 400. | `content-length` is checked **before** `formData()`, with envelope slack; `file.size` stays the authority. |

### Round C — security

| Caught | Fix |
| --- | --- |
| The iTunes lookup was the one fetch that used the runtime's own redirect follower and skipped `assertSafeUrl` on the hops. Not exploitable (hardcoded host) — but *an exception is how a guard stops being one*. | Routed through `guardedFetch` like everything else. |
| `AbortSignal.timeout` per hop let cooperating redirects multiply the budget. | One signal for the whole chain. |
| 6to4 / Teredo / documentation IPv6 wear a global-unicast prefix over an arbitrary IPv4. | Carved back out of the `2000::/3` allowance. |
| A page emitting a decoy `<meta name="audio">` above its canonical `og:audio:secure_url` won, because the scrape iterated the *document* first. | The outer loop is over the **priority list of names**, not the document. |
| A feed item's first media tag might be a cover image or a PDF transcript, killing an item whose real mp3 sat one tag later. | All candidates are weighed (`enclosureVerdict`), preferring declared-audio, then unknown, then nothing. |
| An R2 write of up to 64 MB is itself billed, so a teacher with no hours left could loop the upload endpoint for unbounded Class A writes. | The quota gate runs **before** `MEDIA.put`, and the object is deleted if job creation then loses a race. |
| `?limit=abc` → `Number("abc")` → NaN, which every `Math.min/max` propagates into `LIMIT ?`, where D1 raises a datatype mismatch that surfaces as a 500. | Query strings validated with zod `.catch()`, **and** re-clamped with `Number.isFinite` in the query helper — two locks on one door. |

### Round D — honesty toward the teacher

| Caught | Fix |
| --- | --- |
| Broadcasting Whisper's segment-level `avg_logprob` onto each word would have looked like per-word confidence and mis-flagged whole segments. | Report `null`. Drop `avg_logprob`. |
| Trusting item 1 of a feed transcribes a years-old episode on a chronological feed and spends the teacher's ledger on it. | `newestEpisode` decides by the **stated publication date**; document order is the fallback, used only when no item states a parseable date. |
| Resolving a feed silently picked "the newest" with no disclosure. | An **episode picker** (`/episodes`) — and the chosen episode's name lands on the job title either way. |
| A provider's raw English sentence, or an internal slug like `blocked_host`, could reach a French interface. | `publicTranscriptionFailure` strips `detail` on every exit path; `TranscriptionError`'s `message` **is** the code, so even an accidental `error.message` leak is machine-translatable. |
| A 4-status vocabulary made "reading your feed" and "transcribing" the same wait. | Five statuses, five sentences, in fr/en/es. |
| Native `type="url"` validation blocked submit with a bubble **in the browser's language**, so our warm translated message never ran. | The field is `type="text" inputMode="url"`; `/inspect` is the judge. |

### Round E — accessibility and interface craft

| Caught | Fix |
| --- | --- |
| The speaker choice used `<button aria-pressed>` cards, so the legend went unannounced and the single most consequential decision on the page read as two independent toggles. | Real radios inside a `<fieldset>`/`<legend>`. |
| A 50-episode picker gave every row the accessible name "Transcrire". | `episodes_choose_named` carries the title and still starts with the visible word (WCAG 2.5.3). |
| The rename pencil sat **inside** the truncating title, so a long title pushed it outside the clip box and it became untappable on a 375 px screen. | Pencil is a sibling of `.rowTitle`, never a child. |
| A failed rename announced at the top of the page while focus stayed in the field. | `aria-invalid` + `aria-describedby` wire the message to the input. |
| Search and controls scrolled away on a 90-minute transcript. | Sticky control bar, with the containing block deliberately in normal flow. |

### Round F — the first smoothing pass

| Caught | Fix |
| --- | --- |
| **The API was mounted at two public prefixes**, `/api/transcripts` and `/api/transcriptions`. Two names for one API is the exact incoherence a fresh reader trips on. | One prefix: **`/api/transcriptions`**. Module renamed, export renamed, 40-odd client and test paths rewritten. The download-link test now asserts the advertised href is the href the router answers on. |
| `summaryTitle` returned the hardcoded English word `"Transcription"` — a user-facing string outside i18n. | Returns `""`; the library renders `transcription.untitled_transcript`. |
| Comments still quoted **100 MB** as "our own ceiling" in five places after the ceiling became 64 MB. | All now name `TRANSCRIPTION_MAX_UPLOAD_BYTES` or the real number. |
| `listPodcastEpisodes` was documented "NOT YET EXPOSED" while `/episodes` shipped and the page used it. | Rewritten to describe the route, its rate limit and its fall-through. |
| `env.ts` said the router "returns `provider_unavailable`". It throws — and the difference decides whether the queue retries. | Corrected, with the retry consequence stated. |

### Round G — Wave 2

**Four defects proven by review, and fixed:**

| Caught | Fix |
| --- | --- |
| **The retention sweep reported success while deleting nothing.** It swallowed every error, returned a zeroed result, and ran under `ctx.waitUntil`, so Cloudflare recorded a clean invocation whatever happened — and the read-time expiry check hid the consequence, because the interface still showed correct countdowns. A sweep could have deleted nothing for months. | `runTranscriptionRetentionSweep` **rethrows**, and `scheduled` **awaits** it. A rejected handler is the only alert surface this feature has. Every run logs, including the quiet one: "nothing to purge" and "never ran" are different facts. |
| **D1's 100-bound-parameter limit.** The purge's `UPDATE … WHERE id IN (?, ?, …)` binds one parameter per row, so a batch of 200 threw `too many SQL variables` the moment 100 transcripts expired on the same day — swallowed, per the row above. | `TRANSCRIPTION_PURGE_BATCH_SIZE = 90`, with the reason written where the constant is, and `MAX_BATCHES` raised so the rows-per-day ceiling did not move. |
| **`npm run db:migrate` aborted at migration 0002 on any already-migrated database** — `ALTER TABLE … ADD COLUMN` has no `IF NOT EXISTS` in SQLite, and seven earlier migrations use it. The chain is `&&`-joined with no applied-migrations table, so the first non-zero exit **silently skipped everything after it**, including 0017 and 0018. The printed error named `is_active`, so it read as a fault in an old migration rather than "the whole tail was skipped". | Every link whose only expected replay failure is `duplicate column name` is joined with `{ … \|\| true; }`. The two new `ADD COLUMN`s were split into `0018a`, which runs **before** `0018` despite sorting after it; `0018`'s rebuild keeps its `&&` so a genuine failure still stops the chain. |
| **Per-speaker "speaking time" was the wall-clock span of each turn.** A segment only breaks after 90 words *and* a 0.4 s pause, so every shorter silence — a breath, a student answering off-mic — was billed to that speaker as speech. Two words 30 s apart read as 30 seconds spoken. | `buildSpeakers` sums each **word's own** duration. **Confirmed by the live run**: the old method overstated the guest in a real RFI interview by 12.2 s, or +9.5 % (§8.2). |

**Two defects proven by live API calls, and NOT yet fixed** — see §8.1 and §8.2.
Both were found by running the repo's own provider modules against the real APIs,
and neither is visible to any fixture test, because a fixture is written from the
documentation and the documentation is not what arrives.

**And what Wave 2 added:**

- **AssemblyAI `universal-3.5-pro` as tier 3** — the universal backstop, the only
  provider that can serve both lanes. Async (`submit` then poll), which is what
  the contract's two-step provider interface was kept for.
- **The Groq capacity tracker and circuit breaker** (`transcription-budget.ts`).
- **The three-tier failover cascade** (§2), replacing a router that threw.
- **7-day retention** with the daily purge cron (§4).
- **File-limit warnings and the limits explainer** (§7).

### Round H — the second smoothing pass (this one)

| Caught | Fix |
| --- | --- |
| **`TranscriptMetadata.provider` in the SPA was still two providers wide** (`"groq" \| "deepgram"`) while the Worker had been shipping `"assemblyai"` for a wave. The type was wrong about the wire, and the consequence was live: `ENGINE_KEYS` had no entry, the lookup fell through, and the "Moteur" row printed the raw model id **`universal-3.5-pro`** to a teacher — in a component whose own comment says "a teacher never needs to read `whisper-large-v3-turbo`". | Union widened to three. `ENGINE_KEYS` is keyed by the union itself, so a fourth provider is now a **type error** rather than a silent fall-through. New key `transcription.engine_versatile` (fr/en/es) — AssemblyAI serves both lanes, so it is neither "the fast one" nor "the speakers one" and borrowing either label would be false half the time. |
| `worker/env.ts` and the contract header in `types.ts` still documented **`getProvider`**, deleted in Wave 2 — and `types.ts` documented it under "implement these VERBATIM". A frozen contract that names a function nobody can call sends the next reader to build the wrong thing. | Both rewritten to the real surface: `selectTranscriptionProvider` (the pure tier-1 rule) and `runTranscription` (the cascade), with a line recording why `getProvider` went. |
| `groqRateLimitSeconds` re-implemented `groqBilledSeconds` — the same `max(10, ceil(x))`, in a second file, with the provider's own per-request minimum imported to do it. Two copies of one rounding rule is how they come to disagree about a 0.4-second clip. | `groqRateLimitSeconds` now **delegates**, and is the substitution rule only. As a side effect a non-finite `fallback` now returns the 10-second minimum instead of `NaN`. |
| `GROQ_DEV_TIER_MAX_UPLOAD_BYTES` was exported and read by nothing — not by the router, not by a test. An exported constant with no caller reads as a supported configuration. | Deleted. The dev-tier figure stays in the header comment, where a fact we cannot yet reach belongs. |
| The **contract header still said "both providers"** in four places, and `TranscriptionCapabilities.diarization` was documented "Groq: false. Deepgram: true." AssemblyAI is neither. | All four corrected, including a per-channel-billing paragraph for AssemblyAI (bills per audio-hour, multichannel never requested, `channels: 1` like the others). |
| The budget module's header asserted Groq "returns its limiter state on EVERY response" and named the audio-seconds headers as the primary signal. **The live run measured otherwise**: eight responses, only request-count headers, no audio-seconds header at all. The comment was optimistic about the exact mechanism the module's safety depends on. | Header records the measurement and its consequence: on this account the local counters are not a backstop, they are the whole pre-flight guarantee. The parser stays — it costs one map lookup and the fallbacks are sized for exactly this null. |
| `type TranscriptsEnv` survived the `transcripts` → `transcriptions` rename. | Renamed. |
| **The limit sentences a teacher reads spell "64 Mo" and "90 minutes" out as words**, in three languages, with nothing watching them. The mirrored *constants* were already pinned by a parity test; the prose was not — and this feature has already been through one round of exactly that drift (100 MB → 64 MB, five comments left saying 100). | Six new assertions in `transcription-display.test.ts` derive both numbers from the Worker's constants and look for them in `source_hint` and `limits_help_body` in fr, en and es. Move the ceiling and the test names the language whose sentence became false. |

---

## 7. Limits: warning before refusal

The limits are 90 minutes (link or file) and 64 MB (file only). Three surfaces
carry them, and none of them is a server error message.

1. **The hint under the field** (`source_hint`) states both, always visible.
2. **An info disclosure beside the label** (`limits_help_label` /
   `limits_help_title` / `limits_help_body`) — the shared `HelpDot` / `HelpPanel`
   the Audio Studio and Documents also use, so one 44 px target, one
   `aria-controls` relationship, one always-rendered panel. It explains the thing
   a teacher cannot guess: **pasting a link makes the size limit disappear
   entirely**, because nothing leaves their computer — but the 90 minutes stay.
   The panel joins the field's `aria-describedby` **only while it is open**: a
   hidden paragraph is not something the field is currently described by.
3. **Pre-flight warnings on the file itself** (`fileSizeWarning`,
   `fileDurationWarning` → `limit_file_too_large`, `limit_file_too_long`). The
   moment a teacher picks a file we already know we cannot take, the warning
   appears **beside the field they were using** — not in the error line at the top
   — because nothing was attempted and this is not a failure. Both messages name
   the real number and give a next step.

`readMediaDuration` reads the length in the browser, so a 2-hour file is refused
before a single byte is uploaded. `latestPick` guards the race: a slow length
check cannot refuse a file the teacher has already replaced.

Client and server cannot disagree about where the line is:
`transcription-display.test.ts` asserts `MAX_UPLOAD_BYTES`, `MAX_SOURCE_SECONDS`
and `RETENTION_DAYS` against the Worker's own constants by importing the Worker
module directly, and — new this pass — asserts the same numbers appear in the
French, English and Spanish sentences.

---

## 8. VERIFIED — what real API calls actually showed

> Slice 1 shipped with a section here headed *"UNVERIFIED — nobody has seen a word
> this system produced from real audio."* That is no longer true. Two agents made
> live calls through **this repo's own provider modules**, with real French audio,
> and both reported `ran: true`. What follows is their measured output, including
> the parts that are bad news.

### 8.1 Groq — French accuracy · **acceptable, but do not ship yet**

**What ran.** `groqProvider(env).submit()` then `.fetchTranscript()` from
`worker/lib/transcription/groq.ts`, against the live API with production
parameters (`verbose_json`, word + segment granularities, language hint `fr`).
Groq request id `req_01kzktasakewe91ac7d3795wvy`.

**Material.** InnerFrench E89, *"La liberté de la presse française est-elle
menacée ?"* (2 306 s), scored against the publisher's own human transcript via a
Wayback snapshot from when transcripts were public. The scored span is 05:39–11:03
— 324 s, 9 paragraphs, **753 words**, cut to 16 kHz mono FLAC (the same resampling
Groq does server-side, so nothing is lost relative to what the model sees).
Correspondence was *verified, not assumed*: 753 reference words against 753 ASR
words with zero deletions and zero insertions, and all 9 of the transcript's own
time anchors landing on the right audio.

**Speed:** 324 s of audio in 1.19 s, roughly 272× real time.

#### The headline number, and why there are two of them

| Measured over the same 753 words | WER |
| --- | --- |
| What **Groq actually heard** (`words[]`) | **1.72 %** |
| What **our pipeline renders** (`.txt`, on-screen reader) | **4.24 %** |

Sensitivity variants, so the figure cannot be gamed — strict / apostrophe-folded /
accent-blind / both: `4.24 / 3.96 / 4.11 / 3.83 %` for our pipeline,
`1.72 / 1.61 / 1.59 / 1.48 %` for Groq's words.

**The gap is a bug in our code, not in the model.**

#### THE BLOCKING DEFECT: Groq's `text` and `segments[].text` are corrupted, and those are the fields we render

Groq's `verbose_json` returns the same audio twice, and the two disagree:

- `words[]` is **correct**.
- `text` and `segments[].text` are **truncated at the first multi-byte character
  or apostrophe**, and some tokens vanish entirely. `c'est`→`c`, `sécurité`→`s`,
  `l'expliquer`→`l`, `extérieurs`→`ext`, `frontières`→`fronti`; `États-Unis`,
  `époque,` and `éclaté` disappear. Classic byte-offset-treated-as-char-offset
  drift.

It was characterised, not anecdoted: **deterministic** (identical 4 463-character
corrupted `text` on every repeat); **not caused by our parameters** (identical with
granularities `[word,segment]`, `[segment]`, `[word]` and none); **not
`verbose_json`-specific** (`response_format=json` and `=text` return the same
corrupted string); **not a one-off clip** (reproduced on an independent 20:00–23:00
clip — 8 damaged blocks in 403 words, including the proper noun `Al-Halbi`→`Al`).
Rate of damage on the scored clip: **20 damaged blocks in 753 words**.

Blast radius in our code:

| File | Line | What it does | State |
| --- | --- | --- | --- |
| `worker/lib/transcription/groq.ts` | ~334 | prefers `shell.text` over the bucketed words for `segment.text` | **corrupted** |
| `worker/lib/transcription/groq.ts` | ~413 | prefers `raw.text` for `transcript.text` | **corrupted** |
| `worker/lib/transcription-download.ts` | ~170 | the `.txt` export — the file whose own header calls it "the one a language teacher actually uses" — renders `segment.text` | **corrupted** |
| `src/components/transcription/transcript-text.ts` | ~348 | the on-screen reader always renders `segment.text`; search counts matches in it too | **corrupted** |
| `segmentToCues` → `.srt` / `.vtt` | — | prefers `segment.words` | **clean** |

Both exports were rendered from the same real response to prove it:

```
.srt : "si on sait ce que c'est cette loi sécurité globale … vous l'expliquer dans quelques instants."   CLEAN
.txt : "si on sait ce que c cette loi s globale … Je vais vous l dans quelques instants"                 CORRUPTED
```

A teacher downloads the `.txt` and reads *"je vais vous l dans quelques instants"*,
while the subtitle file from the very same job is perfect. The bug alone takes WER
from 1.72 % to 4.24 % — roughly 2.5× the error rate, concentrated in elisions and
accented words, i.e. exactly where a French learner is most vulnerable.

**Fix sketch** (small, local, one file): in `normaliseGroqTranscript`, build
`segment.text` by joining the bucketed words and keep `shell.text` only as the
fallback for a segment with no words; build `transcript.text` from the segments
rather than `raw.text`. **The clean data is already in hand — we are choosing the
wrong field.** The trade-off is punctuation: `words[]` is largely unpunctuated,
which is why this is Greg's call (§0.5) and not a silent patch.

#### Model quality, using the clean `words[]`

13 substitutions, **0 deletions, 0 insertions** in 753 words. Nine of the 13 are
orthographic variants rather than errors — `évènements`/`événements` (both valid,
pre/post-1990), `XIXème`/`XIXe` (ours is the better typography), `5`/`cinq`,
`1ère`/`première`, `1er`/`premier`, `2ème`/`deuxième` ×2, `3ème`/`troisième`.
**Meaning-level WER: 4/753 = 0.53 %.**

- **Elisions: flawless.** 54 in the reference, 55 in ours, token for token
  identical — `qu'il`, `qu'au`, `c'est`, `j'ai`, `l'Europe`, `d'utiliser`,
  `jusqu'`. This is the thing most expected to break, and it did not.
- **Accents: zero errors.** 137 accented words in the reference, 135 in ours; every
  difference is the ordinal formatting above.
- **Proper nouns: all correct.** Rousseau, Napoléon, Lumières, États-Unis (hyphen
  included), Europe, Russie, Terreur, Révolution, République, Empire, Parlement,
  Déclaration, Constitution.
- **Numbers: all correct.** 16 janvier, 80 manifestations, 1789, 1792, 1793, 1870,
  500.
- **The one error that would mislead a learner:** *"prendre le pouls"* → *"prendre
  le poux"* at 06:18 — pulse becomes lice, and it lands precisely where Hugo is
  teaching that idiom.
- Two harmless homophone slips: *"des vraies rockstars"* → *"des vrais"*,
  *"Nous connaissant"* → *"Nous connaissants"*.
- **Register note worth telling a teacher:** Whisper silently *repairs* spoken
  French. *"Le nom est pas très original"* came back as *"Le nom n'est pas très
  original"* — the dropped `ne` reinserted. Inconsistently: it kept *"et c'est pas
  faux"* earlier in the same span. **Anyone using this to demonstrate authentic
  spoken register cannot trust the `ne` omissions to survive.**

#### Timestamps: safe to subtitle with

Checked against the human transcript's own 9 paragraph anchors, not eyeballed.
Every one lands within ±0.5 s, and there is **no accumulating drift** — the first
anchor is +0.00 s and the last, 274 s later, is +0.10 s.

#### Operational finding: no audio-seconds rate-limit headers on this account

Across eight live responses, only `x-ratelimit-limit-requests`,
`-remaining-requests` and `-reset-requests` came back. **Not one
audio-seconds header appeared.** So `parseGroqRateLimitHeaders` returns
`remainingSeconds: null` on Greg's key, `applyReading` is a no-op, and the local
counters in `transcription-budget.ts` are the entire pre-flight guarantee — with
the circuit breaker behind them. This is recorded in that module's header, and the
fallbacks were already sized for it; nothing needs to change, but nobody should be
surprised by a capacity log that says `source: "local"` forever.

*(One number the run did not reconcile: Groq reported 751 words in its own
metadata while 753 were scored. A two-word discrepancy over 753 changes no
conclusion, but it is unexplained.)*

### 8.2 Deepgram — French diarization · **good, ship it**

**What ran.** The repo's own `deepgramProvider` from
`worker/lib/transcription/deepgram.ts`, five live calls, with a spy `fetcher`
capturing the wire request to prove what we send:

```
POST https://api.deepgram.com/v1/listen
  diarize=true  language=multi  model=nova-3  multichannel=false
  punctuate=true  smart_format=true  utterances=false
```

Exactly what the module documents. Real request ids
(e.g. `019fe7a3-2261-7ad3-ae64-f64ee5999157`), ~2.1–2.5 s for a 4-minute file
(≈100× real time). **Total billed: 932 s = 0.26 h ≈ USD 0.08.**

**Material.** RFI *Invité international* 09/08/2026 (studio host, telephone guest,
mixed gender) split into two clips; RFI *Autour de la question* (both in studio,
fast, overlapping — the hard one); and a synthetic FR/EN/FR file for
code-switching.

**How truth was established.** Not by reading the French — by measuring the audio:
per-word `pYIN` fundamental frequency, a 2-component GMM on log-F0 fitted without
reference to Deepgram's labels, plus MFCC clustering and a band-energy ratio as
cross-checks. Pitch separation was unambiguous (RFI 84 Hz vs 215 Hz; ADQ 115 Hz vs
190 Hz). MFCC clustering was *not* relied on: it scored 96 % on the phone/studio
pair and collapsed to 51 % on the same-room pair.

#### Turn attribution — 692 s of real French, 23 turns

| Metric | Result |
| --- | --- |
| Whole-turn misattributions | **0 / 23** |
| Turns with a misplaced *edge* | 3 / 23 — every one at overlapping speech |
| Total misattributed speech | **~2.0 s of 692 s (0.3 %)** |
| Word level, RFI clip 1 | **450 / 450 = 100 %** |
| Word level, RFI clip 2 | 341 / 345 = 98.8 % |
| Word level, ADQ (hard) | 537 / 578 = 92.9 % raw → **~99.5 %** after hand-inspecting all 41 flagged words (38 were pYIN octave doubling or the male guest's emphatic register) |

Hard cases:

- **Speaker change mid-sentence: handled.** At 65.96 s the pitch track drops
  165 Hz → 95 Hz *inside* the single word "Exactement," — a real mid-word handover.
  Deepgram gave the whole word to the incoming speaker, which is the right call at
  word granularity.
- **Zero-gap handovers:** two boundaries with a literal 0.00 s gap, both correct.
- **Short interjections:** five turns of 0.7–3.4 s, all with their own turn and the
  right speaker.
- **Overlapping speech: 100 % of the errors are here**, and the pattern is
  consistent and benign — the turn is created, the identity is right, the seam
  lands 1–3 words off, so one sentence gets torn between two labels. A teacher
  reads past it.
- **A false alarm that was checked and cleared:** a "D'accord" at 38.66 s inside
  the guest's own long turn looked like a misattributed host back-channel. It
  measures 125–132 Hz — the guest's own range. It is his rhetorical *"D'accord ?"*.
  Deepgram was right.

#### Billing safety — PASS, on all four responses

`results.channels.length === 1` and `metadata.channels === 1` on **every** response,
including the stereo-sourced podcast mp3s. Deepgram downmixed exactly as the
module's comment predicts. No per-channel double billing. `results.utterances`
absent, as expected with `utterances=false`.

#### Per-speaker speaking time — PASS, and it confirms the Round G fix

Independently summed 255 word durations for RFI speaker 0, outside the provider
code: **86.320 s**, exactly the 86.32 s reported. Speaker 1: 128.960 s, matches.
The **old wall-clock method would have reported 90.3 s / 141.2 s — overstating the
guest by 12.2 s (+9.5 %)**. Sanity: 177 and 174 wpm, 215.3 s of speech in 240 s
against 226–232 s non-silent from an independent energy VAD.

Worth holding: Deepgram's word spans chain contiguously within a phrase, so the sum
already absorbs intra-phrase silence. The fix removes **inter-phrase** gaps — which
will matter far more on a classroom recording than on radio.

#### Code-switching — PASS, better than expected

On the FR/EN/FR file: 456 `fr` words and 189 `en` words, aligned with the true
regions to within 1–2 words at each boundary. Three speakers correctly separated —
and **the French guest was re-identified as the same speaker id after a 60-second
interruption in another language.** That is precisely the "teacher plays an English
clip mid-lesson" case that justifies `language=multi`, and it holds up.

#### SECOND DEFECT FOUND, not yet fixed: `detectedLanguages` has no floor

- A **100 % French** RFI clip returned `detectedLanguages: ["fr", "en"]` because
  **one word out of 629** — "Materie", a fragment clipped at the cut boundary,
  confidence 0.71 — was tagged `en`.
- The bilingual file returned `["fr", "en", "hi"]` because **two words out of 647**
  were tagged Hindi.

`transcript-view.tsx` (`languageNames`, ~line 348) renders that list as a chip
joined with " · ", and
`languageName` falls back to the **raw uppercased code** for anything outside
`NAMED_LANGUAGES`. So a teacher transcribing a French lesson can be shown
**"Français · English"**, or **"Français · English · HI"** — a bare language code
in a French interface, which is the one thing §1 says never happens.

Cause: `languageTotals` in `deepgram.ts` (~line 300) ranks languages by spoken
seconds but keeps **every** language with a single word.

**Fix sketch:** a minimum share — ≥ 2 % of spoken time, or ≥ 3 words — before a
language earns a place in `detectedLanguages`. Deliberately **not** applied in this
smoothing pass: picking the threshold is a tuning decision that wants the audio in
front of it, and the same pass should decide what `languageName` does with an
unnamed code rather than shouting it in capitals.

#### The two caveats — untested, not failed

1. **Same-gender speakers were never tested.** Both pairs were male + female, which
   is also what made the acoustic ground truth possible. Two female teachers, or a
   class of teenagers, is the known hard case for any diarizer, and this run says
   nothing about it.
2. **True back-channel was never exercised.** Broadcast audio is too clean — the
   host stays silent under the guest. Given that **100 % of the errors found were
   at overlap**, a real classroom recording on a single room mic, with overlapping
   students and "mmh / oui oui", is where this should be expected to degrade.

### 8.3 Still not verified

1. **AssemblyAI has not been called live.** Tier 3 is proven against fixtures only
   — the same standard Groq and Deepgram were held to before this wave, and the
   Groq result is exactly why that standard is not enough. It is also the tier
   whose free hours are shared with other tooling.
2. **Real-world latency for a full 90-minute source.** The clips were 3–7 minutes.
   The Deepgram 10-minute and AssemblyAI 12-minute deadlines are still calibrated
   on arithmetic, not observation.
3. **The failover cascade end to end against live providers.** The plan and the
   fall-through logic are covered by 26 router tests, but no live job has actually
   fallen from Groq to Deepgram to AssemblyAI.
4. **The retention cron in production.** It has never fired on real data.
5. **Anything through a browser.** No page in this feature has been rendered in a
   real browser against a real Worker. The component tests render to a string.
6. **Groq's 10-second minimum** and the exact free-tier reset behaviour, neither of
   which the eight responses exercised.

---

## 9. Test coverage

**639 tests across 17 files** (repo total: 829 in 40 files, all green).

| File | Tests |
| --- | --- |
| `worker/lib/transcription-ingest.test.ts` | 175 |
| `worker/lib/transcription/assemblyai.test.ts` | 68 |
| `worker/lib/transcription/deepgram.test.ts` | 55 |
| `worker/lib/transcription-budget.test.ts` | 49 |
| `worker/lib/transcription/groq.test.ts` | 41 |
| `src/components/transcription/transcript-search.test.tsx` | 36 |
| `worker/lib/transcription-quota.test.ts` | 32 |
| `worker/routes/transcriptions.test.ts` | 28 |
| `worker/lib/transcription-jobs.test.ts` | 26 |
| `worker/lib/transcription/router.test.ts` | 26 |
| `worker/lib/transcription-duration.test.ts` | 21 |
| `src/lib/transcription-display.test.ts` | 21 |
| `worker/lib/transcription-retention.test.ts` | 17 |
| `src/components/transcription/transcript-legend.test.tsx` | 15 |
| `worker/lib/transcription-download.test.ts` | 14 |
| `src/components/transcription/speaker-rename-field.test.tsx` | 9 |
| `src/components/transcription/transcript-controls.test.tsx` | 6 |

**What this number does and does not prove.** It proves our *normalisation*,
routing, quota arithmetic, retention selection and rendering are correct **given
the payloads in the fixtures**. §8.1 is the standing counter-example: 639 green
tests could not see that the field we render is the one Groq corrupts, because the
fixture's `text` field was written from the documentation and the documentation is
right.

Three seams make it possible without keys:

- `processTranscriptionJob(env, jobId, deps?)` takes
  `TranscriptionJobDeps { getProvider, resolveSource, chargeQuota }`.
- `runTranscription(env, request, deps?)` takes
  `TranscriptionRunDeps { buildProvider, planRoute }`, so the cascade policy is
  asserted directly instead of through three HTTP fakes.
- Providers take `fetcher?: typeof fetch` on `TranscriptionRequest`.

`vitest.config.ts` runs **two projects**: `worker` (Workers pool) and `src` (plain
Node, rendering with `react-dom/server`). Before this feature there were no `src/`
tests at all — a green `npm test` proved nothing about the SPA.

Dev fixtures, both gated from production without a runtime flag:

- **`/transcribe?demo=1`** renders the hand-written French interview fixture
  through the real reading UI. Gated on `import.meta.env.DEV`, which Vite replaces
  with the literal `false`; the fixture arrives via a *dynamic* import inside the
  folded branch, and `TranscriptView` is imported from its own file rather than the
  barrel. **Re-verified this pass: `grep -rl "Claire Fontaine" dist/` finds
  nothing.**
- **`npm run transcribe:seed`** writes the fixture straight into local D1.
  `--local` is hardcoded and the script refuses to run if `--remote`/`--preview`
  appear in argv.

---

## 10. Operational notes for Greg

- **Watch Groq's free tier first.** 8 audio-hours/day, recurring, covers the
  default path for a long time. The Deepgram credit is the one that drains, and
  only when teachers ask for speakers. AssemblyAI drains too, and shares its pot
  with `video-use`.
- **`transcription_jobs.provider_job_id`** is indexed (partially) precisely so
  "the provider says request X failed — whose job was that?" is one query.
- **`provider_choice_reason`** tells you why a job cost what it cost.
  `GROUP BY provider, provider_choice_reason` after the first week: a lot of
  `groq_rate_limited` or `groq_out_of_capacity` means the free tier is the
  bottleneck and §0.3 is worth chasing again.
- **`error_code`** is denormalised out of `error_payload` so you can
  `GROUP BY error_code` and see what teachers actually hit, without parsing JSON.
  It will tell you which supported-source claim is a lie.
- **YouTube demand is countable.** `source_kind = 'youtube'` rows are recognised
  and refused, never processed. Slice 2 was closed on 2026-08-10 (zero demand at the time); this counter is what would justify reopening it.
- **A failed nightly cron is a real alert.** The sweep rethrows and `scheduled`
  awaits it, so Cloudflare marks the invocation failed. That is the only alarm this
  feature has; if it goes off, transcripts are not being deleted.
- **`npm audit` reports 18 vulnerabilities** (12 high, 4 moderate, 2 low) in the
  dev toolchain (`ws` via `miniflare`/`@cloudflare/vite-plugin`, plus `vite` and
  `react-router`). This feature added **no dependency**; it is the repo's
  pre-existing baseline, unchanged by Waves 1 and 2. `npm audit fix --force` wants
  to make `@cloudflare/vitest-pool-workers` a breaking change — not something to do
  inside a feature branch.
- **`es.json` is 183 keys short of `fr.json` overall** (documents and admin
  sections). The `transcription` section itself is at **full three-language parity,
  160 keys, zero drift** — and missing keys elsewhere fall back to English
  silently, which is a pre-existing debt worth its own pass.
