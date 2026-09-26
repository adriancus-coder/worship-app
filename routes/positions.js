'use strict';

const express = require('express');
const { requireRole } = require('../lib/auth');
const { validatePositionName, createPositionStore } = require('../lib/positions');

// "Poziții în echipă" (Setări, and /positions for the leader): the positions a church uses.
// Everyone signed in reads them (pickers, the profile); owner and leader edit them.
const MANAGE_ROLES = ['owner', 'leader'];

function createPositionsRouter({ db, auth, logger }) {
  const router = express.Router();
  const positions = createPositionStore(db);
  const canManage = requireRole(...MANAGE_ROLES);

  router.use('/api/positions', auth.requireUser, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const idOf = (req) => (/^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : null);

  router.get('/api/positions', (req, res) => {
    res.json({ positions: positions.list(req.adminId), canManage: MANAGE_ROLES.includes(req.user.role) });
  });

  router.post('/api/positions', canManage, (req, res) => {
    const name = validatePositionName((req.body || {}).name, req.t);
    if (name.error) return res.status(400).json({ error: name.error });
    const created = positions.create(req.adminId, name.value);
    if (!created) return res.status(400).json({ error: req.t('errors.positionsTooMany') });
    logger.info(`Position "${created.name}" added by user #${req.user.id} (admin #${req.adminId})`);
    res.status(201).json({ position: created, positions: positions.list(req.adminId) });
  });

  // The whole order: { ids: [...] } (every position of the admin, once).
  router.put('/api/positions/order', canManage, (req, res) => {
    const ids = (req.body || {}).ids;
    if (!Array.isArray(ids) || !ids.every((id) => Number.isInteger(id)) || !positions.reorder(req.adminId, ids)) {
      return res.status(400).json({ error: req.t('errors.badRequest') });
    }
    res.json({ positions: positions.list(req.adminId) });
  });

  // Rename and / or (de)activate: { name?, active? }.
  router.put('/api/positions/:id', canManage, (req, res) => {
    const id = idOf(req);
    const body = req.body || {};
    const patch = {};
    if (body.name !== undefined) {
      const name = validatePositionName(body.name, req.t);
      if (name.error) return res.status(400).json({ error: name.error });
      patch.name = name.value;
    }
    if (body.active !== undefined) patch.active = Boolean(body.active);
    if (!Object.keys(patch).length) return res.status(400).json({ error: req.t('errors.badRequest') });
    const updated = id && positions.update(req.adminId, id, patch);
    if (!updated) return res.status(404).json({ error: req.t('errors.notFound') });
    res.json({ position: updated, positions: positions.list(req.adminId) });
  });

  return router;
}

module.exports = { MANAGE_ROLES, createPositionsRouter };
