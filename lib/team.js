'use strict';

// Team accounts of an admin, managed by its owner: create (with a temporary password shown
// once), rename, change role, deactivate / reactivate, reset the password. Every query is
// scoped to the admin; emails are unique across all admins.

const crypto = require('crypto');

const TEAM_ROLES = ['leader', 'operator', 'member']; // never 'owner': one owner per admin
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const MIN_PASSWORD_LENGTH = 10;
const TEMP_PASSWORD_LENGTH = 12;
// Readable: no 0/O, 1/l/I.
const TEMP_ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// A random temporary password (crypto.randomInt: no modulo bias).
function temporaryPassword() {
  let out = '';
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i++) out += TEMP_ALPHABET[crypto.randomInt(TEMP_ALPHABET.length)];
  return out;
}

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

function validateName(value, t) {
  const name = clean(value);
  if (!name || name.length > MAX_NAME_LENGTH) return { error: t('errors.teamNameInvalid', { max: MAX_NAME_LENGTH }) };
  return { value: name };
}

function validateEmail(value, t) {
  const email = clean(value).toLowerCase();
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) return { error: t('errors.emailInvalid') };
  return { value: email };
}

function validateRole(value, t) {
  return TEAM_ROLES.includes(value) ? { value } : { error: t('errors.teamRoleInvalid') };
}

function createTeamStore(db) {
  const columns = `id, name, email, role, active, must_change_password, last_login_at, created_at, deactivated_at`;
  const listRows = db.prepare(`SELECT ${columns} FROM users WHERE admin_id = ?
    ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'leader' THEN 1 WHEN 'operator' THEN 2 ELSE 3 END, name COLLATE NOCASE, id`);
  const selectOne = db.prepare(`SELECT ${columns} FROM users WHERE id = ? AND admin_id = ?`);
  const emailTaken = db.prepare('SELECT 1 FROM users WHERE email = ?').pluck();
  const insert = db.prepare(`INSERT INTO users
    (admin_id, email, name, password_hash, role, active, must_change_password, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)`);
  const updateName = db.prepare('UPDATE users SET name = ? WHERE id = ? AND admin_id = ?');
  const updateRole = db.prepare('UPDATE users SET role = ? WHERE id = ? AND admin_id = ?');
  const setActive = db.prepare('UPDATE users SET active = ?, deactivated_at = ? WHERE id = ? AND admin_id = ?');
  const setPassword = db.prepare('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ? AND admin_id = ?');
  const deleteSessions = db.prepare('DELETE FROM sessions WHERE user_id = ? AND admin_id = ?');

  const toMember = (row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    active: Boolean(row.active),
    mustChangePassword: Boolean(row.must_change_password),
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    deactivatedAt: row.deactivated_at,
  });

  function list(adminId) {
    return listRows.all(adminId).map(toMember);
  }

  function get(adminId, id) {
    const row = selectOne.get(id, adminId);
    return row ? toMember(row) : null;
  }

  function isEmailTaken(email) {
    return emailTaken.get(email) !== undefined;
  }

  // Returns the new user's id. passwordHash: of the temporary password.
  function create(adminId, createdBy, { name, email, role }, passwordHash) {
    return Number(insert.run(adminId, email, name, passwordHash, role, createdBy, Date.now()).lastInsertRowid);
  }

  function rename(adminId, id, name) {
    updateName.run(name, id, adminId);
  }

  function changeRole(adminId, id, role) {
    updateRole.run(role, id, adminId);
  }

  // Deactivated users cannot log in; their sessions are deleted.
  const deactivate = db.transaction((adminId, id) => {
    setActive.run(0, Date.now(), id, adminId);
    deleteSessions.run(id, adminId);
  });

  function reactivate(adminId, id) {
    setActive.run(1, null, id, adminId);
  }

  // mustChange: 1 for a temporary password (owner reset), 0 when the user chose it.
  function setUserPassword(adminId, id, passwordHash, mustChange) {
    setPassword.run(passwordHash, mustChange ? 1 : 0, id, adminId);
  }

  function endSessions(adminId, id) {
    deleteSessions.run(id, adminId);
  }

  return { list, get, isEmailTaken, create, rename, changeRole, deactivate, reactivate, setUserPassword, endSessions };
}

module.exports = {
  TEAM_ROLES,
  MIN_PASSWORD_LENGTH,
  TEMP_PASSWORD_LENGTH,
  TEMP_ALPHABET,
  temporaryPassword,
  validateName,
  validateEmail,
  validateRole,
  createTeamStore,
};
