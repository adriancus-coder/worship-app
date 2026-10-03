'use strict';

// Who serves at an event (migration 030): the leader (or the owner) puts people on positions;
// each person answers "Vin" / "Nu pot" (+ a note). Rows survive edits of the list (their
// status stays); a copy of an event / template copies them as pending; templates keep theirs
// as the "usual team".

const STATUSES = ['pending', 'accepted', 'declined'];
const ASSIGN_ROLES = ['owner', 'leader']; // scheduling is the leader's job
const MAX_NOTE = 200;

function createAssignmentStore(db) {
  const select = db.prepare(`SELECT a.*, u.name AS user_name, u.email AS user_email, u.active AS user_active, p.name AS position_name, p.emoji AS position_emoji, p.sort AS position_sort
    FROM event_assignments a JOIN users u ON u.id = a.user_id JOIN positions p ON p.id = a.position_id
    WHERE a.admin_id = ? AND a.event_id = ? ORDER BY p.sort, p.id, u.name COLLATE NOCASE, a.id`);
  const selectOne = db.prepare(`SELECT a.*, u.name AS user_name, p.name AS position_name, p.emoji AS position_emoji FROM event_assignments a
    JOIN users u ON u.id = a.user_id JOIN positions p ON p.id = a.position_id WHERE a.id = ? AND a.admin_id = ? AND a.event_id = ?`);
  const insert = db.prepare(`INSERT INTO event_assignments (event_id, admin_id, user_id, position_id, status, created_by, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)`);
  const remove = db.prepare('DELETE FROM event_assignments WHERE id = ? AND admin_id = ?');
  const respond = db.prepare('UPDATE event_assignments SET status = ?, note = ?, responded_at = ? WHERE id = ? AND admin_id = ? AND user_id = ?');
  const markNotified = db.prepare('UPDATE event_assignments SET notified_at = ? WHERE id = ? AND admin_id = ?');
  const copyRows = db.prepare(`INSERT OR IGNORE INTO event_assignments (event_id, admin_id, user_id, position_id, status, created_by, created_at)
    SELECT ?, admin_id, user_id, position_id, 'pending', ?, ? FROM event_assignments WHERE event_id = ? AND admin_id = ?`);
  const forUserEvent = db.prepare(`SELECT a.*, p.name AS position_name, p.emoji AS position_emoji FROM event_assignments a JOIN positions p ON p.id = a.position_id
    WHERE a.admin_id = ? AND a.user_id = ? AND a.event_id = ? ORDER BY p.sort, p.id`);
  const userIds = db.prepare('SELECT DISTINCT user_id FROM event_assignments WHERE admin_id = ? AND event_id = ?').pluck();
  const userOk = db.prepare('SELECT 1 FROM users WHERE id = ? AND admin_id = ? AND active = 1').pluck();
  const positionOk = db.prepare('SELECT 1 FROM positions WHERE id = ? AND admin_id = ?').pluck();

  const toRow = (r) => ({
    id: r.id, eventId: r.event_id, userId: r.user_id, userName: r.user_name, positionId: r.position_id, positionName: r.position_name, positionEmoji: r.position_emoji || null,
    status: r.status, note: r.note || null, respondedAt: r.responded_at, notifiedAt: r.notified_at, createdAt: r.created_at,
  });

  function list(adminId, eventId) {
    return select.all(adminId, eventId).map(toRow);
  }

  function get(adminId, eventId, id) {
    const row = selectOne.get(id, adminId, eventId);
    return row ? toRow(row) : null;
  }

  // The full list wanted: [{ userId, positionId }]. Existing pairs keep their row (and answer),
  // new ones start pending, missing ones go. Returns { ok, added, removed } or { error }.
  const replace = db.transaction((adminId, eventId, wanted, createdBy) => {
    const seen = new Set();
    for (const w of wanted) {
      if (!Number.isInteger(w.userId) || !Number.isInteger(w.positionId)) return { error: 'badRequest' };
      if (!userOk.get(w.userId, adminId)) return { error: 'userInvalid' };
      if (!positionOk.get(w.positionId, adminId)) return { error: 'positionInvalid' };
      seen.add(`${w.userId}:${w.positionId}`);
    }
    const current = select.all(adminId, eventId);
    let removed = 0;
    for (const row of current) {
      if (!seen.has(`${row.user_id}:${row.position_id}`)) { remove.run(row.id, adminId); removed += 1; }
    }
    const have = new Set(current.map((r) => `${r.user_id}:${r.position_id}`));
    let added = 0;
    const now = Date.now();
    for (const key of seen) {
      if (have.has(key)) continue;
      const [userId, positionId] = key.split(':').map(Number);
      insert.run(eventId, adminId, userId, positionId, createdBy, now);
      added += 1;
    }
    return { ok: true, added, removed };
  });

  // The assigned person's answer. -> the row, or null when not theirs.
  function answer(adminId, eventId, id, userId, status, note) {
    if (!STATUSES.includes(status) || status === 'pending') return null;
    const changed = respond.run(status, note || null, Date.now(), id, adminId, userId).changes > 0;
    return changed ? get(adminId, eventId, id) : null;
  }

  function markSent(adminId, ids, now = Date.now()) {
    for (const id of ids) markNotified.run(now, id, adminId);
  }

  // A copy of another event's / template's team, all pending, not yet notified.
  function copyFrom(adminId, fromEventId, toEventId, createdBy) {
    return copyRows.run(toEventId, createdBy, Date.now(), fromEventId, adminId).changes;
  }

  // This person's rows on an event (the home card, the event page's own row).
  function forUser(adminId, userId, eventId) {
    return forUserEvent.all(adminId, userId, eventId).map((r) => ({ id: r.id, positionId: r.position_id, positionName: r.position_name, positionEmoji: r.position_emoji || null, status: r.status, note: r.note || null }));
  }

  function assignedUserIds(adminId, eventId) {
    return userIds.all(adminId, eventId);
  }

  // "5 confirmați · 1 așteaptă · 1 nu poate"
  function summary(rows) {
    const out = { accepted: 0, pending: 0, declined: 0, total: rows.length };
    for (const r of rows) out[r.status] += 1;
    return out;
  }

  return { list, get, replace, answer, markSent, copyFrom, forUser, assignedUserIds, summary };
}

module.exports = { STATUSES, ASSIGN_ROLES, MAX_NOTE, createAssignmentStore };
