'use strict';

const fs = require('fs');
const path = require('path');
const { buildInfo, versionedUrl } = require('./pwa');
const { browserColor, statusBarStyle } = require('./theme');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// The same head for every page: installable app (manifest, icons), the theme's colour for
// the browser UI, iOS home-screen mode (the viewport covers the notch area; the CSS keeps
// content inside the safe-area insets) and the theme script (public/theme.js, not deferred:
// it sets the palette before the first paint).
const HEAD = [
  '<link rel="manifest" href="/manifest.webmanifest">',
  '<meta name="theme-color" content="{{THEME_COLOR}}">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="{{STATUS_BAR}}">',
  '<meta name="apple-mobile-web-app-title" content="{{APP_NAME}}">',
  '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">',
  '<link rel="icon" href="/icons/favicon.svg" type="image/svg+xml">',
  '<link rel="icon" href="/icons/favicon-32.png" sizes="32x32" type="image/png">',
  '<script src="/theme.js"></script>',
].join('\n  ');
// The service worker and installed-app helpers: every page except the first-run setup.
const PWA_SCRIPT = '\n  <script src="/pwa.js" defer></script>';
const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">';

// Serves public/<name>.html with the shared head, {{APP_NAME}} from config and {{LANG}} from
// req.lang. Local scripts and styles get the build version (?v=, see lib/pwa.js), which the
// page also carries as <html data-build>. themeOf(req) -> 'dark' | 'light' | 'auto' (the
// colour theme preference, lib/theme.js) becomes <html data-theme-pref data-theme>.
function createPageRenderer({ config, themeOf = () => 'dark' }) {
  const cache = new Map();
  const appName = escapeHtml(config.APP_NAME);
  const { version } = buildInfo(config.VERSION);

  function render(name, lang, pref) {
    const key = `${lang}:${name}:${pref}`;
    if (config.IS_PRODUCTION && cache.has(key)) return cache.get(key);
    const html = fs.readFileSync(path.join(PUBLIC_DIR, `${name}.html`), 'utf8')
      .replace(/<meta name="viewport"[^>]*>/, VIEWPORT)
      .replace(/\s*<meta name="theme-color"[^>]*>/, '')
      .replace('</head>', `  ${HEAD}${name === 'setup' ? '' : PWA_SCRIPT}\n</head>`)
      .replace(/(<script[^>]*\ssrc="|<link[^>]*\shref=")(\/[^"?#]+\.(?:js|css))"/g,
        (match, before, url) => (url.startsWith('/socket.io/') ? match : `${before}${versionedUrl(url, version)}"`))
      .replace('<html', `<html data-build="${escapeHtml(version)}" data-theme-pref="${pref}" data-theme="${pref === 'light' ? 'light' : 'dark'}"`)
      .replace('{{THEME_COLOR}}', browserColor(pref))
      .replace('{{STATUS_BAR}}', statusBarStyle(pref))
      .replaceAll('{{APP_NAME}}', appName)
      .replaceAll('{{LANG}}', escapeHtml(lang));
    cache.set(key, html);
    return html;
  }

  return function sendPage(req, res, name) {
    // The projector screen ignores the theme: always black with white text.
    res.type('html').send(render(name, req.lang, name === 'screen' ? 'dark' : themeOf(req)));
  };
}

module.exports = { createPageRenderer };
