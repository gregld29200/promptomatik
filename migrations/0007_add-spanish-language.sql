-- Expand language checks to include Spanish

-- Rebuilding parent tables with active foreign keys can cascade-delete
-- dependent rows in SQLite/D1 during DROP TABLE.
PRAGMA foreign_keys = OFF;

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'teacher'
    CHECK (role IN ('teacher', 'admin')),
  language_preference TEXT NOT NULL DEFAULT 'fr'
    CHECK (language_preference IN ('fr', 'en', 'es')),
  profile TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_active INTEGER NOT NULL DEFAULT 1
);

INSERT INTO users_new (
  id,
  email,
  name,
  password_hash,
  role,
  language_preference,
  profile,
  created_at,
  updated_at,
  is_active
)
SELECT
  id,
  email,
  name,
  password_hash,
  role,
  language_preference,
  profile,
  created_at,
  updated_at,
  is_active
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE INDEX idx_users_email ON users(email);

CREATE TABLE prompts_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'fr'
    CHECK (language IN ('fr', 'en', 'es')),
  tags TEXT NOT NULL DEFAULT '[]',
  blocks TEXT NOT NULL DEFAULT '[]',
  model_recommendation TEXT,
  model_recommendation_reason TEXT,
  source_type TEXT NOT NULL DEFAULT 'from_scratch'
    CHECK (source_type IN ('from_scratch', 'from_source')),
  is_template INTEGER NOT NULL DEFAULT 0,
  template_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  tips TEXT NOT NULL DEFAULT '[]',
  template_kind TEXT NOT NULL DEFAULT 'official'
    CHECK (template_kind IN ('official', 'community')),
  template_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (template_status IN ('pending', 'approved', 'rejected')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES prompts(id) ON DELETE SET NULL
);

INSERT INTO prompts_new (
  id,
  user_id,
  name,
  language,
  tags,
  blocks,
  model_recommendation,
  model_recommendation_reason,
  source_type,
  is_template,
  template_id,
  created_at,
  updated_at,
  tips,
  template_kind,
  template_status
)
SELECT
  id,
  user_id,
  name,
  language,
  tags,
  blocks,
  model_recommendation,
  model_recommendation_reason,
  source_type,
  is_template,
  template_id,
  created_at,
  updated_at,
  tips,
  template_kind,
  template_status
FROM prompts;

DROP TABLE prompts;
ALTER TABLE prompts_new RENAME TO prompts;

CREATE INDEX idx_prompts_user_id ON prompts(user_id);
CREATE INDEX idx_prompts_is_template ON prompts(is_template);
CREATE INDEX idx_prompts_user_updated ON prompts(user_id, updated_at);
CREATE INDEX idx_prompts_template_kind ON prompts(template_kind);
CREATE INDEX idx_prompts_template_status ON prompts(template_status);

PRAGMA foreign_keys = ON;
