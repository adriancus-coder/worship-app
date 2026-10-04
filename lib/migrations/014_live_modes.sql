-- Live control modes (replaces "projector controlled by the operator").
--   lead_mode  'together' ONE main position; leader and operator both move it; the
--                         projector and team phones follow it
--              'split'    the main position (team phones) and the projector position
--                         (projector_*) are independent
--              projector_follows is kept in step ('split' <-> 'operator') for older readers.
--   team_mode  'follow' (team phones follow the main position) | 'free' (each person
--              scrolls on their own and sees where live is)
-- The request / approval flow is gone: pending proposals stay what they already are,
-- projector-only items; every request field is cleared.
ALTER TABLE live_state ADD COLUMN lead_mode TEXT NOT NULL DEFAULT 'together' CHECK (lead_mode IN ('together', 'split'));
ALTER TABLE live_state ADD COLUMN team_mode TEXT NOT NULL DEFAULT 'follow' CHECK (team_mode IN ('follow', 'free'));
UPDATE live_state SET lead_mode = CASE WHEN projector_follows = 'operator' THEN 'split' ELSE 'together' END;
UPDATE setlist_items SET request_status = NULL, requested_by = NULL, requested_at = NULL WHERE request_status IS NOT NULL;
