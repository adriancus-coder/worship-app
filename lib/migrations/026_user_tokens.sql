-- One-time links sent by email (lib/invites.js): an invitation (7 days) that lets a new
-- person set their name and password, and a password reset (1 hour). The token itself is
-- 32 random bytes, only its SHA-256 is stored; used_at marks it spent (single use). A new
-- token of the same kind for the same user spends the previous one.
CREATE TABLE user_tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('invite', 'reset')),
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE INDEX idx_user_tokens_user ON user_tokens(user_id, kind);
