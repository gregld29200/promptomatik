# TeachInspire Audio Studio — Technical Spec

**Status:** spec, pre-implementation. Product decisions locked (see §1). This document is implementable as written; exact Gemini request/response shapes flagged `⚠ verify` must be confirmed against current Google docs before coding the call.
**Lives in:** the existing Promptomatik Worker, as a new `/audio` section. One deploy, one login, shared auth.

---

## 1. Decisions locked (do not relitigate)

| Decision | Choice | Rationale |
|---|---|---|
| Engine | **Per-line generation** — one isolated TTS call per dialogue line | Structurally immune to the multi-speaker collapse + >1min drift bug that is the entire reason this tool exists. Enables per-line play + regenerate. |
| NOT | Native multi-speaker (single call) | Inherits the bug we're escaping. |
| Model | `gemini-2.5-pro` TTS (pinned, config not code) | Expressive-but-controlled. Teaches prosody/intonation without 3.1's over-acting. |
| Held for later | `gemini-3.1-flash` TTS as opt-in "expressive+" | Re-inherits collapse bug; not v1. |
| Cost | **$20/M tokens → ~$1.80 / audio-hour** | 25 tok/audio-sec → 90k tok/hr. |
| Quota | **60 min generated audio / user / month** | Worst case ~$1.80/user/mo. 10-teacher cohort ≈ $18/mo at full quota; real usage far below. |
| Speakers | **1–3, discovered from the script** (not configured up front) | Per-line engine makes N speakers free. 3 covers real lessons, stays inside the voice pool, short voice strip. |
| Generation mode | **Synchronous** (no queue, no Batch API) | Seconds-to-result; matches existing interview route pattern. Batch's 50% saving isn't worth a 24h SLA on a $1.80/mo tool. |
| Audio format | **WAV only (v1)** | Gemini returns raw PCM; WAV concat is pure-TS buffer splicing. MP3 → v1.1 (client-side `lamejs`). |
| Stitching | **In-Worker PCM splice + header rewrite** | No FFmpeg (no native binaries on Workers). 500ms silence = zero-filled PCM block. |
| Retention | **7 days**, R2 lifecycle delete | Users told to download immediately. |
| UI language | **FR / EN** (interface chrome only) | Audio output language = whatever the teacher writes (unbounded). |
| Access | **`tier === 'participant'`** | Paywall feature. See §3 dependency. |

---

## 2. Reality check — what's net-new

The brief assumed an existing tier/queue/quota/R2 foundation. **It does not exist.** Current infra: D1 (`DB`), KV (`SESSIONS`), Hono, synchronous OpenRouter. Net-new for this feature:

1. **R2 bucket** binding (`AUDIO`) — store generated WAVs, lifecycle-delete at 7d.
2. **Gemini API key** (`GEMINI_API_KEY`) — Google Generative Language API, not OpenRouter.
3. **`tier` column** on `users` — *shared dependency with the tiers spec.* If that lands first, reuse it; otherwise this spec adds it (§4.1).
4. **Quota counter** — monthly KV key, minutes-based (§7).
5. **Two D1 tables** — `audio_generations`, `audio_lines` (§4.2).

No queue, no Durable Object, no Batch endpoint. Sync calls + `ctx.waitUntil` for fire-and-forget cleanup is all the concurrency model we need.

---

## 3. Dependency on the tiers spec

Audio Studio gates on `tier === 'participant'`. The `tier` column belongs to `promptomatik-tiers-spec.md`. Resolution:

- **If tiers spec lands first:** import its `requireTier('participant')` middleware. Done.
- **If this lands first:** add the migration in §4.1 and a minimal `requireTier` here; the tiers spec adopts it later. The column is `TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free','participant','admin'))` either way — agree the enum once, across both specs, so there's no drift.

**Action:** confirm sequencing with the tiers spec owner before migration numbering (next free is `0006`).

---

## 4. Data model

### 4.1 Migration `0006` — tier + audio tables

