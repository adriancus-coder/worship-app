'use strict';

const express = require('express');
const asyncRoute = require('../lib/async-route');
const { hashPassword } = require('../lib/auth');
const { temporaryPassword, validateName, validateEmail, validateRole, createTeamStore } = require('../lib/team');
const { createScreenStore } = require('../lib/screens');
const { validateAdminName, validateQuota, createPlatformStore, createDeletionSweep } = require('../lib/platform');
const { createRequestLimiter } = require('../lib/rate-limit');
const { emailErrorResponse } = require('./invites');

const CREATE_LIMIT = 10; // new churches per hour
const HOUR_MS = 60 * 60 * 1000;

// The platform owner (lib/auth.js isPlatformOwner) manages the churches on this server:
// list, create (with an owner and a temporary password shown once), deactivate /
// reactivate, a new temporary password for a church's owner, the media quota, permanent
// deletion in two steps (schedule 7 days ahead on a deactivated church, typing its name;
// cancel while pending; a daily sweep purges, final backup first). Every action is logged.
// Everyone else gets 403.
function createPlatformRouter({ db, auth, config, logger, live, screensHub, storage, email, invites }) {
  const router = express.Router();
  const baseUrl = (req) => config.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  const store = createPlatformStore(db, { dataDir: config.DATA_DIR, defaultMediaMaxBytes: config.MEDIA_MAX_ADMIN_BYTES });
  const createLimiter = createRequestLimiter({ maxRequests: CREATE_LIMIT, windowMs: HOUR_MS });
  const sweep = createDeletionSweep({ db, dataDir: config.DATA_DIR, config, logger, platformAdminId: () => auth.platformAdminId() });
  sweep.start(); // at startup and every 24 h
  // A church's accounts and screens, scoped to it (the same stores as /api/team and
  // /api/screens); the platform owner never reads a church's content.
  const team = createTeamStore(db);
  const screens = createScreenStore(db);

  router.use('/api/platform', auth.requireUser, auth.requirePlatformOwner, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const audit = (req, what) => logger.info(`Platform: ${what} by user #${req.user.id} (admin #${req.adminId})`);
  const view = (req, id) => store.list(auth.platformAdminId()).find((a) => a.id === id);

  // The target church, or a 404 response (null).
  function target(req, res) {
    const id = /^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : null;
    const admin = id && store.get(id);
    if (!admin) {
      res.status(404).json({ error: req.t('errors.platformAdminNotFound') });
      return null;
    }
    return admin;
  }

  router.get('/api/platform/admins', (req, res) => {
    // baseUrl: the address in the welcome message (null: the page uses its own origin).
    // disk: the whole data disk, for the total against it.
    res.json({ admins: store.list(auth.platformAdminId()), baseUrl: config.PUBLIC_BASE_URL, defaultMediaMaxBytes: config.MEDIA_MAX_ADMIN_BYTES, disk: storage.usage() });
  });

  router.post('/api/platform/admins', asyncRoute(async (req, res) => {
    const body = req.body || {};
    const name = validateAdminName(body.name, req.t);
    if (name.error) return res.status(400).json({ error: name.error });
    const ownerName = validateName(body.ownerName, req.t);
    if (ownerName.error) return res.status(400).json({ error: ownerName.error });
    const ownerEmail = validateEmail(body.ownerEmail, req.t);
    if (ownerEmail.error) return res.status(400).json({ error: ownerEmail.error });
    if (store.isEmailTaken(ownerEmail.value)) return res.status(409).json({ error: req.t('errors.teamEmailTaken') });
    const retryAfter = createLimiter.take(req.user.id);
    if (retryAfter > 0) {
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: req.t('errors.platformTooMany', { max: CREATE_LIMIT }) });
    }
    const password = temporaryPassword();
    let created;
    try {
      created = store.create({ name: name.value, ownerName: ownerName.value, ownerEmail: ownerEmail.value }, await hashPassword(password), req.user.id);
    } catch (err) {
      if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: req.t('errors.teamEmailTaken') });
      throw err;
    }
    audit(req, `created church #${created.adminId} "${name.value}" with owner user #${created.userId}`);
    // The temporary password is returned this once; only its hash is stored.
    res.status(201).json({ admin: view(req, created.adminId), temporaryPassword: password });
  }));

  router.post('/api/platform/admins/:id/deactivate', (req, res) => {
    const admin = target(req, res);
    if (!admin) return;
    if (admin.id === auth.platformAdminId()) return res.status(403).json({ error: req.t('errors.platformSelf') });
    if (admin.active) {
      store.deactivate(admin.id); // ends its sessions
      live.closeAdmin(admin.id);
      screensHub.suspend(admin.id);
      audit(req, `deactivated church #${admin.id}`);
    }
    res.json({ admin: view(req, admin.id) });
  });

  router.post('/api/platform/admins/:id/reactivate', (req, res) => {
    const admin = target(req, res);
    if (!admin) return;
    if (!admin.active) {
      store.reactivate(admin.id);
      audit(req, `reactivated church #${admin.id}`);
    }
    res.json({ admin: view(req, admin.id) });
  });

  router.post('/api/platform/admins/:id/reset-owner-password', asyncRoute(async (req, res) => {
    const admin = target(req, res);
    if (!admin) return;
    const password = temporaryPassword();
    const owner = store.resetOwnerPassword(admin.id, await hashPassword(password));
    if (!owner) return res.status(404).json({ error: req.t('errors.platformAdminNotFound') });
    live.closeUser(owner.id);
    audit(req, `reset the password of owner user #${owner.id} of church #${admin.id}`);
    res.json({ admin: view(req, admin.id), owner: { name: owner.name, email: owner.email }, temporaryPassword: password });
  }));

  // --- permanent deletion ----------------------------------------------------------------

  // Step one: { confirmName } must be the church's exact name; only a deactivated church.
  router.post('/api/platform/admins/:id/delete', (req, res) => {
    const admin = target(req, res);
    if (!admin) return;
    if (admin.id === auth.platformAdminId()) return res.status(403).json({ error: req.t('errors.platformSelf') });
    const out = store.scheduleDelete(admin.id, (req.body || {}).confirmName);
    if (out.error === 'active') return res.status(409).json({ error: req.t('errors.platformDeleteActive') });
    if (out.error === 'name') return res.status(409).json({ error: req.t('errors.platformDeleteName') });
    audit(req, `scheduled the deletion of church #${admin.id} "${admin.name}" for ${new Date(out.deleteAt).toISOString()}`);
    res.json({ admin: view(req, admin.id) });
  });

  router.post('/api/platform/admins/:id/cancel-delete', (req, res) => {
    const admin = target(req, res);
    if (!admin) return;
    if (!store.cancelDelete(admin.id)) return res.status(409).json({ error: req.t('errors.platformDeleteNotPending') });
    audit(req, `cancelled the deletion of church #${admin.id}`);
    res.json({ admin: view(req, admin.id) });
  });

  // Runs the sweep now (it purges only churches whose delete_at has passed). Outside
  // production a test may pass { now } (ms) to act as if it were later.
  router.post('/api/platform/deletions/sweep', asyncRoute(async (req, res) => {
    const asked = (req.body || {}).now;
    const now = !config.IS_PRODUCTION && Number.isInteger(asked) ? asked : Date.now();
    const out = await sweep.run(now);
    if (out.purged.length) audit(req, `ran the deletion sweep: purged ${out.purged.map((p) => `#${p.id}`).join(', ')}`);
    res.json({ purged: out.purged.map((p) => p.id), failed: out.failed, backupsRemoved: out.backupsRemoved });
  }));

  // --- one church: detail, its team, its screens ---------------------------------------

  router.get('/api/platform/admins/:id', (req, res) => {
    const admin = target(req, res);
    if (!admin) return;
    res.json({ admin: store.detail(admin.id, auth.platformAdminId(), screensHub.onlineIds(admin.id).size), defaultMediaMaxBytes: config.MEDIA_MAX_ADMIN_BYTES, baseUrl: config.PUBLIC_BASE_URL });
  });

  router.get('/api/platform/admins/:id/users', (req, res) => {
    const admin = target(req, res);
    if (!admin) return;
    res.json({ users: team.list(admin.id), baseUrl: config.PUBLIC_BASE_URL, emailEnabled: email.enabled });
  });

  // The same email links as on /team, for a church's people (never its owner).
  router.post('/api/platform/admins/:id/users/:userId/invite', asyncRoute(async (req, res) => {
    const admin = target(req, res);
    if (!admin) return;
    const member = targetUser(req, res, admin);
    if (!member) return;
    if (member.lastLoginAt) return res.status(409).json({ code: 'alreadySignedIn', error: req.t('errors.alreadySignedIn') });
    try {
      await invites.invite({ adminId: admin.id, user: member, adminName: admin.name, invitedBy: req.user.name, baseUrl: baseUrl(req), lang: req.lang });
    } catch (err) {
      return emailErrorResponse(req, res, err);
    }
    auditUser(req, admin, 'sent an invitation to', member.id);
    res.json({ ok: true, user: team.get(admin.id, member.id), sentTo: member.email });
  }));

  router.post('/api/platform/admins/:id/users/:userId/reset-link', asyncRoute(async (req, res) => {
    const admin = target(req, res);
    if (!admin) return;
    const member = targetUser(req, res, admin);
    if (!member) return;
    try {
      await invites.reset({ adminId: admin.id, user: member, adminName: admin.name, baseUrl: baseUrl(req), lang: req.lang });
    } catch (err) {
      return emailErrorResponse(req, res, err);
    }
    auditUser(req, admin, 'sent a reset link to', member.id);
    res.json({ ok: true, user: team.get(admin.id, member.id), sentTo: member.email });
  }));

  const auditUser = (req, admin, what, userId) => logger.info(`Platform: ${what} user #${userId} of church #${admin.id} by user #${req.user.id} (admin #${req.adminId})`);

  // A user of that church, or a 404 / 403 response (null). The church's owner is managed
  // through the church itself (deactivate the church, reset its owner's password).
  function targetUser(req, res, admin) {
    const id = /^\d{1,15}$/.test(req.params.userId) ? Number(req.params.userId) : null;
    const member = id && team.get(admin.id, id);
    if (!member) {
      res.status(404).json({ error: req.t('errors.teamUserNotFound') });
      return null;
    }
    if (member.role === 'owner') {
      res.status(403).json({ error: req.t('errors.teamNotOwnerOrSelf') });
      return null;
    }
    return member;
  }

  router.post('/api/platform/admins/:id/users', asyncRoute(async (req, res) => {
    const admin = target(req, res);
    if (!admin) return;
    const body = req.body || {};
    const name = validateName(body.name, req.t);
    if (name.error) return res.status(400).json({ error: name.error });
    const email = validateEmail(body.email, req.t);
    if (email.error) return res.status(400).json({ error: email.error });
    const role = validateRole(body.role, req.t);
    if (role.error) return res.status(400).json({ error: role.error });
    if (team.isEmailTaken(email.value)) return res.status(409).json({ error: req.t('errors.teamEmailTaken') });
    const password = temporaryPassword();
    let id;
    try {
      id = team.create(admin.id, req.user.id, { name: name.value, email: email.value, role: role.value }, await hashPassword(password));
    } catch (err) {
      if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: req.t('errors.teamEmailTaken') });
      throw err;
    }
    auditUser(req, admin, `created (${role.value})`, id);
    res.status(201).json({ user: team.get(admin.id, id), temporaryPassword: password });
  }));

  router.patch('/api/platform/admins/:id/users/:userId', (req, res) => {
    const admin = target(req, res);
    if (!admin) return;
    const member = targetUser(req, res, admin);
    if (!member) return;
    const body = req.body || {};
    if (body.name === undefined && body.role === undefined) return res.status(400).json({ error: req.t('errors.badRequest') });
    const name = body.name === undefined ? null : validateName(body.name, req.t);
    if (name && name.error) return res.status(400).json({ error: name.error });
    const role = body.role === undefined ? null : validateRole(body.role, req.t);
    if (role && role.error) return res.status(400).json({ error: role.error });
    if (name && name.value !== member.name) {
      team.rename(admin.id, member.id, name.value);
      auditUser(req, admin, 'renamed', member.id);
    }
    if (role && role.value !== member.role) {
      team.changeRole(admin.id, member.id, role.value);
      auditUser(req, admin, `role ${member.role} -> ${role.value} for`, member.id);
    }
    res.json({ user: team.get(admin.id, member.id) });
  });

  router.post('/api/platform/admins/:id/users/:userId/deactivate', (req, res) => {
    const admin = target(req, res);
    if (!admin) return;
    const member = targetUser(req, res, admin);
    if (!member) return;
    if (member.active) {
      team.deactivate(admin.id, member.id);
      live.closeUser(member.id);
      auditUser(req, admin, 'deactivated', member.id);
    }
    res.json({ user: team.get(admin.id, member.id) });
  });

  router.post('/api/platform/admins/:id/users/:userId/reactivate', (req, res) => {
    const admin = target(req, res);
    if (!admin) return;
    const member = targetUser(req, res, admin);
    if (!member) return;
    if (!member.active) {
      team.reactivate(admin.id, member.id);
      auditUser(req, admin, 'reactivated', member.id);
    }
    res.json({ user: team.get(admin.id, member.id) });
  });

  router.post('/api/platform/admins/:id/users/:userId/reset-password', asyncRoute(async (req, res) => {
    const admin = target(req, res);
    if (!admin) return;
    const member = targetUser(req, res, admin);
    if (!member) return;
    const password = temporaryPassword();
    team.setUserPassword(admin.id, member.id, await hashPassword(password), true);
    team.endSessions(admin.id, member.id);
    live.closeUser(member.id);
    auditUser(req, admin, 'reset the password of', member.id);
    res.json({ user: team.get(admin.id, member.id), temporaryPassword: password });
  }));

  router.get('/api/platform/admins/:id/screens', (req, res) => {
    const admin = target(req, res);
    if (!admin) return;
    const online = screensHub.onlineIds(admin.id);
    res.json({ screens: screens.list(admin.id).map((screen) => ({ ...screen, online: online.has(screen.id) })) });
  });

  router.post('/api/platform/admins/:id/screens/:screenId/revoke', (req, res) => {
    const admin = target(req, res);
    if (!admin) return;
    const id = /^\d{1,15}$/.test(req.params.screenId) ? Number(req.params.screenId) : null;
    if (!id || !screens.revoke(admin.id, id)) return res.status(404).json({ error: req.t('errors.screenNotFound') });
    screensHub.revoked(admin.id, id);
    audit(req, `revoked screen #${id} of church #${admin.id}`);
    res.json({ ok: true });
  });

  router.patch('/api/platform/admins/:id', (req, res) => {
    const admin = target(req, res);
    if (!admin) return;
    const body = req.body || {};
    if (body.mediaMaxMb === undefined) return res.status(400).json({ error: req.t('errors.badRequest') });
    const quota = validateQuota(body.mediaMaxMb, req.t);
    if (quota.error) return res.status(400).json({ error: quota.error });
    store.setQuota(admin.id, quota.value);
    audit(req, `set the media quota of church #${admin.id} to ${quota.value === null ? 'the default' : `${quota.value / (1024 * 1024)} MB`}`);
    res.json({ admin: view(req, admin.id) });
  });

  return router;
}

module.exports = { createPlatformRouter };
