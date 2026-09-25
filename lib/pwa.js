'use strict';

// What the service worker precaches and the version of its cache: the app version plus a
// hash of the static files, computed at startup, so every deploy that changes a file gets a
// new cache (and the old one is dropped when the new worker activates).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const STATIC_EXT = new Set(['.js', '.css', '.png', '.svg', '.ico', '.woff', '.woff2', '.webmanifest']);

function staticFiles(dir = PUBLIC_DIR, prefix = '/') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...staticFiles(full, `${prefix}${entry.name}/`));
    else if (STATIC_EXT.has(path.extname(entry.name))) out.push({ url: `${prefix}${entry.name}`, full });
  }
  return out;
}

function buildInfo(appVersion) {
  const files = staticFiles();
  const hash = crypto.createHash('sha256');
  for (const file of files) hash.update(file.url).update('\0').update(fs.readFileSync(file.full));
  return {
    version: `${appVersion}-${hash.digest('hex').slice(0, 10)}`,
    precache: files.map((file) => file.url),
  };
}

module.exports = { buildInfo, staticFiles };
