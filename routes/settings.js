'use strict';

const express = require('express');
const asyncRoute = require('../lib/async-route');
const { isValidTime } = require('../lib/dates');
const { requireRole } = require('../lib/auth');
const { MAX_BYTES, sniff, createLogoStore } = require('../lib/logo');
const { createScreenStore } = require('../lib/screens');
const { NOTATIONS, THEME_DEFAULTS, TIME_FORMATS, createAdminSettings, parseSafeMargin } = require('../lib/admin-settings');
const { parsePatch: parseClockPatch } = require('../lib/clock');
const { parseChoice, createBackgroundStore } = require('../lib/backgrounds');
const { createMediaSigner } = require('../lib/media');
const { createBackupService } = require('../lib/backup');

// Admin settings (owner only): the church logo shown by the projector and the default
// chord notation.
// GET /api/logo/:file serves it to the users of that admin and to its paired screens.
function createSettingsRouter({ db, auth, config, logger, screensHub, live, storage, email }) {
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
      service: settings.service(req.adminId),
      clock: settings.clock(req.adminId),
      timeFormat: settings.timeFormat(req.adminId),
      safeMargin: settings.safeMargin(req.adminId),
      backgroundDefaults: backgrounds.defaults(req.adminId),
      backup: backups.lastBackup(req.adminId),
      storage: storage.usage(),
      email: email.status(), // { enabled, from }
    });
  });

  // "Trimite un email de test": to the owner's own address. 503 while email is disabled.
  router.post('/api/settings/email/test', asyncRoute(async (req, res) => {
    if (!email.enabled) return res.status(503).json({ code: 'emailDisabled', error: req.t('errors.emailDisabled') });
    const message = email.templates.test(req.lang, { appName: config.APP_NAME, churchName: req.admin.name, email: req.user.email });
    try {
      await email.send(req.adminId, { ...message, to: req.user.email, kind: 'test', userId: req.user.id });
    } catch (err) {
      if (err.code === 'emailRateLimited') return res.status(429).json({ code: err.code, error: req.t('errors.emailRateLimited') });
      if (err.code === 'emailFailed') return res.status(502).json({ code: err.code, error: req.t('errors.emailFailed') });
      throw err;
    }
    res.json({ ok: true, to: req.user.email });
  }));

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

  // "Ziua și ora obișnuită a slujbei": the defaults of "+ Eveniment nou".
  router.put('/api/settings/service', (req, res) => {
    const { weekday, time } = req.body || {};
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !isValidTime(time)) {
      return res.status(400).json({ error: req.t('errors.serviceInvalid') });
    }
    settings.set(req.adminId, 'service_weekday', String(weekday));
    settings.set(req.adminId, 'service_time', time);
    res.json({ service: settings.service(req.adminId) });
  });

  // The corner clock a new event starts with, and the idle screen's: { show?, position?, scale? }.
  router.put('/api/settings/clock', (req, res) => {
    const patch = parseClockPatch(req.body);
    if (!patch) return res.status(400).json({ error: req.t('errors.clockInvalid') });
    const clock = settings.setClock(req.adminId, patch);
    screensHub.update(req.adminId); // the idle screen shows the defaults
    res.json({ clock });
  });

  // "Margine de siguranță proiector": 0-12 % of each edge kept free of text, clock and logo
  // (overscan). Every screen without its own value follows it at once.
  router.put('/api/settings/safe-margin', (req, res) => {
    const percent = parseSafeMargin((req.body || {}).percent);
    if (percent === null) return res.status(400).json({ error: req.t('errors.safeMarginInvalid') });
    settings.set(req.adminId, 'safe_margin', String(percent));
    screensHub.marginChanged(req.adminId);
    res.json({ safeMargin: percent });
  });

  // '24' | '12': the format of every clock (the projector's, the live pages').
  router.put('/api/settings/time-format', (req, res) => {
    const format = (req.body || {}).format;
    if (!TIME_FORMATS.includes(format)) return res.status(400).json({ error: req.t('errors.timeFormatInvalid') });
    settings.set(req.adminId, 'time_format', format);
    live.settingsChanged(req.adminId); // live pages and screens re-read it at once
    res.json({ timeFormat: format });
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
