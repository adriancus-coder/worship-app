'use strict';

const fs = require('fs');
const path = require('path');
const { buildInfo, versionedUrl } = require('./pwa');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// The same head for every page: installable app (manifest, icons), the stage colour for the
// browser UI, iOS home-screen mode with the content under a translucent status bar (the
// viewport covers the notch area; the CSS keeps content inside the safe-area insets).
const HEAD = [
  '<link rel="manifest" href="/manifest.webmanifest">',
  '<meta name="theme-color" content="#141318">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
  '<meta name="apple-mobile-web-app-title" content="{{APP_NAME}}">',
  '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">',
  '<link rel="icon" href="/icons/favicon.svg" type="image/svg+xml">',
  '<link rel="icon" href="/icons/favicon-32.png" sizes="32x32" type="image/png">',
].join('\n  ');
// The service worker and installed-app helpers: every page except the first-run setup.
const PWA_SCRIPT = '\n  <script src="/pwa.js" defer></script>';
const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">';

// Serves public/<name>.html with the shared head, {{APP_NAME}} from config and {{LANG}} from
// req.lang. Local scripts and styles get the build version (?v=, see lib/pwa.js), which the
// page also carries as <html data-build>.
function createPageRenderer({ config }) {
  const cache = new Map();
  const appName = escapeHtml(config.APP_NAME);
  const { version } = buildInfo(config.VERSION);

  function render(name, lang) {
    const key = `${lang}:${name}`;
    if (config.IS_PRODUCTION && cache.has(key)) return cache.get(key);
    const html = fs.readFileSync(path.join(PUBLIC_DIR, `${name}.html`), 'utf8')
      .replace(/<meta name="viewport"[^>]*>/, VIEWPORT)
      .replace(/\s*<meta name="theme-color"[^>]*>/, '')
      .replace('</head>', `  ${HEAD}${name === 'setup' ? '' : PWA_SCRIPT}\n</head>`)
      .replace(/(<script[^>]*\ssrc="|<link[^>]*\shref=")(\/[^"?#]+\.(?:js|css))"/g,
        (match, before, url) => (url.startsWith('/socket.io/') ? match : `${before}${versionedUrl(url, version)}"`))
      .replace('<html', `<html data-build="${escapeHtml(version)}"`)
      .replaceAll('{{APP_NAME}}', appName)
      .replaceAll('{{LANG}}', escapeHtml(lang));
    cache.set(key, html);
    return html;
  }

  return function sendPage(req, res, name) {
    res.type('html').send(render(name, req.lang));
  };
}

module.exports = { createPageRenderer };
