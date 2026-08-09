-- TeachInspire Transcription Studio — Slice 1
--
-- Async job table (same lifecycle as document_jobs / audio_jobs) plus a
-- DEDICATED quota ledger. The transcription ledger is deliberately separate
-- from quota_ledger / credit_balances: Gemini TTS costs roughly 5-15x more per
-- minute than STT, so pooling the two would misprice both. Transcription is
-- 10 hours (36 000 s) included per user per month, tracked in KV under
-- `transq:<userId>:<YYYY-MM>` with this table as the double-entry audit trail.

CREATE TABLE IF NOT EXISTS transcription_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,

  -- Richer than document_jobs on purpose: resolving a podcast feed and running
  -- the transcription are two visibly different waits for the teacher, and the
  -- UI shows a different sentence for each.
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'resolving', 'transcribing', 'completed', 'failed')),

  -- How the media arrived. 'youtube' rows are recognised and stored but never
  -- processed in Slice 1 — keeping them lets us count demand for the Slice 2
  -- yt-dlp container instead of losing the request in a generic error.
  source_kind TEXT NOT NULL
    CHECK (source_kind IN ('upload', 'direct_url', 'podcast', 'youtube')),

  -- What the teacher pasted (NULL for uploads).
  source_url TEXT,
  -- Where we ended up after following an RSS feed / Apple Podcasts page. This
  -- is the URL actually handed to the provider, and it is often not source_url.
  resolved_url TEXT,
  -- R2 key for uploaded media (NULL for URL sources — those are never buffered).
  source_r2_key TEXT,
  source_content_type TEXT,
  source_bytes INTEGER,

  title TEXT,

  -- What was ASKED (immutable intent) versus what actually RAN. They differ
  -- whenever we route away from the requested provider, and we need both to
  -- explain a transcript with no speakers in it.
  requested_provider TEXT
    CHECK (requested_provider IS NULL OR requested_provider IN ('groq', 'deepgram')),
  -- D1 has no BOOLEAN: INTEGER 0/1.
  diarize_requested INTEGER NOT NULL DEFAULT 0
    CHECK (diarize_requested IN (0, 1)),
  provider TEXT
    CHECK (provider IS NULL OR provider IN ('groq', 'deepgram')),
  provider_model TEXT,
  -- Groq: x-request-id. Deepgram: metadata.request_id. Persisted per job so a
  -- support question can be traced back to the provider's own logs.
  provider_job_id TEXT,
  -- 1 only when the stored transcript's words really carry speakers. Always 0
  -- for Groq/Whisper, which has no diarization at all.
  diarization INTEGER NOT NULL DEFAULT 0
    CHECK (diarization IN (0, 1)),

  -- Dominant language, plus the full list for Deepgram's multilingual mode.
  -- No ARRAY type in D1: TEXT holding a JSON array of BCP-47-ish tags.
  detected_language TEXT,
  detected_languages TEXT,

  -- duration_seconds = media length as measured. billed_seconds = what we
  -- actually charged the monthly allowance. They diverge on a partial failure
  -- or an admin refund, so both are stored rather than derived.
  --
  -- There is deliberately no api_cost_usd here, unlike audio_jobs. Slice 1 has
  -- no admin cost report to read it and no verified per-second rate table to
  -- write it, and a column populated from a guessed provider rate is worse than
  -- a column that does not exist: it reads as an audit trail. billed_seconds is
  -- the honest input — add the cost column together with the rate table and the
  -- report that consumes it.
  duration_seconds INTEGER,
  billed_seconds INTEGER,

  -- Serialised TranscriptionRequestPayload / NormalisedTranscript.
  request_payload TEXT NOT NULL,
  result_payload TEXT,

  -- error_code is the TranscriptionFailure discriminant, denormalised out of
  -- error_payload so admin can GROUP BY it without parsing JSON. error_payload
  -- keeps the whole failure (durations, byte counts) for a specific message.
  error_code TEXT,
  error_payload TEXT,
  -- Raw provider/internal detail. Diagnostics only — never shown to a teacher.
  error_message TEXT,

  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- The library list endpoint: every read is scoped `WHERE user_id = ?` (ownership
-- is enforced in SQL, never in the handler) and ordered newest-first.
CREATE INDEX IF NOT EXISTS idx_transcription_jobs_user
  ON transcription_jobs(user_id, created_at DESC);

-- Support lookups: "the provider says request X failed — whose job was that?"
-- Partial, because the column is NULL until a provider has actually accepted
-- the job, and NULLs would otherwise dominate the index.
CREATE INDEX IF NOT EXISTS idx_transcription_jobs_provider_job
  ON transcription_jobs(provider_job_id)
  WHERE provider_job_id IS NOT NULL;

-- "What is running right now?" — the live statuses, unscoped by user: the
-- quota gate's in-flight sum (transcription-quota.ts, which is user-scoped and
-- prefers idx_transcription_jobs_user) plus ops queries over the whole table.
-- Partial on the live statuses only: completed/failed rows accumulate forever
-- and are never the target of this query. There is no scheduled sweeper in
-- Slice 1 — a row abandoned by an evicted isolate is handled where it does
-- harm: it stops counting against the allowance after
-- TRANSCRIPTION_STALE_JOB_MINUTES, and the next delivery may re-claim it.
CREATE INDEX IF NOT EXISTS idx_transcription_jobs_active
  ON transcription_jobs(status, created_at)
  WHERE status IN ('queued', 'resolving', 'transcribing');

-- Transcription's OWN ledger. Double-entry audit of the monthly allowance:
-- delta_seconds is negative for a spend, positive for a refund or an admin
-- grant. Nothing here ever touches quota_ledger or credit_balances.
-- There is no transcription credit-balance table: Slice 1 has no purchase path,
-- so a positive 'admin_adjust' row is the only way to hand back time.
CREATE TABLE IF NOT EXISTS transcription_quota_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  delta_seconds INTEGER NOT NULL,
  reason TEXT NOT NULL
    CHECK (reason IN ('transcription', 'refund', 'admin_adjust')),
  provider TEXT
    CHECK (provider IS NULL OR provider IN ('groq', 'deepgram')),
  -- SET NULL, not CASCADE: deleting a transcript is storage cleanup, never a
  -- quota refund. The spend row must outlive the job it paid for.
  job_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES transcription_jobs(id) ON DELETE SET NULL
);

-- Per-user statements and the monthly reconciliation of the KV counter.
CREATE INDEX IF NOT EXISTS idx_transcription_ledger_user
  ON transcription_quota_ledger(user_id, created_at DESC);
-- "What did this job cost?" — one row per job in the normal case.
CREATE INDEX IF NOT EXISTS idx_transcription_ledger_job
  ON transcription_quota_ledger(job_id);
