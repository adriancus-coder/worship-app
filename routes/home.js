'use strict';

const express = require('express');
const { todayIn } = require('../lib/dates');
const { createAdminSettings } = require('../lib/admin-settings');
const { createHome } = require('../lib/home');

// GET /api/home: the live event, the next one and a few more, for the user's admin and role.
function createHomeRouter({ db, auth }) {
  const router = express.Router();
  const settings = createAdminSettings(db);
  const { home } = createHome(db);

  router.get('/api/home', auth.requireUser, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(home(req.adminId, req.user.role, todayIn(settings.timezone(req.adminId))));
  });

  return router;
}

module.exports = { createHomeRouter };
