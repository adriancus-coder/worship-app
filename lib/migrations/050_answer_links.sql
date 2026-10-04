-- Answer links in the invitation email ("Vin" / "Poate" / "Nu pot"): open a small page that
-- answers without signing in. One link per (event, person), replaced on every new email; only
-- the SHA-256 of the 32 random bytes is stored. Valid until two days after the event.
CREATE TABLE answer_links (
  id INTEGER PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE (event_id, user_id)
);
CREATE INDEX idx_answer_links_admin ON answer_links(admin_id);
