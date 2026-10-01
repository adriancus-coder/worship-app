'use strict';

// Projector screens: static links, pairing codes and tokens.
//
// Every screen has a STATIC LINK: /screen/<link_key>, a random 12-character key given out on
// /screens (copy / email / share). Opening it on the projector PC shows that screen's output
// at once, on any browser, at any time, without a code; it stays valid until the screen is
// revoked. A screen is created on /screens with a name ("Adaugă un ecran"), or by the console
// button "Deschide ecranul proiectorului" (one screen per window name, reused).
//
// Pairing with a code (the older way, for a PC where the link cannot be typed): the unpaired
// screen starts a pairing (secret id + 6-digit code); an owner/operator claims the code with
// a name, which creates the screen; the waiting screen polls with its secret id and collects
// its token once (the pairing row is then deleted). A screen token is 32 random bytes (hex)
// given to the screen once; the database keeps only its sha256. Until the token is collected
// a screen row holds a placeholder hash ("pending:…"): it is not listed, can never match a
// real token, and is removed if never collected. A screen made for its link holds a "link:…"
// placeholder instead: listed, never matched by a token.

const crypto = require('crypto');

const TOKEN_BYTES = 32;
const TOKEN_RE = /^[0-9a-f]{64}$/;
const PAIRING_ID_RE = /^[0-9a-f]{48}$/;
const CODE_RE = /^\d{6}$/;
const PENDING = 'pending:';
const LINK_ONLY = 'link:';
const CODE_TTL_MS = 10 * 60 * 1000;
const NAME_MAX = 60;
// Link keys: 12 characters, no ambiguous ones (0/o, 1/l/i), 2^55 or so.
const LINK_KEY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const LINK_KEY_LEN = 12;
const LINK_KEY_RE = /^[a-z0-9]{12}$/;

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

function newLinkKey() {
  const bytes = crypto.randomBytes(LINK_KEY_LEN);
  let key = '';
  for (let i = 0; i < LINK_KEY_LEN; i++) key += LINK_KEY_ALPHABET[bytes[i] % LINK_KEY_ALPHABET.length];
  return key;
}

function isLinkKey(value) {
  return typeof value === 'string' && LINK_KEY_RE.test(value);
}

