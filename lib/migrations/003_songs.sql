-- Song library. Timestamps are Unix epoch milliseconds.
-- songs.title_norm = normalizeForSearch(title) (lib/search.js), unique per admin.
-- song_sections.content holds lyrics with inline ChordPro chords, e.g. "[G]Ne ridici din [D]noaptea grea".
-- song_sections.content_hash = sha256 hex of the lyrics with chords removed and whitespace
-- normalized; it identifies a section's text for the future translation bridge.
-- song_sections.admin_id mirrors songs.admin_id (CLAUDE.md rule 1: every admin table has admin_id).

CREATE TABLE songs (
  id INTEGER PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  title_norm TEXT NOT NULL,
  author TEXT,
  song_key TEXT,
  source_lang TEXT NOT NULL DEFAULT 'ro',
  source_provider TEXT,
  source_url TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (admin_id, title_norm)
);

CREATE INDEX idx_songs_admin ON songs(admin_id);

CREATE TABLE song_sections (
  id INTEGER PRIMARY KEY,
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('verse', 'chorus', 'pre_chorus', 'bridge', 'intro', 'outro', 'tag', 'other')),
  label TEXT,
  content TEXT NOT NULL,
  note TEXT,
  content_hash TEXT NOT NULL
);

CREATE INDEX idx_song_sections_song ON song_sections(song_id, position);
