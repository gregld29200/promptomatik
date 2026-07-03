# TeachInspire Audio Studio Build Log

## Phase 0 - Repo audit and integration plan (2026-07-01)

### Audit map

- Auth middleware: `worker/lib/auth-middleware.ts`
  - `requireAuth` loads the KV-backed session via `worker/lib/session.ts` and sets `session`.
  - `requireAdmin` checks `session.role === "admin"` after auth.
  - `requireParticipant` reads tier live from D1 via `getUserTier`; admins bypass participant gates.
- Tier checks: `worker/lib/tier.ts`
  - Supported tiers are `free` and `participant`.
  - Audio Studio participant access should reuse `requireParticipant`; free users should get the locked teaser in the UI.
- D1 access pattern: raw SQL through `env.DB.prepare(...).bind(...).run()/first()/all()`
  - Existing migrations are sequential files in `migrations/`; next migration should be `0011_audio_studio.sql`.
  - `package.json` has a manual `db:migrate` command listing every migration, so Phase 1 must append the new migration there.
- KV quota helper: `worker/lib/quota.ts`
  - Current free interview quota uses the `SESSIONS` KV namespace with UTC-date keys and implicit reset.
  - Audio quota should reuse `SESSIONS` with the PRD key pattern `audioq:{userId}:{YYYY-MM}`.
- Queue setup: `wrangler.jsonc`, `worker/index.ts`, `worker/lib/interview-jobs.ts`
  - One producer/consumer queue exists: `INTERVIEW_JOBS_QUEUE` / `interview-jobs`.
  - The worker exports one `queue` handler. Audio should add an `AUDIO_GENERATION_QUEUE` producer and `audio-generation` consumer, then route batches from the exported queue handler to the interview or audio consumer.
- Frontend routing: `src/App.tsx`
  - React Router routes live in one route tree behind `ProtectedRoute`.
  - Audio Studio should add a protected route at `/audio`.
- Shell/nav gating: `src/components/layout/shell.tsx`
  - Navigation entries are visible to free users with a lock badge.
  - Audio Studio should add an `/audio` nav entry using the same visible-locked pattern.
- Frontend auth/tier state: `src/lib/auth/auth-context.tsx`
  - `isParticipant` is true for participant tier and admins.
  - Audio UI can use `isParticipant` for the locked teaser and participant-only full screen.
- API client: `src/lib/api.ts`
  - Typed helpers return `{ data, error }` and use same-origin credentials.
  - Audio endpoints from PRD §7.8 should be added here with typed request/response shapes.
- i18n: `src/lib/i18n/index.ts`, `src/lib/i18n/fr.json`, `src/lib/i18n/en.json`, `src/lib/i18n/es.json`
  - French is the default. The app currently exposes `fr`, `en`, and `es`.
  - PRD requires FR + EN strings from day one; because Spanish is already user-selectable, Phase 4 should either add Spanish fallbacks for Audio Studio keys or intentionally hide Audio Studio until FR/EN are active.
- Admin area: `worker/routes/admin.ts`, `src/pages/admin.tsx`
  - Admin API is mounted at `/api/admin` and protected globally with `requireAuth, requireAdmin`.
  - Admin UI uses local tabs in `AdminPage`; Audio metrics should add an `audio` tab/section and API routes under the existing admin router or the PRD route prefix as admin-only.
- Deployment/config: `wrangler.jsonc`, `worker/env.ts`
  - Worker config uses `wrangler.jsonc` with D1, KV, queue, and plain vars.
  - No R2 binding is currently configured in this repo, even though the PRD says to reuse an existing bucket.
- Tests: no test runner or test script is currently configured.
  - Phase 1 must add a lightweight test setup before unit/integration tests can satisfy the phase DoD.

### Integration plan

- Backend route prefix: add `worker/routes/audio.ts` and mount it at `/api/audio` in `worker/index.ts`.
- Auth model:
  - All `/api/audio/*` endpoints require `requireAuth`.
  - Generation, preparation, history, quota, voice catalog, and regeneration are participant features; admins bypass via `requireParticipant`.
  - Admin metrics/credit endpoints should require `requireAdmin` and stay under `/api/audio/admin/*` to match the PRD endpoint table.
- Data model:
  - Add migration `migrations/0011_audio_studio.sql` with `audio_jobs`, `audio_segments`, `quota_ledger`, and `credit_balances`.
  - Use raw SQL and JSON text columns, matching current D1 conventions.
- Quota:
  - Add a separate audio quota service rather than modifying the existing interview quota API in place.
  - Reuse `SESSIONS` KV for included monthly seconds and D1 for credits/ledger.
- Queue/consumer:
  - Add `AUDIO_GENERATION_QUEUE` to `Env`.
  - Extend `wrangler.jsonc` with producer/consumer binding for `audio-generation`.
  - Update the exported queue handler to dispatch interview and audio batches without changing interview job behavior.
- R2:
  - Add an R2 binding once the real bucket name/binding is confirmed.
  - Use `audio/{jobId}/...` for expiring job assets and `voices/{name}.mp3` for persistent voice previews.
- Frontend:
  - Add route `/audio` and a participant-gated `AudioStudioPage`.
  - Add a shell nav item labelled through i18n; free-tier users see the same locked teaser pattern used by templates/profile.
  - Keep the V1 UI as the PRD's single screen: header quota, three zones, and history access.
- Admin UI:
  - Add an Audio tab to `src/pages/admin.tsx` for metrics and credit grants, backed by `/api/audio/admin/*`.
- Config:
  - TTS model IDs, text prep model, prompt expansions, voice catalog, and prices should live in worker config/provider/config modules, not scattered UI constants.
  - Phase 2 must verify Gemini speech docs before finalizing model IDs.

### Deviations and open questions

- Resolved in Phase 1: `teachinspire-media` was created as the Audio Studio R2 bucket with binding `MEDIA`.
- Decided for V1: Audio Studio ships FR + EN strings only. Spanish should fall back to EN if supported; otherwise copy EN values into ES and mark them `TODO-ES`. Do not machine-translate ES. Full Spanish localization is a V1.5 item.
- Resolved in Phase 1: Vitest plus `@cloudflare/vitest-pool-workers` was added as task 1.0.
- PRD amendment for V1: replace signed audio URLs with authenticated proxy downloads at `GET /api/audio/jobs/:id/download/:file`, where `file` is `final.mp3`, `final.wav`, or `transcript.txt`. Voice previews should stream from `GET /api/audio/voices/:name/preview` with `Cache-Control: public, max-age=86400`.

### Phase 0 DoD

- [x] Integration points mapped.
- [x] Audio Studio plug-in plan written.
- [x] No product code added.

## Phase 1 - Data model and quota service (2026-07-01)

### Built

- Task 1.0 test infrastructure:
  - Added Vitest and `@cloudflare/vitest-pool-workers`.
  - Added `vitest.config.ts` using Cloudflare's worker pool with `wrangler.jsonc`.
  - Added `npm test`.
- R2:
  - Created bucket: `teachinspire-media`.
  - Added R2 binding `MEDIA` in `wrangler.jsonc` and `worker/env.ts`.
  - Added the 7-day lifecycle rule to the `audio/` prefix only.
  - Exact lifecycle command run:
    `npx wrangler r2 bucket lifecycle add teachinspire-media audio-expire-7d audio/ --expire-days 7 --force`
  - No lifecycle rule was added for `voices/`.
- D1:
  - Added `migrations/0011_audio_studio.sql` with `audio_jobs`, `audio_segments`, `quota_ledger`, and `credit_balances`.
  - Added the migration to `package.json`'s local `db:migrate` chain.
- Quota service:
  - Added `worker/lib/audio-quota.ts`.
  - Implemented `getAudioQuotaBalance`, `precheckAudioQuota`, and `chargeAudioQuota`.
  - Monthly included quota uses `SESSIONS` KV key pattern `audioq:{userId}:{YYYY-MM}`.
  - Charges round actual seconds up, consume included seconds first, then credits, and write ledger rows for included/credit movement.
- API:
  - Added `worker/routes/audio.ts`.
  - Mounted `/api/audio` in `worker/index.ts`.
  - `GET /api/audio/quota` returns `{ includedRemaining, credits, monthResetsOn }` for authenticated participant/admin users.

### Dependency health notes

- `vitest@4.1.9`: npm metadata shows it was modified 2026-06-15; installed as a dev dependency.
- `@cloudflare/vitest-pool-workers@0.17.0`: npm metadata shows it was modified 2026-06-30; installed as a dev dependency.
- Cloudflare's current Workers Vitest docs use the `cloudflareTest()` plugin with `wrangler.configPath`, matching this setup.
- `npm audit --omit=dev` initially reported existing high-severity advisories for `hono` and `react-router`; both direct runtime dependencies were bumped within semver range and production audit is now clean.
- Full `npm audit` still reports dev/toolchain advisories under the Cloudflare/Vite/Rollup stack; `npm audit fix --dry-run` showed a broad toolchain upgrade, so that should be handled as a separate dependency-hardening pass.

### Verification

- `npm test` passed: 7 tests after adding the exact quota straddle/precheck cases requested in review.
- `npm run build` passed.
- `npm audit --omit=dev` passed.
- `npx wrangler d1 execute promptomatik-db --local --file=./migrations/0011_audio_studio.sql` passed locally.

### Phase 1 DoD

- [x] Vitest worker-pool test setup added before the migration work.
- [x] Audio Studio migration added.
- [x] Quota service implemented.
- [x] Unit tests cover month rollover, included/credit split, exact 30s included + 70s credit straddle, credit balance decrement, 1.2x precheck margin, rounding up, and regeneration charge.
- [x] `GET /api/audio/quota` returns correct values for a seeded user in a worker-runtime test.

