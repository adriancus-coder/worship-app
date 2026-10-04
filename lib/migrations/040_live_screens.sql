-- Which of the church's screens show the projection of a live event ("Pe ce ecrane", the
-- live page and the console): a JSON array of screen ids, or NULL = every screen. A screen
-- left out shows the idle screen (logo / clock) while the event is live. Reset to NULL at
-- every start.
ALTER TABLE live_state ADD COLUMN screen_ids TEXT;
