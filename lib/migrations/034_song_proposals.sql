-- Song proposals from the team: a member suggests a library song for a planned or live event
-- (with a short note); an event role adds it (setlist, or projector-only while live) or
-- declines it (with a note). One open proposal per (event, song); at most 5 open per member
-- and event (checked in lib/proposals.js).
CREATE TABLE song_proposals (
  id INTEGER PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  proposed_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'added', 'declined')),
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at INTEGER,
  decision_note TEXT,
  added_target TEXT CHECK (added_target IS NULL OR added_target IN ('setlist', 'projector')),
  added_item_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_song_proposals_event ON song_proposals(admin_id, event_id, status);
CREATE UNIQUE INDEX idx_song_proposals_open ON song_proposals(event_id, song_id) WHERE status = 'open';
