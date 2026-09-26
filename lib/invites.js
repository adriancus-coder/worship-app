'use strict';

// Invitation and password-reset links sent by email (migration 026, user_tokens):
//   invite  a new person (never signed in) sets their name and password: /invite/<token>,
//           valid 7 days
//   reset   a new password: /reset/<token>, valid 1 hour, the other sessions end
// Tokens: 32 random bytes in the link, only the SHA-256 in the table; single use; a new
// token of the same kind spends the older one. Email goes through lib/email.js (disabled
// without a key: the callers answer 503 emailDisabled).

const crypto = require('crypto');
const { t } = require('./i18n');

const KINDS = ['invite', 'reset'];
const TTL_MS = { invite: 7 * 24 * 60 * 60 * 1000, reset: 60 * 60 * 1000 };
const TOKEN_RE = /^[0-9a-f]{64}$/;

const hashToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

function createTokenStore(db) {
  const insert = db.prepare(`INSERT INTO user_tokens (user_id, admin_id, kind, token_hash, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const spendOthers = db.prepare('UPDATE user_tokens SET used_at = ? WHERE user_id = ? AND kind = ? AND used_at IS NULL');
  const select = db.prepare(`SELECT tk.id, tk.user_id, tk.admin_id, tk.kind, tk.expires_at, tk.used_at,
      u.name, u.email, u.active AS user_active, u.locale, u.last_login_at, a.name AS admin_name, a.active AS admin_active
    FROM user_tokens tk JOIN users u ON u.id = tk.user_id JOIN admins a ON a.id = tk.admin_id
    WHERE tk.token_hash = ? AND tk.kind = ?`);
  const markUsed = db.prepare('UPDATE user_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL');

  // A new token for the user; the older unused ones of the kind are spent. -> the raw token.
  const create = db.transaction((adminId, userId, kind, now = Date.now()) => {
    if (!KINDS.includes(kind)) throw new Error(`bad token kind ${kind}`);
    const raw = crypto.randomBytes(32).toString('hex');
    spendOthers.run(now, userId, kind);
    insert.run(userId, adminId, kind, hashToken(raw), now, now + TTL_MS[kind]);
    return raw;
  });

  // { state: 'valid' | 'expired' | 'used', ...row } or null when unknown / not this kind /
  // the user or church is gone or deactivated.
  function find(kind, raw, now = Date.now()) {
    if (!KINDS.includes(kind) || !TOKEN_RE.test(String(raw || ''))) return null;
    const row = select.get(hashToken(raw), kind);
    if (!row || !row.user_active || !row.admin_active) return null;
    const state = row.used_at !== null ? 'used' : (row.expires_at <= now ? 'expired' : 'valid');
    return { ...row, state };
  }

  // Spends a valid token; returns its row or null (unknown, expired, used).
  const consume = db.transaction((kind, raw, now = Date.now()) => {
    const row = find(kind, raw, now);
    if (!row || row.state !== 'valid') return null;
    markUsed.run(now, row.id);
    return row;
  });

  return { create, find, consume };
}

// Sends the invitation / reset email with a fresh link. Throws lib/email.js EmailError.
//   invite({ adminId, user: { id, email, locale }, adminName, invitedBy, baseUrl, lang })
//   reset({ adminId, user, adminName, baseUrl, lang })
function createInviteService({ db, config, logger, email }) {
  const tokens = createTokenStore(db);
  const expiresText = (kind, lang) => (kind === 'invite' ? t('email.expiresDays', { n: 7 }, lang) : t('email.expiresHour', {}, lang));

  async function sendLink(kind, { adminId, user, adminName, invitedBy, baseUrl, lang }) {
    const language = user.locale || lang;
    const raw = tokens.create(adminId, user.id, kind);
    const url = `${baseUrl}/${kind}/${raw}`;
    const message = email.templates[kind](language, {
      appName: config.APP_NAME, churchName: adminName, url, invitedBy: invitedBy || '', expiresIn: expiresText(kind, language), email: user.email,
    });
    await email.send(adminId, { ...message, to: user.email, kind, userId: user.id });
    logger.info(`Link "${kind}" issued for user #${user.id} (admin #${adminId}), valid ${Math.round(TTL_MS[kind] / 60000)} min`);
  }

  return {
    tokens,
    invite: (args) => sendLink('invite', args),
    reset: (args) => sendLink('reset', args),
  };
}

module.exports = { KINDS, TTL_MS, TOKEN_RE, hashToken, createTokenStore, createInviteService };
