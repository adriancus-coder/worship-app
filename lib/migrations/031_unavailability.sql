-- Stage 7: "nu pot în perioada …": date ranges (inclusive, YYYY-MM-DD) when a person cannot
-- serve. Own rows only; the owner and the leader see everyone's (Echipa, the assignment picker).
CREATE TABLE unavailability (
  id INTEGER PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  note TEXT,
  CHECK (date_to >= date_from)
);
CREATE INDEX idx_unavailability_user ON unavailability(admin_id, user_id, date_to);