```sql
-- Tier (skip if tiers spec already added it — coordinate enum)
ALTER TABLE users ADD COLUMN tier TEXT NOT NULL DEFAULT 'free'
  CHECK (tier IN ('free', 'participant', 'admin'));

-- One row per generation job (a whole script)
CREATE TABLE IF NOT EXISTS audio_generations (
  id TEXT PRIMARY KEY,                      -- crypto.randomUUID()
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',           -- derived from first line, editable
  mode TEXT NOT NULL DEFAULT 'dialogue'
    CHECK (mode IN ('monologue', 'dialogue')),
  scene TEXT NOT NULL DEFAULT '',
  context TEXT NOT NULL DEFAULT '',
  speakers TEXT NOT NULL DEFAULT '[]',      -- JSON: [{id, voice, instruction}]
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','generating','ready','partial','error')),
  total_seconds REAL NOT NULL DEFAULT 0,    -- summed actual audio duration
  final_r2_key TEXT,                        -- concatenated WAV, null until first full play/download
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,                 -- created_at + 7 days
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_audio_gen_user ON audio_generations(user_id);

-- One row per line — the unit
CREATE TABLE IF NOT EXISTS audio_lines (
  id TEXT PRIMARY KEY,
  generation_id TEXT NOT NULL,
  line_order INTEGER NOT NULL,
  speaker_id TEXT NOT NULL DEFAULT '1',     -- matches a speakers[].id
  text TEXT NOT NULL,                       -- the line, cues included
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','generating','ready','stale','error')),
  r2_key TEXT,                              -- per-line PCM/WAV blob
  seconds REAL NOT NULL DEFAULT 0,          -- actual duration, for quota debit
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (generation_id) REFERENCES audio_generations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_audio_lines_gen ON audio_lines(generation_id, line_order);
```

`speakers` JSON shape: `[{ "id": "1", "voice": "Kore", "instruction": "calme et posée" }]`. Cap 3 — enforced at parse, not DB.

### 4.2 R2 layout

```
audio/{user_id}/{generation_id}/line-{order}.wav   per-line blobs
audio/{user_id}/{generation_id}/full.wav           concatenated result (lazy)
```

Lifecycle rule: delete objects older than 7 days. Set on the bucket, not per-object — keeps it declarative. `expires_at` in D1 mirrors it for UI ("kept for 7 days").

### 4.3 KV quota key

```
quota:audio:{user_id}:{YYYY-MM}  →  "<seconds_used>"   TTL ~35 days
```

Minutes-based display, seconds stored for precision. Monthly bucket by calendar month (matches the over-limit copy "refreshes on the 1st").

---

## 5. Bindings & config

**`wrangler.jsonc`** add:
```jsonc
"r2_buckets": [
  { "binding": "AUDIO", "bucket_name": "teachinspire-audio" }
],
"vars": {
  // ...existing...
  "GEMINI_TTS_MODEL": "gemini-2.5-pro-preview-tts"   // ⚠ verify exact id; config not code
}
```

**`worker/env.ts`** add:
```ts
AUDIO: R2Bucket;
GEMINI_API_KEY: string;       // secret, via `wrangler secret put`
GEMINI_TTS_MODEL?: string;    // var, swappable without deploy-code change
```

The model id being a var is the whole point of the tool: if Google deprecates it, swap the var, re-test, ship — UI and training videos untouched.

---

## 6. API surface — `/api/audio/*`

New route module `worker/routes/audio.ts`, mounted in `worker/index.ts`. All routes behind `requireAuth` + `requireTier('participant')`.

