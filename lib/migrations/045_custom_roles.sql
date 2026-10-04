-- Roles the owner creates (Echipa → Roluri): a name, an emoji, the built-in role it opens
-- like ("Se deschide ca": presenter / leader / operator / member: which page an event opens
-- on) and its rights (a comma list from lib/roles.js PERMS). A user with a custom role keeps
-- users.role = the role's base (the experience) and users.custom_role_id = the role; the
-- rights then come from the role. Deleting a role makes its people members.
CREATE TABLE custom_roles (
  id INTEGER PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  emoji TEXT,
  base TEXT NOT NULL,
  perms TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_custom_roles_admin ON custom_roles(admin_id, sort);

ALTER TABLE users ADD COLUMN custom_role_id INTEGER REFERENCES custom_roles(id) ON DELETE SET NULL;
