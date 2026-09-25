'use strict';

// Events and setlists: validation and storage. Every query is scoped by admin_id.

const { isValidDate, isValidTime } = require('./dates');

const ITEM_TYPES = ['song', 'verse', 'video', 'announcement', 'sermon', 'other'];
const VISIBLE_TO_TEAM = ['published', 'live', 'finished'];
const LIMITS = {
  nameMax: 120,
  notesMax: 2000,
  itemsMax: 60,
  titleMax: 200,
  bodyMax: 5000,
  referenceMax: 100,
  urlMax: 500,
  durationMax: 600,
};

function text(value) {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value.trim() : null;
}

// Returns { value: { name, eventDate, startTime, notes } } or { error }.
function validateEventMeta(body, t) {
  const input = body && typeof body === 'object' ? body : {};
  const name = text(input.name);
  if (!name || name.length > LIMITS.nameMax) return { error: t('errors.eventNameInvalid', { max: LIMITS.nameMax }) };
  if (!isValidDate(input.eventDate)) return { error: t('errors.eventDateInvalid') };
  const startTime = text(input.startTime);
  if (startTime === null || (startTime && !isValidTime(startTime))) return { error: t('errors.eventTimeInvalid') };
  const notes = text(input.notes);
  if (notes === null || notes.length > LIMITS.notesMax) return { error: t('errors.eventNotesTooLong', { max: LIMITS.notesMax }) };
  return { value: { name, eventDate: input.eventDate, startTime: startTime || null, notes: notes || null } };
}

function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch (err) {
    return false;
  }
}

// items: [{ type, songId, title, body, reference, url, durationMin }]
// findSong(id) -> { id, title } of a song of the same admin, or null.
// Returns { value: [clean items] } or { error }.
function validateItems(items, t, findSong) {
  if (!Array.isArray(items)) return { error: t('errors.badRequest') };
  if (items.length > LIMITS.itemsMax) return { error: t('errors.eventItemsTooMany', { max: LIMITS.itemsMax }) };

  const clean = [];
  for (let i = 0; i < items.length; i++) {
    const n = i + 1;
    const item = items[i] && typeof items[i] === 'object' ? items[i] : {};
    if (!ITEM_TYPES.includes(item.type)) return { error: t('errors.itemTypeInvalid', { n }) };

    const title = text(item.title);
    const body = text(item.body);
    const reference = text(item.reference);
    const url = text(item.url);
    if (title === null || title.length > LIMITS.titleMax) return { error: t('errors.itemTitleTooLong', { n, max: LIMITS.titleMax }) };
    if (body === null || body.length > LIMITS.bodyMax) return { error: t('errors.itemBodyTooLong', { n, max: LIMITS.bodyMax }) };
    if (reference === null || reference.length > LIMITS.referenceMax) {
      return { error: t('errors.itemReferenceTooLong', { n, max: LIMITS.referenceMax }) };
    }
    if (url === null || (url && (url.length > LIMITS.urlMax || !httpsUrl(url)))) {
      return { error: t('errors.itemUrlInvalid', { n, max: LIMITS.urlMax }) };
    }

    let durationMin = null;
    if (item.durationMin !== undefined && item.durationMin !== null && item.durationMin !== '') {
      const d = Number(item.durationMin);
      if (!Number.isInteger(d) || d < 0 || d > LIMITS.durationMax) {
        return { error: t('errors.itemDurationInvalid', { n, max: LIMITS.durationMax }) };
      }
      durationMin = d;
    }

    const out = { type: item.type, songId: null, title: null, body: null, reference: null, url: null, durationMin };
    if (item.type === 'song') {
      const hasId = item.songId !== undefined && item.songId !== null && item.songId !== '';
      if (hasId) {
        const song = /^\d{1,15}$/.test(String(item.songId)) ? findSong(Number(item.songId)) : null;
        if (!song) return { error: t('errors.itemSongInvalid', { n }) };
        out.songId = song.id;
        out.title = song.title;
      } else if (title) {
        out.title = title; // a song that was deleted from the library: kept by its cached title
      } else {
        return { error: t('errors.itemSongInvalid', { n }) };
      }
    } else if (item.type === 'verse') {
      if (!reference && !body) return { error: t('errors.itemEmpty', { n }) };
      Object.assign(out, { reference: reference || null, body: body || null });
    } else if (item.type === 'video') {
      if (!url) return { error: t('errors.itemUrlInvalid', { n, max: LIMITS.urlMax }) };
      Object.assign(out, { title: title || null, url });
    } else {
      if (!title && !body) return { error: t('errors.itemEmpty', { n }) };
      Object.assign(out, { title: title || null, body: body || null });
    }
    clean.push(out);
  }
  return { value: clean };
}

