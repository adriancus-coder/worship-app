-- Participation: "Trimite invitația" asks the whole team whether they come to an event; each
-- person answers Vin / Poate / Nu pot (+ a note). One row per (event, person); invited_at: when
-- the invitation (or a reminder) last went out. The leader then puts on positions the ones who
-- come (event_assignments).
CREATE TABLE event_attendance (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'maybe', 'declined')),
  note TEXT,
  responded_at INTEGER,
  invited_at INTEGER,
  invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (event_id, user_id)
);
CREATE INDEX idx_event_attendance_event ON event_attendance(admin_id, event_id);
CREATE INDEX idx_event_attendance_user ON event_attendance(admin_id, user_id);
