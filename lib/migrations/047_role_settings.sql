-- The built-in roles, as the owner shapes them (Echipa → Roluri → a built-in role → Editează):
-- a name and an emoji of their own, and their rights (a comma list from lib/roles.js PERMS).
-- NULL = the default (the i18n name, the fixed emoji, BUILTIN_PERMS). Never the owner: the
-- owner always has every right. What a role opens on (users.role) never changes.
CREATE TABLE role_settings (
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('presenter', 'leader', 'operator', 'member')),
  name TEXT,
  emoji TEXT,
  perms TEXT,
  PRIMARY KEY (admin_id, role)
);
