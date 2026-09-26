'use strict';

const express = require('express');
const { todayIn } = require('../lib/dates');
const { createAdminSettings } = require('../lib/admin-settings');
const { validateRange, createUnavailabilityStore } = require('../lib/unavailability');
const { ASSIGN_ROLES } = require('../lib/assignments');

// "Indisponibil" (lib/unavailability.js):
//   GET / POST /api/me/unavailability, DELETE /api/me/unavailability/:id   one's own ranges
//   GET /api/unavailability                                               owner, leader: everyone's
function createUnavailabilityRouter({ db, auth, logger }) {
  const router = express.Router();
  const store = createUnavailabilityStore(db);
  const settings = createAdminSettings(db);
  const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
  const today = (req) => todayIn(settings.timezone(req.adminId));

  router.get('/api/me/unavailability', auth.requireUser, noStore, (req, res) => {
    res.json({ ranges: store.listForUser(req.adminId, req.user.id, today(req)), today: today(req) });
  });

  router.post('/api/me/unavailability', auth.requireUser, noStore, (req, res) => {
    const { error, value } = validateRange(req.body || {}, req.t);
    if (error) return res.status(400).json({ error });
    const range = store.add(req.adminId, req.user.id, value);
    if (!range) return res.status(400).json({ error: req.t('errors.unavailabilityTooMany') });
    logger.info(`User #${req.user.id} is unavailable ${value.dateFrom}..${value.dateTo} (admin #${req.adminId})`);
    res.status(201).json({ range, ranges: store.listForUser(req.adminId, req.user.id, today(req)) });
  });

  router.delete('/api/me/unavailability/:id', auth.requireUser, noStore, (req, res) => {
    const id = /^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : null;
    if (!id || !store.removeOwn(req.adminId, req.user.id, id)) return res.status(404).json({ error: req.t('errors.notFound') });
    res.json({ ranges: store.listForUser(req.adminId, req.user.id, today(req)) });
  });

  // Everyone's upcoming ranges: the owner and the leader (scheduling); never the others.
  router.get('/api/unavailability', auth.requireUser, noStore, (req, res) => {
    if (!ASSIGN_ROLES.includes(req.user.role)) return res.status(403).json({ error: req.t('errors.forbidden') });
    const by = store.byUser(req.adminId, today(req));
    res.json({ byUser: Object.fromEntries([...by.entries()].map(([userId, ranges]) => [String(userId), ranges])), today: today(req) });
  });

  return router;
}

module.exports = { createUnavailabilityRouter };
