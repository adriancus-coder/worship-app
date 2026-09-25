'use strict';

const express = require('express');

const SHORT_NAME_MAX = 12;
const STAGE = '#141318';

// The web app manifest: installable from Chrome / Edge (and the icons for iOS "Add to Home
// Screen"). Names from config, language from the request.
function createPwaRouter({ config }) {
  const router = express.Router();

  const shortName = config.APP_NAME.length <= SHORT_NAME_MAX
    ? config.APP_NAME
    : config.APP_NAME.slice(0, SHORT_NAME_MAX).trim();

  router.get('/manifest.webmanifest', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.type('application/manifest+json').send(JSON.stringify({
      id: '/app',
      name: config.APP_NAME,
      short_name: shortName,
      lang: req.lang,
      dir: 'ltr',
      start_url: '/app',
      scope: '/',
      display: 'standalone',
      orientation: 'any',
      background_color: STAGE,
      theme_color: STAGE,
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }));
  });

  // Browsers ask for /favicon.ico on their own.
  router.get('/favicon.ico', (req, res) => {
    res.redirect(301, '/icons/favicon-32.png');
  });

  return router;
}

module.exports = { createPwaRouter };