| Method · Path | Purpose |
|---|---|
| `POST /api/audio/enhance` | Script in → normalized script + diff annotations out (LLM). No audio, no quota. |
| `POST /api/audio/generations` | Create a draft from {mode, scene, context, script, speakers}. Parses lines. Returns generation + lines. |
| `GET /api/audio/generations` | History list (user's, non-expired). |
| `GET /api/audio/generations/:id` | Full generation + lines (poll during generating). |
| `POST /api/audio/generations/:id/lines/:lineId/generate` | Generate (or regenerate) ONE line. Quota-gated. Debits actual seconds. |
| `POST /api/audio/generations/:id/generate` | Generate all `pending`/`stale` lines (loops the per-line path; see §8 concurrency). |
| `GET /api/audio/lines/:lineId/audio` | Stream one line's WAV (player ▶). |
| `GET /api/audio/generations/:id/audio` | Concatenate ready lines → full.wav, stream (Play all / Download). |
| `PATCH /api/audio/generations/:id` | Edit script/title → re-parse, mark changed lines `stale` (§8). |
| `DELETE /api/audio/generations/:id` | Remove (D1 cascade + R2 cleanup via `waitUntil`). |

Parse = the only non-obvious bit: split script by `Speaker N:` labels (or newlines in monologue), one `audio_lines` row each, assign `speaker_id`. **>3 distinct speakers → 422 with the localized "up to 3 voices, split into segments" message** (do not silently drop).

---

## 7. Quota logic

Gate on **estimate** before spending, debit **actual** after.

```
// Before generating a line (or batch):
est_seconds = words(line.text) / 2.5            // ~150 wpm heuristic
used = Number(KV.get(quota:audio:{uid}:{month})) || 0
if (used + est_seconds > 3600)                  // 60 min = 3600s
    return 429 { error: localized("quota_reached", refresh_date) }

// After the call returns:
actual_seconds = pcm_bytes / (24000 * 2)        // 24kHz, 16-bit mono
KV.put(quota:audio:{uid}:{month}, used + actual_seconds, { expirationTtl: ~35d })
audio_lines.seconds = actual_seconds
audio_generations.total_seconds += actual_seconds
```

Regenerate debits again (honest — the chip ticks up). Estimate gates, actual bills. Word-count heuristic is intentionally rough; the actual debit corrects it.

---

## 8. Per-line generation flow

### Single line (the core call)
1. Load line + its speaker's `{voice, instruction}` from the generation.
2. Quota check (§7).
3. Set line `status='generating'`.
4. **Gemini call** ⚠ verify shape:
   ```
   POST https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_TTS_MODEL}:generateContent
   ?key={GEMINI_API_KEY}
   {
     "contents": [{ "parts": [{ "text": "{instruction}: {line.text}" }] }],
     "generationConfig": {
       "responseModalities": ["AUDIO"],
       "speechConfig": {
         "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": "{speaker.voice}" } }
       }
     }
   }
   ```
   Single-speaker config per call — we never send `multiSpeakerVoiceConfig`. The instruction (e.g. "calme et posée") is prepended as natural-language style; it takes precedence over the preset, matching AI Studio behavior the course teaches.
5. Response: base64 PCM in `candidates[0].content.parts[0].inlineData.data`, mime `audio/L16;codec=pcm;rate=24000` (raw, no header). ⚠ verify rate.
6. Wrap PCM with a 44-byte WAV header (24kHz/16-bit/mono) → store `line-{order}.wav` in R2.
7. Debit actual seconds (§7). Set `status='ready'`, save `r2_key`, `seconds`.
8. On failure: `status='error'`, no debit, return the localized "couldn't generate this line" message.

**Optional context nudge:** prepend prior lines' text (not audio) to the prompt so the read stays tonally consistent across a regenerated line. Cheap (input tokens only). Keep it short (preceding 1–2 lines) to avoid drift.

### Generate-all
Loop the single-line path over `pending`/`stale` lines. **Concurrency: sequential or small bounded fan-out (≤3 parallel)** — Workers subrequest limits + keeping quota arithmetic race-free. Sequential is fine for the audience; the UX (§ frontend) fills rows in as each returns, so sequential still *looks* like progress. Set generation `status='generating'` → `ready` (all ok) / `partial` (some error).

### Edit → stale (decision from UX)
On `PATCH`, diff new script against existing lines by `line_order`+`text`. Unchanged lines keep audio. Changed/new lines → `status='stale'` (kept playable-greyed, "à régénérer"). Removed lines → delete row + R2. Never silently wipe ready audio.

---

## 9. WAV concatenation (Play all / Download)

Pure TS in the Worker — no FFmpeg.

```
1. Fetch ready line WAVs from R2 in line_order.
2. Strip each 44-byte header → raw PCM.
3. Between lines, insert 500ms silence = 24000 * 0.5 * 2 = 24000 zero bytes.   // 24kHz·16-bit·mono
4. Concatenate all PCM.
5. Write ONE 44-byte header with the total length.
6. Stream as full.wav; cache to R2 final_r2_key; invalidate on any line regenerate.
```

`partial` generations concatenate only ready lines (gap where errors are) — or block Download until all ready; **recommend: allow play-all of ready lines, gate Download until 100% ready** with a hint ("1 réplique encore à générer"). Decide at build; leaning gate-download.

All-same params (24kHz/16/mono) means concat is byte-correct without resampling. This only holds while every line uses the same model/rate — assert it.

---

## 10. Enhance LLM prompt

Runs via existing OpenRouter `chatCompletion` (cheap text model — **not** the Gemini TTS model). No quota cost. Returns the normalized script **plus** a structured diff so the UI can render accept/reject with the "why" annotations.

**Output contract (forced JSON):**
```json
{
  "normalized_script": "Speaker 1: ...\nSpeaker 2: ...",
  "speakers_detected": 2,
  "changes": [
    { "type": "label_added|cue_added|silent_removed|split|other",
      "line_order": 3,
      "before": "(sourit)",
      "after": "",
      "why": "si ça ne produit pas de son, ça n'a pas sa place dans le script" }
  ]
}
```

**System prompt guardrails (the pedagogy lives here):**
- Normalize speaker labels to `Speaker 1/2/3`; **never exceed 3** (merge or flag).
- Add **only sound-producing** cues in brackets: `[soupire]`, `[rires]`, `[pause]`. **Never** stage directions, emotions-as-labels, or theatrical `[dramatiquement]`. Sober — matches the 2.5 Pro delivery, not 3.1.
- **Remove** anything that makes no sound; `why` must state the rule verbatim: *"si ça ne produit pas de son, ça n'a pas sa place dans le script"* (FR) / *"if it doesn't make a sound, it doesn't go in the script"* (EN).
- Preserve the teacher's wording and meaning — reformat, don't rewrite.
- Output language matches the **script's** language (the audio language), not the UI language.
- Each `why` ≤ 1 sentence, warm, teacherly, never scolding.

This is the highest-pedagogy-value surface in the app. The slogan string must be **byte-identical** to the course and the training videos.

---

## 11. Frontend — `/audio`

One route, one component, four states, line-is-the-unit throughout. Full UX (ASCII states, component tree) is settled — see conversation; condensed here.

**Component tree:** `AudioStudioPage` → `QuotaChip` · `ModeToggle` · `SetupFields`(collapsible Scene/Context) · `VoicePanel`(reactive 1–3 `VoiceRow`, discovered from script) · `ScriptZone`(`EnhanceButton` + `ScriptTextarea`↔`LineList` of `LineRow`) · `ActionBar` · `RetentionNote` · `HistoryList`.

**Four states:**
- **A Draft** — textarea, empty-state permission copy, voice strip above.
- **B Enhance review** — inline diff overlay on textarea; default `Apply all`, per-change ⓘ "why" for the curious.
- **C Generating** — textarea becomes `LineList`; rows fill top-down as each per-line call returns (reuse existing assembling-sprite **per row**, no global spinner).
- **D Result** — per-row ▶ (play one) + ↻ (redo one); top ▶ Play all · ⬇ Download; retention note.

**Hard rules (from UX passes):**
- Textarea ↔ LineList is a **clean flip**, not an editable hybrid (no Notion editor). "✏️ Modifier le script" returns to textarea.
- **No Preview button** — validate by generating line 1 alone (`/lines/:id/generate`). One concept.
- No per-line voice override, no drag-reorder, no in-browser trim (download → AudioTrimmer, per course).
- Voice instruction field is the **primary expressiveness control** — placeholder teaches the range (neutral → warm → animated).

**i18n:** new keys under `audio.*` in `fr.json` / `en.json` only. Strings already drafted (clarify pass). One word per concept per language; French written native, not translated. Protect: the silent-direction slogan, the voice-instruction placeholder, the retention warning.

---

## 12. Build order

1. **Spine** — migration `0006`, R2 binding, env, `requireTier`. `POST /generations` (parse), `POST /lines/:id/generate` (single Gemini call + WAV wrap + quota), `GET /lines/:id/audio`. Frontend states A + C/D for a single line. *This proves the whole engine.*
2. **Full dialogue** — generate-all, concat endpoint, Play all / Download, history. States C/D complete.
3. **Enhance** — `/enhance` + diff UI (state B). Additive; changes nothing upstream. Highest pedagogy value, lowest architectural risk → safe to sequence last.
4. **Polish** — quota chip near-limit/over-limit states, retention copy, stale-line edit flow, `interface-craft` pass on the per-line transitions.

## 13. Open items (decide at build)

- `⚠ verify` Gemini TTS: exact model id, request/response shape, PCM sample rate, available `prebuiltVoiceConfig` voice names (need ≥3 clearly-distinct for 3-speaker scenes).
- Tier-column sequencing vs tiers spec (§3) — coordinate before migration `0006`.
- Download on `partial`: gate until 100% ready (leaning yes) vs allow ready-only concat.
- Mode toggle: keep, or infer monologue = 0 labels (leaning infer, held).
- Whether training videos will teach multi-speaker (≤3) or leave it as a discovered affordance — product/curriculum call.
```