## Phase 2 - TTS provider and pipeline core (2026-07-01)

### Task 2.0 docs verification

- Source checked: Google Gemini speech generation docs, current page last updated 2026-06-22 UTC; model pages last updated 2026-06-23 UTC.
- API shape:
  - Google now recommends the Interactions API for latest features.
  - The generateContent page is labeled legacy, but still documents the PRD-compatible REST endpoint `models/{model}:generateContent` and request shape.
  - Decision: keep generateContent for this V1 PRD build, isolated in `worker/lib/tts-provider.ts` so a future Interactions migration is contained.
- Model IDs:
  - Draft is configured as `gemini-2.5-flash-preview-tts`.
  - Final is configured as `gemini-2.5-pro-preview-tts`.
  - Decision: stay on these benchmarked 2.5 TTS models for the pilot. `gemini-3.1-flash-tts-preview` is documented and tested as available, but has documented voice-consistency limitations; it is only a post-pilot config-switch candidate.
  - Model IDs live in config/defaults only: `wrangler.jsonc` and `worker/lib/audio-config.ts`.
- API keys:
  - Google AI Studio now creates Authorization API keys with the `AQ...` prefix by default.
  - The provider uses the native `x-goog-api-key` header, and the local `AQ...` key was verified successfully against Gemini text and TTS endpoints.
- Speaker limit:
  - Multi-speaker TTS is documented as up to 2 speakers.
- PCM format:
  - Docs examples write PCM as 1 channel, 24,000 Hz, 2-byte samples: 24kHz / 16-bit / mono.
- Retryable failures:
  - Docs document occasional text-token returns instead of audio, usually surfacing as HTTP 500.
  - Provider retries HTTP 429, 500, 503, and text-instead-of-audio responses.
  - `PROHIBITED_CONTENT` is non-retryable and returns the PRD message recommending Prepare for audio.

### Built

- Config:
  - Added TTS env/config keys to `wrangler.jsonc` and `worker/env.ts`.
  - Documented `GEMINI_API_KEY` in `.env.example` and `README.md`.
- Dependencies:
  - Added `lamejs` for MP3 encoding, as named in the PRD.
  - Added `nanoid` for upcoming job IDs, as named in the PRD environment additions.
  - No unrelated version bumps were made.
- Provider:
  - Added `worker/lib/tts-provider.ts`.
  - Implements generateContent REST calls, single-speaker and 2-speaker request bodies, retry policy, PCM duration calculation, and sanitized provider errors.
- Direction compiler:
  - Added `worker/lib/audio-direction.ts`.
  - Uses CEFR delivery modifiers and preset expansions from `worker/lib/audio-config.ts`.
- Block splitting and duration estimate:
  - Added `worker/lib/audio-script.ts`.
  - Tags are excluded from estimated word count.
  - Dialogue splits at speaker turns; monologue splits at sentence boundaries; long single turns remain intact.
- Audio assembly:
  - Added `worker/lib/audio-assembly.ts`.
  - Concatenates PCM with 400ms silence gaps, writes WAV headers, and encodes 128 kbps mono MP3 through `lamejs`.
  - Added a contained compatibility shim because `lamejs@1.2.1` has missing CommonJS globals under modern module loading.
- Smoke script:
  - Added `scripts/audio-studio-smoke.ts` and `npm run audio:smoke`.
  - The script writes `.wav` and `.mp3` files under `.tmp/audio-studio-phase2/` and prints model, quality, block count, measured duration, wall-clock time, retry count, cost, and output paths.

### Verification

- `npm test` passed: 20 tests.
- `npm run build` passed.
- `npm audit --omit=dev` passed.
- `rg -n "gemini-" src worker scripts wrangler.jsonc README.md .env.example BUILD_LOG.md` shows production model IDs only in `wrangler.jsonc` and `worker/lib/audio-config.ts`; other matches are this build log and a test fixture key string.
- `npm run audio:smoke` passed with a real Gemini TTS call:
  - model: `gemini-2.5-flash-preview-tts`
  - quality: `draft`
  - blocks: 1
  - measured duration: 11.21s
  - wall-clock time: 14960ms
  - retry count: 1
  - computed API cost: $0.0030
  - WAV: `.tmp/audio-studio-phase2/smoke-2026-07-02T06-36-26-874Z.wav`
  - MP3: `.tmp/audio-studio-phase2/smoke-2026-07-02T06-36-26-874Z.mp3`

### Phase 2 DoD

- [x] Current Gemini TTS docs verified.
- [x] Provider module implemented.
- [x] Direction compiler implemented and covered by 3 inline snapshot tests.
- [x] Block splitter implemented and covered for turn boundaries, 90s cap, and long single turn.
- [x] Audio assembly implemented and covered for WAV header bytes and durations.
- [x] Real end-to-end local generation wrote a playable MP3; Greg reviewed it by ear and accepted it.

## Phase 3 - Jobs API and queue consumer (2026-07-02)

### Built

- Queue:
  - Added `AUDIO_GENERATION_QUEUE` binding and `audio-generation` producer/consumer in `wrangler.jsonc`.
  - Updated the worker queue export to dispatch `interview-jobs` and `audio-generation` by `batch.queue`.
- Jobs API:
  - `POST /api/audio/jobs` validates mode, quality, non-empty script, server-side 2-speaker limit, voices, and quota precheck; then creates job/segment rows and enqueues processing.
  - `GET /api/audio/jobs/:id` returns job plus segment status and proxy download URLs when ready.
  - `GET /api/audio/jobs` returns paginated history for the current user.
  - `POST /api/audio/jobs/:id/segments/:idx/regenerate` marks one segment pending and re-enqueues the job.
  - `GET /api/audio/jobs/:id/download/:file` implements the authenticated proxy download route for `final.mp3`, `final.wav`, and `transcript.txt`.
  - Foreign jobs return `403`; nonexistent jobs return `404`.
- Consumer:
  - Added `worker/lib/audio-jobs.ts`.
  - Processes pending segments idempotently, skipping already-`ok` segments on redelivery.
  - Generation and assembly are split into separate queue actions. This keeps the real job lifecycle externally observable as `generating -> assembling -> ready` instead of collapsing the short assembly step into the same queue turn.
  - Writes segment PCM to R2 under `audio/{jobId}/seg-{idx}.pcm`.
  - Assembles final PCM with 400ms gaps, writes `final.wav`, `final.mp3`, and `transcript.txt` to R2.
  - Marks failed segments and failed jobs with human-readable errors.
  - Charges quota only after successful assembly.
  - Regeneration charges only the regenerated segment duration while still reassembling the final files.
  - Records model, actual seconds, retry count, wall-clock generation time, and computed API cost.

### Verification

- `npm test` passed: 26 tests.
- `npm run build` passed.
- `npm audit --omit=dev` passed.
- Phase 3 integration tests cover:
  - successful lifecycle to Ready with R2 final files and quota ledger charge
  - failed block after provider failure with no quota charge
  - redelivery resume by skipping already completed segments
  - foreign job ownership returns `403`
  - `POST /api/audio/jobs` creates jobs through the worker route
  - server-side >2 speaker rejection

### Local dev curl lifecycle

- Local dev command:
  - `npx wrangler dev --local --port 8787`
  - Wrangler dev used local D1, KV, R2, and `audio-generation` Queue bindings with `GEMINI_API_KEY` loaded from `.dev.vars`.
- Local auth setup:
  - Root local D1 had a corrupted dev admin bcrypt hash from an older shell-expanded seed command. Fixed only local dev state via `/tmp/audio-studio-curl/fix-admin.sql`, then logged in with `greg@teachinspire.com` / `admin123`.
- Login:
  - Command: `curl -i -c cookies.txt -H 'Content-Type: application/json' -d '{"email":"greg@teachinspire.com","password":"admin123"}' http://localhost:8787/api/auth/login`
  - Response: `HTTP/1.1 200 OK`, `Set-Cookie: promptomatik_session=...`, user role `admin`, tier `participant`.
- Starting quota:
  - Command: `curl -b cookies.txt http://localhost:8787/api/audio/quota`
  - Response: `{"includedRemaining":3455,"credits":0,"monthResetsOn":"2026-08-01T00:00:00.000Z"}`
- Create Final dialogue job:
  - Command: `curl -i -b cookies.txt -H 'Content-Type: application/json' --data-binary @create-job.json http://localhost:8787/api/audio/jobs`
  - Input: 2-speaker dialogue, quality `final`, 204 words, estimated 82s.
  - Response: `HTTP/1.1 202 Accepted`, `{"jobId":"nvCcjL6V0k0YuGnuqPHme","estimatedSeconds":82}`
  - Initial DB status is `queued` by insert default; first external poll after queue dispatch observed `generating`.
- Poll to Ready:
  - Command loop: `curl -b cookies.txt http://localhost:8787/api/audio/jobs/nvCcjL6V0k0YuGnuqPHme` every 50ms.
  - Observed statuses:
    - `06:47:22.3NZ status=generating segments=0:pending`
    - `06:48:07.3NZ status=assembling segments=0:ok`
    - `06:48:08.3NZ status=ready segments=0:ok`
  - Final job metrics: model `gemini-2.5-pro-preview-tts`, estimated 82s, actual 71s, `genMs=46079`, retry count 0, API cost `$0.0355`, segment duration 70.610958s.
