-- Backgrounds behind the text on the projector. What applies, first match wins:
--   1) live_state.background_override   set during the service: a media id (as text),
--                                        'none' (black) or NULL (no override)
--   2) setlist_items.background_*       per event item
--   3) songs.background_*               the song's default (library)
--   4) admin settings background_default_song / _verse / _announcement (a media id)
--   5) none (black)
-- On items and songs: background_none = 1 means "explicitly no background" (it stops the
-- lookup); else background_media_id (NULL = use the next level). A deleted media item sets
-- the id to NULL: the lookup simply falls through to the next level.
-- Readability, per background (media): dim 0..80 (% black over it), blur 0..20 (px),
-- shadow 0/1 (a shadow behind the text).
ALTER TABLE songs ADD COLUMN background_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL;
ALTER TABLE songs ADD COLUMN background_none INTEGER NOT NULL DEFAULT 0 CHECK (background_none IN (0, 1));
ALTER TABLE setlist_items ADD COLUMN background_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL;
ALTER TABLE setlist_items ADD COLUMN background_none INTEGER NOT NULL DEFAULT 0 CHECK (background_none IN (0, 1));
ALTER TABLE live_state ADD COLUMN background_override TEXT;
ALTER TABLE media ADD COLUMN bg_dim INTEGER NOT NULL DEFAULT 45 CHECK (bg_dim BETWEEN 0 AND 80);
ALTER TABLE media ADD COLUMN bg_blur INTEGER NOT NULL DEFAULT 0 CHECK (bg_blur BETWEEN 0 AND 20);
ALTER TABLE media ADD COLUMN bg_shadow INTEGER NOT NULL DEFAULT 1 CHECK (bg_shadow IN (0, 1));
