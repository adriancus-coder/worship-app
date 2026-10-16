-- Lyrics edited "only for this event" (the live pages' "Editează versurile"): a song item may
-- carry its own sections (JSON: [{ type, label, content, note }], in the song's original key)
-- that replace the library song's for this event only. NULL: the library's sections.
ALTER TABLE setlist_items ADD COLUMN sections_json TEXT;
