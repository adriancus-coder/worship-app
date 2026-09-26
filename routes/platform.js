'use strict';

const express = require('express');
const asyncRoute = require('../lib/async-route');
const { hashPassword } = require('../lib/auth');
const { temporaryPassword, validateName, validateEmail } = require('../lib/team');
const { validateAdminName, validateQuota, createPlatformStore } = require('../lib/platform');
const { createRequestLimiter } = require('../lib/rate-limit');

const CREATE_LIMIT = 10; // new churches per hour
const HOUR_MS = 60 * 60 * 1000;

// The platform owner (lib/auth.js isPlatformOwner) manages the churches on this server:
// list, create (with an owner and a temporary password shown once), deactivate /
// reactivate, a new temporary password for a church's owner, the media quota. Every
// action is logged. Everyone else gets 403.
function createPlatformRouter({ db, auth, config, logger, live, screensHub, storage }) {
  const router = express.Router();
  const store = createPlatformStore(db, { dataDir: config.DATA_DIR, defaultMediaMaxBytes: config.MEDIA_MAX_ADMIN_BYTES });
  const createLimiter = createRequestLimiter({ maxRequests: CREATE_LIMIT, windowMs: HOUR_MS });

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
