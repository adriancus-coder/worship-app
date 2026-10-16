'use strict';

const express = require('express');
const { RELEASES, latest } = require('../lib/whats-new');

// GET /api/whats-new  { latest, releases: [{ id, title, items }] } in the request language,
// newest first (the last 10): what public/whats-new.js shows after an update.
function createWhatsNewRouter({ auth }) {
  const router = express.Router();
  router.get('/api/whats-new', auth.requireUser, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const lang = req.lang === 'en' ? 'en' : 'ro';
    res.json({ latest: latest(), releases: RELEASES.slice(0, 10).map((r) => ({ id: r.id, title: r[lang].title, items: r[lang].items })) });
  });
  return router;
}

module.exports = { createWhatsNewRouter };
