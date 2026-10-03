'use strict';

const express = require('express');
const { requireRole } = require('../lib/auth');
const { validatePositionEmoji } = require('../lib/positions');
const { BASES, PERMS, MAX_NAME_LENGTH, validateRoleInput, createRoleStore } = require('../lib/roles');

// Echipa → Roluri: the roles the owner creates (lib/roles.js), owner only.
//   GET    /api/roles        { roles: [{ id, name, emoji, base, perms, users }] }
//   POST   /api/roles        { name, emoji?, base, perms: [...] }
//   PUT    /api/roles/:id    any of { name, emoji, base, perms }
//   DELETE /api/roles/:id    its people become members
//   PUT    /api/roles/builtin/:role   a built-in role (presenter, leader, operator, member):
//                                     { name?, emoji?, perms? } (name / emoji '' = the default)
//   DELETE /api/roles/builtin/:role   back to the default name, emoji and rights
// The owner is never one of them: always every right.
// A change applies at once: every guard reads the rights from the session (lib/auth.js).
function createRolesRouter({ db, auth, logger }) {
  const router = express.Router();
  const roles = createRoleStore(db);

  router.use('/api/roles', auth.requireUser, requireRole('owner'), (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const idOf = (req) => (/^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : null);
  const audit = (req, what, id) => logger.info(`Roles: ${what} role #${id} by user #${req.user.id} (admin #${req.adminId})`);

  // { value: patch } or { error }
  function input(req, partial) {
    const body = req.body || {};
    const out = validateRoleInput(body, req.t, { partial });
    if (out.error) return out;
    if (!partial || body.emoji !== undefined) {
      const emoji = validatePositionEmoji(body.emoji, req.t);
      if (emoji.error) return { error: req.t('errors.positionEmojiInvalid') };
      out.value.emoji = emoji.value;
    }
    return out;
  }

  router.get('/api/roles', (req, res) => {
    res.json({ roles: roles.list(req.adminId), builtins: roles.builtins(req.adminId) });
  });

  router.put('/api/roles/builtin/:role', (req, res) => {
    const role = req.params.role;
    if (!BASES.includes(role)) return res.status(404).json({ error: req.t('errors.notFound') });
    const body = req.body || {};
    const patch = {};
    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : null;
      if (name === null || name.length > MAX_NAME_LENGTH) return res.status(400).json({ error: req.t('errors.roleNameInvalid', { max: MAX_NAME_LENGTH }) });
      patch.name = name || null;
    }
    if (body.emoji !== undefined) {
      const emoji = validatePositionEmoji(body.emoji, req.t);
      if (emoji.error) return res.status(400).json({ error: req.t('errors.positionEmojiInvalid') });
      patch.emoji = emoji.value;
    }
    if (body.perms !== undefined) {
      if (!Array.isArray(body.perms) || body.perms.some((p) => !PERMS.includes(p))) return res.status(400).json({ error: req.t('errors.rolePermsInvalid') });
      patch.perms = body.perms;
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: req.t('errors.badRequest') });
    const updated = roles.setBuiltin(req.adminId, role, patch);
    logger.info(`Roles: built-in "${role}" changed (${updated.perms.join(',') || '-'}) by user #${req.user.id} (admin #${req.adminId})`);
    res.json({ builtin: updated, builtins: roles.builtins(req.adminId), roles: roles.list(req.adminId) });
  });

  router.delete('/api/roles/builtin/:role', (req, res) => {
    const role = req.params.role;
    if (!BASES.includes(role)) return res.status(404).json({ error: req.t('errors.notFound') });
    const reset = roles.resetBuiltin(req.adminId, role);
    logger.info(`Roles: built-in "${role}" back to the default by user #${req.user.id} (admin #${req.adminId})`);
    res.json({ builtin: reset, builtins: roles.builtins(req.adminId), roles: roles.list(req.adminId) });
  });

  router.post('/api/roles', (req, res) => {
    const patch = input(req, false);
    if (patch.error) return res.status(400).json({ error: patch.error });
    const created = roles.create(req.adminId, patch.value);
    if (!created) return res.status(400).json({ error: req.t('errors.rolesTooMany') });
    audit(req, `created "${created.name}" (${created.base}: ${created.perms.join(',') || '-'})`, created.id);
    res.status(201).json({ role: created, roles: roles.list(req.adminId) });
  });

  router.put('/api/roles/:id', (req, res) => {
    const patch = input(req, true);
    if (patch.error) return res.status(400).json({ error: patch.error });
    if (!Object.keys(patch.value).length) return res.status(400).json({ error: req.t('errors.badRequest') });
    const id = idOf(req);
    const updated = id && roles.change(req.adminId, id, patch.value);
    if (!updated) return res.status(404).json({ error: req.t('errors.notFound') });
    audit(req, `changed "${updated.name}" (${updated.base}: ${updated.perms.join(',') || '-'})`, id);
    res.json({ role: updated, roles: roles.list(req.adminId) });
  });

  router.delete('/api/roles/:id', (req, res) => {
    const id = idOf(req);
    if (!id || !roles.destroy(req.adminId, id)) return res.status(404).json({ error: req.t('errors.notFound') });
    audit(req, 'deleted', id);
    res.json({ ok: true, roles: roles.list(req.adminId) });
  });

  return router;
}

module.exports = { createRolesRouter };
