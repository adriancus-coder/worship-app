-- migrate: foreign_keys off
-- A backing track ("negativ") on a song: an audio file in the media table (kind 'audio',
-- MP3 / M4A / WAV / OGG, lib/media.js), linked from songs.audio_media_id. The operator
-- plays it from the console; the song page plays it too. The media CHECK of migration 016
-- cannot change in place: the table is rebuilt (rows survive; the references to it keep
-- their ids).
CREATE TABLE media_new (
  id INTEGER PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('upload', 'url', 'image', 'loop', 'audio')),
  title TEXT NOT NULL,
  file TEXT,
  mime TEXT,
  size_bytes INTEGER,
  url TEXT,
  duration_s REAL,
  file_display TEXT,
  file_thumb TEXT,
  width INTEGER,
  height INTEGER,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  bg_dim INTEGER NOT NULL DEFAULT 45 CHECK (bg_dim BETWEEN 0 AND 80),
  bg_blur INTEGER NOT NULL DEFAULT 0 CHECK (bg_blur BETWEEN 0 AND 20),
  bg_shadow INTEGER NOT NULL DEFAULT 1 CHECK (bg_shadow IN (0, 1)),
  source_url TEXT,
  attribution TEXT
);
INSERT INTO media_new (id, admin_id, kind, title, file, mime, size_bytes, url, duration_s, file_display, file_thumb, width, height, created_by, created_at, bg_dim, bg_blur, bg_shadow, source_url, attribution)
  SELECT id, admin_id, kind, title, file, mime, size_bytes, url, duration_s, file_display, file_thumb, width, height, created_by, created_at, bg_dim, bg_blur, bg_shadow, source_url, attribution FROM media;
DROP TABLE media;
ALTER TABLE media_new RENAME TO media;
CREATE INDEX idx_media_admin ON media(admin_id);

ALTER TABLE songs ADD COLUMN audio_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL;
