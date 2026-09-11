CREATE TABLE IF NOT EXISTS interview_contexts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  sealed INTEGER NOT NULL DEFAULT 0,
  selection TEXT
);
CREATE INDEX IF NOT EXISTS interview_contexts_expiry ON interview_contexts(expires_at);
CREATE INDEX IF NOT EXISTS interview_contexts_owner ON interview_contexts(user_id);
CREATE TABLE IF NOT EXISTS interview_attachments (
  id TEXT PRIMARY KEY,
  context_id TEXT NOT NULL REFERENCES interview_contexts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  size INTEGER NOT NULL,
  characters INTEGER NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS interview_attachments_context ON interview_attachments(context_id);
CREATE INDEX IF NOT EXISTS interview_jobs_context
  ON interview_jobs(json_extract(request_payload, '$.document_context_id'));