function toEvent(row) {
  return {
    id: row.id,
    name: row.name,
    eventDate: row.event_date,
    startTime: row.start_time,
    status: row.status,
    isTemplate: Boolean(row.is_template),
    notes: row.notes,
    itemCount: row.item_count || 0,
    totalDurationMin: row.total_duration || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toItem(row) {
  const songDeleted = row.type === 'song' && row.song_id === null;
  return {
    id: row.id,
    position: row.position,
    type: row.type,
    songId: row.song_id,
    title: row.type === 'song' && row.song_title ? row.song_title : row.title,
    body: row.body,
    reference: row.reference,
    url: row.url,
    durationMin: row.duration_min,
    song: row.type === 'song' && row.song_id !== null
      ? { id: row.song_id, title: row.song_title, key: row.song_key, sectionCount: row.section_count }
      : null,
    songDeleted,
  };
}

const EVENT_COLUMNS = `e.id, e.name, e.event_date, e.start_time, e.status, e.is_template, e.notes,
  e.created_at, e.updated_at,
  (SELECT COUNT(*) FROM setlist_items i WHERE i.event_id = e.id AND i.admin_id = e.admin_id) AS item_count,
  (SELECT COALESCE(SUM(i.duration_min), 0) FROM setlist_items i WHERE i.event_id = e.id AND i.admin_id = e.admin_id) AS total_duration`;

function createEventStore(db) {
  const selectEvent = db.prepare(`SELECT ${EVENT_COLUMNS} FROM events e WHERE e.id = ? AND e.admin_id = ?`);
  const selectItems = db.prepare(`SELECT i.id, i.position, i.type, i.song_id, i.title, i.body, i.reference, i.url,
      i.duration_min, s.title AS song_title, s.song_key,
      (SELECT COUNT(*) FROM song_sections ss WHERE ss.song_id = s.id AND ss.admin_id = s.admin_id) AS section_count
    FROM setlist_items i
    LEFT JOIN songs s ON s.id = i.song_id AND s.admin_id = i.admin_id
    WHERE i.event_id = ? AND i.admin_id = ?
    ORDER BY i.position`);
  const insertEvent = db.prepare(`INSERT INTO events
    (admin_id, name, event_date, start_time, status, is_template, notes, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`);
  const updateEvent = db.prepare(`UPDATE events SET name = ?, event_date = ?, start_time = ?, notes = ?, updated_at = ?
    WHERE id = ? AND admin_id = ?`);
  const touchEvent = db.prepare('UPDATE events SET updated_at = ? WHERE id = ? AND admin_id = ?');
  const setStatusStmt = db.prepare('UPDATE events SET status = ?, updated_at = ? WHERE id = ? AND admin_id = ?');
  const deleteEvent = db.prepare('DELETE FROM events WHERE id = ? AND admin_id = ?');
  const deleteItems = db.prepare('DELETE FROM setlist_items WHERE event_id = ? AND admin_id = ?');
  const insertItem = db.prepare(`INSERT INTO setlist_items
    (event_id, admin_id, position, type, song_id, title, body, reference, url, duration_min)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const copyItems = db.prepare(`INSERT INTO setlist_items
    (event_id, admin_id, position, type, song_id, title, body, reference, url, duration_min,
      transpose, arrangement, team_note, reference_url)
    SELECT ?, admin_id, position, type, song_id, title, body, reference, url, duration_min,
      transpose, arrangement, team_note, reference_url
    FROM setlist_items WHERE event_id = ? AND admin_id = ? ORDER BY position`);
  const selectSongRef = db.prepare('SELECT id, title FROM songs WHERE id = ? AND admin_id = ?');
  const historyRows = db.prepare(`SELECT DISTINCT e.id AS event_id, e.name, e.event_date, e.status
    FROM setlist_items i JOIN events e ON e.id = i.event_id AND e.admin_id = i.admin_id
    WHERE i.admin_id = ? AND i.song_id = ? AND e.is_template = 0
      AND e.status IN ('published', 'live', 'finished')
    ORDER BY e.event_date DESC, e.id DESC LIMIT 20`);
  const lastSungRows = db.prepare(`SELECT i.song_id, MAX(e.event_date) AS last_date
    FROM setlist_items i JOIN events e ON e.id = i.event_id AND e.admin_id = i.admin_id
    WHERE i.admin_id = ? AND i.song_id IS NOT NULL AND e.is_template = 0
      AND e.status IN ('published', 'live', 'finished') AND e.event_date <= ?
    GROUP BY i.song_id`);

  // when: 'upcoming' (today and later), 'past', 'templates'. teamOnly limits to what the
  // team may see (published/live/finished, never templates).
  function list(adminId, { when, today, teamOnly }) {
    const where = ['e.admin_id = ?'];
    const params = [adminId];
    let order = 'e.event_date ASC, COALESCE(e.start_time, \'\') ASC, e.id ASC';
    if (when === 'templates') {
      where.push('e.is_template = 1');
      order = 'e.name COLLATE NOCASE ASC, e.id ASC';
    } else {
      where.push('e.is_template = 0');
      where.push(when === 'past' ? 'e.event_date < ?' : 'e.event_date >= ?');
      params.push(today);
      if (when === 'past') order = 'e.event_date DESC, COALESCE(e.start_time, \'\') DESC, e.id DESC';
    }
    if (teamOnly) {
      where.push(`e.status IN (${VISIBLE_TO_TEAM.map(() => '?').join(', ')})`);
      params.push(...VISIBLE_TO_TEAM);
    }
    return db.prepare(`SELECT ${EVENT_COLUMNS} FROM events e WHERE ${where.join(' AND ')} ORDER BY ${order}`)
      .all(...params).map(toEvent);
  }

  // null when missing, or when teamOnly and the event is a draft or a template.
  function get(adminId, id, { teamOnly = false } = {}) {
    const row = selectEvent.get(id, adminId);
    if (!row) return null;
    if (teamOnly && (row.is_template || !VISIBLE_TO_TEAM.includes(row.status))) return null;
    return { event: toEvent(row), items: selectItems.all(id, adminId).map(toItem) };
  }

  function findSong(adminId, songId) {
    return selectSongRef.get(songId, adminId) || null;
  }

  function writeItems(adminId, eventId, items) {
    deleteItems.run(eventId, adminId);
    items.forEach((it, position) => {
      insertItem.run(eventId, adminId, position, it.type, it.songId, it.title, it.body, it.reference, it.url, it.durationMin);
    });
  }

  // source: optional event id (same admin) whose items are copied in order.
  const create = db.transaction((adminId, userId, meta, { isTemplate = false, sourceId = null } = {}) => {
    const now = Date.now();
    const id = Number(insertEvent.run(adminId, meta.name, meta.eventDate, meta.startTime, isTemplate ? 1 : 0,
      meta.notes, userId, now, now).lastInsertRowid);
    if (sourceId !== null) copyItems.run(id, sourceId, adminId);
    return id;
  });

  function updateMeta(adminId, id, meta) {
    return updateEvent.run(meta.name, meta.eventDate, meta.startTime, meta.notes, Date.now(), id, adminId).changes > 0;
  }

  const replaceItems = db.transaction((adminId, id, items) => {
    if (!selectEvent.get(id, adminId)) return false;
    writeItems(adminId, id, items);
    touchEvent.run(Date.now(), id, adminId);
    return true;
  });

  function setStatus(adminId, id, status) {
    return setStatusStmt.run(status, Date.now(), id, adminId).changes > 0;
  }

  function remove(adminId, id) {
    return deleteEvent.run(id, adminId).changes > 0;
  }

  // Dates a song was in a published/live/finished (non-template) event, newest first.
  function songHistory(adminId, songId) {
    return historyRows.all(adminId, songId).map((r) => ({ eventId: r.event_id, name: r.name, eventDate: r.event_date, status: r.status }));
  }

  // Map songId -> last date (<= today) the song was in a published/live/finished event.
  function lastSungMap(adminId, today) {
    return new Map(lastSungRows.all(adminId, today).map((r) => [r.song_id, r.last_date]));
  }

  return { list, get, findSong, create, updateMeta, replaceItems, setStatus, remove, songHistory, lastSungMap };
}

module.exports = { ITEM_TYPES, VISIBLE_TO_TEAM, LIMITS, validateEventMeta, validateItems, createEventStore };
