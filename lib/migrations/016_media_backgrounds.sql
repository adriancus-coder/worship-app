-- migrate: foreign_keys off
-- Backgrounds for the projector in the media library. Two more kinds:
--   kind 'image'  an uploaded JPEG / PNG / WebP (file = as uploaded), plus
--                 file_display  a projector-size WebP (max 1920x1080) made on upload
--                 file_thumb    a small WebP for pickers and lists
--                 width, height the original's size in pixels
--   kind 'loop'   an uploaded MP4 / WebM played muted and looped behind the text
-- 'upload' and 'url' stay the videos. A CHECK cannot be changed in place: the table is
-- rebuilt (the runner turns foreign keys off for it and checks them after).
CREATE TABLE media_new (
  id INTEGER PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('upload', 'url', 'image', 'loop')),
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
  created_at INTEGER NOT NULL
);
INSERT INTO media_new (id, admin_id, kind, title, file, mime, size_bytes, url, duration_s, created_by, created_at)
  SELECT id, admin_id, kind, title, file, mime, size_bytes, url, duration_s, created_by, created_at FROM media;
DROP TABLE media;
ALTER TABLE media_new RENAME TO media;
CREATE INDEX idx_media_admin ON media(admin_id);
