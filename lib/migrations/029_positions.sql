-- Stage 7: the positions a church uses in its worship team (Voce, Chitară, …; seeded per admin
-- on first use, editable in Setări → "Poziții în echipă"), each user's usual positions, and an
-- optional phone number on the profile.
CREATE TABLE positions (
  id INTEGER PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_positions_admin ON positions(admin_id, sort);

CREATE TABLE users_positions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, position_id)
);
CREATE INDEX idx_users_positions_position ON users_positions(admin_id, position_id);

ALTER TABLE users ADD COLUMN phone TEXT;
