-- Themes ("tematică") of a song: several per song, a free list that grows from imports
-- (resursecrestine.ro's "Tematica") and from what the editors write. name_norm (lowercase,
-- no diacritics) is the identity: "Paști" and "pasti" are one theme; name is how it is shown.
CREATE TABLE song_themes (
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  name_norm TEXT NOT NULL,
  PRIMARY KEY (song_id, name_norm)
);
CREATE INDEX idx_song_themes_admin ON song_themes(admin_id, name_norm);
