-- "Acorduri pe proiector": whether the lyrics on the screen carry their chords (above the
-- words), a live setting of the event (chords.set) started from the church default
-- (admin_settings chords_show); NULL = the church default (rows from before this migration).
ALTER TABLE live_state ADD COLUMN show_chords INTEGER;
