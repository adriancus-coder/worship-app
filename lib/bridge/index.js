'use strict';

// The bridge hub (worship-app side of the stage-8 bridge to Sanctuary Voice). Ties the client
// transport (lib/bridge/client.js) to persistence (lib/bridge/store.js) and, from B2-B4, to
// the live path. Everything here is server-side: phones and projector screens never talk to SV.
//
// Lifecycle: connect() exchanges a code and opens the /bridge socket; the socket reconnects
// with backoff on its own; disconnect() closes it and revokes the token at SV. resume() reopens
// stored sockets after a restart. If the bridge drops, worship-app carries on unchanged.

const { createBridgeStore } = require('./store');
const { createBridgeClient, BridgeError } = require('./client');

function createBridge({ db, config, logger = console, fetchImpl, ioClient, screensHub = null } = {}) {
  const store = createBridgeStore(db);
  const client = createBridgeClient({ fetchImpl, ioClient, logger });
  // eventId -> { socket, connected, adminId, svEventId, targetLanguages }
  const live = new Map();
  // eventId -> { <lang>: { entryId, lines, partial, at } }: the latest translated text from SV
  // for the projector's translation source (SV -> worship). Not persisted (a fast stream).
  const translations = new Map();

  function stateOf(eventId) {
    return live.get(eventId) || { socket: null, connected: false, svEventId: null, targetLanguages: [] };
  }

  function closeSocket(eventId) {
    const current = live.get(eventId);
    if (current && current.socket) {
      try { current.socket.removeAllListeners(); current.socket.disconnect(); } catch (err) { /* already gone */ }
    }
    live.delete(eventId);
    translations.delete(eventId);
  }

  // A translation.partial / .final from SV: keep the latest text per language, then ask the
  // screens to re-render (only when dir_in is on for this event). partial: in-progress text.
  function receiveTranslation(eventId, payload, partial) {
    const src = payload && typeof payload.translations === 'object' && payload.translations ? payload.translations : {};
    const entryId = partial ? (payload && payload.entryId) : (payload && payload.id);
    const map = translations.get(eventId) || {};
    for (const [lang, text] of Object.entries(src)) {
      if (typeof text !== 'string') continue;
      map[String(lang).toLowerCase()] = { entryId: entryId != null ? String(entryId) : null, lines: text.split('\n'), partial, at: Date.now() };
    }
    translations.set(eventId, map);
    const row = store.getByEvent(eventId);
    if (screensHub && row && row.dir_in === 1) screensHub.update(row.admin_id);
  }

  // The live translated text for the projector's translation source, or null. Gated by dir_in
  // and scoped to the connection's admin. (adminId, eventId, lang) -> { lines, partial }.
  function translationFor(adminId, eventId, lang) {
    const row = store.getByEvent(eventId);
    if (!row || row.admin_id !== adminId || row.dir_in !== 1) return null;
    const map = translations.get(eventId);
    const entry = map && lang ? map[String(lang).toLowerCase()] : null;
    return entry ? { lines: entry.lines, partial: entry.partial } : null;
  }

  // Open (or reopen) the SV socket for a stored connection row.
  function openSocket(row) {
    closeSocket(row.event_id);
    const entry = { socket: null, connected: false, adminId: row.admin_id, svEventId: row.sv_event_id, targetLanguages: [] };
    live.set(row.event_id, entry);
    const socket = client.connectSocket(row.sv_base_url, row.bridge_token, {
      onReady: (payload) => {
        entry.connected = true;
        entry.svEventId = (payload && payload.svEventId) || row.sv_event_id;
        entry.targetLanguages = Array.isArray(payload && payload.targetLanguages) ? payload.targetLanguages : entry.targetLanguages;
        store.markStatus(row.event_id, 'connected');
        logger.info(`bridge: ready for event #${row.event_id} <-> SV ${entry.svEventId} (${row.token_fingerprint})`);
      },
      onPartial: (payload) => receiveTranslation(row.event_id, payload, true),
      onFinal: (payload) => receiveTranslation(row.event_id, payload, false),
      onConnect: () => { entry.connected = true; },
      onDisconnect: (reason) => {
        entry.connected = false;
        store.markStatus(row.event_id, 'disconnected');
        logger.info(`bridge: socket disconnected for event #${row.event_id} (${reason})`);
      },
      onError: (err) => {
        entry.connected = false;
        store.markStatus(row.event_id, 'error');
        logger.warn(`bridge: connect error for event #${row.event_id}: ${err && err.message}`);
      },
    });
    entry.socket = socket;
    return entry;
  }

  // Exchange a connection code and connect the bridge for this event. Throws BridgeError on a
  // bad code / transport error (the route maps the code to a message).
  async function connect(adminId, eventId, { svBaseUrl, code }) {
    const result = await client.exchange(svBaseUrl || undefined, code);
    const row = store.save(adminId, eventId, {
      svBaseUrl: result.baseUrl,
      svEventId: result.svEventId,
      bridgeToken: result.bridgeToken,
      targetLanguages: result.targetLanguages,
      expiresAt: result.expiresAt,
    });
    openSocket(row);
    logger.info(`bridge: connected event #${eventId} (admin #${adminId}) to SV ${result.svEventId}`);
    return status(adminId, eventId);
  }

  // The two direction switches (dir_in, dir_out). dir_out needs the church's one-time consent.
  function setSwitches(adminId, eventId, { dirIn, dirOut, userId }) {
    const row = store.get(adminId, eventId);
    if (!row) throw new BridgeError('not_connected');
    if (dirOut && !store.hasOutConsent(adminId)) throw new BridgeError('needs_consent');
    store.switches(adminId, eventId, { dirIn, dirOut });
    // dir_in gates the translated text on the projector: re-render so it shows / hides at once.
    if (screensHub) screensHub.update(adminId);
    return status(adminId, eventId);
  }

  // Record the church owner's one-time consent for worship -> SV (copyright acknowledgement).
  function recordConsent(adminId, userId) {
    store.recordOutConsent(adminId, userId);
    return { consented: true };
  }

  function hasConsent(adminId) {
    return store.hasOutConsent(adminId);
  }

  // Disconnect the bridge for this event: close the socket, revoke the token at SV (best
  // effort) and forget the connection.
  async function disconnect(adminId, eventId) {
    const row = store.get(adminId, eventId);
    closeSocket(eventId);
    if (!row) return { ok: true };
    store.remove(adminId, eventId);
    try {
      await client.revoke(row.sv_base_url, row.bridge_token);
    } catch (err) {
      logger.warn(`bridge: revoke failed for event #${eventId}: ${err && err.code}`);
    }
    logger.info(`bridge: disconnected event #${eventId} (admin #${adminId})`);
    return { ok: true };
  }

  // The public status of the bridge for this event (tokenless), plus the live socket state.
  function status(adminId, eventId) {
    const row = store.get(adminId, eventId);
    if (!row) return { connected: false, connection: null, consent: store.hasOutConsent(adminId) };
    const pub = store.toPublic(row);
    const s = stateOf(eventId);
    return {
      connected: true,
      connection: { ...pub, live: s.connected, targetLanguages: s.targetLanguages.length ? s.targetLanguages : pub.targetLanguages },
      consent: store.hasOutConsent(adminId),
    };
  }

  // Ask SV whether the token is still active (liveness); updates the stored status.
  async function refresh(adminId, eventId) {
    const row = store.get(adminId, eventId);
    if (!row) return status(adminId, eventId);
    try {
      const remote = await client.status(row.sv_base_url, row.bridge_token);
      store.markStatus(eventId, remote.connected ? 'connected' : 'disconnected', remote.lastSeenAt || Date.now());
    } catch (err) {
      store.markStatus(eventId, 'error');
    }
    return status(adminId, eventId);
  }

  // Reopen stored sockets after a restart (skip clearly expired tokens).
  function resume() {
    const now = Date.now();
    let opened = 0;
    for (const row of store.all()) {
      if (row.expires_at && row.expires_at <= now) continue;
      try { openSocket(row); opened += 1; } catch (err) { logger.warn(`bridge: resume failed for event #${row.event_id}: ${err && err.message}`); }
    }
    if (opened) logger.info(`bridge: resumed ${opened} connection(s)`);
    return opened;
  }

  // Close every socket (a church deactivated, or a clean shutdown). Does not revoke.
  function closeAll() {
    for (const eventId of [...live.keys()]) closeSocket(eventId);
  }

  return { connect, disconnect, setSwitches, recordConsent, hasConsent, status, refresh, resume, closeAll, translationFor, store };
}

module.exports = { createBridge };
