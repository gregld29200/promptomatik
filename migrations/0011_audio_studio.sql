-- TeachInspire Audio Studio V1
-- Jobs, generated segments, quota ledger, and non-expiring credit balances.

CREATE TABLE IF NOT EXISTS audio_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('monologue','dialogue')),
  quality TEXT NOT NULL CHECK (quality IN ('draft','final')),
  script_raw TEXT NOT NULL,
  direction_json TEXT NOT NULL,
  voices_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','generating','assembling','ready','failed')),
  estimated_seconds INTEGER NOT NULL,
  actual_seconds INTEGER,
  error TEXT,
  model_used TEXT,
  gen_ms INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  api_cost_usd REAL,
  r2_prefix TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_jobs_user ON audio_jobs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audio_segments (
  job_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','ok','failed')),
  duration_seconds REAL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  r2_key TEXT,
  PRIMARY KEY (job_id, idx),
  FOREIGN KEY (job_id) REFERENCES audio_jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quota_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  delta_seconds INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('included','credit')),
  reason TEXT NOT NULL CHECK (reason IN ('generation','regeneration','credit_grant','admin_adjust')),
  job_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES audio_jobs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_quota_ledger_user ON quota_ledger(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quota_ledger_job ON quota_ledger(job_id);

CREATE TABLE IF NOT EXISTS credit_balances (
  user_id TEXT PRIMARY KEY,
  seconds INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