- Downloads:
  - MP3 command: `curl -D final.mp3.headers -b cookies.txt http://localhost:8787/api/audio/jobs/nvCcjL6V0k0YuGnuqPHme/download/final.mp3 -o final.mp3`
    - Headers: `Content-Type: audio/mpeg`, `Content-Disposition: attachment; filename="final.mp3"`, length 1,130,880 bytes.
    - File signature: `MPEG ADTS, layer III, v2, 128 kbps, 24 kHz, Monaural`.
  - WAV command: `curl -D final.wav.headers -b cookies.txt http://localhost:8787/api/audio/jobs/nvCcjL6V0k0YuGnuqPHme/download/final.wav -o final.wav`
    - Headers: `Content-Type: audio/wav`, `Content-Disposition: attachment; filename="final.wav"`, length 3,389,370 bytes.
    - File signature: `RIFF WAVE audio, Microsoft PCM, 16 bit, mono 24000 Hz`.
  - Transcript command: `curl -D transcript.txt.headers -b cookies.txt http://localhost:8787/api/audio/jobs/nvCcjL6V0k0YuGnuqPHme/download/transcript.txt -o transcript.txt`
    - Headers: `Content-Type: text/plain; charset=utf-8`, `Content-Disposition: attachment; filename="transcript.txt"`, length 1,218 bytes.
    - Contents confirmed speaker labels and submitted dialogue text.
  - Browser playback: opened `/tmp/audio-studio-curl-2/downloads-after-regenerate/final.mp3` in Google Chrome.
- Charge after generation:
  - Quota response: `{"includedRemaining":3384,"credits":0,"monthResetsOn":"2026-08-01T00:00:00.000Z"}`
  - Ledger query: `SELECT source, reason, delta_seconds, job_id, created_at FROM quota_ledger WHERE job_id='nvCcjL6V0k0YuGnuqPHme' ORDER BY id`
  - Ledger row: `included`, `generation`, `-71`, created `2026-07-02 06:48:08`.
- Regenerate segment 0:
  - Command: `curl -i -b cookies.txt -X POST http://localhost:8787/api/audio/jobs/nvCcjL6V0k0YuGnuqPHme/segments/0/regenerate`
  - Response: `HTTP/1.1 202 Accepted`, `{"accepted":true}`
  - Poll observed:
    - `06:48:27.3NZ status=generating segments=0:pending`
    - `06:49:21.3NZ status=ready segments=0:ok`
  - Regenerated job metrics: actual 76s, `genMs=53600`, retry count 0, API cost `$0.0380`, regenerated segment duration 75.970958s.
  - MP3 hash changed:
    - Before: `31025bb91a03517662ec475563bbbf1b9ecc8ef9ec220181dc02bc2f404d2aae`
    - After: `ca959f9593b2621d7880658f01dee431abc465ff68c46f4c53845468e9edf9c4`
  - Quota after regeneration: `{"includedRemaining":3308,"credits":0,"monthResetsOn":"2026-08-01T00:00:00.000Z"}`
  - Ledger rows:
    - `included`, `generation`, `-71`, created `2026-07-02 06:48:08`
    - `included`, `regeneration`, `-76`, created `2026-07-02 06:49:21`

### Phase 3 DoD

- [x] Job API endpoints implemented.
- [x] Queue consumer implemented.
- [x] Authenticated proxy download route implemented instead of signed URLs.
- [x] Integration tests cover happy path, failed block/no charge, redelivery resume, ownership check, and server-side speaker validation.
- [x] Manual curl lifecycle against `wrangler dev` with real Gemini generation completed and recorded.

## Phase 4 - Frontend 3-zone Audio Studio screen (2026-07-02)

### Built

- Backend micro-addition:
  - Added `peaksFromPcm()` during assembly.
  - Stores `peaks.json` beside `final.mp3`, `final.wav`, and `transcript.txt` under the job R2 prefix.
  - `GET /api/audio/jobs/:id` now returns `waveform: { peaks, blocks }` for ready jobs; block timings are derived from segment durations plus the existing 400ms assembly gaps.
- Voice catalog:
  - Added static 30-voice Gemini catalog at `GET /api/audio/voices`.
  - Added cached preview proxy at `GET /api/audio/voices/:name/preview` with `Cache-Control: public, max-age=86400`; it returns `404` until Phase 6 seeds `voices/{name}.mp3`.
- Frontend route:
  - Added protected `/audio` route and nav entry with the existing participant lock badge behavior.
  - Free users see the locked teaser; participants/admins see the full studio.
- 3-zone screen:
  - Script zone: mode toggle, live duration estimate, static FR/EN example scripts, tag insertion at cursor, tag highlighting, dialogue turn preview, and >2-speaker warning.
  - Direction zone: exactly the five V1 controls: level, accent, pace, style, scene.
  - Booth zone: card-grid voice casting, selected speaker slots, preview controls, Draft/Final toggle, Generate, polled generation console, waveform player, per-block regenerate action, downloads, and history duplicate-settings.
- Generation console:
  - No simulated progress. Status, block count, and active block come from the polled job/segment response.
  - Shows `Block n/m - voicing Speaker x`, elapsed time, estimate, model label, and a CSS-only VU meter.
  - `assembling` switches copy to `Assembling the final take...`.
- Waveform player:
  - Hand-rolled SVG waveform from backend peaks; no waveform dependency added.
  - Draws block boundaries; clicking a block selects it and reveals `Regenerer ce bloc` with estimated quota seconds.
  - Includes play/pause, click-to-seek, elapsed/total time, and MP3/WAV/TXT downloads.
- i18n:
  - Added FR + EN Audio Studio strings.
  - Added EN fallback in the i18n helper, so Spanish falls back to EN without machine-translated ES copy.
- Typography:
  - Added bundled `@fontsource/inter` and `@fontsource/playfair-display` because Phase 4 explicitly requires Inter and Playfair Display.
  - Health check: both packages are `5.2.8`, OFL-1.1 licensed, and self-host font assets. Imports are limited to latin weights used by the Audio Studio UI.

### Screenshots

The current Phase 4 screenshot set is listed in the final closeout section below. Earlier pre-fix screenshots were removed after the French diacritics review so this log only references current UI state.

Screenshots were captured against local dev with deterministic local D1/R2 fixtures:

- `phase4-ready`: ready job with `final.mp3`, `final.wav`, `transcript.txt`, and `peaks.json` in local R2.
- `phase4-generating`: in-progress job with four segments and status `generating`, used to verify honest console state from polling.

### Verification

- `npm test` passed: 28 tests.
- `npm run build` passed.
- Browser QA via `agent-browser`:
  - Logged in locally as `greg@teachinspire.com`.
  - Opened `/audio`.
  - Verified voice casting grid selected states.
  - Loaded ready history fixture, selected waveform block 1, and verified regenerate action visibility.
  - Loaded generating history fixture and verified `Block 2/4 - voicing Speaker 2` console copy.

### Phase 4 DoD

- [x] `/audio` route and nav entry implemented.
- [x] Free-tier locked teaser implemented through existing tier gate.
- [x] Script zone implemented.
- [x] Direction zone implemented with the five required controls.
- [x] Booth zone implemented with voice cards, generation state, waveform result, regeneration, downloads, and history.
- [x] `peaks.json` backend micro-addition implemented and tested.
- [ ] Human walkthrough accepted by Greg.
- [ ] "Prepare for audio" diff view screenshot. Blocked because the feature is Phase 5 and no route/UI exists yet.

### Phase 4 review addendum - not closed (2026-07-02)

Phase 4 is not closed. Three items:

1. Housekeeping was skipped: `.DS_Store` was already present in `.gitignore`, but the file was still tracked by Git. Fixed by removing it from the index without deleting the local file and committing `a09e797 chore: stop tracking macOS metadata`.

2. Screenshots were incomplete. The final current screenshot set is listed in the closeout section below. The `"Prepare for audio"` diff view remains a Phase 5 DoD screenshot.

3. Human review findings:
   - Fixed: `.DS_Store` was tracked despite `.gitignore`.
   - Fixed: FR default was mixed with visible English UI labels (`Speaker`, `Booth`, `Draft`, direction presets, voice descriptors, generation console copy, history statuses). UI labels now render in French while backend/config values remain unchanged.
   - Fixed: gold accent was too dispersed inside Audio Studio components. Disabled primary action, waveform selection, play button, and console active block now use neutral/teal/slate treatment; selected voice dots remain gold per the Phase 4 casting requirement.
   - Verified clean: tag insertion occurs at cursor position.
   - Verified clean: duration estimate changes on each real user edit.
   - Verified clean: 3+ speaker scripts show a hard warning and disable generation.
   - Verified clean: polling stops after navigating away from `/audio`; after 30 seconds on `/dashboard`, only the two pre-navigation `/api/audio/jobs/phase4-generating` requests were logged.
   - Verified clean: browser walkthrough for the implemented flow succeeded: paste script -> direct -> generate real Draft audio -> listen in player -> download MP3/WAV/TXT -> regenerate block.
   - Blocker: complete requested walkthrough cannot include "prepare" until Phase 5 implements `POST /api/audio/prepare` and the diff UI.

The phase closes when all three are done and Greg confirms the walkthrough.

### Phase 4 final closeout fixes (2026-07-02)

Phase 4 review blockers fixed:

1. French diacritics:
   - Audited visible FR strings in `src/lib/i18n/fr.json`, Audio Studio components, the Audio Studio page, and FR email copy.
   - Corrected known unaccented forms including `Réinitialisation`, `Générer la prise`, `Réunion professionnelle`, `Se déconnecter`, `Prêt`, `En régie`, `Temps écoulé`, `Modèle`, `Enjouée`, `Décontractée`, `Soufflée`, `Légère`, `Énergique`, `apparaîtront`, and `téléchargements`.
   - Added `worker/lib/i18n-fr-lint.test.ts`, which fails on the known unaccented regression pattern `/\b(Generer|Reinitialisation|Reunion|deconnecter|Pret|ECOULE|MODELE)\b/`.
