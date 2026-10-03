'use strict';

const express = require('express');
const { requirePerm } = require('../lib/roles');
const { createFailureLimiter, createRequestLimiter } = require('../lib/rate-limit');
const { validateScreenName, createScreenStore } = require('../lib/screens');
const { parseSafeMargin, createAdminSettings } = require('../lib/admin-settings');

const TEN_MINUTES = 10 * 60 * 1000;
const SCREEN_TOKEN_HEADER = 'x-screen-token';
const SCREEN_KEY_HEADER = 'x-screen-key';

// The screen's credential from its request headers: X-Screen-Token (code pairing) or
// X-Screen-Key (static link).
const screenCredential = (req) => ({ token: req.get(SCREEN_TOKEN_HEADER), key: req.get(SCREEN_KEY_HEADER) });

// Projector screens.
//   /api/screen/...  called by the screen itself (no user session): pairing and "who am I"
//                    with its credential (X-Screen-Token / X-Screen-Key header).
//   /api/screens/... owner/operator: create a screen (its static link), claim a code, list,
//                    rename, margin, test pattern, revoke.
function createScreensRouter({ db, auth, config, logger, screensHub }) {
  const router = express.Router();
  const screens = createScreenStore(db);
  const settings = createAdminSettings(db);
  const canManage = requirePerm('screens');
  const pairingLimiter = createRequestLimiter({ maxRequests: 10, windowMs: TEN_MINUTES });
  const codeLimiter = createFailureLimiter({ maxFailures: 5, windowMs: TEN_MINUTES });

  const noStore = (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  };

  function tooMany(req, res, retryAfter) {
    res.set('Retry-After', String(retryAfter));
    res.status(429).json({ error: req.t('errors.tooManyAttempts') });
  }

  function screenId(req) {
    return /^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : null;
  }

  // --- the screen itself ------------------------------------------------------------

  router.use('/api/screen', noStore);

  router.post('/api/screen/pairings', (req, res) => {
    const retryAfter = pairingLimiter.take(`ip:${req.ip}`);
    if (retryAfter > 0) return tooMany(req, res, retryAfter);
    res.status(201).json(screens.startPairing());
  });

  // Polled by the waiting screen (every 3 s). The token is returned once.
  router.get('/api/screen/pairings/:id', (req, res) => {
    const result = screens.collect(req.params.id);
    if (!result) return res.status(404).json({ status: 'expired', error: req.t('errors.pairingExpired') });
    if (result.status === 'paired') {
      logger.info(`Screen #${result.screen.id} paired with a code (admin #${result.adminId})`);
      return res.json({ status: 'paired', token: result.token, screen: result.screen });
    }
    res.json(result);
  });

  router.get('/api/screen/me', (req, res) => {
    const screen = screens.identify(screenCredential(req));
    if (!screen) return res.status(401).json({ error: req.t('errors.screenUnknown') });
    // A deactivated church: the screen keeps its token and waits (public/screen.js).
    if (!screen.adminActive) return res.status(423).json({ code: 'suspended', error: req.t('errors.adminInactive') });
    screens.touch(screen.id);
    res.json({ screen: { id: screen.id, name: screen.name }, admin: { id: screen.adminId, name: screen.adminName } });
  });

  // --- owner / operator ---------------------------------------------------------------

  router.use('/api/screens', auth.requireUser, canManage, noStore);

  // "Deschide ecranul proiectorului" (the live page, the console): the window opens the
  // static link of the screen named after it (one per name, reused across clicks).
  router.post('/api/screens/auto-claim', (req, res) => {
    const name = validateScreenName((req.body || {}).name, req.t);
    if (name.error) return res.status(400).json({ error: name.error });
    const screen = screens.findOrCreate(req.adminId, req.user.id, name.value);
    screensHub.listChanged(req.adminId);
    res.status(201).json({ url: screen.link, screen });
  });

  // "Adaugă un ecran": a screen with its static link, to open on the projector PC.
  router.post('/api/screens', (req, res) => {
    const name = validateScreenName((req.body || {}).name, req.t);
    if (name.error) return res.status(400).json({ error: name.error });
    const screen = screens.create(req.adminId, req.user.id, name.value);
    screensHub.listChanged(req.adminId);
    logger.info(`Screen #${screen.id} "${screen.name}" created with a static link by user #${req.user.id} (admin #${req.adminId})`);
    res.status(201).json({ screen });
  });

  router.post('/api/screens/claim', (req, res) => {
    const key = `user:${req.user.id}`;
    const retryAfter = codeLimiter.retryAfterSeconds(key);
    if (retryAfter > 0) return tooMany(req, res, retryAfter);
    const body = req.body || {};
    const name = validateScreenName(body.name, req.t);
    if (name.error) return res.status(400).json({ error: name.error });
    const code = typeof body.code === 'string' ? body.code.replace(/\s+/g, '') : '';
    const screen = screens.claimCode(req.adminId, req.user.id, code, name.value);
    if (!screen) {
      codeLimiter.recordFailure(key);
      return res.status(404).json({ error: req.t('errors.pairingCodeInvalid') });
    }
    codeLimiter.reset(key);
    logger.info(`Screen #${screen.id} "${screen.name}" claimed by user #${req.user.id} (admin #${req.adminId})`);
    res.status(201).json({ screen });
  });

  router.get('/api/screens', (req, res) => {
    const online = screensHub.onlineIds(req.adminId);
    // baseUrl: the address of the projector page ("adresa proiectorului"), null -> the page's origin.
    res.json({ screens: screens.list(req.adminId).map((s) => ({ ...s, online: online.has(s.id), testPattern: screensHub.showsPattern(s.id) })), baseUrl: config.PUBLIC_BASE_URL, safeMargin: settings.safeMargin(req.adminId) });
  });

  router.put('/api/screens/:id', (req, res) => {
    const id = screenId(req);
    const name = validateScreenName((req.body || {}).name, req.t);
    if (!id || !screens.get(req.adminId, id)) return res.status(404).json({ error: req.t('errors.screenNotFound') });
    if (name.error) return res.status(400).json({ error: name.error });
    screens.rename(req.adminId, id, name.value);
    screensHub.listChanged(req.adminId);
    res.json({ screen: screens.get(req.adminId, id) });
  });

  // The screen's own "Margine de siguranță" { percent: 0-12 | null } (null: the church default).
  router.put('/api/screens/:id/margin', (req, res) => {
    const id = screenId(req);
    if (!id || !screens.get(req.adminId, id)) return res.status(404).json({ error: req.t('errors.screenNotFound') });
    const raw = (req.body || {}).percent;
    const percent = raw === null ? null : parseSafeMargin(raw);
    if (percent === undefined || (raw !== null && percent === null)) return res.status(400).json({ error: req.t('errors.safeMarginInvalid') });
    screens.setSafeMargin(req.adminId, id, percent);
    screensHub.marginChanged(req.adminId, id);
    logger.info(`Screen #${id} safe margin ${percent === null ? 'follows the church default' : `${percent} %`} (user #${req.user.id}, admin #${req.adminId})`);
    res.json({ screen: screens.get(req.adminId, id) });
  });

  // "Ecran de test" { on: true | false }: the calibration pattern on that screen (until closed or
  // the next live frame). The labels travel with the frame, in the operator's language.
  router.post('/api/screens/:id/test-pattern', (req, res) => {
    const id = screenId(req);
    const screen = id && screens.get(req.adminId, id);
    if (!screen) return res.status(404).json({ error: req.t('errors.screenNotFound') });
    const on = (req.body || {}).on !== false;
    const labels = on ? { name: screen.name, resolution: req.t('screen.patternResolution'), margin: req.t('screen.patternMargin'), hint: req.t('screen.patternHint') } : null;
    const shown = screensHub.testPattern(req.adminId, id, labels);
    res.json({ screen: { ...screen, online: screensHub.onlineIds(req.adminId).has(id), testPattern: shown } });
  });

  router.delete('/api/screens/:id', (req, res) => {
    const id = screenId(req);
    if (!id || !screens.revoke(req.adminId, id)) return res.status(404).json({ error: req.t('errors.screenNotFound') });
    screensHub.revoked(req.adminId, id);
    logger.info(`Screen #${id} revoked by user #${req.user.id} (admin #${req.adminId})`);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { SCREEN_TOKEN_HEADER, SCREEN_KEY_HEADER, screenCredential, createScreensRouter };
