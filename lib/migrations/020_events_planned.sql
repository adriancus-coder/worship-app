-- migrate: foreign_keys off
-- No more publishing: an event is visible to the team as soon as it exists. Statuses are
-- planned | live | finished; draft and published both become planned. Templates keep
-- is_template and stay hidden from the team. The CHECK cannot change in place: the table
-- is rebuilt (the runner turns foreign keys off for it and checks them after).
CREATE TABLE events_new (
  id INTEGER PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  event_date TEXT NOT NULL,
  start_time TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'live', 'finished')),
  is_template INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO events_new (id, admin_id, name, event_date, start_time, status, is_template, notes, created_by, created_at, updated_at)
  SELECT id, admin_id, name, event_date, start_time,
    CASE WHEN status IN ('draft', 'published') THEN 'planned' ELSE status END,
    is_template, notes, created_by, created_at, updated_at FROM events;
DROP TABLE events;
ALTER TABLE events_new RENAME TO events;
CREATE INDEX idx_events_admin_date ON events(admin_id, event_date);