// The screen's static link, relative (the pages prefix "adresa proiectorului").
function linkPath(linkKey) {
  return `/screen/${linkKey}`;
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

// safeMargin: this screen's own "Margine de siguranță" (0-12 %), null = the church default.
function toScreen(row) {
  return {
    id: row.id, name: row.name, createdAt: row.created_at, lastSeenAt: row.last_seen_at,
    safeMargin: row.safe_margin === undefined ? null : row.safe_margin,
    linkKey: row.link_key || null,
    link: row.link_key ? linkPath(row.link_key) : null,
  };
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
  const insertScreen = db.prepare(`INSERT INTO screens (admin_id, name, token_hash, link_key, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const setToken = db.prepare('UPDATE screens SET token_hash = ?, last_seen_at = ? WHERE id = ?');
  const withAdmin = `SELECT s.*, a.name AS admin_name, a.active AS admin_active FROM screens s JOIN admins a ON a.id = s.admin_id`;
  const selectByHash = db.prepare(`${withAdmin} WHERE s.token_hash = ? AND s.revoked_at IS NULL`);
  const selectByKey = db.prepare(`${withAdmin} WHERE s.link_key = ? AND s.revoked_at IS NULL AND s.token_hash NOT LIKE '${PENDING}%'`);
  const selectScreen = db.prepare(`SELECT * FROM screens WHERE id = ? AND admin_id = ? AND revoked_at IS NULL
    AND token_hash NOT LIKE '${PENDING}%'`);
  const selectByName = db.prepare(`SELECT * FROM screens WHERE admin_id = ? AND name = ? AND revoked_at IS NULL
    AND token_hash NOT LIKE '${PENDING}%' ORDER BY id LIMIT 1`);
  const listScreens = db.prepare(`SELECT * FROM screens WHERE admin_id = ? AND revoked_at IS NULL
    AND token_hash NOT LIKE '${PENDING}%' ORDER BY name COLLATE NOCASE, id`);
  const renameScreen = db.prepare('UPDATE screens SET name = ? WHERE id = ? AND admin_id = ? AND revoked_at IS NULL');
  const revokeScreen = db.prepare('UPDATE screens SET revoked_at = ? WHERE id = ? AND admin_id = ? AND revoked_at IS NULL');
  const touchScreen = db.prepare('UPDATE screens SET last_seen_at = ? WHERE id = ?');
  const setMargin = db.prepare('UPDATE screens SET safe_margin = ? WHERE id = ? AND admin_id = ? AND revoked_at IS NULL');
  const withoutKey = db.prepare('SELECT id FROM screens WHERE link_key IS NULL');
  const setKey = db.prepare('UPDATE screens SET link_key = ? WHERE id = ?');
  const keyTaken = db.prepare('SELECT 1 FROM screens WHERE link_key = ?');

  function freshKey() {
    let key = newLinkKey();
    while (keyTaken.get(key)) key = newLinkKey();
    return key;
  }

  // Screens from before migration 039 get their static link once.
  const ensureLinkKeys = db.transaction(() => {
    for (const { id } of withoutKey.all()) setKey.run(freshKey(), id);
  });
  ensureLinkKeys();

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

  function insert(adminId, userId, name, placeholder, now) {
    return Number(insertScreen.run(adminId, name, `${placeholder}${crypto.randomBytes(16).toString('hex')}`, freshKey(), userId, now).lastInsertRowid);
  }

  // "Adaugă un ecran" on /screens: a screen with its static link, nothing to pair.
  const create = db.transaction((adminId, userId, name) => {
    const id = insert(adminId, userId, name, LINK_ONLY, Date.now());
    return get(adminId, id);
  });

  // The console button: the screen with this name (the window's), or a new one.
  const findOrCreate = db.transaction((adminId, userId, name) => {
    const row = selectByName.get(adminId, name);
    return row ? toScreen(row) : create(adminId, userId, name);
  });

  // Owner/operator enters the code shown on the screen: the screen is created for the admin.
  // Returns the new screen, or null when the code is wrong or expired.
  const claimCode = db.transaction((adminId, userId, code, name) => {
    const now = Date.now();
    if (!CODE_RE.test(String(code))) return null;
    const pairing = pendingCode.get(String(code), now);
    if (!pairing) return null;
    const screenId = insert(adminId, userId, name, PENDING, now);
    claimPairing.run(adminId, screenId, now, pairing.id);
    return { id: screenId, name };
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
    if (!pairing) return null;
    if (pairing.claimed_at && pairing.screen_id) return { status: 'paired', ...deliver(pairing, now) };
    if (pairing.expires_at <= now) return null;
    return { status: 'pending', expiresAt: pairing.expires_at };
  });

  function withAdminInfo(row) {
    // adminActive false: the church is deactivated (platform page); the credential stays valid.
    return row ? { ...toScreen(row), adminId: row.admin_id, adminName: row.admin_name, adminActive: Boolean(row.admin_active) } : null;
  }

  // The screen for a token (not revoked), with its admin, or null.
  function findByToken(token) {
    if (!isToken(token)) return null;
    return withAdminInfo(selectByHash.get(hashToken(token)));
  }

  // The screen for a static link key (not revoked), with its admin, or null.
  function findByKey(key) {
    if (!isLinkKey(key)) return null;
    return withAdminInfo(selectByKey.get(key));
  }

  // A screen's credential, as a socket handshake or request headers carry it:
  // { token } (code pairing) or { key } (static link). Unknown -> null.
  function identify(credential) {
    const c = credential && typeof credential === 'object' ? credential : {};
    return (c.token && findByToken(c.token)) || (c.key && findByKey(c.key)) || null;
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

  // The screen's own safe margin (0-12) or null (back to the church default).
  function setSafeMargin(adminId, id, value) {
    return setMargin.run(value, id, adminId).changes > 0;
  }

  return { startPairing, claimCode, create, findOrCreate, collect, findByToken, findByKey, identify, touch, list, get, rename, revoke, setSafeMargin, cleanup };
}

module.exports = {
  TOKEN_BYTES,
  CODE_TTL_MS,
  LINK_KEY_LEN,
  newToken,
  hashToken,
  isToken,
  newLinkKey,
  isLinkKey,
  linkPath,
  validateScreenName,
  createScreenStore,
};