2. History now matches REQ-9.1:
   - Rows show title from first script words, mode, quality, duration, status, and expiry date.
   - Dates are localized with the app locale; French renders `DD/MM/YYYY` (`09/07/2026` in the local fixtures).
3. Speaker labels:
   - Input accepts `Speaker N:` and `Locuteur N:` in mixed case.
   - Backend normalizes stored scripts, segment transcripts, voice-map keys, and `transcript.txt` output to `Speaker 1/2`.
   - Added normalizer unit tests for both conventions, mixed case, mixed input, and voice-map keys.
4. Locked teaser:
   - Updated copy to `génération audio, choix des voix, quotas inclus et téléchargements`.

Affected screenshots recaptured:

- Quota header: `docs/audio-studio-screenshots/phase4-quota-header.png`
- Generation console mid-run: `docs/audio-studio-screenshots/phase4-generation-console-mid-run.png`
- History row with all REQ-9.1 fields: `docs/audio-studio-screenshots/phase4-history-rich-row.png`
- Free-tier locked teaser: `docs/audio-studio-screenshots/phase4-free-tier-locked-teaser.png`
- FR studio view: `docs/audio-studio-screenshots/phase4-fr-studio-view.png`

Housekeeping after Greg's confirmation:

- Removed stale pre-fix screenshot files from `docs/audio-studio-screenshots/` so the folder and this log reference only current Phase 4 UI state.

Verification:

- `npm test -- --run worker/lib/audio-script.test.ts worker/lib/i18n-fr-lint.test.ts` passed: 8 tests.
- `npm test` passed: 32 tests before Phase 5 files were added.
- `npm run build` passed.
- Browser text audit on `/audio` as admin confirmed:
  - no mixed English core UI in the FR studio view,
  - `En régie`, `Prêt`, `Réinitialisation`, `Générer la prise`, `Réunion professionnelle`, `Temps écoulé`, and `Modèle` render with accents,
  - history dates render as `09/07/2026`,
  - voice descriptors render with accents.
- Browser text audit as free-tier user confirmed the locked teaser copy.

Phase 4 is closed. The `"Prepare for audio"` diff screenshot is intentionally deferred to Phase 5 DoD.

## Phase 5 - Prepare for audio (2026-07-02)

### Started

- Added `worker/lib/audio-prepare.ts`:
  - Defensive parser for the §7.7 JSON contract.
  - Strips accidental markdown JSON fences.
  - Extracts a JSON object from accidental surrounding model text while still rejecting malformed JSON.
  - Validates `speaker_count`, `formatted_script`, `changes`, and `warnings` before returning anything to the caller.
  - Gemini Flash text service wrapper using `LLM_MODEL_PREP` from config and `GEMINI_API_KEY` from env.
- Added `POST /api/audio/prepare` under the authenticated participant audio router.
  - Empty scripts return `400` and are not sent to Gemini.
  - Invalid modes return `400`.
  - Malformed provider output returns an error; nothing is applied.
- Added frontend API client types and `prepareAudioScript()`.
- Added the Audio Studio diff UI:
  - Disabled empty-script state with the exact French hint: `Collez d'abord votre script — Audio Studio le prépare, il ne l'écrit pas.`
  - Changes grouped by type with counts: `Renommages de locuteurs`, `Tags proposés`, `Nettoyages`.
  - Per-item `Accepter` / `Rejeter` decisions.
  - `Tout accepter` is secondary; `Appliquer la sélection` is the explicit application action.
  - Added fragments render in green; removed fragments render red with strike-through.
  - Warnings render in a distinct banner above the change groups.
  - The editor content remains intact until `Appliquer la sélection`.
- Added tolerant partial-apply logic for speaker renames where a label contains visual direction, e.g. `Marie (sourit):` can become `Speaker 1:` without applying the rejected tag suggestion.

### Verification

- `npm test -- --run worker/lib/audio-prepare.test.ts` passed after parser hardening.
- `npm test` passed: 36 tests.
- `npm run build` passed.
- Browser E2E against local dev with real `GEMINI_API_KEY` passed:
  - Pasted messy dialogue with character names, visual stage directions, and no tags.
  - Ran one Prepare pass.
  - Verified the editor content stayed unchanged before applying the selection.
  - Accepted only speaker-renaming changes and rejected tag/cleanup suggestions.
  - Applied the selection; script became generation-ready with normalized `Speaker 1/2` labels.
  - Generated a Draft job successfully; the ready player appeared and history showed the new 12s Brouillon take.
- Diff view screenshot: `docs/audio-studio-screenshots/phase5-prepare-diff-view.png`

### Remaining Phase 5 work

- None for the Phase 5 DoD.

### Phase 5 DoD

- [x] Preparation service: one Gemini Flash text call with the §7.7 JSON contract and defensive parsing.
- [x] Diff UI: grouped changes, accept/reject per item, `Tout accepter`, explicit apply action, warnings banner, and empty-script disabled hint.
- [x] Parser tests cover valid, fenced, surrounding-text, and malformed inputs.
- [x] E2E messy script -> Prepare -> accept subset -> generate successfully.
- [x] Diff view screenshot captured.

Phase 5 is closed.

## Phase 5b - PRD amendments before Phase 6 (2026-07-02)

### Built

- Rule 1 - hard Speaker 1/2 compiler boundary:
  - Added `validateTranscriptForTts()` in the Direction compiler path.
  - Dialogue transcripts must have every non-empty line start with `Speaker 1: ` or `Speaker 2: ` immediately before prompt compilation.
  - Monologue transcripts reject any speaker-style label before prompt compilation.
  - If validation fails during queue processing, the job fails before any provider call; no quota ledger row and no API cost are recorded.
  - Prepare responses are also validated so named labels are not presented to the UI as a valid formatted script.
- Rule 2 - stage-direction handling:
  - Added shared `SUPPORTED_AUDIO_TAGS` and FR/EN `STAGE_DIRECTION_TAG_MAP` config in `src/lib/audio-script-rules.ts`.
  - Updated Prepare contract with `stage_direction_converted` and `direction_hint`.
  - Convert action: acting notes like `(sourit)` become supported inline tags such as `[smiling]`.
  - Promote action: upstream context such as `il regarde son téléphone` becomes a `direction_hint`; accepting it appends to the Scene field and removes it from the script path.
  - Remove action remains `removed_stage_direction`.
  - Added deterministic completion for repeated speaker-name renames when Gemini maps the first occurrence but omits later rows.
  - `Tout accepter` applies the validated `formatted_script` plus accepted direction hints; partial selections still apply per accepted row.
- Rule 3 - local and server script lint:
  - Added shared `lintAudioScript()`.
  - Blocking findings: unknown speaker labels after normalization, >2 speakers, unbalanced brackets, empty script.
  - Warning findings: residual stage directions, tags outside the reference list, single turn >60s estimated, narration lines in dialogue mode.
  - Client shows blocking reasons continuously and disables Generate.
  - Server runs the same linter at job creation and remains authoritative.
- User guide:
  - Added the static `Bien écrire pour l'audio` help panel in the Script zone.
  - Covers Speaker 1/2 conventions, supported bracket tags, no stage directions in script, and scene/character info in Direction.
  - No new route added.

### Verification

- `npm test -- --run worker/lib/audio-direction.test.ts worker/lib/audio-prepare.test.ts worker/lib/audio-script-lint.test.ts worker/lib/audio-jobs.test.ts worker/lib/i18n-fr-lint.test.ts` passed: 25 tests.
- `npm test` passed: 46 tests.
- `npm run build` passed.
- Browser E2E against local dev with real `GEMINI_API_KEY` passed:
  - Pasted messy dialogue with names, `(sourit)`, and `[il regarde son téléphone]`.
  - Blocking lint appeared before Prepare.
  - One Prepare pass produced a tag conversion and a `direction_hint`.
  - Editor content stayed intact before apply.
  - `Tout accepter` applied the validated formatted script:
    - `Speaker 1: [smiling] Bonjour Paul, tu as vérifié la salle ?`
    - `Speaker 2: Oui, mais le projecteur ne démarre pas.`
    - remaining lines normalized to `Speaker 1/2`.
  - Scene field received `Paul vérifie son téléphone.`
  - Blocking lint cleared, Generate enabled, and Draft generation reached Ready in 9169 ms.
- Diff view screenshot recaptured: `docs/audio-studio-screenshots/phase5-prepare-diff-view.png`.

### Phase 5b DoD

- [x] Compiler-boundary guard implemented and tested.
- [x] Prepare contract handles convert/promote/remove stage-direction actions.
- [x] Shared script linter implemented client-side and server-side with unit tests.
- [x] Static FR/EN user guide panel added in the Script zone.
- [x] Messy-script E2E rerun and screenshot recaptured.

Phase 5 is re-closed after amendments. Phase 6 may begin.

## Phase 6 - Voice previews, admin, instrumentation (2026-07-02)

### Built

- Admin metrics API:
  - Added `worker/lib/audio-metrics.ts` with `getAudioAdminMetrics()` and `grantAudioCredits()`.
  - Added `GET /api/audio/admin/metrics` and `POST /api/audio/admin/credits` in `worker/routes/audio.ts`, behind the existing `requireAuth` + `requireAdmin` middleware, matching the PRD §7.8 route table.
  - Metrics returned: failure rate after retries split Draft/Final plus overall; median normalized generation speed (wall-clock ms per second of audio produced, from `gen_ms / actual_seconds` on ready jobs) split Draft/Final; cumulative API cost vs cumulative charged quota seconds; cost per generated hour split Draft/Final; per-user usage table (included consumed this calendar month from `quota_ledger` `included` rows, credits consumed all-time, credits remaining from `credit_balances`).
  - The per-user table lists all users so credits can be granted before first use.
  - The metrics endpoint returns ids, numbers, and statuses only; a route test asserts the response body does not contain script content.
