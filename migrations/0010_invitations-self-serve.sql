-- Self-serve signup support:
--   invited_by becomes nullable (public signups have no inviter),
--   tier is carried by the invitation and copied to the user at registration,
--   kind distinguishes admin-created invitations from public signup ones,
--   language records the signup form choice (account + marketing webhook).
-- SQLite cannot drop NOT NULL via ALTER — rebuild the table.

-- Rebuilding parent tables with active foreign keys can cascade-delete
-- dependent rows in SQLite/D1 during DROP TABLE.
PRAGMA foreign_keys = OFF;

CREATE TABLE invitations_new (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  invited_by TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'expired')),
  tier TEXT NOT NULL DEFAULT 'participant'
    CHECK (tier IN ('free', 'participant')),
  kind TEXT NOT NULL DEFAULT 'admin'
    CHECK (kind IN ('admin', 'self')),
  language TEXT NOT NULL DEFAULT 'fr'
    CHECK (language IN ('fr', 'en', 'es')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO invitations_new (id, email, token, invited_by, status, created_at, expires_at)
SELECT id, email, token, invited_by, status, created_at, expires_at
FROM invitations;

DROP TABLE invitations;
ALTER TABLE invitations_new RENAME TO invitations;

CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON invitations(status);

PRAGMA foreign_keys = ON;
