'use strict';

// Projector screens: pairing and tokens. A screen token is 32 random bytes (hex) given to
// the screen once; the database keeps only its sha256.
//
// Pairing with a code: the unpaired screen starts a pairing (secret id + 6-digit code);
// an owner/leader claims the code with a name, which creates the screen; the waiting
// screen polls with its secret id and collects its token once (the pairing row is then
// deleted). Pairing by link: an owner/leader asks for a one-time link (60 s); opening it
// on the projector PC collects the token the same way, without a code.
// Until the token is collected a screen row holds a placeholder hash ("pending:…"): it is
// not listed, can never match a real token, and is removed if never collected.

const crypto = require('crypto');

const TOKEN_BYTES = 32;
const TOKEN_RE = /^[0-9a-f]{64}$/;
const PAIRING_ID_RE = /^[0-9a-f]{48}$/;
const CODE_RE = /^\d{6}$/;
const LINK_CODE = 'link'; // pairings created as claim links (never a 6-digit code)
const PENDING = 'pending:';
const CODE_TTL_MS = 10 * 60 * 1000;
const LINK_TTL_MS = 60 * 1000;
const NAME_MAX = 60;

function newToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function isToken(value) {
  return typeof value === 'string' && TOKEN_RE.test(value);
}

function isPairingId(value) {
  return typeof value === 'string' && PAIRING_ID_RE.test(value);
}

function randomCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

// Screen name -> { value } or { error }.
function validateScreenName(name, t) {
  const value = typeof name === 'string' ? name.trim() : '';
  if (!value || value.length > NAME_MAX) return { error: t('errors.screenNameInvalid', { max: NAME_MAX }) };
  return { value };
}

function toScreen(row) {
  return { id: row.id, name: row.name, createdAt: row.created_at, lastSeenAt: row.last_seen_at };
}

