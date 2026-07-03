-- TeachInspire Documents (D1): async generation jobs, mirroring the
-- interview_jobs shape. No quota tables - Documents is participant-gated
-- without consumption counters (decision 2026-07-03).

CREATE TABLE IF NOT EXISTS document_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  request_payload TEXT NOT NULL,
  result_payload TEXT,
  error_message TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_document_jobs_user ON document_jobs(user_id, created_at DESC);
