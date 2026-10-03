'use strict';

const express = require('express');
const asyncRoute = require('../lib/async-route');

// Web push subscriptions of the signed-in user (lib/push.js).
//   GET    /api/push/config          { enabled, publicKey }
//   GET    /api/push/subscriptions   this user's subscriptions (no keys)
//   POST   /api/push/subscriptions   { subscription: PushSubscription.toJSON() }
//   DELETE /api/push/subscriptions   { endpoint }
//   POST   /api/push/test            a test notification to this user's subscriptions
function createPushRouter({ auth, logger, push }) {
  const router = express.Router();
  router.use('/api/push', auth.requireUser, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  const disabled = (req, res) => res.status(503).json({ code: 'pushDisabled', error: req.t('errors.pushDisabled') });

  router.get('/api/push/config', (req, res) => {
    res.json({ enabled: push.enabled, publicKey: push.publicKey });
  });

  router.get('/api/push/subscriptions', (req, res) => {
    res.json({ enabled: push.enabled, subscriptions: push.listForUser(req.adminId, req.user.id) });
  });

  router.post('/api/push/subscriptions', (req, res) => {
    if (!push.enabled) return disabled(req, res);
    const row = push.subscribe(req.adminId, req.user.id, (req.body || {}).subscription, req.get('user-agent'));
    if (!row) return res.status(400).json({ error: req.t('errors.pushSubscriptionInvalid') });
    logger.info(`Push subscription #${row.id} saved for user #${req.user.id} (admin #${req.adminId})`);
    res.status(201).json({ subscription: row, subscriptions: push.listForUser(req.adminId, req.user.id) });
  });

  router.delete('/api/push/subscriptions', (req, res) => {
    const removed = push.unsubscribe(req.adminId, req.user.id, (req.body || {}).endpoint);
    if (removed) logger.info(`Push subscription removed by user #${req.user.id} (admin #${req.adminId})`);
    res.json({ removed, subscriptions: push.listForUser(req.adminId, req.user.id) });
  });

  router.post('/api/push/test', asyncRoute(async (req, res) => {
    if (!push.enabled) return disabled(req, res);
    const result = await push.sendToUser(req.adminId, req.user.id, { title: req.t('push.testTitle'), body: req.t('push.testBody', { name: req.user.name }), url: '/notifications', tag: 'test' });
    res.json({ ...result, subscriptions: push.listForUser(req.adminId, req.user.id) });
  }));

  return router;
}

module.exports = { createPushRouter };