function createScreenStore(db) {
  const insertPairing = db.prepare(`INSERT INTO screen_pairings (id, code, admin_id, screen_id, created_at, expires_at, claimed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const pendingCode = db.prepare(`SELECT id FROM screen_pairings
    WHERE code = ? AND claimed_at IS NULL AND expires_at > ?`);
  const selectPairing = db.prepare('SELECT * FROM screen_pairings WHERE id = ?');
  const claimPairing = db.prepare(`UPDATE screen_pairings SET admin_id = ?, screen_id = ?, claimed_at = ?
    WHERE id = ? AND claimed_at IS NULL`);
  const deletePairing = db.prepare('DELETE FROM screen_pairings WHERE id = ?');
  const deleteExpired = db.prepare('DELETE FROM screen_pairings WHERE expires_at <= ?');
  const deleteOrphans = db.prepare(`DELETE FROM screens WHERE token_hash LIKE '${PENDING}%'
    AND id NOT IN (SELECT screen_id FROM screen_pairings WHERE screen_id IS NOT NULL)`);
  const insertScreen = db.prepare(`INSERT INTO screens (admin_id, name, token_hash, created_by, created_at)
    VALUES (?, ?, ?, ?, ?)`);
  const setToken = db.prepare('UPDATE screens SET token_hash = ?, last_seen_at = ? WHERE id = ?');
  const selectByHash = db.prepare(`SELECT s.*, a.name AS admin_name, a.active AS admin_active FROM screens s JOIN admins a ON a.id = s.admin_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL`);
  const selectScreen = db.prepare(`SELECT * FROM screens WHERE id = ? AND admin_id = ? AND revoked_at IS NULL
    AND token_hash NOT LIKE '${PENDING}%'`);
  const listScreens = db.prepare(`SELECT * FROM screens WHERE admin_id = ? AND revoked_at IS NULL
    AND token_hash NOT LIKE '${PENDING}%' ORDER BY name COLLATE NOCASE, id`);
  const renameScreen = db.prepare('UPDATE screens SET name = ? WHERE id = ? AND admin_id = ? AND revoked_at IS NULL');
  const revokeScreen = db.prepare('UPDATE screens SET revoked_at = ? WHERE id = ? AND admin_id = ? AND revoked_at IS NULL');
  const touchScreen = db.prepare('UPDATE screens SET last_seen_at = ? WHERE id = ?');

  const cleanup = db.transaction((now) => {
    deleteExpired.run(now);
    deleteOrphans.run();
  });

  // An unpaired screen starts a pairing: { pairingId, code, expiresAt }.
  const startPairing = db.transaction(() => {
    const now = Date.now();
    cleanup(now);
    let code = randomCode();
    while (pendingCode.get(code, now)) code = randomCode(); // unique among pending pairings
    const id = crypto.randomBytes(24).toString('hex');
    insertPairing.run(id, code, null, null, now, now + CODE_TTL_MS, null);
    return { pairingId: id, code, expiresAt: now + CODE_TTL_MS };
  });

  function createPendingScreen(adminId, userId, name, now) {
    return Number(insertScreen.run(adminId, name, `${PENDING}${crypto.randomBytes(16).toString('hex')}`, userId, now).lastInsertRowid);
  }

  // Owner/leader enters the code shown on the screen: the screen is created for the admin.
  // Returns the new screen, or null when the code is wrong or expired.
  const claimCode = db.transaction((adminId, userId, code, name) => {
    const now = Date.now();
    if (!CODE_RE.test(String(code))) return null;
    const pairing = pendingCode.get(String(code), now);
    if (!pairing) return null;
    const screenId = createPendingScreen(adminId, userId, name, now);
    claimPairing.run(adminId, screenId, now, pairing.id);
    return { id: screenId, name };
  });

  // One-time claim link for the signed-in owner/leader's own window: { claim, expiresAt }.
  const createLink = db.transaction((adminId, userId, name) => {
    const now = Date.now();
    cleanup(now);
    const screenId = createPendingScreen(adminId, userId, name, now);
    const claim = crypto.randomBytes(24).toString('hex');
    insertPairing.run(claim, LINK_CODE, adminId, screenId, now, now + LINK_TTL_MS, now);
    return { claim, expiresAt: now + LINK_TTL_MS, screenId };
  });

  // Hands the token to the screen once: the pairing row is deleted in the same step.
  function deliver(pairing, now) {
    const token = newToken();
    setToken.run(hashToken(token), now, pairing.screen_id);
    deletePairing.run(pairing.id);
    const screen = db.prepare('SELECT id, name, admin_id FROM screens WHERE id = ?').get(pairing.screen_id);
    return { token, screen: { id: screen.id, name: screen.name }, adminId: screen.admin_id };
  }

  // The waiting screen polls its pairing: { status: 'pending', expiresAt } or
  // { status: 'paired', token, screen } (once), or null (unknown or expired).
  const collect = db.transaction((pairingId) => {
    const now = Date.now();
    if (!isPairingId(pairingId)) return null;
    const pairing = selectPairing.get(pairingId);
    if (!pairing || pairing.code === LINK_CODE) return null;
    if (pairing.claimed_at && pairing.screen_id) return { status: 'paired', ...deliver(pairing, now) };
    if (pairing.expires_at <= now) return null;
    return { status: 'pending', expiresAt: pairing.expires_at };
  });

  // Opening a claim link: { token, screen } once, or null (unknown, used or expired).
  const collectLink = db.transaction((claim) => {
    const now = Date.now();
    if (!isPairingId(claim)) return null;
    const pairing = selectPairing.get(claim);
    if (!pairing || pairing.code !== LINK_CODE || pairing.expires_at <= now) return null;
    return deliver(pairing, now);
  });

  // The screen for a token (not revoked), with its admin, or null.
  function findByToken(token) {
    if (!isToken(token)) return null;
    const row = selectByHash.get(hashToken(token));
    // adminActive false: the church is deactivated (platform page); the token stays valid.
    return row ? { ...toScreen(row), adminId: row.admin_id, adminName: row.admin_name, adminActive: Boolean(row.admin_active) } : null;
  }

  function touch(screenId) {
    touchScreen.run(Date.now(), screenId);
  }

  function list(adminId) {
    return listScreens.all(adminId).map(toScreen);
  }

  function get(adminId, id) {
    const row = selectScreen.get(id, adminId);
    return row ? toScreen(row) : null;
  }

  function rename(adminId, id, name) {
    return renameScreen.run(name, id, adminId).changes > 0;
  }

  function revoke(adminId, id) {
    return revokeScreen.run(Date.now(), id, adminId).changes > 0;
  }

  return { startPairing, claimCode, createLink, collect, collectLink, findByToken, touch, list, get, rename, revoke, cleanup };
}

module.exports = {
  TOKEN_BYTES,
  CODE_TTL_MS,
  LINK_TTL_MS,
  newToken,
  hashToken,
  isToken,
  validateScreenName,
  createScreenStore,
};
