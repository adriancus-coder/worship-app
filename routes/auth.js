'use strict';

const express = require('express');
const asyncRoute = require('../lib/async-route');
const { DUMMY_HASH, verifyPassword } = require('../lib/auth');
const { createFailureLimiter } = require('../lib/rate-limit');
const { isLang, setLangCookie } = require('../lib/i18n');
const { createAdminSettings } = require('../lib/admin-settings');

function createAuthRouter({ db, auth, config, logger, live }) {
  const router = express.Router();
  const limiter = createFailureLimiter({ maxFailures: 5, windowMs: 15 * 60 * 1000 });
  const settings = createAdminSettings(db);

  const findUser = db.prepare(`SELECT u.id, u.admin_id, u.name, u.email, u.role, u.locale, u.password_hash,
      a.name AS admin_name
    FROM users u JOIN admins a ON a.id = u.admin_id
    WHERE u.email = ? AND u.active = 1`);
  const updateLocale = db.prepare('UPDATE users SET locale = ? WHERE id = ? AND admin_id = ?');
  const touchLogin = db.prepare('UPDATE users SET last_login_at = ? WHERE id = ? AND admin_id = ?');

  router.post('/api/auth/login', asyncRoute(async (req, res) => {
    const ip = req.ip;
    const retryAfter = limiter.retryAfterSeconds(ip);
    if (retryAfter > 0) {
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: req.t('errors.tooManyAttempts') });
    }

    const body = req.body || {};
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const remember = body.remember === true;

    const user = email ? findUser.get(email) : undefined;
    const valid = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !valid) {
      limiter.recordFailure(ip);
      logger.info(`Failed login from ${ip}`);
      return res.status(401).json({ error: req.t('errors.invalidLogin') });
    }

    limiter.reset(ip);
    const previous = auth.getSessionId(req);
    if (previous) auth.deleteSession(previous);

    const session = auth.createSession(user, remember);
    touchLogin.run(Date.now(), user.id, user.admin_id);
    auth.setSessionCookie(res, session.id, session.maxAgeMs);

    // A saved language wins; otherwise the current one becomes the user's preference.
    let locale = user.locale;
    if (!isLang(locale)) {
      locale = req.lang;
      updateLocale.run(locale, user.id, user.admin_id);
    }
    setLangCookie(res, locale, config);
    logger.info(`User #${user.id} logged in (admin #${user.admin_id})`);
    res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role, locale },
      admin: { id: user.admin_id, name: user.admin_name },
    });
  }));

  router.post('/api/auth/logout', (req, res) => {
    const sessionId = auth.getSessionId(req);
    if (sessionId) {
      auth.deleteSession(sessionId);
      live.closeSession(sessionId);
    }
    auth.clearSessionCookie(res);
    res.json({ ok: true });
  });

  router.get('/api/auth/me', auth.requireUser, (req, res) => {
    res.set('Cache-Control', 'no-store');
    // chordNotation is the effective one: the user's own, else the church default.
    const own = req.user.chordNotation || null;
    res.json({
      user: { ...req.user, chordNotation: own || settings.chordNotationDefault(req.adminId), chordNotationOwn: own },
      admin: req.admin,
    });
  });

  return router;
}

module.exports = createAuthRouter;