- Credit grants:
  - `grantAudioCredits` validates the user exists, then upserts `credit_balances` and inserts a positive `credit_grant` ledger row in one D1 batch.
  - Route validation: `userId` non-empty string, `seconds` a positive integer; unknown user returns 404; non-admin returns 403.
- Admin dashboard UI:
  - Added an `Audio` tab to `src/pages/admin.tsx` with five cards: go/no-go thresholds, reliability, generation speed, costs/consumption, and per-user usage with an inline per-row credit grant (minutes input, converted to seconds).
  - The four §10 go/no-go thresholds display next to live values with GO/NO-GO badges where measurable now (failure rate, Final cost per generated hour vs the 2x $1.80/h threshold). The 2-minute Final dialogue median is marked "Mesurée par le harnais pilote (phase 7)" and shareable quality is marked as assessed by pilot listening.
  - UI shows Brouillon/Finale only; no model names.
  - Numbers are locale-formatted (FR comma decimals, USD currency).
- Quota header (REQ-8.2 alignment, flagged):
  - The Phase 4 header displayed one combined figure (`includedRemaining + credits`). It now shows `X min restantes ce mois` from included seconds plus `+ Y min de crédits` only when credits > 0, matching REQ-8.2 and making grants visible per the Phase 6 DoD. Generation-blocking logic is unchanged (still `included + credits` pool with the 1.2 margin).
- Voice preview seed:
  - Added `scripts/seed-voice-previews.ts` and `npm run audio:seed-voices` (append `-- --remote` for the production bucket; default is local R2).
  - One ~4s neutral English introduction per voice ("Hello! My name is {name}, and this is what I sound like."), Draft (Flash) model, default temperature (no temperature parameter sent), MP3-encoded via the existing assembly module, uploaded to `voices/{name}.mp3` with `Content-Type: audio/mpeg`.
  - Idempotent: existence is checked per voice with `wrangler r2 object get` before any API call, so re-runs skip existing previews and spend nothing.
  - Logs per-voice duration/retries and a final JSON summary with total audio seconds and total API cost.
- i18n:
  - Added FR + EN strings for the admin Audio tab and the header credits suffix (`audio.quota_credits`).
  - Extended `worker/lib/i18n-fr-lint.test.ts` with new unaccented regression forms (`Echouees|Reussies|Evaluee|Mesuree|Metrique|Crediter|credites|generee|echec`).

### Config note

- No config defaults were changed. Go/no-go threshold constants (5% failure, $3.60/h Final = 2x the published $1.80/h estimate) are informational display values in the admin component per PRD §4 REQ-10.3.

### Verification

- `npm test` passed: 55 tests (9 new in `worker/lib/audio-metrics.test.ts` covering aggregate math, month scoping of per-user included usage, ledger auditability of grants, 403 for non-admins, payload validation, and no-script-content in metrics).
- `npm run build` passed.
- `npm audit --omit=dev` passed: 0 vulnerabilities.
- Model-ID leak check: `grep -rn "gemini-" src/ worker/ scripts/ | grep -v provider | grep -v config` returns nothing outside tests.
- Local seed run against local R2: 30/30 previews generated, total 134.61s audio, total API cost $0.03375 (PRD estimate ~= $0.05). Immediate re-run: 30/30 skipped, $0. `GET /api/audio/voices/Kore/preview` now returns `200 audio/mpeg` (71,040 bytes).
- Local dev DoD walkthrough (`wrangler dev --local`, admin `greg@teachinspire.com`):
  - `GET /api/audio/admin/metrics` reflected the real Phase 3-5 jobs in local D1: 7 jobs (3 Draft ready, 3 Final ready, 1 stale generating fixture), 0% failure, median speed 623.75 ms/s Draft and 666.67 ms/s Final, cumulative cost $0.0910, charged 327s, cost per generated hour $0.90 Draft / $1.80 Final (Final exactly at the published estimate, GO).
  - `POST /api/audio/admin/credits` with 900s: `{"success":true,"credits":900}`; ledger row `+900 / credit / credit_grant / job_id null`; `GET /api/audio/quota` returned `credits: 900`.
  - Browser (agent-browser): admin Audio tab renders all five cards in French with GO badges; granted 10 minutes to `participant@test.com` through the UI, success message shown and the row updated to `10 min` credits remaining; `/audio` header reads `54 min restantes ce mois + 15 min de crédits`; Zephyr preview playback request returned `200` Media; no page errors.
- Screenshots:
  - Admin dashboard: `docs/audio-studio-screenshots/phase6-admin-audio-dashboard.png`
  - Credit grant result: `docs/audio-studio-screenshots/phase6-admin-credit-grant.png`
  - Quota header with credits: `docs/audio-studio-screenshots/phase6-quota-header-credits.png`

### Notes for review

- The production bucket has not been seeded; run `npm run audio:seed-voices -- --remote` once against the deployed `teachinspire-media` bucket (~$0.034 API cost).
- The per-user table header reuses the existing `auth.name` / `auth.email` keys, matching the Users tab convention.

### Phase 6 DoD

- [x] Seed script `scripts/seed-voice-previews.ts`: 30 samples to `voices/`, idempotent, cost logged.
- [x] Admin metrics endpoint and dashboard: failure rate, normalized generation speed, cumulative cost vs charged seconds, per-user usage, credit grant action.
- [x] Go/no-go thresholds displayed with live values; 2-minute-dialogue metric marked as measured by the pilot harness.
- [x] Dashboard reflects real generated jobs (local D1 jobs from Phases 3-5).
- [x] Credits can be granted and appear in the user's quota header.
- [ ] Human review by Greg.

Phase 6 awaits human review before Phase 7.

## Phase 6 review closeout - version control and caveats (2026-07-02)

### Phase 6 review verdict

Approved on substance by Greg:
- REQ-8.2 header split (included + credits shown separately): approved.
- Production voice-preview seed deferred to deployment: approved.
- Blocker raised: the working tree for Phases 0-6 was never committed.

### Retroactive commits

The entire Audio Studio working tree was committed on 2026-07-02, grouped
logically (not a reconstructed per-phase history; shared files were assigned
to their dominant phase):

- `30e6c16` phases 0-1 — migration, quota service, Vitest setup, R2/queue/TTS config
- `5d796c4` phase 2 — TTS provider, direction compiler, splitter, assembly, smoke script
- `b775c01` phase 3 — jobs API, queue consumer, voice catalog (includes phase 6 admin routes sharing `worker/routes/audio.ts`)
- `065bff9` phase 4 — 3-zone studio frontend, i18n, FR lint test (includes phase 5/6 UI additions sharing these files)
- `c3df701` phases 5-5b — prepare service, script rules, shared linter
- `b0675ae` phase 6 — admin metrics/credits, dashboard tab, voice preview seed, build log

`git status` verified clean after the final commit.

### Operating checklist change (from review)

The phase gate is now four checks, all required before a phase can be
reported complete:

1. `npm test`
2. `npm run build`
3. `npm audit --omit=dev`
4. `git status` clean — all phase work committed

### Phase 6 metrics caveat (from review)

The failure rate and cost-per-hour figures on the admin dashboard are
currently computed over only 7 local jobs and are NOT decision-grade.
The Phase 7 pilot harness provides the go/no-go measurement set.

## Phase 7 - Pilot harness (2026-07-02)

### Built

- Added `scripts/pilot-assets.ts` and `npm run audio:pilot`.
  - Generates the 7 pilot assets (PRD §10.3) through the REAL pipeline: each take is a `POST /api/audio/jobs` against a running dev server, processed by the actual queue consumer, polled to a terminal status, and its `final.mp3` downloaded to `.tmp/pilot-assets/` for the listening session.
  - All takes are Final quality. The B2 business scenario is written to ~2 minutes and runs 3 times so the "2-min Final dialogue" go/no-go metric is a median, not a single sample. The slow+natural pair generates the same script under both pace presets. 10 takes total.
  - Prints a per-take metrics table (estimated vs actual seconds, accuracy ratio, wall-clock, ms per audio second, retries, cost) plus a go/no-go summary, and writes `.tmp/pilot-assets/metrics.md`.
  - Config: `PILOT_BASE_URL` / `PILOT_EMAIL` / `PILOT_PASSWORD` env vars (defaults target local dev).

### Amendment - speaker-label heuristic narrowed (found by the harness)

The first harness run rejected 3 of the 7 assets before generation: the shared linter and the compiler-boundary guard both treated ANY line whose first colon fell within 80 characters as a speaker label. Ordinary prose colons — `...regarda l'horloge : six heures dix.` (FR narration), `...enjoy the flexibility: they can...` (EN pair) — blocked monologue generation entirely. Real teacher scripts would hit this constantly.

Fix, kept within the approved Phase 5b intent (block speaker labels, not prose):
- New shared helper `speakerLabelPrefix()` in `src/lib/audio-script-rules.ts`: a colon marks a label only when the prefix is 1-3 words (`Sarah`, `M. Dupont`, `Speaker 1`) within 40 characters and does not start with a tag bracket.
- `lintAudioScript` and `validateTranscriptForTts` (`worker/lib/audio-direction.ts`) now share this single definition, so client lint, server lint, and the TTS compiler boundary agree.
- Genuine labels are still blocked in monologue and still normalized/enforced in dialogue; the strict Speaker 1/2 dialogue rule is unchanged.
- Tests extended (+3): prose colons pass in both layers, short labels still rejected, dialogue narration with a prose colon stays a warning.

### Dev-workflow gotcha (cost one debugging session, recorded for future phases)

