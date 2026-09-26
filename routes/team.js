'use strict';

const express = require('express');
const asyncRoute = require('../lib/async-route');
const { hashPassword, requireRole } = require('../lib/auth');
const { temporaryPassword, validateName, validateEmail, validateRole, createTeamStore } = require('../lib/team');
const { emailErrorResponse } = require('./invites');

// The owner manages the admin's team: accounts with temporary passwords (shown once, never
// logged), role and name changes, deactivation, password resets. Owner only; another admin's
// users do not exist here (404). The owner's own row cannot be changed here.
function createTeamRouter({ db, auth, config, logger, live, email, invites }) {
  const router = express.Router();
  const team = createTeamStore(db);
  const baseUrl = (req) => config.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;

  router.use('/api/team', auth.requireUser, requireRole('owner'), (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const audit = (req, what, targetId) => logger.info(`Team: ${what} user #${targetId} by user #${req.user.id} (admin #${req.adminId})`);

  // The target user of this admin, or a 404 / 403 response (null).
  function target(req, res) {
    const id = /^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : null;
    const member = id && team.get(req.adminId, id);
    if (!member) {
      res.status(404).json({ error: req.t('errors.teamUserNotFound') });
      return null;
    }
    if (member.role === 'owner' || member.id === req.user.id) {
      res.status(403).json({ error: req.t('errors.teamNotOwnerOrSelf') });
      return null;
    }
    return member;
  }

  router.get('/api/team', (req, res) => {
    // baseUrl: the address in the welcome message (null: the page uses its own origin).
    res.json({ users: team.list(req.adminId), baseUrl: config.PUBLIC_BASE_URL, emailEnabled: email.enabled });
  });

  // "Trimite / Retrimite invitația": a fresh invitation link by email, while the person has
  // never signed in (409 afterwards). 503 while email is disabled.
  router.post('/api/team/:id/invite', asyncRoute(async (req, res) => {
    const member = target(req, res);
    if (!member) return;
    if (member.lastLoginAt) return res.status(409).json({ code: 'alreadySignedIn', error: req.t('errors.alreadySignedIn') });
    try {
      await invites.invite({ adminId: req.adminId, user: member, adminName: req.admin.name, invitedBy: req.user.name, baseUrl: baseUrl(req), lang: req.lang });
    } catch (err) {
      return emailErrorResponse(req, res, err);
    }
    audit(req, 'sent an invitation to', member.id);
    res.json({ ok: true, user: team.get(req.adminId, member.id), sentTo: member.email });
  }));

  // "Trimite link de resetare": a reset link by email (the temporary-password card stays as
  // the other way).
  router.post('/api/team/:id/reset-link', asyncRoute(async (req, res) => {
    const member = target(req, res);
    if (!member) return;
    try {
      await invites.reset({ adminId: req.adminId, user: member, adminName: req.admin.name, baseUrl: baseUrl(req), lang: req.lang });
    } catch (err) {
      return emailErrorResponse(req, res, err);
    }
    audit(req, 'sent a reset link to', member.id);
    res.json({ ok: true, user: team.get(req.adminId, member.id), sentTo: member.email });
  }));

  router.post('/api/team', asyncRoute(async (req, res) => {
    const body = req.body || {};
    const name = validateName(body.name, req.t);
    if (name.error) return res.status(400).json({ error: name.error });
    const email = validateEmail(body.email, req.t);
    if (email.error) return res.status(400).json({ error: email.error });
    const role = validateRole(body.role, req.t);
    if (role.error) return res.status(400).json({ error: role.error });
    if (team.isEmailTaken(email.value)) return res.status(409).json({ error: req.t('errors.teamEmailTaken') });
    const password = temporaryPassword();
    const hash = await hashPassword(password);
    let id;
    try {
      id = team.create(req.adminId, req.user.id, { name: name.value, email: email.value, role: role.value }, hash);
    } catch (err) {
      if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: req.t('errors.teamEmailTaken') });
      throw err;
    }
    audit(req, `created (${role.value})`, id);
    // The temporary password is returned this once; only its hash is stored.
    res.status(201).json({ user: team.get(req.adminId, id), temporaryPassword: password });
  }));

  router.patch('/api/team/:id', (req, res) => {
    const member = target(req, res);
    if (!member) return;
    const body = req.body || {};
    if (body.name === undefined && body.role === undefined) return res.status(400).json({ error: req.t('errors.badRequest') });
    const name = body.name === undefined ? null : validateName(body.name, req.t);
    if (name && name.error) return res.status(400).json({ error: name.error });
    const role = body.role === undefined ? null : validateRole(body.role, req.t);
    if (role && role.error) return res.status(400).json({ error: role.error });
    if (name && name.value !== member.name) {
      team.rename(req.adminId, member.id, name.value);
      audit(req, 'renamed', member.id);
    }
    if (role && role.value !== member.role) {
      team.changeRole(req.adminId, member.id, role.value);
      audit(req, `role ${member.role} -> ${role.value} for`, member.id);
    }
    res.json({ user: team.get(req.adminId, member.id) });
  });

  router.post('/api/team/:id/deactivate', (req, res) => {
    const member = target(req, res);
    if (!member) return;
    if (member.active) {
      team.deactivate(req.adminId, member.id); // also deletes their sessions
      live.closeUser(member.id);
      audit(req, 'deactivated', member.id);
    }
    res.json({ user: team.get(req.adminId, member.id) });
  });

  router.post('/api/team/:id/reactivate', (req, res) => {
    const member = target(req, res);
    if (!member) return;
    if (!member.active) {
      team.reactivate(req.adminId, member.id);
      audit(req, 'reactivated', member.id);
    }
    res.json({ user: team.get(req.adminId, member.id) });
  });

  router.post('/api/team/:id/reset-password', asyncRoute(async (req, res) => {
    const member = target(req, res);
    if (!member) return;
    const password = temporaryPassword();
    team.setUserPassword(req.adminId, member.id, await hashPassword(password), true);
    team.endSessions(req.adminId, member.id);
    live.closeUser(member.id);
    audit(req, 'reset the password of', member.id);
    res.json({ user: team.get(req.adminId, member.id), temporaryPassword: password });
  }));

  return router;
}

module.exports = { createTeamRouter };
