'use strict';

const express = require('express');

function createHealthRouter({ config }) {
  const router = express.Router();

  router.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      version: config.VERSION,
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  return router;
}

module.exports = createHealthRouter;
