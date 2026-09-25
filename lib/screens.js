'use strict';

// Projector screens: token helpers. A screen token is 32 random bytes (hex) given to the
// screen once; the database keeps only its sha256.

const crypto = require('crypto');

const TOKEN_BYTES = 32;
const TOKEN_RE = /^[0-9a-f]{64}$/;

function newToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function isToken(value) {
  return typeof value === 'string' && TOKEN_RE.test(value);
}

module.exports = { TOKEN_BYTES, newToken, hashToken, isToken };
