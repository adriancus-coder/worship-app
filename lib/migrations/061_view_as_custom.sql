-- migrate: foreign_keys off
-- "Vezi aplicația ca" for the church's own roles: sessions.view_as also takes 'custom:<id>'
-- (a custom_roles row of the admin; lib/auth.js reads its base and rights). The CHECK of
-- migration 027 cannot change in place: the table is rebuilt (sessions survive).
CREATE TABLE sessions_new (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  view_as TEXT CHECK (view_as IN ('presenter', 'leader', 'operator', 'member') OR view_as LIKE 'custom:%')
);
INSERT INTO sessions_new (id, user_id, admin_id, created_at, expires_at, view_as)
  SELECT id, user_id, admin_id, created_at, expires_at, view_as FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
