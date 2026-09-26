-- "Vezi aplicația ca": an owner may look at the app as another role. The effective role of
-- the session is view_as when set (lib/auth.js getSession); every guard, page, socket
-- command and menu follows it. Platform-owner routes use the real role and refuse while
-- view_as is set. Cleared by logout (the session goes) and by a password change.
ALTER TABLE sessions ADD COLUMN view_as TEXT CHECK (view_as IN ('leader', 'operator', 'member'));
