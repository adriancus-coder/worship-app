'use strict';

const express = require('express');
const asyncRoute = require('../lib/async-route');
const { hashPassword } = require('../lib/auth');
const { MIN_PASSWORD_LENGTH, validateName, validateEmail } = require('../lib/team');
const { createRequestLimiter } = require('../lib/rate-limit');
const { isLang, setLangCookie } = require('../lib/i18n');

const FORGOT_LIMIT = { maxRequests: 5, windowMs: 60 * 60 * 1000 }; // per email and per IP

// The public side of the email links (lib/invites.js): /api/invite/:token and
// /api/reset/:token (look, then set the password and sign in), "Ai uitat parola?"
// (POST /api/auth/forgot: always the same answer, no account enumeration) and the small
// feature flag the login page reads. Owner actions (send / resend) live in routes/team.js and
// routes/platform.js through the same service.
function createInvitesRouter({ db, auth, config, logger, live, email, invites }) {
  const router = express.Router();
  const { tokens } = invites;
  const forgotLimiter = createRequestLimiter(FORGOT_LIMIT);
  const findByEmail = db.prepare(`SELECT u.id, u.admin_id, u.email, u.locale, a.name AS admin_name
    FROM users u JOIN admins a ON a.id = u.admin_id WHERE u.email = ? AND u.active = 1 AND a.active = 1`);
  const setPassword = db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ? AND admin_id = ?');
  const setName = db.prepare('UPDATE users SET name = ? WHERE id = ? AND admin_id = ?');
  const touchLogin = db.prepare('UPDATE users SET last_login_at = ? WHERE id = ? AND admin_id = ?');
  const userSessions = db.prepare('SELECT id FROM sessions WHERE user_id = ? AND admin_id = ?').pluck();
  const deleteSession = db.prepare('DELETE FROM sessions WHERE id = ?');

  const baseUrl = (req) => config.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  const noStore = (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  };

  // What the login page needs to know: whether "Ai uitat parola?" can do anything.
  router.get('/api/auth/features', noStore, (req, res) => {
    res.json({ emailEnabled: email.enabled });
  });

  // "Ai uitat parola?": the same answer whether the account exists or not.
  router.post('/api/auth/forgot', noStore, asyncRoute(async (req, res) => {
    if (!email.enabled) return res.status(503).json({ code: 'emailDisabled', error: req.t('errors.emailDisabled') });
    const parsed = validateEmail((req.body || {}).email, req.t);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const retry = Math.max(forgotLimiter.take(`email:${parsed.value}`), forgotLimiter.take(`ip:${req.ip}`));
    if (retry > 0) {
      res.set('Retry-After', String(retry));
      return res.status(429).json({ error: req.t('errors.tooManyAttempts') });
    }
    const user = findByEmail.get(parsed.value);
    if (user) {
      try {
        await invites.reset({ adminId: user.admin_id, user: { id: user.id, email: user.email, locale: user.locale }, adminName: user.admin_name, baseUrl: baseUrl(req), lang: req.lang });
      } catch (err) {
        logger.warn(`Forgot-password email for user #${user.id} not sent: ${err.code || err.message}`);
      }
    } else {
      logger.info(`Forgot-password request for an unknown email from ${req.ip}`);
    }
    res.json({ ok: true });
  }));

  // The token as the page sees it: 404 unknown, 410 expired / used, else who it is for.
  function lookup(kind) {
    return (req, res) => {
      const found = tokens.find(kind, req.params.token);
      if (!found) return res.status(404).json({ code: 'tokenInvalid', error: req.t('errors.tokenInvalid') });
      if (found.state !== 'valid') return res.status(410).json({ code: found.state === 'used' ? 'tokenUsed' : 'tokenExpired', error: req.t(found.state === 'used' ? 'errors.tokenUsed' : 'errors.tokenExpired') });
      res.json({ kind, name: found.name, email: found.email, church: found.admin_name, appName: config.APP_NAME });
    };
  }
  router.get('/api/invite/:token', noStore, lookup('invite'));
  router.get('/api/reset/:token', noStore, lookup('reset'));

  // Signs the user in on the device that used the link.
  function signIn(req, res, row) {
    for (const id of userSessions.all(row.user_id, row.admin_id)) {
      deleteSession.run(id);
      live.closeSession(id);
    }
    const session = auth.createSession({ id: row.user_id, admin_id: row.admin_id }, false);
    auth.setSessionCookie(res, session.id, session.maxAgeMs);
    setLangCookie(res, isLang(row.locale) ? row.locale : req.lang, config);
    touchLogin.run(Date.now(), row.user_id, row.admin_id);
  }

  function passwordOf(req, res) {
    const password = typeof (req.body || {}).password === 'string' ? req.body.password : '';
    if (password.length < MIN_PASSWORD_LENGTH) {
      res.status(400).json({ code: 'tooShort', error: req.t('errors.passwordTooShort', { min: MIN_PASSWORD_LENGTH }) });
      return null;
    }
    return password;
  }

  // The invitation: name (prefilled, may be corrected) + password -> signed in.
  router.post('/api/invite/:token', noStore, asyncRoute(async (req, res) => {
    const found = tokens.find('invite', req.params.token);
    if (!found || found.state !== 'valid') return lookup('invite')(req, res);
    const name = validateName((req.body || {}).name, req.t);
    if (name.error) return res.status(400).json({ error: name.error });
    const password = passwordOf(req, res);
    if (password === null) return;
    const hash = await hashPassword(password);
    const row = tokens.consume('invite', req.params.token);
    if (!row) return lookup('invite')(req, res); // spent meanwhile
    setName.run(name.value, row.user_id, row.admin_id);
    setPassword.run(hash, row.user_id, row.admin_id);
    signIn(req, res, row);
    logger.info(`User #${row.user_id} accepted the invitation and set a password (admin #${row.admin_id})`);
    res.json({ ok: true, user: { id: row.user_id, name: name.value, email: row.email } });
  }));

  // The reset: a new password -> signed in here, every other session ended.
  router.post('/api/reset/:token', noStore, asyncRoute(async (req, res) => {
    const found = tokens.find('reset', req.params.token);
    if (!found || found.state !== 'valid') return lookup('reset')(req, res);
    const password = passwordOf(req, res);
    if (password === null) return;
    const hash = await hashPassword(password);
    const row = tokens.consume('reset', req.params.token);
    if (!row) return lookup('reset')(req, res);
    setPassword.run(hash, row.user_id, row.admin_id);
    signIn(req, res, row);
    logger.info(`User #${row.user_id} set a new password through a reset link (admin #${row.admin_id})`);
    res.json({ ok: true, user: { id: row.user_id, name: row.name, email: row.email } });
  }));

  return router;
}

// The owner actions share this: a 503 / 429 / 502 for an email error, else rethrow.
function emailErrorResponse(req, res, err) {
  if (err.code === 'emailDisabled') return res.status(503).json({ code: err.code, error: req.t('errors.emailDisabled') });
  if (err.code === 'emailRateLimited') return res.status(429).json({ code: err.code, error: req.t('errors.emailRateLimited') });
  if (err.code === 'emailFailed') return res.status(502).json({ code: err.code, error: req.t('errors.emailFailed') });
  throw err;
}

module.exports = { createInvitesRouter, emailErrorResponse };
