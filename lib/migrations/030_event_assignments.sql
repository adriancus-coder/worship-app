-- Stage 7: who serves at an event, on which position, and their answer. One row per
-- (event, person, position). notified_at: when "Trimite programarea" last told this person
-- (NULL: not yet). Templates keep their rows as the "usual team"; a copy resets them to pending.
CREATE TABLE event_assignments (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  note TEXT,
  responded_at INTEGER,
  notified_at INTEGER,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (event_id, user_id, position_id)
);
CREATE INDEX idx_event_assignments_event ON event_assignments(admin_id, event_id);
CREATE INDEX idx_event_assignments_user ON event_assignments(admin_id, user_id);
