-- Per-event options for song items.
--   transpose      semitones from the song's own key, -11..11 (0 = as written)
--   arrangement    section codes in order, e.g. "V1 C V2 C B C" (NULL = the song's default)
--   team_note      a note for the team about this song in this event
--   reference_url  https link to a reference recording
ALTER TABLE setlist_items ADD COLUMN transpose INTEGER NOT NULL DEFAULT 0 CHECK (transpose BETWEEN -11 AND 11);
ALTER TABLE setlist_items ADD COLUMN arrangement TEXT;
ALTER TABLE setlist_items ADD COLUMN team_note TEXT;
ALTER TABLE setlist_items ADD COLUMN reference_url TEXT;
