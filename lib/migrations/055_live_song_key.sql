-- "Gama pe proiector": the song's key on the first screen of each song, as its own small
-- layer: shown or not, which corner and its size (0.7 - 1.8 of the clock's base size). A new
-- event starts from the church defaults (admin_settings key_show / key_position / key_scale);
-- live commands (key.set) change them for the running event. NULL = the church defaults
-- (rows from before this migration).
ALTER TABLE live_state ADD COLUMN show_key INTEGER;
ALTER TABLE live_state ADD COLUMN key_position TEXT
  CHECK (key_position IS NULL OR key_position IN ('top-left', 'top-right', 'bottom-left', 'bottom-right'));
ALTER TABLE live_state ADD COLUMN key_scale REAL;
