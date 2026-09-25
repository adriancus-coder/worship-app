'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// Serves public/<name>.html with {{APP_NAME}} filled in from config.
function createPageRenderer({ config }) {
  const cache = new Map();
  const appName = escapeHtml(config.APP_NAME);

  function render(name) {
    if (config.IS_PRODUCTION && cache.has(name)) return cache.get(name);
    const html = fs.readFileSync(path.join(PUBLIC_DIR, `${name}.html`), 'utf8')
      .replaceAll('{{APP_NAME}}', appName);
    cache.set(name, html);
    return html;
  }

  return function sendPage(res, name) {
    res.type('html').send(render(name));
  };
}

module.exports = { createPageRenderer };
