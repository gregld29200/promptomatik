-- Stripe credit purchases (Audio Studio V1.5):
--   quota_ledger gains the 'credit_purchase' reason and a stripe_ref column
--   (SQLite cannot alter a CHECK constraint - rebuild the table),
--   stripe_events makes webhook grants idempotent.

PRAGMA foreign_keys = OFF;

CREATE TABLE quota_ledger_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  delta_seconds INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('included','credit')),
  reason TEXT NOT NULL CHECK (reason IN ('generation','regeneration','credit_grant','credit_purchase','admin_adjust')),
  job_id TEXT,
  stripe_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES audio_jobs(id) ON DELETE SET NULL
);

INSERT INTO quota_ledger_new (id, user_id, delta_seconds, source, reason, job_id, created_at)
SELECT id, user_id, delta_seconds, source, reason, job_id, created_at
FROM quota_ledger;

DROP TABLE quota_ledger;
ALTER TABLE quota_ledger_new RENAME TO quota_ledger;

CREATE INDEX IF NOT EXISTS idx_quota_ledger_user ON quota_ledger(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quota_ledger_job ON quota_ledger(job_id);

CREATE TABLE IF NOT EXISTS stripe_events (
  event_id TEXT PRIMARY KEY,
  processed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

PRAGMA foreign_keys = ON;
