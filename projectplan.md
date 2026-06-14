# Project Plan — Tiered Access (Free Lead Magnet / Participant)

Spec: two-tier access model. `free` = email-gated lead magnet, `participant` = full product for training participants.

Repo: `~/Documents/GitHub/teach/promptomatik` (Hono worker + Queue consumer, D1, KV sessions, OpenRouter Sonnet/Kimi, Resend, fr/en/es).

---

## Codebase reality check (spec vs. code)

The spec maps onto this codebase almost 1:1. Three adaptations:

1. **`GET /api/profile` is load-bearing for all users.** `dashboard.tsx:94` calls `getProfile()` and `onboarding-context.tsx` calls `updateProfile()` to persist tour flags. A blanket 403 (spec §5.3) would break the dashboard and onboarding tour for free users. Adaptation: **GET stays open for all tiers; PUT for free users accepts only onboarding-flag fields** (`onboarding_*`, `profile_onboarding_*` — teaching-profile fields silently filtered); the `/profile` page is gated in the UI; profile injection into LLM context is tier-guarded in the consumer. Net product effect is identical (free users have no usable teacher profile).
2. **`invitations.invited_by` is `NOT NULL` FK → users** (`migrations/0001`). Self-signups have no inviter, and SQLite can't drop NOT NULL via ALTER → Migration B rebuilds the table (the `PRAGMA foreign_keys = OFF` rebuild pattern already used in 0007/0008).
3. **Model routing without config rename:** keep `OPENROUTER_MODEL` / `OPENROUTER_FALLBACK_MODEL` and reverse the chain for free users (free → Kimi primary, Sonnet fallback). The spec's `MODEL_PREMIUM`/`MODEL_ECONOMY` rename is optional polish — skipped for minimal diff unless you want it.

Everything else lands exactly where the spec says: quota at `POST /api/interview/analyze` (before job creation — `worker/routes/interview.ts:22`), tier in the job payload at enqueue (`createInterviewJob`), tier-aware `llmModels()` in the consumer (`worker/lib/interview-jobs.ts:119`), profile injection guard around `fetchProfile` (`interview-jobs.ts:144`).

---

## Step 1 — Migrations + backfill

- [x] `migrations/0009_add-user-tier.sql`:
  `ALTER TABLE users ADD COLUMN tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free','participant'));`
  `UPDATE users SET tier = 'participant';` (all existing users were invited for the training)
- [x] `migrations/0010_invitations-self-serve.sql`: rebuild `invitations` (0007/0008 PRAGMA pattern) with `invited_by TEXT NULL` (FK kept), `tier TEXT NOT NULL DEFAULT 'participant' CHECK (tier IN ('free','participant'))`, `kind TEXT NOT NULL DEFAULT 'admin' CHECK (kind IN ('admin','self'))`; copy data; recreate the three indexes
- [x] Apply both to local D1; verify clean apply on a fresh DB

## Step 2 — `/me` returns tier + quota (invisible deploy)

- [x] `worker/routes/auth.ts`: `UserRow`/`userResponse` gain `tier`; `/me` adds `quota: { used, limit } | null` (null for participant/admin; read from quota KV for free)
- [x] `login`/`register` responses include `tier` (consistent `setUser`)
- [x] `src/lib/api.ts`: `User.tier`, `MeResponse.quota`
- [x] `src/lib/auth/auth-context.tsx`: store quota; expose `isParticipant` (tier === 'participant' || role === 'admin'), `quota`, and `refreshMe()` (re-fetch `/me` — used to update the quota chip after generations)

## Step 3 — Tier gating (backend + frontend)

Backend:
- [x] `worker/lib/auth-middleware.ts`: `requireParticipant` — `session.role === 'admin'` bypasses; else `SELECT tier FROM users`; failure → `403 { error: 'tier_required', required: 'participant' }` (stable contract)
- [x] Gate: all of `worker/routes/templates.ts`, `POST /api/interview/refine`, `POST /api/prompts/:id/submit-template`
- [x] `worker/routes/profile.ts`: GET open; PUT filters free users' input to onboarding-flag fields (adaptation #1)
- [x] `worker/routes/prompts.ts` `POST /` + `POST /:id/duplicate`: free tier → `COUNT(*) FROM prompts WHERE user_id = ? AND is_template = 0`; ≥ 3 → `403 { error: 'library_limit', limit: 3 }`

Frontend:
- [x] New `src/components/upgrade-gate.tsx` (+ module.css): branded "Available for training participants" panel, CTA → training landing page; variants: full-page, inline panel, library-cap ("3/3 prompts saved")
- [x] Full-page gate on `profile.tsx`, `templates.tsx`, `template-detail.tsx` when `!isParticipant`
- [x] `refinement-flow.tsx`: trigger visible for free users, opens gate panel instead of the flow (discovery > hiding)
- [x] Save/duplicate `library_limit` error → gate panel
- [x] `shell.tsx`: lucide `Lock` badge on Templates + Profile nav for free users (visible, not hidden)
- [x] i18n keys in `fr.json`, `en.json`, `es.json`

