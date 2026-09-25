'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// Serves public/<name>.html with {{APP_NAME}} from config and {{LANG}} from req.lang.
function createPageRenderer({ config }) {
  const cache = new Map();
  const appName = escapeHtml(config.APP_NAME);

  function render(name, lang) {
    const key = `${lang}:${name}`;
    if (config.IS_PRODUCTION && cache.has(key)) return cache.get(key);
    const html = fs.readFileSync(path.join(PUBLIC_DIR, `${name}.html`), 'utf8')
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
