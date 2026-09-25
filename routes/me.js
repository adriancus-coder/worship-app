'use strict';

const express = require('express');
const { isLang, setLangCookie } = require('../lib/i18n');

function createMeRouter({ db, auth, config }) {
  const router = express.Router();

  const updateLocale = db.prepare('UPDATE users SET locale = ? WHERE id = ? AND admin_id = ?');

  router.put('/api/me/locale', auth.requireUser, (req, res) => {
    const locale = (req.body || {}).locale;
    if (!isLang(locale)) {
      return res.status(400).json({ error: req.t('errors.localeInvalid') });
    }
    updateLocale.run(locale, req.user.id, req.adminId);
    setLangCookie(res, locale, config);
    res.json({ ok: true, locale });
  });

  return router;
}

module.exports = createMeRouter;
