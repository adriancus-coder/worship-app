'use strict';

const express = require('express');
const { requireRole } = require('../lib/auth');
const { MAX_BYTES, sniff, createLogoStore } = require('../lib/logo');
const { createScreenStore } = require('../lib/screens');
const { NOTATIONS, THEME_DEFAULTS, createAdminSettings } = require('../lib/admin-settings');
const { parseChoice, createBackgroundStore } = require('../lib/backgrounds');
const { createMediaSigner } = require('../lib/media');
const { createBackupService } = require('../lib/backup');

// Admin settings (owner only): the church logo shown by the projector and the default
// chord notation.
// GET /api/logo/:file serves it to the users of that admin and to its paired screens.
function createSettingsRouter({ db, auth, config, logger, screensHub, live, storage }) {
  const router = express.Router();
  const logos = createLogoStore(db, config.DATA_DIR);
  const screens = createScreenStore(db);
  const settings = createAdminSettings(db);
  const backgrounds = createBackgroundStore(db, createMediaSigner(config.DATA_DIR));
  const backups = createBackupService({ db, dataDir: config.DATA_DIR, config });
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
    res.json({
      logo: logoInfo(req.adminId),
      chordNotationDefault: settings.chordNotationDefault(req.adminId),
      themeDefault: settings.themeDefault(req.adminId),
      backgroundDefaults: backgrounds.defaults(req.adminId),
      backup: backups.lastBackup(req.adminId),
      storage: storage.usage(),
    });
  });

  // The church default backgrounds per item type: { song?, verse?, announcement? }, each a
  // background from the media library or null (none).
  router.put('/api/settings/backgrounds', (req, res) => {
    const body = req.body || {};
    const values = {};
    for (const type of ['song', 'verse', 'announcement']) {
      const choice = parseChoice(body[type]);
      if (choice.value === undefined && !choice.error) continue;
      if (choice.error || choice.value === 'none' || (choice.value !== null && !backgrounds.find(req.adminId, choice.value))) {
        return res.status(400).json({ error: req.t('errors.backgroundChoiceInvalid') });
      }
      values[type] = choice.value;
    }
    backgrounds.setDefaults(req.adminId, values);
    live.backgroundsChanged(req.adminId);
    res.json({ backgroundDefaults: backgrounds.defaults(req.adminId) });
  });

  // The church default colour theme, for users without their own choice.
  router.put('/api/settings/theme-default', (req, res) => {
    const theme = (req.body || {}).theme;
    if (!THEME_DEFAULTS.includes(theme)) return res.status(400).json({ error: req.t('errors.themeInvalid') });
    settings.set(req.adminId, 'theme_default', theme);
    res.json({ themeDefault: theme });
  });

  // The church default chord notation, for users without their own preference.
  router.put('/api/settings/chord-notation', (req, res) => {
    const notation = (req.body || {}).notation;
    if (!NOTATIONS.includes(notation)) return res.status(400).json({ error: req.t('errors.chordNotationInvalid') });
    settings.set(req.adminId, 'chord_notation_default', notation);
    res.json({ chordNotationDefault: notation });
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
      const room = storage.room();
      if (buffer.length > room) return res.status(507).json({ error: req.t('errors.diskFull', { free: `${Math.floor(room / (1024 * 1024))} MB`, pct: config.DISK_MIN_FREE_PCT }) });
      logos.save(req.adminId, buffer, ext);
      storage.refresh();
      logger.info(`Logo updated by user #${req.user.id} (admin #${req.adminId}, ${ext}, ${buffer.length} bytes)`);
      screensHub.update(req.adminId);
      res.json({ logo: logoInfo(req.adminId) });
    });
  });

  router.delete('/api/settings/logo', (req, res) => {
    logos.clear(req.adminId);
    storage.refreshSoon();
    screensHub.update(req.adminId);
    res.json({ logo: null });
  });

  // Session user of that admin, or one of its screens (X-Screen-Token). Else 404.
  router.get('/api/logo/:file', (req, res) => {
    const found = logos.find(req.params.file);
    const session = auth.getActiveSession(req);
    const paired = session ? null : screens.findByToken(req.get('x-screen-token'));
    const screen = paired && paired.adminActive ? paired : null; // a deactivated church's screens get nothing
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
