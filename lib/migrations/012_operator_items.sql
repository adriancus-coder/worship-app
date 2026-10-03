-- Operator additions (stage 6). An item the operator adds during a live event is
-- projector-only: worship navigation, team phones, rehearsal and history never see it.
-- Proposed to the leader, it carries a request; accepted, it joins the shared setlist.
--   scope           'shared' (the setlist everyone sees) | 'projector' (operator only)
--   request_status  NULL (not proposed) | 'pending' | 'accepted' | 'refused'
ALTER TABLE setlist_items ADD COLUMN scope TEXT NOT NULL DEFAULT 'shared' CHECK (scope IN ('shared', 'projector'));
ALTER TABLE setlist_items ADD COLUMN request_status TEXT CHECK (request_status IN ('pending', 'accepted', 'refused'));
ALTER TABLE setlist_items ADD COLUMN requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE setlist_items ADD COLUMN requested_at INTEGER;
