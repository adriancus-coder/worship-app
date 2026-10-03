-- Stage 7: the in-app notifications (one row per person and event; a push goes out too when
-- the person is subscribed) and the per-kind switches (a row only for a kind turned OFF; every
-- kind is on by default). event_id ties reminders and setlist changes to their event
-- (idempotent reminders, the 10-minute throttle).
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  url TEXT,
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX idx_notifications_user ON notifications(admin_id, user_id, created_at);
CREATE INDEX idx_notifications_event ON notifications(admin_id, event_id, kind);

CREATE TABLE notification_prefs (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, kind)
);
