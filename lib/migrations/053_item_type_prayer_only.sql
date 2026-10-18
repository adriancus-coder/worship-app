-- migrate: foreign_keys off
-- One item type for "Îndemn la rugăciune" (prayer), not two: 052 added prayer and
-- exhortation, which are the same thing; exhortation rows become prayer and the CHECK loses
-- it. The table is rebuilt again (the runner turns foreign keys off for it and checks after).
CREATE TABLE setlist_items_new (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('song', 'verse', 'video', 'announcement', 'sermon', 'prayer', 'other')),
  song_id INTEGER REFERENCES songs(id) ON DELETE SET NULL,
  title TEXT,
  body TEXT,
  reference TEXT,
  url TEXT,
  duration_min INTEGER,
  transpose INTEGER NOT NULL DEFAULT 0 CHECK (transpose BETWEEN -11 AND 11),
  arrangement TEXT,
  team_note TEXT,
  reference_url TEXT,
  media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  scope TEXT NOT NULL DEFAULT 'shared' CHECK (scope IN ('shared', 'projector')),
  request_status TEXT CHECK (request_status IN ('pending', 'accepted', 'refused')),
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  requested_at INTEGER,
  background_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  background_none INTEGER NOT NULL DEFAULT 0 CHECK (background_none IN (0, 1)),
  sections_json TEXT
);
INSERT INTO setlist_items_new (id, event_id, admin_id, position, type, song_id, title, body, reference, url, duration_min,
    transpose, arrangement, team_note, reference_url, media_id, scope, request_status, requested_by, requested_at,
    background_media_id, background_none, sections_json)
  SELECT id, event_id, admin_id, position, CASE WHEN type = 'exhortation' THEN 'prayer' ELSE type END, song_id, title, body, reference, url, duration_min,
    transpose, arrangement, team_note, reference_url, media_id, scope, request_status, requested_by, requested_at,
    background_media_id, background_none, sections_json
  FROM setlist_items;
DROP TABLE setlist_items;
ALTER TABLE setlist_items_new RENAME TO setlist_items;
CREATE INDEX idx_setlist_items_event ON setlist_items(event_id, position);
CREATE INDEX idx_setlist_items_song ON setlist_items(song_id);
