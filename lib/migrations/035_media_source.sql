-- Backgrounds added from a link (Media → Fundaluri → "Din link"): where the file came from,
-- shown as a small "sursă: <host>" caption in the media list. NULL for uploads and links.
ALTER TABLE media ADD COLUMN source_url TEXT;