## Step 4 — Daily quota (KV)

- [x] `worker/lib/quota.ts`: key `quota:interview:{userId}:{YYYY-MM-DD}` (UTC) in `env.SESSIONS` KV, TTL 172800, limit 5; `getQuota` / `incrementQuota`
- [x] `POST /api/interview/analyze`: participant/admin skip; at limit → `429 { error: 'daily_quota', limit: 5, resets_at: <next UTC midnight ISO> }` **before** `createInterviewJob`; else increment. `questions`/`assemble` untouched (already-admitted interview; ownership checks exist)
- [x] `/me` quota wiring (step 2) returns real counts
- [x] Front: chip "Generations today: X/5" on dashboard + `/new` (free only); friendly 429 full-state on `/new` ("resets in Xh" + participant pitch); `refreshMe()` after analyze
- [x] i18n keys

## Step 5 — Tier-aware model routing (queue consumer)

- [x] Job request payloads gain `tier: 'free' | 'participant'`, resolved at enqueue: `worker/routes/interview.ts` fetches tier once per request (admin → 'participant') and passes it into `createInterviewJob` for all four kinds
- [x] `worker/lib/interview-jobs.ts` `llmModels(env, tier)`: participant → `[OPENROUTER_MODEL, OPENROUTER_FALLBACK_MODEL]`; free → reversed. Missing `tier` in old queued payloads → default 'participant'
- [x] Profile injection guard: in the four `process*Job` functions, fetch/inject profile only when `tier === 'participant'` (defensive — free users can't complete a profile anyway)
- [x] Existing `llmUsedFallbackModel`/`llmModel` log fields already verify routing per job — no extra logging needed

## Step 6 — Public signup

- [x] `POST /api/auth/signup` (public, in `worker/routes/auth.ts`): validate + normalize email; KV IP rate limit `ratelimit:signup:{ip}` max 5/h (`CF-Connecting-IP`) → 429; existing user → generic `{ ok: true }` (anti-enumeration); pending self-invitation → resend email → `{ ok: true }`; else insert invitation `kind='self'`, `tier='free'`, `invited_by=NULL`, 7-day expiry + send confirmation → `{ ok: true }`. Body: `{ email, language?: 'fr'|'en'|'es' }`
- [x] `worker/lib/email.ts`: `sendSignupConfirmationEmail` (fr/en/es), link `/register?token=...` (existing acceptance flow unchanged)
- [x] `POST /register`: set `users.tier` from `invitations.tier`; expired **self** invitation → error payload includes flag so the front offers "request a new link" (→ `/signup`)
- [x] Front: `src/pages/signup.tsx` (+ css) — email + language + consent line; "check your inbox" success state; route in `App.tsx`; `/login` link "No account? Get free access"; `api.ts` `signup()`
- [x] i18n keys

## Step 7 — Marketing webhook

- [x] `Env.MARKETING_WEBHOOK_URL?` (secret, optional)
- [x] In `POST /register`, when invitation `kind='self'`: `c.executionCtx.waitUntil(...)` POST `{ email, language, source: 'promptomatik_free', created_at }`, try/catch, skipped when unset — never blocks activation

## Step 8 — Admin UI

- [x] `GET /api/admin/users` includes `tier`; new `POST /api/admin/users/:id/tier` `{ tier }` (validated, pattern of deactivate/reactivate)
- [x] `POST /api/admin/invitations` accepts optional `tier` (default 'participant'); `GET` list includes `tier` + `kind`
- [x] `src/pages/admin.tsx`: tier column + free⇄participant action on users; tier selector on invitation form; tier/kind columns in list
- [x] i18n keys

## Verification (spec §12)

- [x] Build + typecheck pass; migrations apply on fresh local D1
- [x] Free user: 403 `tier_required` on templates/refine/submit-template → UI gate (not error toast); 4th save → `library_limit` → gate; 6th analyze/day → 429 with `resets_at`; job logs show Kimi-first
- [x] Participant: no caps, no quota chip, Sonnet-first; admin bypasses all gates regardless of tier
- [x] Signup: new email → confirmation → register → active free account; existing email → generic success, no email; expired self-token → "request new link"; 6th signup/h/IP → 429
- [x] Pre-migration users are participants, zero behavior change; admin invitation flow unchanged (participant default)

## Review (2026-06-12)

All 8 steps implemented and tested locally, plus two mid-flight additions requested by Greg:

### Added beyond the original spec
1. **Edit Mode (block editor) is now participant-only.** Backend: `PUT /api/prompts/:id` returns `403 tier_required` for free users when `blocks`/`tips` are in the payload — renaming and re-tagging stay open. Front: the "Modifier" tab stays visible and opens the upgrade gate (`upgrade.feature_edit`). Free users keep User + Study modes.
2. **Onboarding tours audited for free users.** The *main* tour only covers dashboard → new prompt → save (nothing gated) — kept as-is. The *profile* tour was auto-starting **on top of the upgrade gate** (caught during the QA pass); it's now guarded by `isParticipant` in `profile.tsx`, and it has no other trigger.

### QA pass findings (free test user, local)
- Verified end-to-end via API + browser: tier in `/me`, quota chip (5/5 exhausted state), 403 gates on templates/refine/submit-template/edit, library cap on save+duplicate ("3/3" gate), 429 `daily_quota` with `resets_at` on the 6th analyze, profile PUT whitelist (teaching fields silently dropped, onboarding flags accepted), participant has no caps and `quota: null`, admin bypass + tier toggle + invitation tier selector.
- **Model routing verified in job logs:** free job → `moonshotai/kimi-k2.5` first; participant job → `anthropic/claude-sonnet-4.6` first.
- Signup flow verified: new email → invitation row (`kind=self`, `tier=free`, `language` from form, `invited_by` NULL) → register → active free account with the form's language; existing email → generic `{ok:true}`; invalid email → 400; 6th attempt/h/IP → 429; used token → "already used"; expired self token → `code: INVITE_EXPIRED_SELF` and the register page offers a link back to `/signup`.

### ⚠️ Deployment notes (read before `npm run deploy`)
1. **Apply migrations remotely BEFORE deploying the worker** (the new code SELECTs `users.tier`): `0009_add-user-tier.sql` then `0010_invitations-self-serve.sql` with `--remote`. First check the remote schema actually has 0001–0008 (the local store was missing 0006–0008 — don't assume).
2. **`PRAGMA foreign_keys = OFF` is silently ignored by D1.** Observed locally: rebuilding `users` cascade-deleted `prompts` and `interview_jobs` despite the PRAGMA. **Migration 0010 is safe** — `invitations` is a leaf table (no FK points at it), so its rebuild cascades nothing. But never reuse the 0007 parent-table rebuild pattern without `PRAGMA defer_foreign_keys = true`; take a `wrangler d1 export` backup before any rebuild migration.
3. Optional secret: `wrangler secret put MARKETING_WEBHOOK_URL` (webhook is skipped when unset).
4. The upgrade CTA lives in `src/lib/config.ts` (`UPGRADE_CTA_URL`, with UTM params) — one-line change when the real training landing page exists.
5. `seed/seed.ts` mangles the bcrypt hash (`$` expansion in `execSync` double quotes) — admin seed login fails; worth a small fix later (pass SQL via temp file).

### Files touched
- Migrations: `0009_add-user-tier.sql`, `0010_invitations-self-serve.sql` (+ `db:migrate` script)
- Worker: `env.ts`, `lib/tier.ts` (new), `lib/quota.ts` (new), `lib/auth-middleware.ts`, `lib/interview-jobs.ts`, `lib/email.ts`, `routes/auth.ts`, `routes/interview.ts`, `routes/prompts.ts`, `routes/profile.ts`, `routes/templates.ts`, `routes/admin.ts`, `wrangler.jsonc` (comment)
- Front: `lib/config.ts` (new), `components/upgrade-gate.tsx` (new), `components/quota-chip.tsx` (new), `pages/signup.tsx` (new), `lib/api.ts`, `lib/auth/auth-context.tsx`, `App.tsx`, `pages/{login,register,dashboard,new-prompt,prompt-view,profile,templates,template-detail,admin}.tsx`, `components/layout/shell.tsx`, i18n `fr/en/es.json`

---

## Decisions (approved 2026-06-12)

1. **Profile gating adaptation approved.** PUT filtering must be a **whitelist of onboarding fields** (not a blacklist of profile fields) — robust to future field additions.
2. **CTA URL:** `https://www.teachinspire.me?utm_source=promptomatik&utm_medium=upgrade_gate&utm_campaign=free_tier`, defined once as `UPGRADE_CTA_URL` in a front config constant — never hardcoded in components.
3. **Reversed vars approved.** Add a comment in `wrangler.jsonc` (and README) explaining that primary/fallback semantics invert per tier, so it doesn't read as a bug later.
4. **Spec §13 defaults approved:** copy-or-lose, UTC shown as "resets in Xh", blurred-templates teaser deferred to phase 2.
5. **Process:** after step 3 (gating) and before step 6 (public signup), do a full manual pass as a test free user — tune gate wording and lock-badge placement while it's cheap.
