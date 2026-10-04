'use strict';

const express = require('express');
const { todayIn } = require('../lib/dates');
const { createAdminSettings } = require('../lib/admin-settings');
const { createHome } = require('../lib/home');
const { createBackupLog } = require('../lib/backup');
const { seesAllEvents } = require('../lib/roles');

// GET /api/home: the live event, the next one and a few more, for the user's admin and role;
// for the owner also backupReminder ({ lastAt } or null, lib/backup.js).
function createHomeRouter({ db, auth }) {
  const router = express.Router();
  const settings = createAdminSettings(db);
  const { home } = createHome(db);
  const backups = createBackupLog(db);

  router.get('/api/home', auth.requireUser, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const body = home(req.adminId, seesAllEvents(req.user), todayIn(settings.timezone(req.adminId)), req.user.id);
    if (req.user.role === 'owner') body.backupReminder = backups.reminder(req.adminId);
    res.json(body);
  });

  return router;
}

module.exports = { createHomeRouter };
