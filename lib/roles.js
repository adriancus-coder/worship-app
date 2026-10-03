'use strict';

// Rights (permissions) and the roles the owner creates (migration 045).
//
// A user's role (users.role) decides the EXPERIENCE: which page an event opens on (presenter:
// the live page, leader: the big lyrics, operator: the console, member: follow / rehearsal).
// The RIGHTS are a list of PERMS: the built-in roles have fixed ones (BUILTIN_PERMS); a custom
// role (Echipa → Roluri) has a name, an emoji, a base role (its experience) and its own list.
// Every guard reads the rights (requirePerm, can), never a role list; what stays the owner's
// alone (team, settings, backups, pairing, platform) still checks role === 'owner'.

const PERMS = ['library', 'events', 'media', 'live', 'screens', 'schedule', 'guides'];
//   library   write songs (add, edit, import, export, delete), a song's key and background
//   events    create / edit / delete events, setlists, templates; see unshared events; proposals
//   media     the media library (uploads, links, Pexels)
//   live      start / end / withdraw an event and control it live (live pages, additions,
//             song search on resursecrestine.ro, the translation bridge)
//   screens   the operator console and the screens page; holding the projector = split mode
//   schedule  the team for events (assignments, sending the schedule), positions, everyone's
//             unavailability
//   guides    write the Ghiduri (how-to guides with steps, photos, "Dacă nu merge"); everyone reads
const BUILTIN_PERMS = {
  owner: PERMS,
  presenter: ['library', 'events', 'media', 'live'],
  leader: ['library', 'events', 'media', 'live', 'schedule', 'guides'],
  operator: ['library', 'events', 'media', 'live', 'screens'],
  member: [],
};
const BASES = ['presenter', 'leader', 'operator', 'member']; // a custom role is never an owner
const MAX_ROLES = 20;
const MAX_NAME_LENGTH = 40;

// A clean, ordered list; 'screens' needs 'live' (the console sends live commands).
function normalizePerms(list) {
  const set = new Set((Array.isArray(list) ? list : []).filter((p) => PERMS.includes(p)));
  if (set.has('screens')) set.add('live');
  return PERMS.filter((p) => set.has(p));
}

const parsePerms = (text) => normalizePerms(String(text || '').split(',').filter(Boolean));

// The role lib/live.js and the live socket work with: 'member' without the live right, the
// owner as the owner, 'operator' with the screens right (holding the projector = split mode),
// else the person's own role (presenter / leader), a member base counting as a presenter.
function liveRoleOf(role, perms) {
  if (role === 'owner') return 'owner';
  if (!perms.includes('live')) return 'member';
  if (perms.includes('screens')) return 'operator';
  return role === 'leader' ? 'leader' : 'presenter';
}

const can = (user, perm) => Boolean(user && Array.isArray(user.perms) && user.perms.includes(perm));
// Sees every event (unshared ones, templates), not only the team's shared ones.
const seesAllEvents = (user) => can(user, 'events') || can(user, 'live');

// Use after requireUser: 403 unless the user has one of the rights.
function requirePerm(...perms) {
  return (req, res, next) => {
    if (!perms.some((p) => can(req.user, p))) return res.status(403).json({ error: req.t('errors.forbidden') });
    next();
  };
}

function validateRoleInput(body, t, { partial = false } = {}) {
  const out = {};
  const b = body || {};
  if (!partial || b.name !== undefined) {
    const name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ') : '';
    if (!name || name.length > MAX_NAME_LENGTH) return { error: t('errors.roleNameInvalid', { max: MAX_NAME_LENGTH }) };
    out.name = name;
  }
  if (!partial || b.base !== undefined) {
    if (!BASES.includes(b.base)) return { error: t('errors.roleBaseInvalid') };
    out.base = b.base;
  }
  if (!partial || b.perms !== undefined) {
    if (!Array.isArray(b.perms) || b.perms.some((p) => !PERMS.includes(p))) return { error: t('errors.rolePermsInvalid') };
    out.perms = normalizePerms(b.perms);
  }
  return { value: out };
}

const toRole = (row, count) => ({
  id: row.id, name: row.name, emoji: row.emoji || null, base: row.base, perms: parsePerms(row.perms), sort: row.sort,
  ...(count === undefined ? {} : { users: count }),
});

function createRoleStore(db) {
  const listRows = db.prepare(`SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.custom_role_id = r.id AND u.admin_id = r.admin_id) AS users
    FROM custom_roles r WHERE r.admin_id = ? ORDER BY r.sort, r.id`);
  const selectOne = db.prepare('SELECT * FROM custom_roles WHERE id = ? AND admin_id = ?');
  const countAll = db.prepare('SELECT COUNT(*) FROM custom_roles WHERE admin_id = ?').pluck();
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort), -1) FROM custom_roles WHERE admin_id = ?').pluck();
  const insert = db.prepare('INSERT INTO custom_roles (admin_id, name, emoji, base, perms, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const update = db.prepare('UPDATE custom_roles SET name = ?, emoji = ?, base = ?, perms = ? WHERE id = ? AND admin_id = ?');
  const remove = db.prepare('DELETE FROM custom_roles WHERE id = ? AND admin_id = ?');
  // the people of a role follow its base (their experience)
  const syncUsers = db.prepare("UPDATE users SET role = ? WHERE custom_role_id = ? AND admin_id = ? AND role <> 'owner'");
  const clearUsers = db.prepare("UPDATE users SET role = 'member', custom_role_id = NULL WHERE custom_role_id = ? AND admin_id = ? AND role <> 'owner'");
  const assign = db.prepare("UPDATE users SET role = ?, custom_role_id = ? WHERE id = ? AND admin_id = ? AND role <> 'owner'");

  function list(adminId) {
    return listRows.all(adminId).map((r) => toRole(r, r.users));
  }

  function get(adminId, id) {
    const row = selectOne.get(id, adminId);
    return row ? toRole(row) : null;
  }

  function create(adminId, { name, emoji = null, base, perms }) {
    if (countAll.get(adminId) >= MAX_ROLES) return null;
    const info = insert.run(adminId, name, emoji, base, normalizePerms(perms).join(','), maxSort.get(adminId) + 1, Date.now());
    return get(adminId, Number(info.lastInsertRowid));
  }

  const change = db.transaction((adminId, id, patch) => {
    const current = get(adminId, id);
    if (!current) return null;
    const next = { ...current, ...patch };
    update.run(next.name, next.emoji, next.base, normalizePerms(next.perms).join(','), id, adminId);
    if (next.base !== current.base) syncUsers.run(next.base, id, adminId);
    return get(adminId, id);
  });

  // Its people become members (never the base's built-in rights: no surprise rights).
  const destroy = db.transaction((adminId, id) => {
    if (!get(adminId, id)) return false;
    clearUsers.run(id, adminId);
    remove.run(id, adminId);
    return true;
  });

  // A team member gets a built-in role (customRoleId null) or a custom role (its base).
  function setUserRole(adminId, userId, { role, customRoleId = null }) {
    const custom = customRoleId ? get(adminId, customRoleId) : null;
    if (customRoleId && !custom) return false;
    assign.run(custom ? custom.base : role, custom ? custom.id : null, userId, adminId);
    return true;
  }

  return { list, get, create, change, destroy, setUserRole };
}

module.exports = {
  PERMS, BUILTIN_PERMS, BASES, MAX_ROLES, MAX_NAME_LENGTH,
  normalizePerms, parsePerms, liveRoleOf, can, seesAllEvents, requirePerm, validateRoleInput, createRoleStore,
};
