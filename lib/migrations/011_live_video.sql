-- Video on the projector (stage 5b), per live event.
--   video_media_id / video_item_id  what is prepared: a media library entry, or a setlist
--                                   video item with a raw link (older items)
--   video_local_name                a file chosen on the projector PC itself (never uploaded)
--   video_state                     none | prepared | playing | paused | ended
--   video_position_s                where it was paused (live positions are reported by the
--                                   screens and not stored on every tick)
--   video_volume                    0..1
--   video_seq                       bumped on prepare / restart: screens seek to the start
-- Preparing never changes what the projector shows; playing switches the source to video.
ALTER TABLE live_state ADD COLUMN video_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL;
ALTER TABLE live_state ADD COLUMN video_item_id INTEGER;
ALTER TABLE live_state ADD COLUMN video_local_name TEXT;
ALTER TABLE live_state ADD COLUMN video_state TEXT NOT NULL DEFAULT 'none'
  CHECK (video_state IN ('none', 'prepared', 'playing', 'paused', 'ended'));
ALTER TABLE live_state ADD COLUMN video_position_s REAL NOT NULL DEFAULT 0;
ALTER TABLE live_state ADD COLUMN video_volume REAL NOT NULL DEFAULT 1 CHECK (video_volume BETWEEN 0 AND 1);
ALTER TABLE live_state ADD COLUMN video_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE live_state ADD COLUMN video_updated_at INTEGER;
