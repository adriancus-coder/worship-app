'use strict';

const express = require('express');

const { buildInfo } = require('../lib/pwa');

// /api/health: the build this server runs (version, commit, the PWA cache version) and its
// uptime, so a deploy can be checked against the repository and an installed app.
function createHealthRouter({ config }) {
  const router = express.Router();
  const startedAt = Date.now();

  router.get('/api/health', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      ok: true,
      version: config.VERSION,
      commit: config.COMMIT,
      shortCommit: config.SHORT_COMMIT,
      build: buildInfo(config.BUILD_LABEL).version,
      startedAt,
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  return router;
}

module.exports = createHealthRouter;
