'use strict';

const express = require('express');
const asyncRoute = require('../lib/async-route');

// "Mai mult → Notificări" (lib/notifications.js):
//   GET  /api/notifications          { notifications, unread, prefs, kinds }
//   GET  /api/notifications/unread   { unread }   (the tab bar badge)
//   POST /api/notifications/read     { ids: [...] } or { all: true }
//   PUT  /api/notifications/prefs    { kind: true|false, ... }
//   POST /api/notifications/tick     tests only (NODE_ENV=test): { now } runs the reminder tick
function createNotificationsRouter({ auth, config, notifications }) {
  const router = express.Router();
  router.use('/api/notifications', auth.requireUser, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/api/notifications', (req, res) => {
    res.json({ notifications: notifications.list(req.adminId, req.user.id), unread: notifications.unread(req.adminId, req.user.id), prefs: notifications.prefs(req.adminId, req.user.id), kinds: notifications.KINDS });
  });

  router.get('/api/notifications/unread', (req, res) => {
    res.json({ unread: notifications.unread(req.adminId, req.user.id) });
  });

  router.post('/api/notifications/read', (req, res) => {
    const body = req.body || {};
    const ids = body.all === true ? 'all' : (Array.isArray(body.ids) ? body.ids.filter((id) => Number.isInteger(id)) : null);
    if (!ids) return res.status(400).json({ error: req.t('errors.badRequest') });
    const changed = notifications.markRead(req.adminId, req.user.id, ids);
    res.json({ changed, unread: notifications.unread(req.adminId, req.user.id) });
  });

  router.put('/api/notifications/prefs', (req, res) => {
    const body = req.body || {};
    const patch = {};
    for (const kind of notifications.KINDS) if (typeof body[kind] === 'boolean') patch[kind] = body[kind];
    if (!Object.keys(patch).length) return res.status(400).json({ error: req.t('errors.badRequest') });
    res.json({ prefs: notifications.setPrefs(req.adminId, req.user.id, patch) });
  });

  if (config.NODE_ENV === 'test') {
    router.post('/api/notifications/tick', asyncRoute(async (req, res) => {
      const now = (req.body || {}).now ? new Date((req.body || {}).now) : new Date();
      res.json({ sent: await notifications.tick(now) });
    }));
  }

  return router;
}

module.exports = { createNotificationsRouter };
