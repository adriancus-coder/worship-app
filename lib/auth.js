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
// The roles an owner may view the app as (sessions.view_as, migration 025).
const VIEW_AS_ROLES = ['presenter', 'leader', 'operator', 'member'];
// What a user with a temporary password may still call (logout needs no session check).
const PENDING_ALLOWED = ['GET /api/auth/me', 'POST /api/me/password'];

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
  const selectSession = db.prepare(`SELECT u.id, u.name, u.email, u.role, u.locale, u.chord_notation, u.theme, u.must_change_password,
      s.view_as, a.id AS admin_id, a.name AS admin_name
    FROM sessions s
    JOIN users u ON u.id = s.user_id AND u.admin_id = s.admin_id
    JOIN admins a ON a.id = s.admin_id
    WHERE s.id = ? AND s.expires_at > ? AND u.active = 1 AND a.active = 1`);
  const selectPlatformAdmin = db.prepare('SELECT id FROM admins WHERE platform_owner = 1 ORDER BY id LIMIT 1').pluck();
  const deleteSessionStmt = db.prepare('DELETE FROM sessions WHERE id = ?');
  const deleteExpiredStmt = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');
  const updateViewAs = db.prepare('UPDATE sessions SET view_as = ? WHERE id = ?');

  function getSessionId(req) {
    const id = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    return id && SESSION_ID_RE.test(id) ? id : null;
  }

  // The admin that runs the platform: PLATFORM_ADMIN_ID, else the one marked in the database.
  function platformAdminId() {
    if (config.PLATFORM_ADMIN_ID) return config.PLATFORM_ADMIN_ID;
    const id = selectPlatformAdmin.get();
    return id === undefined ? null : id;
  }

  // Only the OWNER user of the platform admin; its leaders and members are ordinary users.
  // Always the real role, and never while the owner is viewing the app as another role.
  function isPlatformOwner(user, admin) {
    return Boolean(user && admin && (user.realRole || user.role) === 'owner' && !user.viewAs && admin.id === platformAdminId());
  }

  // Returns { sessionId, user, admin } for a valid session, else null.
  // user.role is the EFFECTIVE role: the session's view_as ("Vezi aplicația ca", an owner
  // looking at the app as leader / operator / member) when set, else the real one. Every
  // guard, page, socket command and menu reads user.role, so one place decides.
  // user.realRole is what the account is; user.viewAs the role viewed as (or null).
  function getSession(req) {
    const sessionId = getSessionId(req);
    if (!sessionId) return null;
    const row = selectSession.get(sessionId, Date.now());
    if (!row) return null;
    const viewAs = row.role === 'owner' && VIEW_AS_ROLES.includes(row.view_as) ? row.view_as : null;
    const user = {
      id: row.id, name: row.name, email: row.email, role: viewAs || row.role, realRole: row.role, viewAs,
      locale: row.locale, chordNotation: row.chord_notation,
      theme: row.theme,
      mustChangePassword: Boolean(row.must_change_password),
    };
    return {
      sessionId,
      user,
      admin: { id: row.admin_id, name: row.admin_name },
      platformOwner: isPlatformOwner(user, { id: row.admin_id }),
    };
  }

  // "Vezi aplicația ca": role = 'leader' | 'operator' | 'member' | null (back to the owner).
  function setViewAs(sessionId, role) {
    updateViewAs.run(role, sessionId);
  }

  // A session that may use the app: null while the user must first change a temporary
  // password (only /change-password, GET /api/auth/me, logout and POST /api/me/password).
  function getActiveSession(req) {
    const session = getSession(req);
    return session && !session.user.mustChangePassword ? session : null;
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
    if (session.user.mustChangePassword && !PENDING_ALLOWED.includes(`${req.method} ${req.originalUrl.split('?')[0]}`)) {
      return res.status(403).json({ code: 'mustChangePassword', error: req.t('errors.mustChangePassword') });
    }
    req.sessionId = session.sessionId;
    req.user = session.user;
    req.admin = session.admin;
    req.adminId = session.admin.id;
    req.platformOwner = session.platformOwner;
    next();
  }

  // Use after requireUser: the platform owner only (/api/platform), else 403.
  function requirePlatformOwner(req, res, next) {
    if (!isPlatformOwner(req.user, req.admin)) return res.status(403).json({ error: req.t('errors.forbidden') });
    next();
  }

  return {
    getSessionId,
    getSession,
    getActiveSession,
    createSession,
    deleteSession,
    deleteExpiredSessions,
    setViewAs,
    setSessionCookie,
    clearSessionCookie,
    requireUser,
    requirePlatformOwner,
    platformAdminId,
    isPlatformOwner,
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
  VIEW_AS_ROLES,
  parseCookies,
  safeEqual,
  hashPassword,
  verifyPassword,
  createAuth,
  requireRole,
};
