-- The corner clock on the projector (as in Sanctuary Voice): shown or not, which corner and
-- its size (0.7 - 1.8 of the base size). A new event starts from the church defaults
-- (admin_settings clock_show / clock_position / clock_scale); live commands change them for
-- the running event.
ALTER TABLE live_state ADD COLUMN show_clock INTEGER NOT NULL DEFAULT 1;
ALTER TABLE live_state ADD COLUMN clock_position TEXT NOT NULL DEFAULT 'bottom-right'
  CHECK (clock_position IN ('top-left', 'top-right', 'bottom-left', 'bottom-right'));
ALTER TABLE live_state ADD COLUMN clock_scale REAL NOT NULL DEFAULT 1.8;