`.wrangler/deploy/config.json` (written by @cloudflare/vite-plugin at build time) redirects `npx wrangler dev` to the PREBUILT worker in `dist/promptomatik/`, not to `worker/index.ts` source. Worker changes are invisible to `wrangler dev` — including across restarts and cache clears — until `npm run build` regenerates dist. Two harness runs hit stale lint code this way. Rule going forward: `npm run build` before any `wrangler dev` verification, and confirm by grepping `dist/promptomatik/index.js` for the changed string.

### Pilot metrics (final clean run, 2026-07-02, local dev, real Gemini API)

| Asset | Lang | Mode | Run | Status | Est s | Actual s | Accuracy (act/est) | Wall time | ms/audio-s | Retries | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A2 monologue (EN) | EN | monologue | 1/1 | ready | 32 | 49 | 1.53x | 36.5s | 745 | 0 | $0.0245 |
| B1 workplace dialogue (FR) | FR | dialogue | 1/1 | ready | 54 | 36 | 0.67x | 33.2s | 863 | 0 | $0.0180 |
| B2 business scenario, 2-min dialogue (EN) | EN | dialogue | 1/3 | ready | 102 | 80 | 0.78x | 57.3s | 715 | 0 | $0.0400 |
| B2 business scenario, 2-min dialogue (EN) | EN | dialogue | 2/3 | ready | 102 | 80 | 0.78x | 66.3s | 808 | 0 | $0.0400 |
| B2 business scenario, 2-min dialogue (EN) | EN | dialogue | 3/3 | ready | 102 | 82 | 0.80x | 58.0s | 707 | 0 | $0.0410 |
| EN roleplay (hotel check-in) | EN | dialogue | 1/1 | ready | 55 | 44 | 0.80x | 36.2s | 773 | 0 | $0.0220 |
| FR classroom narration | FR | monologue | 1/1 | ready | 39 | 43 | 1.10x | 33.2s | 714 | 0 | $0.0215 |
| Dictation version (FR) | FR | monologue | 1/1 | ready | 24 | 37 | 1.54x | 30.2s | 766 | 0 | $0.0185 |
| Slow+natural pair — slow take (EN) | EN | monologue | 1/1 | ready | 35 | 51 | 1.46x | 39.3s | 720 | 0 | $0.0255 |
| Slow+natural pair — natural take (EN) | EN | monologue | 1/1 | ready | 35 | 42 | 1.20x | 36.4s | 865 | 0 | $0.0210 |

| Go/no-go metric | Threshold | Measured |
|---|---|---|
| Failure rate after retries | < 5% | 0.0% (0/10 takes) |
| Real cost per generated hour (Final) | < $3.60/h (2x $1.80/h estimate) | $1.80/h |
| Median generation time, 2-min Final dialogue | < 3 min | 58.0s over 3 runs |
| Quality shareable with learners | 7 pilot assets | pending Greg's listening session |

Total API cost: $0.2720 · total audio: 544s · takes with actual > 2x estimate: 0.

Observations for the pilot record:
- Slow-pace and dictation monologues run 1.2x-1.55x over the word-count estimate (the 150 wpm assumption is too fast for slowed delivery); dialogues run 0.67x-0.80x under it. Nothing crossed the 2x admin flag in the final run.
- Dictation duration was unstable in an earlier run on the same script (36s vs 223s across runs — the model sometimes inserts very long inter-sentence pauses with the dictation style). Worth listening for; if long-pause takes recur in the pilot, per-style estimate multipliers are a V1.5 candidate.
- Cost per generated hour landed at exactly the published $1.80/h Final estimate in every run (pricing is linear in audio seconds, so this is expected — the metric guards against pricing config drift and retry waste).

### Listening notes template (fill during the pilot session)

For each asset: play `.tmp/pilot-assets/<slug>.mp3` (regenerate anytime with `npm run audio:pilot`). Judge FR and EN separately.

| # | Asset | File | Voice quality (1-5) | Pace/level fit (1-5) | Tags rendered correctly? | Artifacts/glitches? | Shareable with learners? | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | A2 monologue (EN) | a2-monologue-en.mp3 | | | | | oui / non | |
| 2 | B1 workplace dialogue (FR) | b1-workplace-dialogue-fr.mp3 | | | | | oui / non | |
| 3 | B2 business scenario (EN, 2 min) | b2-business-2min-en-run1..3.mp3 | | | | | oui / non | |
| 4 | EN roleplay (hotel) | en-roleplay-hotel.mp3 | | | | | oui / non | |
| 5 | FR classroom narration | fr-classroom-narration.mp3 | | | | | oui / non | |
| 6 | Dictation version (FR) | fr-dictation.mp3 | | | | | oui / non | |
| 7 | Slow+natural pair (EN) | en-pair-slow.mp3 + en-pair-natural.mp3 | | | pair contrast audible? | | oui / non | |

Session verdict: FR shareable __ / EN shareable __ / overall go-no-go __.

### Phase 7 DoD

- [x] `scripts/pilot-assets.ts` generates the 7 pilot assets through the real pipeline.
- [x] Metrics table printed from one command; attached above with the go/no-go summary.
- [x] Listening notes template attached.
- [x] All four go/no-go metrics measurable from one command plus a listening session; the three automated ones are green on the final run.
- [ ] Greg's listening session and human review.

Phase 7 awaits human review.

## Phase 7 review sign-offs (2026-07-02)

Greg's review of the Phase 7 automated results: the three automated
go/no-go metrics are GO. Phase 7 remains OPEN pending the human
listening verdicts on the current `.tmp/pilot-assets/` set (that set is
the review set — do not regenerate unless asked).

1. Amendment APPROVED — speaker-label detection narrowed to a 1-3-word
   prefix, one shared `speakerLabelPrefix()` helper across the linter
   and the compiler guard, tests in both directions (commit `bee9e03`).
2. Rebuild-before-verify rule acknowledged and kept in the operating
   checklist: `npm run build` before any `wrangler dev` verification
   (deploy-config redirect serves the prebuilt dist worker).
3. Known issue — dictation duration instability: the same dictation
   script produced 36s and 223s takes across runs (the model sometimes
   inserts very long inter-sentence pauses with the Dictation style).
   Decision on whether Dictation stays in the V1 style list is PENDING
   the human listening session. The style list must not change until
   instructed.

No further code work until the listening verdicts: no acceptance
walkthrough, no deployment, no pilot-asset regeneration.

## Phase 7 closure - listening verdict and dictation decision (2026-07-02)

### Go/no-go outcome - all four criteria GO

| Criterion | Threshold | Result |
|---|---|---|
| Generation failure rate after retries | < 5% | 0.0% (0/10 pilot takes) - GO |
| Real cost per generated hour (Final) | < 2x estimate ($3.60/h) | $1.80/h - GO |
| Median generation time, 2-min Final dialogue | < 3 min | 58.0s over 3 runs - GO |
| Quality shareable with learners | 7 pilot assets, FR and EN judged separately | Validated by Greg's listening session on all seven assets, FR and EN - GO |

Phase 7 is CLOSED.

### Decision - Dictation removed from the V1 delivery-style list (Greg)

Rationale: duration variance of up to 6x on identical input (36s vs 223s
observed on the same dictation script) makes real-cost charging
unpredictable for participants, which conflicts with the quota-trust
promise. Dictation returns in V1.5 built on pause presets with
programmatic PCM silence insertion (deterministic durations, zero model
dependency) rather than model-performed pauses.

Implemented:
- Removed the style from `STYLE_EXPANSIONS` (`worker/lib/audio-config.ts`)
  and from the frontend preset list + FR display label (`src/pages/audio.tsx`).
- Replaced the third compiled-prompt snapshot (C1 dictation) with a C1
  Examiner voice snapshot so the representative set stays at three.
- Added a `help_dictation` line (FR + EN) to the "Bien écrire pour
  l'audio" panel: timed-pause dictation arrives in a future version;
  manual `[pause]` tags are the interim workaround.
- No other style changes.
- Note: `scripts/pilot-assets.ts` still references the removed preset in
  its historical asset 6 definition. `expandPreset` falls back to the raw
  key, so a future harness run would compile the style text verbatim -
  harmless, and the Phase 7 review set is already archived. Left as-is to
  preserve the pilot record.

### Verification

- `npm test` passed: 58 tests.
- `npm run build` passed.
- `npm audit --omit=dev` passed: 0 vulnerabilities.
- `git status` clean after commit (gate check 4).

## Acceptance walkthrough - AGENT_INSTRUCTIONS §4 (2026-07-02)

Environment: local `wrangler dev` on the freshly built worker (rebuild-before-verify),
real local D1/KV/R2 state including the pilot jobs, browser via agent-browser,
API via curl. Admin account `greg@teachinspire.com`.

### Gaps found by the walkthrough and fixed during it

1. REQ-2.3 - the tag panel had no note that tags stay in English. Added
   `audio.tags_english_note` (FR + EN) rendered under the panel.
2. REQ-8.3 - the blocked state had contact text but no actionable entry
   point. Added a `mailto:greg@teachinspire.com` link (address chosen by
   Greg) with a prefilled subject, FR + EN strings.
3. REQ-3.3 - "French-accented English" existed in the backend accent
   expansions but was missing from the frontend preset list. Added, with
   the FR display label "Anglais avec accent français" (11 accents total).
4. FR lint regression pattern extended for the new strings.

### REQ-by-REQ evidence

