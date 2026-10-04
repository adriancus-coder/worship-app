'use strict';

// "Indisponibil": date ranges when a person cannot serve (migration 031). A person manages
// their own; the owner and the leader read everyone's (Echipa, the assignment picker, which
// greys out someone unavailable on the event date and shows the reason).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NOTE = 120;
const MAX_RANGES = 50;

function validateRange(body, t) {
  const from = typeof body.dateFrom === 'string' ? body.dateFrom : '';
  const to = typeof body.dateTo === 'string' && body.dateTo ? body.dateTo : from;
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || Number.isNaN(Date.parse(`${from}T00:00:00Z`)) || Number.isNaN(Date.parse(`${to}T00:00:00Z`)) || to < from) {
    return { error: t('errors.unavailabilityInvalid') };
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, MAX_NOTE) : '';
  return { value: { dateFrom: from, dateTo: to, note } };
}

function createUnavailabilityStore(db) {
  const insert = db.prepare('INSERT INTO unavailability (admin_id, user_id, date_from, date_to, note) VALUES (?, ?, ?, ?, ?)');
  const remove = db.prepare('DELETE FROM unavailability WHERE id = ? AND admin_id = ? AND user_id = ?');
  const ofUser = db.prepare('SELECT * FROM unavailability WHERE admin_id = ? AND user_id = ? AND date_to >= ? ORDER BY date_from, id');
  const countUser = db.prepare('SELECT COUNT(*) FROM unavailability WHERE admin_id = ? AND user_id = ?').pluck();
  const sameRange = db.prepare('SELECT * FROM unavailability WHERE admin_id = ? AND user_id = ? AND date_from = ? AND date_to = ?');
  const onDay = db.prepare('SELECT * FROM unavailability WHERE admin_id = ? AND date_from <= ? AND date_to >= ? ORDER BY user_id, date_from');
  const upcoming = db.prepare('SELECT * FROM unavailability WHERE admin_id = ? AND date_to >= ? ORDER BY user_id, date_from, id');

  const toRange = (r) => ({ id: r.id, userId: r.user_id, dateFrom: r.date_from, dateTo: r.date_to, note: r.note || null });

  // The person's ranges still current (ending today or later).
  function listForUser(adminId, userId, today) {
    return ofUser.all(adminId, userId, today).map(toRange);
  }

  // The same dates again (a double tap): the existing range, flagged { existing: true }.
  function add(adminId, userId, { dateFrom, dateTo, note }) {
    const same = sameRange.get(adminId, userId, dateFrom, dateTo);
    if (same) return { ...toRange(same), existing: true };
    if (countUser.get(adminId, userId) >= MAX_RANGES) return null;
    const id = Number(insert.run(adminId, userId, dateFrom, dateTo, note || null).lastInsertRowid);
    return { id, userId, dateFrom, dateTo, note: note || null };
  }

  function removeOwn(adminId, userId, id) {
    return remove.run(id, adminId, userId).changes > 0;
  }

  // user id -> the range covering `date` (the first one), for the assignment picker.
  function onDate(adminId, date) {
    const out = new Map();
    for (const r of onDay.all(adminId, date, date)) if (!out.has(r.user_id)) out.set(r.user_id, toRange(r));
    return out;
  }

  // user id -> upcoming ranges, for Echipa (owner, leader).
  function byUser(adminId, today) {
    const out = new Map();
    for (const r of upcoming.all(adminId, today)) {
      if (!out.has(r.user_id)) out.set(r.user_id, []);
      out.get(r.user_id).push(toRange(r));
    }
    return out;
  }

  return { listForUser, add, removeOwn, onDate, byUser };
}

module.exports = { MAX_NOTE, MAX_RANGES, validateRange, createUnavailabilityStore };
