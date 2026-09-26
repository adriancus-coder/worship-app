'use strict';

// Churches (admins) as the platform owner sees them (routes/platform.js): the list with
// usage figures, creating a church with its owner, deactivating / reactivating it, a new
// temporary password for its owner, its media quota. The only module that reads across
// admins; nothing here is reachable by an ordinary church.

const path = require('path');
const { DEFAULTS } = require('./admin-settings');
const { sizeUnder } = require('./storage');

const MAX_ADMIN_NAME = 100;
const MB = 1024 * 1024;
const MAX_QUOTA_MB = 1024 * 1024; // 1 TB: a typo guard, not a policy

function validateAdminName(value, t) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > MAX_ADMIN_NAME) return { error: t('errors.platformNameInvalid', { max: MAX_ADMIN_NAME }) };
  return { value: name };
}

// mediaMaxMb: a whole number of MB, or null (back to the server default).
function validateQuota(value, t) {
  if (value === null || value === '') return { value: null };
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_QUOTA_MB) return { error: t('errors.platformQuotaInvalid', { max: MAX_QUOTA_MB }) };
  return { value: n * MB };
}

function createPlatformStore(db, { dataDir, defaultMediaMaxBytes }) {
  const listRows = db.prepare(`SELECT a.id, a.name, a.created_at, a.active, a.deactivated_at, a.media_max_bytes,
      (SELECT COUNT(*) FROM users u WHERE u.admin_id = a.id) AS users,
      (SELECT COUNT(*) FROM songs s WHERE s.admin_id = a.id) AS songs,
      (SELECT COUNT(*) FROM events e WHERE e.admin_id = a.id AND e.is_template = 0) AS events,
      MAX(COALESCE((SELECT MAX(last_login_at) FROM users u WHERE u.admin_id = a.id), 0),
          COALESCE((SELECT MAX(updated_at) FROM songs s WHERE s.admin_id = a.id), 0),
          COALESCE((SELECT MAX(updated_at) FROM events e WHERE e.admin_id = a.id), 0),
          COALESCE((SELECT MAX(created_at) FROM sessions x WHERE x.admin_id = a.id), 0)) AS last_activity,
      (SELECT id FROM users u WHERE u.admin_id = a.id AND u.role = 'owner' ORDER BY id LIMIT 1) AS owner_id,
      (SELECT email FROM users u WHERE u.admin_id = a.id AND u.role = 'owner' ORDER BY id LIMIT 1) AS owner_email
    FROM admins a ORDER BY a.id`);
  const selectAdmin = db.prepare('SELECT id, name, active, media_max_bytes FROM admins WHERE id = ?');
  const emailTaken = db.prepare('SELECT 1 FROM users WHERE email = ?').pluck();
  const insertAdmin = db.prepare('INSERT INTO admins (name, created_at) VALUES (?, ?)');
  const insertSetting = db.prepare('INSERT INTO admin_settings (admin_id, key, value) VALUES (?, ?, ?)');
  const insertOwner = db.prepare(`INSERT INTO users
    (admin_id, email, name, password_hash, role, active, must_change_password, created_by, created_at)
    VALUES (?, ?, ?, ?, 'owner', 1, 1, ?, ?)`);
  const setActive = db.prepare('UPDATE admins SET active = ?, deactivated_at = ? WHERE id = ?');
  const deleteSessions = db.prepare('DELETE FROM sessions WHERE admin_id = ?');
  const selectOwner = db.prepare("SELECT id, email, name FROM users WHERE admin_id = ? AND role = 'owner' ORDER BY id LIMIT 1");
  const setOwnerPassword = db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ? AND admin_id = ?');
  const deleteUserSessions = db.prepare('DELETE FROM sessions WHERE user_id = ? AND admin_id = ?');
  const setQuotaStmt = db.prepare('UPDATE admins SET media_max_bytes = ? WHERE id = ?');

  const quotaOf = (row) => row.media_max_bytes || defaultMediaMaxBytes;

  // platformAdminId: marks that church's row.
  function list(platformAdminId) {
    return listRows.all().map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      active: Boolean(row.active),
      deactivatedAt: row.deactivated_at,
      platform: row.id === platformAdminId,
      ownerEmail: row.owner_email || null,
      users: row.users,
      songs: row.songs,
      events: row.events,
      storageBytes: sizeUnder(path.join(dataDir, 'uploads', `admin-${row.id}`)),
      mediaMaxBytes: quotaOf(row),
      mediaMaxOverride: row.media_max_bytes !== null,
      lastActivityAt: row.last_activity || null,
    }));
  }

  function get(id) {
    return selectAdmin.get(id) || null;
  }

  function isEmailTaken(email) {
    return emailTaken.get(email) !== undefined;
  }

  // A church with the default settings and its owner (temporary password, to be changed at
  // the first login). Returns { adminId, userId }.
  const create = db.transaction(({ name, ownerName, ownerEmail }, passwordHash, createdBy) => {
    const now = Date.now();
    const adminId = Number(insertAdmin.run(name, now).lastInsertRowid);
    for (const key of ['timezone', 'chord_notation_default', 'theme_default']) insertSetting.run(adminId, key, DEFAULTS[key]);
    const userId = Number(insertOwner.run(adminId, ownerEmail, ownerName, passwordHash, createdBy, now).lastInsertRowid);
    return { adminId, userId };
  });

  // Deactivated: its sessions end (its users get 401 at once) and no login works.
  const deactivate = db.transaction((id) => {
    setActive.run(0, Date.now(), id);
    deleteSessions.run(id);
  });

  function reactivate(id) {
    setActive.run(1, null, id);
  }

  // The church's owner gets a new temporary password; their sessions end. -> the owner row
  const resetOwnerPassword = db.transaction((id, passwordHash) => {
    const owner = selectOwner.get(id);
    if (!owner) return null;
    setOwnerPassword.run(passwordHash, owner.id, id);
    deleteUserSessions.run(owner.id, id);
    return owner;
  });

  function setQuota(id, bytes) {
    setQuotaStmt.run(bytes, id);
  }

  return { list, get, isEmailTaken, create, deactivate, reactivate, resetOwnerPassword, setQuota };
}

// The media quota of a church (routes/media.js): its override, else the server default.
function createMediaQuota(db, fallback) {
  const select = db.prepare('SELECT media_max_bytes FROM admins WHERE id = ?').pluck();
  return (adminId) => select.get(adminId) || fallback;
}

module.exports = { MAX_ADMIN_NAME, validateAdminName, validateQuota, createPlatformStore, createMediaQuota };
