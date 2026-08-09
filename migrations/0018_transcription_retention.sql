-- Transcription Studio — 7-day retention, and room for the third provider.
--
-- TWO changes, one migration, because both need the SAME table rebuild:
--
-- 1. RETENTION. `expires_at` is stamped once, on completion, at +7 days — the
--    identical idiom to audio_jobs (`expiresAtIso()` +
--    `COALESCE(expires_at, ?)`). The difference is what happens next: an mp3 is
--    removed by an R2 lifecycle rule configured in the dashboard, with no code
--    and no cron. A transcript is TEXT in D1, and no lifecycle rule can reach
--    it, so this feature ships with a real scheduled purge
--    (worker/lib/transcription-retention.ts + the daily cron in wrangler.jsonc).
--
-- 2. THE FAILOVER CASCADE. `provider` and `requested_provider` carried
--    `CHECK (... IN ('groq', 'deepgram'))`, which the AssemblyAI tier violates.
--    SQLite cannot alter a CHECK constraint, so the table is rebuilt — the same
--    dance migration 0012 did to quota_ledger. `provider_choice_reason` records
--    WHY the provider that ran was the one that ran, so a tier fallback is
--    visible in the data instead of silent.
--
-- Rebuild order and PRAGMA follow 0012 exactly: foreign keys off, copy into a
-- `_new` table, drop, rename, recreate every index the dropped table owned.
-- transcription_quota_ledger is rebuilt too — its own `provider` CHECK has the
-- same two-provider list, and a spend it cannot record is a spend we never bill.
--
-- ---------------------------------------------------------------------------
-- SURVIVING A SECOND RUN (`npm run db:migrate` replays the whole chain)
-- ---------------------------------------------------------------------------
-- THE INVARIANT: `npm run db:migrate` must exit 0 on a replay. There is no
-- applied-migrations table — the script is a flat `&&` chain, every file is
-- re-executed every run, and one non-zero exit silently skips every migration
-- after it. Every statement in THIS file is re-runnable: `CREATE TABLE
-- <name>_new` on a table that was renamed away, an INSERT/SELECT over columns
-- that exist either way, and `CREATE INDEX IF NOT EXISTS`.
--
-- The one pair of statements that CANNOT be replayed — `ALTER TABLE ... ADD
-- COLUMN`, which SQLite offers no `IF NOT EXISTS` for — lives in
-- `0018a_transcription_retention_columns.sql`, which `db:migrate` runs FIRST and
-- joins with `{ ... || true; }` so its expected duplicate-column error cannot
-- fail the run. Its header documents the invariant in full, including the seven
-- earlier migrations that were breaking it. Read it before touching either file.
--
-- What matters here: by the time this file runs, `expires_at` and
-- `provider_choice_reason` exist on `transcription_jobs`, so the INSERT/SELECT
-- below round-trips them instead of silently nulling a week of retention
-- deadlines. Do not add the ALTERs back into this file — this link is joined
-- with `&&`, and a genuine failure of the rebuild must still stop the chain.

PRAGMA foreign_keys = OFF;

-- ---------------------------------------------------------------------------
-- transcription_jobs
-- ---------------------------------------------------------------------------

