-- migrate: foreign_keys off
-- The role "presenter" (Prezentator): the rights the leader had (events, editor, live), landing
-- on the live page; the leader keeps the same rights and lands in the big lyrics. No existing
-- user changes. The CHECKs on users.role and sessions.view_as cannot change in place: both
-- tables are rebuilt (the runner turns foreign keys off and checks them after).
CREATE TABLE users_new (
  id INTEGER PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'presenter', 'leader', 'operator', 'member')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  locale TEXT CHECK (locale IN ('ro', 'en')),
  chord_notation TEXT CHECK (chord_notation IN ('letters', 'solfege')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  deactivated_at INTEGER,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  last_login_at INTEGER,
  theme TEXT CHECK (theme IN ('dark', 'light', 'auto'))
);
INSERT INTO users_new (id, admin_id, email, name, password_hash, role, active, created_at, locale, chord_notation,
    must_change_password, deactivated_at, created_by, last_login_at, theme)
  SELECT id, admin_id, email, name, password_hash, role, active, created_at, locale, chord_notation,
    must_change_password, deactivated_at, created_by, last_login_at, theme FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE INDEX idx_users_admin ON users(admin_id);

CREATE TABLE sessions_new (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  view_as TEXT CHECK (view_as IN ('presenter', 'leader', 'operator', 'member'))
);
INSERT INTO sessions_new (id, user_id, admin_id, created_at, expires_at, view_as)
  SELECT id, user_id, admin_id, created_at, expires_at, view_as FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
