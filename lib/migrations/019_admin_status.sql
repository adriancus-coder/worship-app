-- Churches managed from the platform page (routes/platform.js):
--   active           0 = deactivated: none of its users can log in, its screens are dropped;
--                    its data stays
--   deactivated_at   when (Unix epoch milliseconds), NULL while active
--   media_max_bytes  the church's media quota; NULL = MEDIA_MAX_ADMIN_MB for everyone
ALTER TABLE admins ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE admins ADD COLUMN deactivated_at INTEGER;
ALTER TABLE admins ADD COLUMN media_max_bytes INTEGER;
