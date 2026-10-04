-- Team accounts created by the owner (no email sending yet). `active` stays the switch the
-- auth code checks; deactivating also records when.
--   must_change_password  1 after the owner created the account or reset its password:
--                         the user must choose their own password before anything else
--   created_by            the owner who created the account
--   last_login_at         the last successful login (Unix epoch milliseconds)
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN deactivated_at INTEGER;
ALTER TABLE users ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN last_login_at INTEGER;
