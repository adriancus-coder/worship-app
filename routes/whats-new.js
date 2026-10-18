'use strict';

const express = require('express');
const { releasesFor, latest } = require('../lib/whats-new');

// GET /api/whats-new  { latest, releases: [{ id, title, items }] } in the request language,
// newest first (the last 10), only what is new for this person's role / rights: what
// public/whats-new.js shows after an update. `latest` is the newest release of all, so a
// device is "up to date" even when nothing in it was for this person.
function createWhatsNewRouter({ auth }) {
  const router = express.Router();
  router.get('/api/whats-new', auth.requireUser, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ latest: latest(), releases: releasesFor(req.user, req.lang) });
  });
  return router;
}

module.exports = { createWhatsNewRouter };
