-- Preferred UI language per user; NULL = no preference yet.
ALTER TABLE users ADD COLUMN locale TEXT CHECK (locale IN ('ro', 'en'));
