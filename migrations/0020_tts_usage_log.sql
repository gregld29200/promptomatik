-- One row per text-to-speech request: full takes (one per block attempt) and
-- free previews. Feeds the cost picture for the future subscription offer and
-- the preview caps (30 a day, 150 a month, cache hits and failures excluded).
--
-- Seconds generated per user and month:
--   SELECT user_id, strftime('%Y-%m', created_at) AS month, kind,
--          ROUND(SUM(audio_seconds)) AS seconds,
--          SUM(cache_hit = 0 AND status = 'ok') AS tts_calls,
--          SUM(cache_hit) AS cache_hits
--   FROM tts_usage_log GROUP BY user_id, month, kind;

CREATE TABLE IF NOT EXISTS tts_usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('preview','full')),
  -- 'pending' only while a preview holds its place under the cap.
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('pending','ok','failed')),
  model TEXT,
  audio_seconds REAL NOT NULL DEFAULT 0,
  chars_sent INTEGER NOT NULL DEFAULT 0,
  cache_hit INTEGER NOT NULL DEFAULT 0 CHECK (cache_hit IN (0, 1)),
  -- No foreign key: the log outlives a deleted take.
  job_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tts_usage_user ON tts_usage_log(user_id, kind, created_at);
