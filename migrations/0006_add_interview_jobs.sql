-- Async interview/refinement jobs

CREATE TABLE IF NOT EXISTS interview_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('assemble', 'refine')),
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

CREATE INDEX IF NOT EXISTS idx_interview_jobs_user_id ON interview_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_interview_jobs_status ON interview_jobs(status);
CREATE INDEX IF NOT EXISTS idx_interview_jobs_user_updated ON interview_jobs(user_id, updated_at);
