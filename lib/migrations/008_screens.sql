-- Projector screens (stage 5a). A screen is a browser window (usually on the projector
-- PC) paired with one admin. It authenticates with a screen token, not a user session:
-- 32 random bytes given to the screen once; only its sha256 (hex) is stored here.
-- Timestamps are Unix epoch milliseconds.
CREATE TABLE screens (
  id INTEGER PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER
);

CREATE INDEX idx_screens_admin ON screens(admin_id);

-- A pending pairing, started by an unpaired screen that shows `code` (6 digits). The id is
-- a random secret only that screen knows. Claiming it (owner/leader + code) sets admin_id,
-- screen_id and claimed_at; the waiting screen then collects its token once and the row
-- is deleted. Rows past expires_at are ignored and cleaned up.
CREATE TABLE screen_pairings (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  admin_id INTEGER REFERENCES admins(id) ON DELETE CASCADE,
  screen_id INTEGER REFERENCES screens(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  claimed_at INTEGER
);

CREATE INDEX idx_screen_pairings_code ON screen_pairings(code);
