'use strict';

const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

const KEY_LENGTH = 64;
const SALT_BYTES = 16;

const SESSION_COOKIE = 'wa_sid';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_ID_RE = /^[0-9a-f]{64}$/;

// Verified when the email is unknown, so both paths cost the same.
const DUMMY_HASH = `scrypt$${crypto.randomBytes(SALT_BYTES).toString('hex')}$${crypto.randomBytes(KEY_LENGTH).toString('hex')}`;

// Constant-time string comparison (hashing first makes lengths equal).
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Returns "scrypt$<salt hex>$<hash hex>".
async function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = await scrypt(String(password), salt, expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in cookies) continue;
    try {
      cookies[name] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      // Ignore malformed values.
    }
  }
  return cookies;
}

function createAuth({ db, config }) {
  const insertSession = db.prepare(`INSERT INTO sessions (id, user_id, admin_id, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)`);
  const selectSession = db.prepare(`SELECT u.id, u.name, u.email, u.role, u.locale,
      a.id AS admin_id, a.name AS admin_name
    FROM sessions s
    JOIN users u ON u.id = s.user_id AND u.admin_id = s.admin_id
    JOIN admins a ON a.id = s.admin_id
    WHERE s.id = ? AND s.expires_at > ? AND u.active = 1`);
  const deleteSessionStmt = db.prepare('DELETE FROM sessions WHERE id = ?');
  const deleteExpiredStmt = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');

  function getSessionId(req) {
    const id = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    return id && SESSION_ID_RE.test(id) ? id : null;
  }

  // Returns { sessionId, user, admin } for a valid session, else null.
  function getSession(req) {
    const sessionId = getSessionId(req);
    if (!sessionId) return null;
    const row = selectSession.get(sessionId, Date.now());
    if (!row) return null;
    return {
      sessionId,
      user: { id: row.id, name: row.name, email: row.email, role: row.role, locale: row.locale },
      admin: { id: row.admin_id, name: row.admin_name },
    };
  }

  function createSession(user, remember) {
    const id = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    const maxAgeMs = remember ? REMEMBER_TTL_MS : SESSION_TTL_MS;
    insertSession.run(id, user.id, user.admin_id, now, now + maxAgeMs);
    return { id, maxAgeMs };
  }

  function deleteSession(id) {
    deleteSessionStmt.run(id);
  }

  function deleteExpiredSessions() {
    return deleteExpiredStmt.run(Date.now()).changes;
  }

  function cookieOptions() {
    return { httpOnly: true, sameSite: 'lax', secure: config.IS_PRODUCTION, path: '/' };
  }

  function setSessionCookie(res, id, maxAgeMs) {
    res.cookie(SESSION_COOKIE, id, { ...cookieOptions(), maxAge: maxAgeMs });
  }

  function clearSessionCookie(res) {
    res.clearCookie(SESSION_COOKIE, cookieOptions());
  }

  function requireUser(req, res, next) {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: req.t('errors.unauthenticated') });
    req.sessionId = session.sessionId;
    req.user = session.user;
    req.admin = session.admin;
    req.adminId = session.admin.id;
    next();
  }

  return {
    getSessionId,
    getSession,
    createSession,
    deleteSession,
    deleteExpiredSessions,
    setSessionCookie,
    clearSessionCookie,
    requireUser,
  };
}

// Use after requireUser.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: req.t('errors.forbidden') });
    }
    next();
  };
}

module.exports = {
  DUMMY_HASH,
  parseCookies,
  safeEqual,
  hashPassword,
  verifyPassword,
  createAuth,
  requireRole,
};
