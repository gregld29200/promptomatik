-- Expand interview job kinds to cover all LLM-heavy interview stages.

PRAGMA foreign_keys = OFF;

CREATE TABLE interview_jobs_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('analyze', 'questions', 'assemble', 'refine')),
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

INSERT INTO interview_jobs_new (
  id,
  user_id,
  kind,
  status,
  request_payload,
  result_payload,
  error_message,
  started_at,
  completed_at,
  created_at,
  updated_at
)
SELECT
  id,
  user_id,
  kind,
  status,
  request_payload,
  result_payload,
  error_message,
  started_at,
  completed_at,
  created_at,
  updated_at
FROM interview_jobs;

DROP TABLE interview_jobs;
ALTER TABLE interview_jobs_new RENAME TO interview_jobs;

CREATE INDEX idx_interview_jobs_user_id ON interview_jobs(user_id);
CREATE INDEX idx_interview_jobs_status ON interview_jobs(status);
CREATE INDEX idx_interview_jobs_user_updated ON interview_jobs(user_id, updated_at);

PRAGMA foreign_keys = ON;
