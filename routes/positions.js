'use strict';

const express = require('express');
const { requirePerm, can } = require('../lib/roles');
const { validatePositionName, validatePositionEmoji, createPositionStore } = require('../lib/positions');

// "Poziții în echipă" (Setări, and /positions for the leader): the positions a church uses.
// Everyone signed in reads them (pickers, the profile); the 'schedule' right edits them.
const MANAGE_ROLES = ['owner', 'leader']; // the built-in roles with it

function createPositionsRouter({ db, auth, logger }) {
  const router = express.Router();
  const positions = createPositionStore(db);
  const canManage = requirePerm('schedule');

  router.use('/api/positions', auth.requireUser, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const idOf = (req) => (/^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : null);

  // people: position id -> [{ id, name }] who have it in their profile (the team directory
  // shows everyone's positions anyway); members: everyone active, for the schedulers' picker.
  const withPeople = (req, extra = {}) => ({
    positions: positions.list(req.adminId), canManage: can(req.user, 'schedule'),
    people: Object.fromEntries([...positions.peopleByPosition(req.adminId)]),
    ...(can(req.user, 'schedule') ? { members: positions.members(req.adminId) } : {}),
    ...extra,
  });
  router.get('/api/positions', (req, res) => {
    res.json(withPeople(req));
  });

  // "Persoane" on a position: who has it, set from the position's side: { userIds }. The same
  // rows as the profile's positions, so the team page, the pickers and "Vin" follow at once.
  router.put('/api/positions/:id/people', canManage, (req, res) => {
    const id = idOf(req);
    const ids = (req.body || {}).userIds;
    if (!Array.isArray(ids) || !ids.every((x) => Number.isInteger(x))) return res.status(400).json({ error: req.t('errors.badRequest') });
    if (!id || !positions.setPeople(req.adminId, id, ids)) return res.status(404).json({ error: req.t('errors.notFound') });
    logger.info(`Position #${id}: people set (${ids.length}) by user #${req.user.id} (admin #${req.adminId})`);
    res.json(withPeople(req));
  });

  router.post('/api/positions', canManage, (req, res) => {
    const name = validatePositionName((req.body || {}).name, req.t);
    if (name.error) return res.status(400).json({ error: name.error });
    const emoji = (req.body || {}).emoji === undefined ? { value: undefined } : validatePositionEmoji(req.body.emoji, req.t);
    if (emoji.error) return res.status(400).json({ error: emoji.error });
    const created = positions.create(req.adminId, name.value, emoji.value);
    if (!created) return res.status(400).json({ error: req.t('errors.positionsTooMany') });
    logger.info(`Position "${created.name}" added by user #${req.user.id} (admin #${req.adminId})`);
    res.status(201).json(withPeople(req, { position: created }));
  });

  // The whole order: { ids: [...] } (every position of the admin, once).
  router.put('/api/positions/order', canManage, (req, res) => {
    const ids = (req.body || {}).ids;
    if (!Array.isArray(ids) || !ids.every((id) => Number.isInteger(id)) || !positions.reorder(req.adminId, ids)) {
      return res.status(400).json({ error: req.t('errors.badRequest') });
    }
    res.json(withPeople(req));
  });

  // Rename, change the emoji ('' / null clears it) and / or (de)activate: { name?, emoji?, active? }.
  router.put('/api/positions/:id', canManage, (req, res) => {
    const id = idOf(req);
    const body = req.body || {};
    const patch = {};
    if (body.name !== undefined) {
      const name = validatePositionName(body.name, req.t);
      if (name.error) return res.status(400).json({ error: name.error });
      patch.name = name.value;
    }
    if (body.emoji !== undefined) {
      const emoji = validatePositionEmoji(body.emoji, req.t);
      if (emoji.error) return res.status(400).json({ error: emoji.error });
      patch.emoji = emoji.value;
    }
    if (body.active !== undefined) patch.active = Boolean(body.active);
    if (!Object.keys(patch).length) return res.status(400).json({ error: req.t('errors.badRequest') });
    const updated = id && positions.update(req.adminId, id, patch);
    if (!updated) return res.status(404).json({ error: req.t('errors.notFound') });
    res.json(withPeople(req, { position: updated }));
  });

  return router;
}

module.exports = { MANAGE_ROLES, createPositionsRouter };
