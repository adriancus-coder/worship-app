-- Consent before the leader takes the projector: in split mode a LEADER's switch to
-- "Împreună" becomes a handover request the operator (or the owner) answers within 60 s.
--   handover_by  the requesting user; NULL = no request pending
--   handover_at  when it was made (Unix epoch ms); expired 60 s later (silently)
-- A restart clears both (socket/live.js).
ALTER TABLE live_state ADD COLUMN handover_by INTEGER;
ALTER TABLE live_state ADD COLUMN handover_at INTEGER;
