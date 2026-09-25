'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { buildInfo } = require('../lib/pwa');

const SHORT_NAME_MAX = 12;
const STAGE = '#141318';

// The web app manifest: installable from Chrome / Edge (and the icons for iOS "Add to Home
// Screen"). Names from config, language from the request.
function createPwaRouter({ config, logger, sendPage }) {
  const router = express.Router();
  const build = buildInfo(config.VERSION);
  const workerSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'service-worker.js'), 'utf8')
    .replace(/\/\* __CONFIG__ \*\/ \{[^}]*\}/, JSON.stringify({ version: build.version, precache: build.precache, offline: '/offline' }));
  logger.info(`Service worker cache version ${build.version} (${build.precache.length} static files)`);

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

  // The service worker, at the root so it controls every page. Always revalidated: a new
  // version is how a deploy reaches installed apps.
  router.get('/sw.js', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.set('Service-Worker-Allowed', '/');
    res.type('application/javascript').send(workerSource);
  });

  // What an installed app shows for a page it never saw, when the network is gone.
  router.get('/offline', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    sendPage(req, res, 'offline');
  });

  // Browsers ask for /favicon.ico on their own.
  router.get('/favicon.ico', (req, res) => {
    res.redirect(301, '/icons/favicon-32.png');
  });

  return router;
}

module.exports = { createPwaRouter };
