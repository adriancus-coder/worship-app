-- Ghiduri: how-to guides for the team and the volunteers (start the sound, the projector PC,
-- the stream...): a title, an emoji, a short summary, the positions it is for, then ordered
-- items: 'step' (what to do, in order) and 'problem' ("Dacă nu merge": a symptom and its fix),
-- each with optional text and one photo (DATA_DIR/uploads/admin-<id>/guides/<file>.webp).
CREATE TABLE guides (
  id INTEGER PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  emoji TEXT,
  summary TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_guides_admin ON guides(admin_id, title);

CREATE TABLE guide_positions (
  guide_id INTEGER NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  PRIMARY KEY (guide_id, position_id)
);
CREATE INDEX idx_guide_positions_position ON guide_positions(admin_id, position_id);

CREATE TABLE guide_items (
  id INTEGER PRIMARY KEY,
  guide_id INTEGER NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('step', 'problem')),
  sort INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  image TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_guide_items_guide ON guide_items(guide_id, kind, sort);
