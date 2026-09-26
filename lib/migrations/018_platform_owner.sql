-- Who runs the platform: the admin created at first-run setup (the lowest id). Only the
-- OWNER user of that admin is the platform owner (lib/auth.js); PLATFORM_ADMIN_ID overrides.
ALTER TABLE admins ADD COLUMN platform_owner INTEGER NOT NULL DEFAULT 0;
UPDATE admins SET platform_owner = 1 WHERE id = (SELECT MIN(id) FROM admins);
