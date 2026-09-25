'use strict';

// What the service worker precaches and the version of its cache: the app version plus a
// hash of the static files, computed once at startup, so every deploy that changes a file
// gets a new cache (and the old one is dropped when the new worker activates).
// Scripts and styles are referenced as /file.js?v=<version> (lib/pages.js): a page loaded
// after a deploy gets its own version's code even while the previous service worker still
// controls the browser, so an update never needs a reload in the middle of a navigation.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const STATIC_EXT = new Set(['.js', '.css', '.png', '.svg', '.ico', '.woff', '.woff2', '.webmanifest']);
const VERSIONED_EXT = new Set(['.js', '.css']);
const builds = new Map();

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
  if (builds.has(appVersion)) return builds.get(appVersion);
  const files = staticFiles();
  const hash = crypto.createHash('sha256');
  for (const file of files) hash.update(file.url).update('\0').update(fs.readFileSync(file.full));
  const version = `${appVersion}-${hash.digest('hex').slice(0, 10)}`;
  const build = {
    version,
    precache: files.map((file) => versionedUrl(file.url, version)),
  };
  builds.set(appVersion, build);
  return build;
}

// /live.js -> /live.js?v=<version>; other files keep their URL.
function versionedUrl(url, version) {
  return VERSIONED_EXT.has(path.extname(url)) ? `${url}?v=${encodeURIComponent(version)}` : url;
}

module.exports = { buildInfo, staticFiles, versionedUrl };