CREATE TABLE transcription_jobs_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'resolving', 'transcribing', 'completed', 'failed')),

  source_kind TEXT NOT NULL
    CHECK (source_kind IN ('upload', 'direct_url', 'podcast', 'youtube')),

  source_url TEXT,
  resolved_url TEXT,
  source_r2_key TEXT,
  source_content_type TEXT,
  source_bytes INTEGER,

  title TEXT,

  -- Widened: 'assemblyai' is tier 3 and can serve BOTH lanes.
  requested_provider TEXT
    CHECK (requested_provider IS NULL OR requested_provider IN ('groq', 'deepgram', 'assemblyai')),
  diarize_requested INTEGER NOT NULL DEFAULT 0
    CHECK (diarize_requested IN (0, 1)),
  provider TEXT
    CHECK (provider IS NULL OR provider IN ('groq', 'deepgram', 'assemblyai')),
  provider_model TEXT,
  provider_job_id TEXT,

  -- WHY this provider ran. A machine value (TranscriptionRouteReason), never
  -- prose and never translated: 'groq_free_tier' on tier 1, and
  -- 'groq_rate_limited' / 'groq_out_of_capacity' / 'previous_tier_failed' on a
  -- row served by a lower tier. Without it a Deepgram transcript for a job that
  -- asked for nothing special is an unexplained cost.
  provider_choice_reason TEXT,

  diarization INTEGER NOT NULL DEFAULT 0
    CHECK (diarization IN (0, 1)),

  detected_language TEXT,
  detected_languages TEXT,

  duration_seconds INTEGER,
  billed_seconds INTEGER,

  request_payload TEXT NOT NULL,
  result_payload TEXT,

  error_code TEXT,
  error_payload TEXT,
  error_message TEXT,

  started_at TEXT,
  completed_at TEXT,

  -- Set ONCE, on completion, to completion + 7 days. NULL on a job that never
  -- completed: nothing was stored, so there is nothing to expire.
  expires_at TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO transcription_jobs_new (
  id, user_id, status, source_kind, source_url, resolved_url, source_r2_key,
  source_content_type, source_bytes, title, requested_provider,
  diarize_requested, provider, provider_model, provider_job_id,
  provider_choice_reason, diarization,
  detected_language, detected_languages, duration_seconds, billed_seconds,
  request_payload, result_payload, error_code, error_payload, error_message,
  started_at, completed_at, expires_at, created_at, updated_at
)
SELECT
  id, user_id, status, source_kind, source_url, resolved_url, source_r2_key,
  source_content_type, source_bytes, title, requested_provider,
  diarize_requested, provider, provider_model, provider_job_id,
  provider_choice_reason, diarization,
  detected_language, detected_languages, duration_seconds, billed_seconds,
  request_payload, result_payload, error_code, error_payload, error_message,
  started_at, completed_at, expires_at, created_at, updated_at
FROM transcription_jobs;

DROP TABLE transcription_jobs;
ALTER TABLE transcription_jobs_new RENAME TO transcription_jobs;

-- ---------------------------------------------------------------------------
-- transcription_quota_ledger — same widened provider list.
-- ---------------------------------------------------------------------------

CREATE TABLE transcription_quota_ledger_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  delta_seconds INTEGER NOT NULL,
  reason TEXT NOT NULL
    CHECK (reason IN ('transcription', 'refund', 'admin_adjust')),
  provider TEXT
    CHECK (provider IS NULL OR provider IN ('groq', 'deepgram', 'assemblyai')),
  job_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES transcription_jobs(id) ON DELETE SET NULL
);

INSERT INTO transcription_quota_ledger_new (
  id, user_id, delta_seconds, reason, provider, job_id, created_at
)
SELECT id, user_id, delta_seconds, reason, provider, job_id, created_at
FROM transcription_quota_ledger;

DROP TABLE transcription_quota_ledger;
ALTER TABLE transcription_quota_ledger_new RENAME TO transcription_quota_ledger;

-- ---------------------------------------------------------------------------
-- Indexes. Dropping a table drops its indexes, so every index from 0017 is
-- recreated here verbatim, plus the one the purge needs.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_transcription_jobs_user
  ON transcription_jobs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transcription_jobs_provider_job
  ON transcription_jobs(provider_job_id)
  WHERE provider_job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transcription_jobs_active
  ON transcription_jobs(status, created_at)
  WHERE status IN ('queued', 'resolving', 'transcribing');

-- THE PURGE INDEX. The daily sweep asks one question — "which rows expired
-- before now and still hold something?" — and it must not scan a table that
-- keeps every completed transcript forever. Partial on the only rows that can
-- ever match: `expires_at` is NULL until a job completes, and NULL rows would
-- otherwise dominate the index.
CREATE INDEX IF NOT EXISTS idx_transcription_jobs_expires
  ON transcription_jobs(expires_at)
  WHERE expires_at IS NOT NULL;

-- THE ORPHAN-MEDIA INDEX. `expires_at` is stamped only on completion, so an
-- upload belonging to a job that failed (or never got past 'queued') would keep
-- its R2 object forever — the purge's second branch sweeps those by age instead,
-- and this is the index that question runs on. Partial, because a row with no
-- stored media can never match it.
CREATE INDEX IF NOT EXISTS idx_transcription_jobs_orphan_media
  ON transcription_jobs(created_at)
  WHERE source_r2_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transcription_ledger_user
  ON transcription_quota_ledger(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transcription_ledger_job
  ON transcription_quota_ledger(job_id);

PRAGMA foreign_keys = ON;
