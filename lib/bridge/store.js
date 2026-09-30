'use strict';

// Persistence for bridge connections (bridge_connections, migration 037).
//
// A bridge row holds the token worship-app presents back to SV; `public()` is the ONLY shape
// that leaves the server (for routes / the UI) and never carries the token — see the migration.

const { fingerprint } = require('./client');

// The safe, tokenless view of a connection for the UI.
function toPublic(row) {
  if (!row) return null;
  let targetLanguages = [];
  try {
    const parsed = JSON.parse(row.target_languages || '[]');
    if (Array.isArray(parsed)) targetLanguages = parsed;
  } catch (err) {
    targetLanguages = [];
  }
  return {
    eventId: row.event_id,
    svEventId: row.sv_event_id,
    svBaseUrl: row.sv_base_url,
    targetLanguages,
    expiresAt: row.expires_at,
    dirIn: row.dir_in === 1,
    dirOut: row.dir_out === 1,
    status: row.status,
    lastSeenAt: row.last_seen_at,
  };
}

function createBridgeStore(db) {
  const selectByEvent = db.prepare('SELECT * FROM bridge_connections WHERE event_id = ? AND admin_id = ?');
  const selectRowByEvent = db.prepare('SELECT * FROM bridge_connections WHERE event_id = ?');
  const selectAll = db.prepare('SELECT * FROM bridge_connections');
  const upsert = db.prepare(`INSERT INTO bridge_connections
      (event_id, admin_id, sv_base_url, sv_event_id, bridge_token, token_fingerprint,
       target_languages, expires_at, dir_in, dir_out, status, last_seen_at, created_at, updated_at)
    VALUES (@eventId, @adminId, @svBaseUrl, @svEventId, @token, @fingerprint,
       @targetLanguages, @expiresAt, @dirIn, @dirOut, @status, @lastSeenAt, @now, @now)
    ON CONFLICT (event_id) DO UPDATE SET
      admin_id = @adminId, sv_base_url = @svBaseUrl, sv_event_id = @svEventId,
      bridge_token = @token, token_fingerprint = @fingerprint,
      target_languages = @targetLanguages, expires_at = @expiresAt,
      status = @status, last_seen_at = @lastSeenAt, updated_at = @now`);
  const setSwitches = db.prepare(`UPDATE bridge_connections SET dir_in = @dirIn, dir_out = @dirOut, updated_at = @now
    WHERE event_id = @eventId AND admin_id = @adminId`);
  const setStatus = db.prepare('UPDATE bridge_connections SET status = ?, last_seen_at = ?, updated_at = ? WHERE event_id = ?');
  const deleteByEvent = db.prepare('DELETE FROM bridge_connections WHERE event_id = ? AND admin_id = ?');

  // A connection scoped to this admin's event, with the token, or null. Server-internal only.
  function get(adminId, eventId) {
    return selectByEvent.get(eventId, adminId) || null;
  }

  function getByEvent(eventId) {
    return selectRowByEvent.get(eventId) || null;
  }

  function all() {
    return selectAll.all();
  }

  // Store a fresh exchange for the {event <-> SV event} pair. Existing switches on the event
  // are preserved (a re-exchange keeps the operator's dir_in / dir_out choices).
  function save(adminId, eventId, { svBaseUrl, svEventId, bridgeToken, targetLanguages = [], expiresAt = null }) {
    const now = Date.now();
    const existing = get(adminId, eventId);
    upsert.run({
      eventId, adminId, svBaseUrl, svEventId, token: bridgeToken, fingerprint: fingerprint(bridgeToken),
      targetLanguages: JSON.stringify(targetLanguages), expiresAt,
      dirIn: existing ? existing.dir_in : 0, dirOut: existing ? existing.dir_out : 0,
      status: 'connected', lastSeenAt: now, now,
    });
    return get(adminId, eventId);
  }

  function switches(adminId, eventId, { dirIn, dirOut }) {
    return setSwitches.run({ eventId, adminId, dirIn: dirIn ? 1 : 0, dirOut: dirOut ? 1 : 0, now: Date.now() }).changes > 0;
  }

  function markStatus(eventId, status, lastSeenAt = Date.now()) {
    setStatus.run(status, lastSeenAt, Date.now(), eventId);
  }

  function remove(adminId, eventId) {
    return deleteByEvent.run(eventId, adminId).changes > 0;
  }

  return { get, getByEvent, all, save, switches, markStatus, remove, toPublic };
}

module.exports = { createBridgeStore, toPublic };
