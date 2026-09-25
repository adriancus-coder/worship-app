'use strict';

const express = require('express');
const { requireRole } = require('../lib/auth');
const { MAX_BYTES, sniff, createLogoStore } = require('../lib/logo');
const { createScreenStore } = require('../lib/screens');

// Admin settings (owner only): the church logo shown by the projector.
// GET /api/logo/:file serves it to the users of that admin and to its paired screens.
function createSettingsRouter({ db, auth, config, logger, screensHub }) {
  const router = express.Router();
  const logos = createLogoStore(db, config.DATA_DIR);
  const screens = createScreenStore(db);
  const ownerOnly = requireRole('owner');
  const rawBody = express.raw({ type: () => true, limit: MAX_BYTES });

  const logoInfo = (adminId) => {
    const file = logos.current(adminId);
    return file ? { file, url: `/api/logo/${file}` } : null;
  };

  router.use('/api/settings', auth.requireUser, ownerOnly, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/api/settings', (req, res) => {
    res.json({ logo: logoInfo(req.adminId) });
  });

  // The image is the raw request body (the browser sends the File as is).
  router.put('/api/settings/logo', (req, res, next) => {
    rawBody(req, res, (err) => {
      if (err && err.type === 'entity.too.large') {
        return res.status(400).json({ error: req.t('errors.logoTooLarge', { max: '2 MB' }) });
      }
      if (err) return next(err);
      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const ext = sniff(buffer);
      if (!ext) return res.status(400).json({ error: req.t('errors.logoInvalid') });
      logos.save(req.adminId, buffer, ext);
      logger.info(`Logo updated by user #${req.user.id} (admin #${req.adminId}, ${ext}, ${buffer.length} bytes)`);
      screensHub.update(req.adminId);
      res.json({ logo: logoInfo(req.adminId) });
    });
  });

  router.delete('/api/settings/logo', (req, res) => {
    logos.clear(req.adminId);
    screensHub.update(req.adminId);
    res.json({ logo: null });
  });

  // Session user of that admin, or one of its screens (X-Screen-Token). Else 404.
  router.get('/api/logo/:file', (req, res) => {
    const found = logos.find(req.params.file);
    const session = auth.getSession(req);
    const screen = session ? null : screens.findByToken(req.get('x-screen-token'));
    const adminId = session ? session.admin.id : screen && screen.adminId;
    if (!found || !adminId || found.adminId !== adminId) return res.status(404).json({ error: req.t('errors.notFound') });
    res.set('Cache-Control', 'private, max-age=86400');
    res.type(found.type);
    res.sendFile(found.path, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: req.t('errors.notFound') });
    });
  });

  return router;
}

module.exports = createSettingsRouter;
