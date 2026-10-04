-- Events and their setlists. Timestamps are Unix epoch milliseconds.
-- event_date is YYYY-MM-DD (the admin's local date), start_time HH:MM or NULL.
-- A template is an event with is_template = 1; it never shows in the event lists.
--
-- setlist_items fields per type:
--   song          song_id (title caches the song title, so a deleted song still shows)
--   verse         reference (e.g. "Psalmul 23:1-4") + body (pasted text)
--   video         title + url (uploads come in stage 5)
--   announcement  title + body
--   sermon/other  title + body
-- duration_min is optional for every type (minutes, for the estimated total).

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  event_date TEXT NOT NULL,
  start_time TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'live', 'finished')),
  is_template INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_events_admin_date ON events(admin_id, event_date);

CREATE TABLE setlist_items (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('song', 'verse', 'video', 'announcement', 'sermon', 'other')),
  song_id INTEGER REFERENCES songs(id) ON DELETE SET NULL,
  title TEXT,
  body TEXT,
  reference TEXT,
  url TEXT,
  duration_min INTEGER
);

CREATE INDEX idx_setlist_items_event ON setlist_items(event_id, position);
CREATE INDEX idx_setlist_items_song ON setlist_items(song_id);

-- Admin setting "timezone": decides which events are upcoming or past.
INSERT OR IGNORE INTO admin_settings (admin_id, key, value)
  SELECT id, 'timezone', 'Europe/Oslo' FROM admins;
