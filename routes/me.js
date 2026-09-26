'use strict';

const express = require('express');
const { isLang, setLangCookie } = require('../lib/i18n');
const { NOTATIONS, createAdminSettings } = require('../lib/admin-settings');
const { isTheme, setThemeCookie } = require('../lib/theme');
const asyncRoute = require('../lib/async-route');
const { hashPassword, verifyPassword, VIEW_AS_ROLES } = require('../lib/auth');
const { MIN_PASSWORD_LENGTH } = require('../lib/team');
const { createFailureLimiter } = require('../lib/rate-limit');

function createMeRouter({ db, auth, config, logger, live }) {
  const router = express.Router();
  const limiter = createFailureLimiter({ maxFailures: 5, windowMs: 15 * 60 * 1000 });
  const selectHash = db.prepare('SELECT password_hash FROM users WHERE id = ? AND admin_id = ?').pluck();
  const updatePassword = db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ? AND admin_id = ?');
  const otherSessions = db.prepare('SELECT id FROM sessions WHERE user_id = ? AND id <> ?').pluck();
  const deleteSession = db.prepare('DELETE FROM sessions WHERE id = ?');

  const updateLocale = db.prepare('UPDATE users SET locale = ? WHERE id = ? AND admin_id = ?');

  // "Vezi aplicația ca" (an owner only): { role: 'leader' | 'operator' | 'member' | null }.
  // The page reloads after; sockets pick the new role up on their next join / command.
  router.put('/api/me/view-as', auth.requireUser, (req, res) => {
    if (req.user.realRole !== 'owner') return res.status(403).json({ error: req.t('errors.forbidden') });
    const role = (req.body || {}).role;
    if (role !== null && !VIEW_AS_ROLES.includes(role)) return res.status(400).json({ error: req.t('errors.badRequest') });
    auth.setViewAs(req.sessionId, role);
    logger.info(`User #${req.user.id} (owner, admin #${req.adminId}) ${role ? `views the app as ${role}` : 'is back to owner'}`);
    res.json({ ok: true, viewAs: role });
  });
  const updateNotation = db.prepare('UPDATE users SET chord_notation = ? WHERE id = ? AND admin_id = ?');
  const updateTheme = db.prepare('UPDATE users SET theme = ? WHERE id = ? AND admin_id = ?');
  const settings = createAdminSettings(db);

  router.put('/api/me/locale', auth.requireUser, (req, res) => {
    const locale = (req.body || {}).locale;
    if (!isLang(locale)) {
      return res.status(400).json({ error: req.t('errors.localeInvalid') });
    }
    updateLocale.run(locale, req.user.id, req.adminId);
    setLangCookie(res, locale, config);
    res.json({ ok: true, locale });
  });

  // The user's own chord notation ('letters' | 'solfege'); it follows them on every device.
  router.put('/api/me/chord-notation', auth.requireUser, (req, res) => {
    const notation = (req.body || {}).notation;
    if (!NOTATIONS.includes(notation)) return res.status(400).json({ error: req.t('errors.chordNotationInvalid') });
    updateNotation.run(notation, req.user.id, req.adminId);
    res.json({ ok: true, chordNotation: notation });
  });

  // The user's own colour theme ('dark' | 'light' | 'auto'), on every device; null returns
  // to the church default. The cookie keeps signed-out pages of this device in step.
  router.put('/api/me/theme', auth.requireUser, (req, res) => {
    const theme = (req.body || {}).theme;
    if (theme !== null && !isTheme(theme)) return res.status(400).json({ error: req.t('errors.themeInvalid') });
    updateTheme.run(theme, req.user.id, req.adminId);
    const effective = theme || settings.themeDefault(req.adminId);
    setThemeCookie(res, effective, config);
    res.json({ ok: true, theme: effective, themeOwn: theme });
  });

  // The user's own password: the current one (a temporary one included) and a new one of at
  // least 10 characters that differs from it. Clears must_change_password; the user's other
  // sessions end (this one stays signed in).
  router.post('/api/me/password', auth.requireUser, asyncRoute(async (req, res) => {
    const key = `user:${req.user.id}`;
    const retryAfter = limiter.retryAfterSeconds(key);
    if (retryAfter > 0) {
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: req.t('errors.tooManyAttempts') });
    }
    const body = req.body || {};
    const current = typeof body.current === 'string' ? body.current : '';
    const next = typeof body.password === 'string' ? body.password : '';
    if (!(await verifyPassword(current, selectHash.get(req.user.id, req.adminId)))) {
      limiter.recordFailure(key);
      return res.status(400).json({ code: 'wrongPassword', error: req.t('errors.passwordWrong') });
    }
    limiter.reset(key);
    if (next.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ code: 'tooShort', error: req.t('errors.passwordTooShort', { min: MIN_PASSWORD_LENGTH }) });
    }
    if (next === current) return res.status(400).json({ code: 'samePassword', error: req.t('errors.passwordSame') });
    updatePassword.run(await hashPassword(next), req.user.id, req.adminId);
    auth.setViewAs(req.sessionId, null); // a password change ends "Vezi ca" too
    for (const id of otherSessions.all(req.user.id, req.sessionId)) {
      deleteSession.run(id);
      live.closeSession(id);
    }
    logger.info(`User #${req.user.id} changed their password (admin #${req.adminId})`);
    res.json({ ok: true });
  }));

  return router;
}

module.exports = createMeRouter;