- REQ-1.1 modes: Dialogue/Monologue toggle present (browser).
- REQ-1.2 turn rendering: alternating Speaker 1/2 turns visually distinct in the preview (screenshot `phase8-acceptance-player-blocks.png`).
- REQ-1.3 >2 speakers: pasting a 3-speaker script showed "Deux locuteurs maximum pour cette version." and disabled Generate (browser).
- REQ-1.4 live estimate: "env. 10s" for a 24-word script, updates on edit (browser).
- REQ-1.5 tag highlighting: inline `[curious]` rendered highlighted in the preview (screenshot).
- REQ-2.1 tag panel: all 19 required tags present (browser count).
- REQ-2.2 insertion at cursor: verified in-page (tag appended at the active cursor position); also human-verified in the Phase 4 review. Note: synthetic automation clicks without a real focus/selection don't reproduce it - real-user behavior is the verified path.
- REQ-2.3 English-tags note: "Les tags restent en anglais, même pour les scripts en français (recommandation Google)." visible under the panel (fixed during walkthrough).
- REQ-3.1 five controls: NIVEAU, ACCENT, RYTHME, STYLE selects + SCÈNE free text - exactly five (browser).
- REQ-3.2 compiled prompt hidden: compilation happens only in the worker (`compileDirection`); no UI surface renders it; §4 grep confirms no model/prompt leakage client-side.
- REQ-3.3 accent presets: 11 options after fix (7 EN + 4 FR per PRD); free-text refinement appended verbatim (compiler snapshot tests).
- REQ-3.4 CEFR delivery-only: compiler snapshots show CEFR modifiers in Director's Notes only; script text is never rewritten (unit tests).
- REQ-4.1 voices: 30 voice cards with descriptors (browser count; catalog endpoint).
- REQ-4.2 previews from R2: `GET /api/audio/voices/:name/preview` streams the seeded static MP3 (200, audio/mpeg, cache-control 86400); no live TTS call in the preview path.
- REQ-4.3 voice casting: dialogue requires one voice per speaker, monologue exactly one - enforced in UI (missing voices disable Generate) and server-side (`validateCreateInput`, unit + integration tests).
- REQ-5.1 validation + statuses: pilot harness drove 10 jobs through queued → generating → assembling → ready with live console states; server-side validation tests green.
- REQ-5.2 quality routing: Draft→Flash / Final→Pro resolved from config only (`modelForQuality`); UI shows Brouillon/Finale only.
- REQ-5.3 retries: provider retry policy (2s/8s/30s on 500/429/503/text-instead-of-audio, no retry on PROHIBITED_CONTENT) unit-tested; observed retry counts recorded per job.
- REQ-5.4 assembly + charge: pilot jobs produced final.wav/mp3/transcript in R2 and charged measured seconds to the ledger (Phase 3 curl + today's pilot ledger rows).
- REQ-5.5 failure = no charge: integration test (failed block after retries leaves no ledger row).
- REQ-5.6 polling: frontend polls active jobs every 3000 ms (`src/pages/audio.tsx:320`); Phase 4 verified polling stops after navigation.
- REQ-6.1 player + boundaries: ready 2-min dialogue rendered the waveform player (203 bars) with a visible block boundary (screenshot).
- REQ-6.2 block regeneration: waveform block selection reveals "Régénérer ce bloc" (Phase 4 human review); backend regeneration + pro-rata charge demonstrated by curl in Phase 3 (-71s generation, -76s regeneration ledger rows) and covered by tests.
- REQ-6.3 downloads: MP3 / WAV / TXT buttons on the ready player; authenticated proxy downloads verified by curl (Phase 3) and by the pilot harness MP3 downloads (approved amendment replacing signed URLs).
- REQ-6.4 expiry: R2 lifecycle rule `audio-expire-7d` on prefix `audio/` confirmed live on the remote bucket (`wrangler r2 bucket lifecycle list`); `voices/` has no expiry rule; every history row displays "Expire le DD/MM/YYYY".
- REQ-7.1 one Flash text call, three passes: Phase 5/5b implementation and E2E; contract tests green.
- REQ-7.2 accept/reject diff: Phase 5b E2E + screenshot `phase5-prepare-diff-view.png`; nothing applied silently.
- REQ-7.3 preparation not charged: the prepare route contains no quota charge call (code inspection - `grep charge worker/routes/audio.ts` is empty for prepare).
- REQ-7.4 empty-state: Prepare disabled with the exact hint "Collez d'abord votre script — Audio Studio le prépare, il ne l'écrit pas." (browser).
- REQ-8.1 quota model: 3600 included seconds per calendar month, included-first then credits, implicit KV reset - unit tests incl. month rollover and exact straddle.
- REQ-8.2 header: "21 min restantes ce mois + 15 min de crédits" observed; credits suffix shown only when > 0.
- REQ-8.3 blocked generation: a 7,002-word script (estimate > remaining × 1.2) disabled Generate and showed "Quota insuffisant pour cette estimation." with the mailto entry point (screenshot `phase8-acceptance-quota-blocked.png`).
- REQ-8.4 actual-seconds charge: charges equal measured PCM seconds rounded up; regeneration pro-rata (unit tests + pilot ledger).
- REQ-8.5 auditable ledger: every movement is a ledger row - generation, regeneration, credit_grant verified in D1 during Phases 3/6 and today.
- REQ-9.1 history rows: title from first script words · mode · quality · duration · status · localized expiry, most recent first (browser).
- REQ-9.2 duplicate settings: clicking a history row restored script, direction, voices, and quality into the editor (screenshot).
- REQ-10.1 job metrics: model_used, estimated vs actual seconds, gen_ms, retry_count, api_cost_usd recorded per job (D1 rows from the pilot).
- REQ-10.2 admin dashboard: failure rate, normalized speed, cumulative cost vs charged seconds, per-user usage, credit grant - live in the Audio tab (Phase 6 + today's data).
- REQ-10.3 thresholds: the four go/no-go thresholds display next to live values; all four now GO (Phase 7 closure).
- NFR-1 i18n: FR default on first load; full EN pass verified by switching languages ("21 min remaining this month + 15 min credits", Booth, Draft, Generate take); FR/EN key sets are identical (parity script: no diff either direction).
- NFR-2 config: model IDs, prices, prompt expansions, prep model all in `wrangler.jsonc` / `worker/lib/audio-config.ts`.
- NFR-3 privacy/access: nanoid R2 keys, authenticated proxy downloads (approved amendment), ownership checks (403 tests), no script-content logging (metrics endpoint tested for script absence).
- NFR-4 honest degradation: no simulated progress; statuses come from polled job/segment state (Phase 4 verification; pilot console observation).

### §4 checklist

- [x] Every REQ 1-10 acceptance criterion walked one by one (above).
- [x] All tests green (58); `grep -rn "gemini-" src/ | grep -v provider | grep -v config` returns nothing.
- [x] FR and EN UI complete; French default; key parity verified.
- [x] R2 lifecycle rule on `audio/` confirmed at 7 days on the live bucket; `voices/` untouched.
- [x] Pilot harness output attached (Phase 7 entry).
- [x] Deviations documented with rationale (proxy downloads, REQ-8.2 header split, speaker-label heuristic, Dictation removal - all approved and logged).

### Walkthrough screenshots

- `docs/audio-studio-screenshots/phase8-acceptance-script-zone.png`
- `docs/audio-studio-screenshots/phase8-acceptance-player-blocks.png`
- `docs/audio-studio-screenshots/phase8-acceptance-quota-blocked.png`

### Verification

- `npm test` passed: 58 tests.
- `npm run build` passed.
- `npm audit --omit=dev` passed: 0 vulnerabilities.
- `git status` clean after commit.

The acceptance walkthrough is complete. Deployment is the next step and is
not started - awaiting Greg's instruction.

## Deployment (2026-07-02)

Deployed on Greg's go after the completed §4 acceptance walkthrough.

Steps executed, in order:
1. `wrangler secret put GEMINI_API_KEY` - uploaded (was absent from the remote secret list; value never logged).
2. `wrangler queues create audio-generation` - created; confirmed in `wrangler queues list`.
3. `wrangler d1 execute promptomatik-db --remote --file=./migrations/0011_audio_studio.sql` - applied; all four tables (`audio_jobs`, `audio_segments`, `quota_ledger`, `credit_balances`) confirmed present in remote D1.
4. `npm run deploy` - version `3c142af0-478d-473b-a726-01c27c0decd6` uploaded with bindings: SESSIONS KV, DB, MEDIA R2, both queues (producer + consumer for `interview-jobs` and `audio-generation`), and the TTS config vars.
5. `npm run audio:seed-voices -- --remote` - 30/30 previews generated and uploaded to `voices/` in the production bucket; 138.57s audio, $0.03475 API cost.

Post-deploy verification:
- `GET https://promptomatik.com/api/health` → 200.
- SPA root → 200.
- `GET /api/audio/quota` and `/api/audio/voices` unauthenticated → 401 (auth enforced).
- `voices/Kore.mp3` in remote R2 starts with an MP3 frame-sync header.
- R2 lifecycle: `audio/` 7-day expiry active; `voices/` has no expiry rule (verified during acceptance).

Not exercised in production: an authenticated end-to-end generation (first
live take is Greg's - the queue consumer is attached and identical to the
pipeline the pilot validated locally).

TeachInspire Audio Studio V1 is live.

## Post-deploy incident - production login 500 (2026-07-02, resolved)

Symptom: `POST /api/auth/login` returned 500 in production immediately
after the V1 deploy; password reset appeared not to take effect.

Root cause: the deployed worker (which includes the freemium/tier feature
from commit `08d5a5e`, never previously deployed) reads `users.tier`
during login, but remote D1 was still at migration level 0006 - migrations
0007 (Spanish language rebuild), 0008 (interview job kinds), 0009 (user
tier), and 0010 (self-serve invitations) had only ever been applied
locally. The deploy checklist verified/applied only 0011 (audio). The
missing `tier` column made the login query throw → 500.

Fix, in order:
1. Production D1 backup exported before any DDL:
   `.tmp/prod-backup/pre-migration-20260702-165631.sql` (865 KB; D1
   Time Travel also available).
2. Verified remote `prompts` columns matched 0007's rebuild SELECT.
3. Applied 0007, 0008, 0009, 0010 remotely in order (417/724/12/93 rows
   written; no errors - the `PRAGMA foreign_keys` statements were
   accepted by remote D1).
4. Verified: `users.tier` present, 11/11 existing users backfilled to
   `participant` per 0009, row counts preserved (11 users, 46 prompts,
   11 invitations), and the login path returns 401 for bad credentials
   instead of 500.

Checklist change: before any production deploy, verify remote schema
parity across the ENTIRE migration chain (e.g. compare
`sqlite_master` against local), not just the migration added by the
current feature. The repo's `db:migrate` script is local-only, which
makes this drift easy to create.

## Post-launch fix - missing accent free-text refinement (2026-07-02)

Reported by Greg minutes after launch: accent presets are limited to
FR/EN while the TTS model speaks many more languages - customization
needed.

Finding: this was a missed PRD requirement, not a new feature. REQ-3.1/3.3
specify "Accent (preset list + free-text refinement, e.g. city)... Free-text
refinement is appended verbatim." The compiler and API types supported
`accentDetail` since Phase 2 ("...English, specifically {detail}"), but the
input was never built into the Direction zone - and the acceptance
walkthrough verified the compiler path, not the UI input. Walkthrough
correction noted.

Fix:
- Added the free-text input under the Accent select: label "Précision
  d'accent (libre)" / "Accent refinement (free text)", placeholder
  suggesting city/region/language, maxLength 120.
- Wired into direction state; flows through direction_json to the
  compiler verbatim (existing unit-tested path). Duplicate-settings
  restores it automatically.
- FR/EN strings added; `.field input` styled like selects.
- Verified E2E on local dev: Spanish monologue draft with
  `accentDetail: "accent andalou"` persisted to the job row; spoken
  language follows the script text (model behavior), presets/refinement
  shape accent and delivery.
- Screenshot: `docs/audio-studio-screenshots/phase8-accent-detail-field.png`

Gate green (58 tests, build, audit); deployed to production.

## PRD amendment - per-speaker direction in dialogues (2026-07-02)

Requested and approved by Greg post-launch: dialogues need differentiated
interlocutors (native/learner pairs, contrasting registers, different
accents in one exchange). Scope decision (Greg): per-speaker accent
(preset + free refinement), style (preset), and a free "manner of
speaking" note - all as overrides of the global Direction. CEFR level,
pace, and scene stay global for pedagogical consistency.

### Built

- Data: optional `direction.speakers["Speaker 1"|"Speaker 2"]` with
  `{accent?, accentDetail?, style?, notes?}`. Stored in the existing
  `direction_json` column - no migration.
- Compiler: AUDIO PROFILE lines are now per-speaker. A speaker with
  overrides gets `Speaker N: {style persona}. Accent: {expansion},
  specifically {detail}. Manner of speaking: {notes}.` Speakers without
  overrides keep the global persona; jobs without overrides compile
  byte-identically to the previous template (existing snapshots
  unchanged; new snapshot covers the override case).
- Server: `normalizeSpeakerDirections()` keeps only canonical Speaker 1/2
  keys (Locuteur accepted), trims and caps fields (accent 80,
  accentDetail 120, style 80, notes 200), drops empty entries, and strips
  the whole object in monologue mode.
- UI: "Direction par locuteur" row under the casting grid (dialogue mode
  only) with one button per speaker opening a per-speaker dialog: accent
  (with "Hériter des réglages globaux"), accent refinement, style
  (inherit option), manner-of-speaking note. A "Personnalisé" badge marks
  configured speakers. FR + EN strings.
- Duplicate-settings restores overrides automatically (direction is
  restored wholesale).

### Verification

- `npm test` passed: 63 tests (+4 normalizer, +1 compiler snapshot).
- `npm run build` + `npm audit --omit=dev` passed.
- Browser E2E on local dev: configured Speaker 2 via the dialog
  (French-accented English, "débutant, de Lyon", Informal conversation,
  "hésite souvent, cherche ses mots"), badge shown, generated a Draft
  dialogue to `ready`; `direction_json.speakers` persisted exactly the
  configured overrides.
- Screenshot: `docs/audio-studio-screenshots/phase8-speaker-direction-dialog.png`

## Post-launch fix - EN mode showed French across the studio (2026-07-02)

Reported by Greg: much of Audio Studio stayed French in EN mode. Root
cause: the Phase 4 "no mixed English in the FR view" fix hardcoded
French display maps and literals instead of using i18n - DIRECTION_LABELS,
STATUS_LABELS, PREPARE_GROUP_LABELS in the page, DESCRIPTORS_FR and slot
labels in VoiceCasting, and every sentence in GenerationConsole and
WaveformPlayer (titles, status lines, aria labels, metrics, downloads,
regenerate action).

Fix:
- 40 new i18n keys (FR + EN) covering statuses, prepare groups,
  casting labels/aria, the whole generation console, and the whole
  player. Key parity verified.
- Direction presets and voice descriptors: FR maps kept as display-only
  transforms, now gated on the current language; EN shows the backend
  English values directly.
- Stale hardcoded maps removed from the page.
- Browser audit in EN mode: no residual French UI (only user script
  content); FR mode unchanged; history rows now fully localized
  ("Ready · Expires ..." / "Prêt · Expire le ...").

Also fixed while in the console: the "Modèle" metric rendered
`job.modelUsed` - the raw model ID - whenever a regenerated job passed
through the console (model_used is set after the first assembly). This
violated the hard "model names never in the UI" rule; the console now
always shows Brouillon/Finale.

Gate green: 63 tests, build, audit, clean tree. Deployed.

## UX fix - per-speaker direction merged into the Direction zone (2026-07-02)

Greg's review: "Direction" vs "Direction par locuteur" conflicted. Root
causes identified before redesign: (1) two places claimed authority over
the same fields (accent/style) with an inheritance rule that lived in a
dialog subtitle, not in the structure; (2) identical field labels with
different scopes; (3) hidden state - the screen could show a global
accent while a speaker would actually voice another one; (4) per-speaker
direction was placed in the casting zone (who) instead of the Direction
zone (how); (5) "Hériter des réglages globaux" is developer vocabulary.

New structure - one rule, visible in the layout, no hidden state:
- Dialogue mode: the Direction zone shows the shared controls (Niveau,
  Rythme, Scène) plus one always-visible fieldset per speaker
  ("Locuteur 1" / "Locuteur 2"), each with Accent, Précision d'accent,
  Style, and Façon de s'exprimer. What is displayed is exactly what will
  be voiced. Speaker 1's accent/précision/style mirror into the global
  direction fields so the compiled Director's Notes and the monologue
  form stay coherent.
- Monologue mode: the flat five-field form, unchanged behavior.
- Removed: the "Direction par locuteur" row in the Cabine, the
  per-speaker dialog, the "Personnalisé" badge, the "Hériter" options,
  and their i18n keys and styles.
- Backend, data model, and compiler unchanged - the same
  direction.speakers overrides flow through.

Verification: 63 tests green, build + audit green; browser check of both
modes (dialogue shows two legended fieldsets, monologue collapses to the
flat form), Speaker 1 -> global mirroring confirmed, FR/EN parity kept.
Screenshot: docs/audio-studio-screenshots/phase8-direction-per-speaker-inline.png

## Feature - manner-of-speaking note in monologue mode (2026-07-02)

Requested by Greg. The dialogue speakers already had a free "Façon de
s'exprimer" note; monologue mode now has the same field.

- `direction.notes` (optional, capped at 200 chars server-side like the
  per-speaker notes) is compiled into the narrator profile line:
  "The speaker: {persona}. Manner of speaking: {notes}."
- Dialogue mode ignores the global note (speakers carry their own).
- UI: the field appears after Style in the monologue Direction form,
  reusing the existing FR/EN labels.
- Tests: compiler note test + normalizer trim/cap/drop tests (65 total).

## Design audit + fixes - Interface Craft critique (2026-07-03)

Ran the Interface Craft design-critique methodology on the studio (empty
dialogue state + ready-player state). Full critique delivered to Greg;
the five ranked opportunities were approved and applied:

1. Welcoming empty state: the red "À corriger avant génération" blocking
   alert no longer renders while the script is untouched/empty (the
   disabled Generate button and the paste hint carry the state), and the
   "env. 0s" estimate is hidden until there is a script. Lint display is
   unchanged as soon as any text exists; server-side lint untouched.
2. Per-block regeneration discoverability: visible dashed boundary lines
   between blocks on the waveform, plus a persistent hint under it
   ("Cliquez un bloc de la forme d'onde pour le régénérer seul.") shown
   until a block is selected.
3. Speaker fieldset hierarchy: legends stepped up (0.88rem, navy) above
   field labels; untouched per-speaker accent/style selects render muted
   until explicitly set; "(LIBRE)" suffixes dropped from labels; clipped
   placeholders shortened ("Ex. : Marseille, andalou" / "Ex. : hésite,
   cherche ses mots").
4. Estimate vs actual reconciliation: the player now shows
   "Estimé {mm:ss} · réel {mm:ss}" under the playback time.
5. Deduplication: the editor collapses to 110px once a take is ready
   (re-expands on focus); history expiry dates are relative ("Expire
   dans 7 j", absolute date on hover) and the status is visually muted
   for Prêt, teal for in-flight, red for failed (status text kept on
   every row per REQ-9.1).

Not covered by this audit pass (flagged for later): mobile layout and
the admin Audio tab.

Gate: 65 tests, build, audit green; browser-verified both states.
