-- "■ Sfârșit": the current item is ended but the position stays on it (the team still sees
-- where the service is). While a position is ended the projector shows the logo (or black)
-- instead of the item; any move clears the flag. One flag per position: the main (team)
-- position and the projector's own (split mode).
ALTER TABLE live_state ADD COLUMN worship_ended INTEGER NOT NULL DEFAULT 0;
ALTER TABLE live_state ADD COLUMN projector_ended INTEGER NOT NULL DEFAULT 0;
