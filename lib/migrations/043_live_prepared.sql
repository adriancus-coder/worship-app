-- Projector preparation before live: on a planned event the event roles may already set the
-- corner clock, the background override, "Pe ce ecrane" and the prepared video (and its
-- volume). prepared = 1 marks a row changed while the event was planned: the start
-- then keeps those choices instead of resetting them to the church defaults. Cleared by the
-- start. Screens keep showing the idle screen until the event is live.
ALTER TABLE live_state ADD COLUMN prepared INTEGER NOT NULL DEFAULT 0;
