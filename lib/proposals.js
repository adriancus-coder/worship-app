'use strict';

// Song proposals (migration 034): everyone may propose a library song for a planned or live
// event; the event roles add it (into the setlist, or projector-only while live) or decline it.
// Limits: one open proposal per (event, song) -> 'proposalExists'; five open per member and
// event -> 'proposalLimit'; a note of at most 200 characters.

const STATUSES = ['open', 'added', 'declined'];
const MAX_NOTE = 200;
const MAX_OPEN_PER_MEMBER = 5;

function createProposalStore(db) {
  const insert = db.prepare(`INSERT INTO song_proposals (admin_id, event_id, song_id, proposed_by, note, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
  const select = db.prepare(`SELECT p.*, s.title AS song_title, s.song_key, u.name AS proposer_name, d.name AS decider_name
    FROM song_proposals p JOIN songs s ON s.id = p.song_id JOIN users u ON u.id = p.proposed_by LEFT JOIN users d ON d.id = p.decided_by
    WHERE p.admin_id = ? AND p.event_id = ? ORDER BY CASE p.status WHEN 'open' THEN 0 ELSE 1 END, p.created_at DESC, p.id DESC`);
  const selectOne = db.prepare(`SELECT p.*, s.title AS song_title, s.song_key, u.name AS proposer_name, d.name AS decider_name
    FROM song_proposals p JOIN songs s ON s.id = p.song_id JOIN users u ON u.id = p.proposed_by LEFT JOIN users d ON d.id = p.decided_by
    WHERE p.id = ? AND p.admin_id = ? AND p.event_id = ?`);
  const openSame = db.prepare("SELECT 1 FROM song_proposals WHERE event_id = ? AND song_id = ? AND status = 'open'").pluck();
  const openOfMember = db.prepare("SELECT COUNT(*) FROM song_proposals WHERE admin_id = ? AND event_id = ? AND proposed_by = ? AND status = 'open'").pluck();
  const openCountStmt = db.prepare("SELECT COUNT(*) FROM song_proposals WHERE admin_id = ? AND event_id = ? AND status = 'open'").pluck();
  const decide = db.prepare(`UPDATE song_proposals SET status = ?, decided_by = ?, decided_at = ?, decision_note = ?, added_target = ?, added_item_id = ?
    WHERE id = ? AND admin_id = ? AND event_id = ? AND status = 'open'`);
  const songOk = db.prepare('SELECT id, title FROM songs WHERE id = ? AND admin_id = ?');

  const toRow = (r) => ({
    id: r.id, eventId: r.event_id, songId: r.song_id, songTitle: r.song_title, songKey: r.song_key, proposedBy: r.proposed_by, proposerName: r.proposer_name,
    note: r.note || null, status: r.status, decidedBy: r.decided_by, deciderName: r.decider_name || null, decidedAt: r.decided_at, decisionNote: r.decision_note || null,
    addedTarget: r.added_target, addedItemId: r.added_item_id, createdAt: r.created_at,
  });

  // Every proposal of the event (the event roles), or only one person's (forUser).
  function list(adminId, eventId, { forUser = null } = {}) {
    return select.all(adminId, eventId).map(toRow).filter((p) => forUser === null || p.proposedBy === forUser);
  }

  const get = (adminId, eventId, id) => { const r = selectOne.get(id, adminId, eventId); return r ? toRow(r) : null; };
  const openCount = (adminId, eventId) => openCountStmt.get(adminId, eventId);

  // -> { proposal } or { error: 'songInvalid' | 'proposalExists' | 'proposalLimit' }
  const create = db.transaction((adminId, eventId, songId, userId, note) => {
    if (!Number.isInteger(songId) || !songOk.get(songId, adminId)) return { error: 'songInvalid' };
    if (openSame.get(eventId, songId)) return { error: 'proposalExists' };
    if (openOfMember.get(adminId, eventId, userId) >= MAX_OPEN_PER_MEMBER) return { error: 'proposalLimit' };
    const clean = typeof note === 'string' ? note.trim().slice(0, MAX_NOTE) : '';
    const id = Number(insert.run(adminId, eventId, songId, userId, clean || null, Date.now()).lastInsertRowid);
    return { proposal: get(adminId, eventId, id) };
  });

  // The decision on an open proposal: 'added' (with where it landed) or 'declined' (+ note).
  function settle(adminId, eventId, id, { status, decidedBy, note = null, target = null, itemId = null }) {
    if (!['added', 'declined'].includes(status)) return null;
    const changed = decide.run(status, decidedBy, Date.now(), note ? String(note).trim().slice(0, MAX_NOTE) || null : null, target, itemId, id, adminId, eventId).changes > 0;
    return changed ? get(adminId, eventId, id) : null;
  }

  return { list, get, openCount, create, settle };
}

module.exports = { STATUSES, MAX_NOTE, MAX_OPEN_PER_MEMBER, createProposalStore };
