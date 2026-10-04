'use strict';

// Answer links (migration 050): the invitation email carries "Vin" / "Poate" / "Nu pot" links
// to /answer/<token>?a=<answer>; the page answers without signing in (routes/answer.js).
// One link per (event, person), replaced on every new email; valid until two days after the
// event; only the token's SHA-256 is stored.

const crypto = require('crypto');

const GRACE_MS = 2 * 24 * 60 * 60 * 1000;
const hashToken = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');

function createAnswerLinks(db) {
  const upsert = db.prepare(`INSERT INTO answer_links (admin_id, user_id, event_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id, user_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at, expires_at = excluded.expires_at`);
  const byHash = db.prepare(`SELECT l.*, u.active AS user_active FROM answer_links l JOIN users u ON u.id = l.user_id AND u.admin_id = l.admin_id
    WHERE l.token_hash = ?`);

  // -> the raw token (goes into the email only).
  function create(adminId, userId, eventId, eventDate, now = Date.now()) {
    const raw = crypto.randomBytes(32).toString('hex');
    const ends = Date.parse(`${eventDate}T23:59:59Z`);
    upsert.run(adminId, userId, eventId, hashToken(raw), now, (Number.isNaN(ends) ? now : ends) + GRACE_MS);
    return raw;
  }

  // -> { adminId, userId, eventId, state: 'valid' | 'expired' } or null.
  function find(raw, now = Date.now()) {
    if (!/^[0-9a-f]{64}$/.test(String(raw))) return null;
    const row = byHash.get(hashToken(raw));
    if (!row || !row.user_active) return null;
    return { adminId: row.admin_id, userId: row.user_id, eventId: row.event_id, state: row.expires_at < now ? 'expired' : 'valid' };
  }

  return { create, find };
}

module.exports = { createAnswerLinks };
