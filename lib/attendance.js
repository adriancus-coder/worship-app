'use strict';

// Participation in an event (migration 049): "Trimite invitația" asks every active person of
// the admin; each answers Vin / Poate / Nu pot (+ a note), and may change it. The leader then
// puts on positions the ones who come (lib/assignments.js: someone who said "Vin" starts
// confirmed there).

const ANSWERS = ['accepted', 'maybe', 'declined'];
const MAX_NOTE = 200;

function createAttendanceStore(db) {
  const select = db.prepare(`SELECT a.*, u.name AS user_name FROM event_attendance a JOIN users u ON u.id = a.user_id
    WHERE a.admin_id = ? AND a.event_id = ? AND u.active = 1 ORDER BY u.name COLLATE NOCASE, a.id`);
  const selectMine = db.prepare('SELECT * FROM event_attendance WHERE admin_id = ? AND event_id = ? AND user_id = ?');
  const activeUsers = db.prepare('SELECT id FROM users WHERE admin_id = ? AND active = 1').pluck();
  const invite = db.prepare(`INSERT INTO event_attendance (event_id, admin_id, user_id, status, invited_at, invited_by, created_at)
    VALUES (?, ?, ?, 'pending', ?, ?, ?) ON CONFLICT(event_id, user_id) DO NOTHING`);
  const reinvite = db.prepare("UPDATE event_attendance SET invited_at = ?, invited_by = ? WHERE admin_id = ? AND event_id = ? AND user_id = ? AND status = 'pending'");
  const upsertAnswer = db.prepare(`INSERT INTO event_attendance (event_id, admin_id, user_id, status, note, responded_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id, user_id) DO UPDATE SET status = excluded.status, note = excluded.note, responded_at = excluded.responded_at`);

  // The invitations still waiting for this person's answer (coming events, not finished):
  // the app's pop-up and the email links.
  const pendingRows = db.prepare(`SELECT a.event_id, e.name, e.event_date, e.start_time FROM event_attendance a
    JOIN events e ON e.id = a.event_id AND e.admin_id = a.admin_id
    WHERE a.admin_id = ? AND a.user_id = ? AND a.status = 'pending' AND a.invited_at IS NOT NULL
      AND e.is_template = 0 AND e.status <> 'finished' AND e.event_date >= ?
    ORDER BY e.event_date, e.start_time, e.id LIMIT 20`);

  const toRow = (r) => ({ id: r.id, userId: r.user_id, userName: r.user_name, status: r.status, note: r.note || null, respondedAt: r.responded_at, invitedAt: r.invited_at });

  function list(adminId, eventId) {
    return select.all(adminId, eventId).map(toRow);
  }

  function mine(adminId, eventId, userId) {
    const r = selectMine.get(adminId, eventId, userId);
    return r ? { status: r.status, note: r.note || null, invitedAt: r.invited_at } : null;
  }

  // "Trimite invitația": every active person not yet invited (reminder: also the ones invited
  // who have not answered). -> the user ids told now.
  const send = db.transaction((adminId, eventId, by, { reminder = false } = {}, now = Date.now()) => {
    const told = [];
    for (const userId of activeUsers.all(adminId)) {
      if (invite.run(eventId, adminId, userId, now, by, now).changes) told.push(userId);
      else if (reminder && reinvite.run(now, by, adminId, eventId, userId).changes) told.push(userId);
    }
    return told;
  });

  // The person's answer (an invitation is not needed to answer). -> the row, or null.
  function answer(adminId, eventId, userId, status, note) {
    if (!ANSWERS.includes(status)) return null;
    upsertAnswer.run(eventId, adminId, userId, status, note ? String(note).slice(0, MAX_NOTE) : null, Date.now(), Date.now());
    return mine(adminId, eventId, userId);
  }

  // "4 vin · 1 poate · 1 nu poate · 3 fără răspuns"; invited: anyone asked yet.
  function summary(rows) {
    const out = { accepted: 0, maybe: 0, declined: 0, pending: 0, total: rows.length };
    for (const r of rows) out[r.status] += 1;
    return out;
  }

  // The status per user id (the position picker).
  function byUser(adminId, eventId) {
    return new Map(list(adminId, eventId).map((r) => [r.userId, r.status]));
  }

  function pendingForUser(adminId, userId, today) {
    return pendingRows.all(adminId, userId, today).map((r) => ({ eventId: r.event_id, eventName: r.name, eventDate: r.event_date, startTime: r.start_time || null }));
  }

  return { list, mine, send, answer, summary, byUser, pendingForUser };
}

module.exports = { ANSWERS, MAX_NOTE, createAttendanceStore };
