'use strict';

const express = require('express');
const { requireRole } = require('../lib/auth');
const { createFailureLimiter, createRequestLimiter } = require('../lib/rate-limit');
const { validateScreenName, createScreenStore } = require('../lib/screens');

const { SCREEN_ROLES } = require('../lib/events');
const TEN_MINUTES = 10 * 60 * 1000;
const SCREEN_TOKEN_HEADER = 'x-screen-token';

// Projector screens.
//   /api/screen/...  called by the screen itself (no user session): pairing, claim links
//                    and "who am I" with its screen token (X-Screen-Token header).
//   /api/screens/... owner/leader: claim a code, create a claim link, list, rename, revoke.
function createScreensRouter({ db, auth, logger, screensHub }) {
  const router = express.Router();
  const screens = createScreenStore(db);
  const canManage = requireRole(...SCREEN_ROLES);
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

  router.post('/api/screen/claim-link', (req, res) => {
    const result = screens.collectLink((req.body || {}).claim);
    if (!result) return res.status(404).json({ error: req.t('errors.claimLinkInvalid') });
    logger.info(`Screen #${result.screen.id} paired with a claim link (admin #${result.adminId})`);
    res.json({ token: result.token, screen: result.screen });
  });

  router.get('/api/screen/me', (req, res) => {
    const screen = screens.findByToken(req.get(SCREEN_TOKEN_HEADER));
    if (!screen) return res.status(401).json({ error: req.t('errors.screenUnknown') });
    // A deactivated church: the screen keeps its token and waits (public/screen.js).
    if (!screen.adminActive) return res.status(423).json({ code: 'suspended', error: req.t('errors.adminInactive') });
    screens.touch(screen.id);
    res.json({ screen: { id: screen.id, name: screen.name }, admin: { id: screen.adminId, name: screen.adminName } });
  });

  // A one-time link (60 s) that pairs the window opening it, without a code: from the
  // leader's live page or the operator console.
  router.post('/api/screens/auto-claim', auth.requireUser, canManage, noStore, (req, res) => {
    const name = validateScreenName((req.body || {}).name, req.t);
    if (name.error) return res.status(400).json({ error: name.error });
    const link = screens.createLink(req.adminId, req.user.id, name.value);
    res.status(201).json({ claimUrl: `/screen?claim=${link.claim}`, expiresAt: link.expiresAt });
  });

  // --- owner / leader -----------------------------------------------------------------

  router.use('/api/screens', auth.requireUser, canManage, noStore);

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
    res.json({ screens: screens.list(req.adminId).map((s) => ({ ...s, online: online.has(s.id) })) });
  });

  router.put('/api/screens/:id', (req, res) => {
    const id = screenId(req);
    const name = validateScreenName((req.body || {}).name, req.t);
    if (!id || !screens.get(req.adminId, id)) return res.status(404).json({ error: req.t('errors.screenNotFound') });
    if (name.error) return res.status(400).json({ error: name.error });
    screens.rename(req.adminId, id, name.value);
    res.json({ screen: screens.get(req.adminId, id) });
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

module.exports = { SCREEN_TOKEN_HEADER, createScreensRouter };
