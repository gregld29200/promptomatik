-- Promptomatic v1 — Initial Schema
-- D1 (SQLite at edge)

-- ============================================================
-- Users
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'teacher'
    CHECK (role IN ('teacher', 'admin')),
  language_preference TEXT NOT NULL DEFAULT 'fr'
    CHECK (language_preference IN ('fr', 'en')),
  profile TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ============================================================
-- Invitations
-- ============================================================
CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  invited_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'expired')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON invitations(status);

-- ============================================================
-- Prompts
-- ============================================================
CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'fr'
    CHECK (language IN ('fr', 'en')),
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
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES prompts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_prompts_user_id ON prompts(user_id);
CREATE INDEX IF NOT EXISTS idx_prompts_is_template ON prompts(is_template);
CREATE INDEX IF NOT EXISTS idx_prompts_user_updated ON prompts(user_id, updated_at);

-- ============================================================
-- Refinements
-- ============================================================
CREATE TABLE IF NOT EXISTS refinements (
  id TEXT PRIMARY KEY,
  prompt_id TEXT NOT NULL,
  issue_type TEXT NOT NULL
    CHECK (issue_type IN ('too_hard', 'too_long', 'too_generic', 'off_topic', 'wrong_level', 'other')),
  issue_description TEXT,
  sample_output TEXT,
  revised_prompt_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE,
  FOREIGN KEY (revised_prompt_id) REFERENCES prompts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_refinements_prompt_id ON refinements(prompt_id);
