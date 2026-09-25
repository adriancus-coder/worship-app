-- Media library (stage 5b): videos for the projector.
--   kind 'upload'  a file under DATA_DIR/uploads/admin-<id>/media/<file> (MP4 or WebM)
--   kind 'url'     url = an https link to a .mp4/.webm file, or "youtube:<video id>",
--                  or "vimeo:<video id>"
-- Timestamps are Unix epoch milliseconds.
CREATE TABLE media (
  id INTEGER PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('upload', 'url')),
  title TEXT NOT NULL,
  file TEXT,
  mime TEXT,
  size_bytes INTEGER,
  url TEXT,
  duration_s REAL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_media_admin ON media(admin_id);

-- A video setlist item can point at the media library instead of a raw url.
ALTER TABLE setlist_items ADD COLUMN media_id INTEGER REFERENCES media(id) ON DELETE SET NULL;
