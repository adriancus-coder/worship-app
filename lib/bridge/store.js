'use strict';

// Persistence for bridge connections (bridge_connections, migration 037) and the church
// pairing (bridge_pairings, migration 042: one per admin).
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

// The safe, tokenless view of the church pairing for the UI (null: not paired).
function pairingPublic(row) {
  if (!row) return null;
  return { paired: row.status === 'paired', status: row.status, svBaseUrl: row.sv_base_url, svOrgId: row.sv_org_id, svOrgName: row.sv_org_name, pairedAt: row.paired_at, lastCheckedAt: row.last_checked_at };
}

function createBridgeStore(db) {
  const selectPairing = db.prepare('SELECT * FROM bridge_pairings WHERE admin_id = ?');
  const upsertPairing = db.prepare(`INSERT INTO bridge_pairings
      (admin_id, sv_base_url, pairing_token, token_fingerprint, sv_org_id, sv_org_name, status, paired_by, paired_at, last_checked_at)
    VALUES (@adminId, @svBaseUrl, @token, @fingerprint, @svOrgId, @svOrgName, 'paired', @pairedBy, @now, @now)
    ON CONFLICT (admin_id) DO UPDATE SET sv_base_url = @svBaseUrl, pairing_token = @token, token_fingerprint = @fingerprint,
      sv_org_id = @svOrgId, sv_org_name = @svOrgName, status = 'paired', paired_by = @pairedBy, paired_at = @now, last_checked_at = @now`);
  const setPairingStatus = db.prepare('UPDATE bridge_pairings SET status = ?, last_checked_at = ? WHERE admin_id = ?');
  const deletePairing = db.prepare('DELETE FROM bridge_pairings WHERE admin_id = ?');
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

  // --- the church pairing (server-internal rows carry the pairing token) ---

  function pairing(adminId) {
    return selectPairing.get(adminId) || null;
  }

  function savePairing(adminId, userId, { svBaseUrl, pairingToken, svOrgId, svOrgName }) {
    upsertPairing.run({ adminId, svBaseUrl, token: pairingToken, fingerprint: fingerprint(pairingToken), svOrgId, svOrgName: svOrgName || '', pairedBy: userId || null, now: Date.now() });
    return pairing(adminId);
  }

  function markPairing(adminId, status) {
    setPairingStatus.run(status, Date.now(), adminId);
  }

  function removePairing(adminId) {
    return deletePairing.run(adminId).changes > 0;
  }

  return { get, getByEvent, all, save, switches, markStatus, remove, toPublic, pairing, savePairing, markPairing, removePairing, pairingPublic };
}

module.exports = { createBridgeStore, toPublic, pairingPublic };
