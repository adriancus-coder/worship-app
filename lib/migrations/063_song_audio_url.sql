-- The backing track can also be a YouTube link (songs.audio_url, "Link YouTube" on the song
-- page): the embedded player plays it on the song page and in the operator console. A song
-- carries one track: a file (audio_media_id) or a link, never both.
ALTER TABLE songs ADD COLUMN audio_url TEXT;
