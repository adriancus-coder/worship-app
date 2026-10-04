'use strict';

// The build identity: the package version and the git commit the server runs from, so
// anyone can check that an installed app (PWA) runs the latest deploy. The commit comes
// from the host (Render sets RENDER_GIT_COMMIT on every deploy; GIT_COMMIT / SOURCE_COMMIT
// for other hosts), else from the checkout itself (`git rev-parse HEAD`), else unknown.
//   { version: '0.1.0', commit: '569a1ad…' | null, shortCommit: '569a1ad' | null,
//     label: '0.1.0+569a1ad' | '0.1.0' }
// The label is the base of the service worker's cache version (lib/pwa.js): a deploy of a
// new commit is always a new build, even when no static file changed.

const path = require('path');
const { execFileSync } = require('child_process');

const SHA_RE = /^[0-9a-f]{7,40}$/i;
const ENV_KEYS = ['RENDER_GIT_COMMIT', 'GIT_COMMIT', 'SOURCE_COMMIT'];

function fromEnv(env) {
  for (const key of ENV_KEYS) {
    const value = String(env[key] || '').trim();
    if (SHA_RE.test(value)) return value.toLowerCase();
  }
  return null;
}

function fromGit(cwd) {
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return SHA_RE.test(out) ? out.toLowerCase() : null;
  } catch (err) {
    return null;
  }
}

function buildIdentity({ version, env = process.env, cwd = path.join(__dirname, '..') } = {}) {
  const commit = fromEnv(env) || fromGit(cwd);
  const shortCommit = commit ? commit.slice(0, 7) : null;
  return { version, commit, shortCommit, label: shortCommit ? `${version}+${shortCommit}` : version };
}

module.exports = { buildIdentity, SHA_RE };
