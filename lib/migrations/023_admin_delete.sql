-- Permanent deletion of a church, in two steps (routes/platform.js): the platform owner
-- schedules it on a deactivated church (typing its name); delete_at = then + 7 days. A daily
-- sweep purges every church whose delete_at has passed (a final backup zip first). NULL =
-- nothing scheduled; cancelling clears it.
ALTER TABLE admins ADD COLUMN delete_at INTEGER;
