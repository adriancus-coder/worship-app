'use strict';

// Bridge to Sanctuary Voice (stage 8), worship-app side. Event-scoped endpoints the worship UI
// calls to connect a code, flip the two direction switches (available to every event role) and
// disconnect. All server-to-server work happens in lib/bridge; nothing here exposes the token.
//
//   GET    /api/events/:id/bridge              status (event roles)
//   POST   /api/events/:id/bridge/connect      { code, svBaseUrl? }  exchange + connect
//   POST   /api/events/:id/bridge/switches     { dirIn, dirOut }     (every event role)
//   POST   /api/events/:id/bridge/refresh      re-check liveness at SV
//   POST   /api/events/:id/bridge/disconnect   revoke + forget

const express = require('express');
const asyncRoute = require('../lib/async-route');
const { requireRole } = require('../lib/auth');
const { EVENT_ROLES, createEventStore } = require('../lib/events');
const { BridgeError } = require('../lib/bridge/client');

// BridgeError code -> HTTP status. Everything else is a bad gateway (SV / transport).
const STATUS_BY_CODE = {
  invalid_code: 400, code_used: 400, code_expired: 400, bad_base_url: 400,
  too_many_attempts: 429,
  not_connected: 409, inactive: 409,
};

function createBridgeRouter({ db, auth, logger, bridge }) {
  const router = express.Router();
  const events = createEventStore(db);
  const canEdit = requireRole(...EVENT_ROLES);

  function eventId(req) {
    return /^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : null;
  }

  // The event of this request if it exists, is not a template and this user may edit it.
  function loadEvent(req, res) {
    const id = eventId(req);
    const found = id && events.get(req.adminId, id);
    if (!found || found.event.isTemplate) {
      res.status(404).json({ error: req.t('errors.eventNotFound') });
      return null;
    }
    return found.event;
  }

  function fail(req, res, err) {
    if (!(err instanceof BridgeError)) throw err;
    const status = STATUS_BY_CODE[err.code] || 502;
    const key = `bridge.errors.${err.code}`;
    const message = req.t(key);
    res.status(status).json({ code: err.code, error: message === key ? req.t('bridge.errors.exchange_failed') : message });
  }

  router.use('/api/events/:id/bridge', auth.requireUser, canEdit, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/api/events/:id/bridge', (req, res) => {
    const event = loadEvent(req, res);
    if (event) res.json(bridge.status(req.adminId, event.id));
  });

  router.post('/api/events/:id/bridge/connect', asyncRoute(async (req, res) => {
    const event = loadEvent(req, res);
    if (!event) return;
    const body = req.body || {};
    try {
      const result = await bridge.connect(req.adminId, event.id, { svBaseUrl: body.svBaseUrl, code: body.code });
      logger.info(`Bridge connected for event #${event.id} by user #${req.user.id} (admin #${req.adminId})`);
      res.json(result);
    } catch (err) {
      fail(req, res, err);
    }
  }));

  router.post('/api/events/:id/bridge/switches', (req, res) => {
    const event = loadEvent(req, res);
    if (!event) return;
    const body = req.body || {};
    try {
      res.json(bridge.setSwitches(req.adminId, event.id, { dirIn: body.dirIn === true, dirOut: body.dirOut === true }));
    } catch (err) {
      fail(req, res, err);
    }
  });

  router.post('/api/events/:id/bridge/refresh', asyncRoute(async (req, res) => {
    const event = loadEvent(req, res);
    if (!event) return;
    res.json(await bridge.refresh(req.adminId, event.id));
  }));

  router.post('/api/events/:id/bridge/disconnect', asyncRoute(async (req, res) => {
    const event = loadEvent(req, res);
    if (!event) return;
    await bridge.disconnect(req.adminId, event.id);
    logger.info(`Bridge disconnected for event #${event.id} by user #${req.user.id} (admin #${req.adminId})`);
    res.json(bridge.status(req.adminId, event.id));
  }));

  return router;
}

module.exports = { createBridgeRouter };
