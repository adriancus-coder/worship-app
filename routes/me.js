'use strict';

const express = require('express');
const { isLang, setLangCookie } = require('../lib/i18n');
const { NOTATIONS } = require('../lib/admin-settings');

function createMeRouter({ db, auth, config }) {
  const router = express.Router();

  const updateLocale = db.prepare('UPDATE users SET locale = ? WHERE id = ? AND admin_id = ?');
  const updateNotation = db.prepare('UPDATE users SET chord_notation = ? WHERE id = ? AND admin_id = ?');

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

  return router;
}

module.exports = createMeRouter;
