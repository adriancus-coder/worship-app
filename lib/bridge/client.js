'use strict';

// Bridge client core (worship-app side of the stage-8 bridge to Sanctuary Voice).
// Pure transport: the server-to-server REST handshake and the /bridge socket. No database,
// no live state — the hub (lib/bridge/index.js) wires this to persistence and the live path.
//
// The wire protocol is fixed by SV (docs/BRIDGE.md); do not rename or reshape anything here.
//   POST <base>/api/bridge/exchange   { code }                    -> { ok, bridgeToken, svEventId, targetLanguages, expiresAt }
//   POST <base>/api/bridge/revoke     Authorization: Bearer <tok> -> { ok }
//   GET  <base>/api/bridge/status     Authorization: Bearer <tok> -> { ok, connected, svEventId, targetLanguages, expiresAt, lastSeenAt }
//   socket.io  <base>/bridge          auth: { token }
//
// fetch and the socket.io-client factory are injected so the paths are unit-testable without
// a network or a real SV server.

const DEFAULT_BASE_URL = 'https://sanctuaryvoice.com';
// The connection code: 6-8 chars from SV's alphabet (no 0/1/I/L/O to avoid confusion).
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{6,8}$`);
const REQUEST_TIMEOUT_MS = 10 * 1000;

class BridgeError extends Error {
  constructor(code, status = null) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

// A user-typed code, upper-cased and trimmed, or null when it is not a valid SV code.
function normalizeCode(input) {
  const code = String(input || '').trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

// The SV base URL without a trailing slash, or null when it is not an acceptable http(s) URL.
// https only, except http on localhost / 127.0.0.1 for local development and the tests.
function normalizeBaseUrl(input) {
  let url;
  try {
    url = new URL(String(input || '').trim());
  } catch (err) {
    return null;
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return url.origin;
}

// A short, non-secret fingerprint of a token, for logs (never the token itself).
function fingerprint(token) {
  return require('crypto').createHash('sha256').update(String(token)).digest('hex').slice(0, 12);
}

// The target languages of an exchange / status response: a clean array of ISO-ish codes.
function parseLanguages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((lang) => typeof lang === 'string' && /^[a-zA-Z-]{2,8}$/.test(lang))
    .map((lang) => lang.toLowerCase());
}

function createBridgeClient({ fetchImpl = globalThis.fetch, ioClient = null, logger = console } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('createBridgeClient: fetch is required');

  async function request(baseUrl, path, { method = 'GET', token = null, body = null } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== null) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === null ? undefined : JSON.stringify(body),
        signal: controller ? controller.signal : undefined,
      });
    } catch (err) {
      throw new BridgeError(err && err.name === 'AbortError' ? 'timeout' : 'unreachable');
    } finally {
      if (timer) clearTimeout(timer);
    }
    let data = {};
    try {
      data = JSON.parse(await res.text());
    } catch (err) {
      data = {};
    }
    return { status: res.status, ok: res.ok, data: data && typeof data === 'object' ? data : {} };
  }

  // Exchange a connection code for a bridge token. Throws BridgeError with the SV error code
  // (invalid_code / code_used / code_expired / too_many_attempts) or a transport code.
  async function exchange(baseUrlInput, codeInput) {
    const baseUrl = normalizeBaseUrl(baseUrlInput);
    if (!baseUrl) throw new BridgeError('bad_base_url');
    const code = normalizeCode(codeInput);
    if (!code) throw new BridgeError('invalid_code');
    const { status, ok, data } = await request(baseUrl, '/api/bridge/exchange', { method: 'POST', body: { code } });
    if (!ok || data.ok === false || !data.bridgeToken) {
      if (status === 429) throw new BridgeError('too_many_attempts', status);
      const errCode = typeof data.error === 'string' ? data.error : (status === 404 ? 'invalid_code' : 'exchange_failed');
      throw new BridgeError(errCode, status);
    }
    return {
      baseUrl,
      bridgeToken: String(data.bridgeToken),
      svEventId: String(data.svEventId || ''),
      targetLanguages: parseLanguages(data.targetLanguages),
      expiresAt: Number.isFinite(data.expiresAt) ? data.expiresAt : null,
    };
  }

  // Revoke a bridge token (disconnect). A 404 (already gone) is treated as success — the
  // caller's intent, a dead token, is met either way.
  async function revoke(baseUrl, token) {
    const { status, ok, data } = await request(baseUrl, '/api/bridge/revoke', { method: 'POST', token, body: { bridgeToken: token } });
    if (ok || status === 404) return { ok: true };
    throw new BridgeError(typeof data.error === 'string' ? data.error : 'revoke_failed', status);
  }

  // Liveness of a bridge token. Returns the status object, or throws BridgeError('inactive')
  // on 401 (revoked / expired), or a transport code.
  async function status(baseUrl, token) {
    const { status: code, ok, data } = await request(baseUrl, '/api/bridge/status', { token });
    if (code === 401 || code === 404) throw new BridgeError('inactive', code);
    if (!ok || data.ok === false) throw new BridgeError(typeof data.error === 'string' ? data.error : 'status_failed', code);
    return {
      connected: data.connected !== false,
      svEventId: data.svEventId ? String(data.svEventId) : null,
      targetLanguages: parseLanguages(data.targetLanguages),
      expiresAt: Number.isFinite(data.expiresAt) ? data.expiresAt : null,
      lastSeenAt: Number.isFinite(data.lastSeenAt) ? data.lastSeenAt : null,
    };
  }

  // Open the /bridge socket to SV with the token in the handshake. Reconnection with backoff
  // is socket.io-client's own (enabled here); handlers wires the SV -> worship stream and the
  // connection lifecycle. Returns the socket, or null when no socket.io-client is available.
  function connectSocket(baseUrl, token, handlers = {}) {
    const io = ioClient;
    if (typeof io !== 'function') {
      logger.warn && logger.warn('bridge: socket.io-client not available; SV socket not opened');
      return null;
    }
    const socket = io(`${baseUrl}/bridge`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30 * 1000,
      randomizationFactor: 0.5,
      timeout: REQUEST_TIMEOUT_MS,
    });
    if (handlers.onReady) socket.on('bridge.ready', (payload) => handlers.onReady(payload));
    if (handlers.onPartial) socket.on('translation.partial', (payload) => handlers.onPartial(payload));
    if (handlers.onFinal) socket.on('translation.final', (payload) => handlers.onFinal(payload));
    socket.on('connect', () => handlers.onConnect && handlers.onConnect());
    socket.on('disconnect', (reason) => handlers.onDisconnect && handlers.onDisconnect(reason));
    socket.on('connect_error', (err) => handlers.onError && handlers.onError(err));
    return socket;
  }

  return { exchange, revoke, status, connectSocket };
}

module.exports = {
  DEFAULT_BASE_URL,
  CODE_ALPHABET,
  CODE_RE,
  BridgeError,
  normalizeCode,
  normalizeBaseUrl,
  fingerprint,
  parseLanguages,
  createBridgeClient,
};
