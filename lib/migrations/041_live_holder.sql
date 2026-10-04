-- The projector has a HOLDER: the one person (an event role) who controls what the church
-- sees. Others ask for it ("Cere controlul proiectorului": a request the holder answers, or
-- applied at once when the holder is not connected) or receive it ("Predă controlul
-- proiectorului"). The live mode is derived from the holder's role: an operator holds it ->
-- 'split' (the projector follows the console's own position); anyone else -> 'together' (the
-- projector follows the main position). lead_mode stays in step for older readers.
-- holder_user_id is not a foreign key: a deleted user simply counts as "not connected".
ALTER TABLE live_state ADD COLUMN holder_user_id INTEGER;
ALTER TABLE live_state ADD COLUMN holder_role TEXT;
UPDATE live_state SET holder_role = 'operator' WHERE lead_mode = 'split';
