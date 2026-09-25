'use strict';

// Events and setlists: validation and storage. Every query is scoped by admin_id.

const { isValidDate, isValidTime } = require('./dates');
const { keyAfter, transposeContent } = require('./chords');
const { parseArrangement, defaultArrangement, sectionCodes, sectionLabels } = require('./sections');

const ITEM_TYPES = ['song', 'verse', 'video', 'announcement', 'sermon', 'other'];
const VISIBLE_TO_TEAM = ['published', 'live', 'finished'];
// The roles with full rights over events: create, edit, publish, templates, delete, start,
// end and run them live. The single place that says so (public/page.js mirrors it for the
// pages). The library, media, screens, team and settings keep their own rules.
const EVENT_ROLES = ['owner', 'leader', 'operator'];
const LIMITS = {
  nameMax: 120,
  notesMax: 2000,
  itemsMax: 60,
  titleMax: 200,
  bodyMax: 5000,
  referenceMax: 100,
  urlMax: 500,
  durationMax: 600,
  transposeMax: 11,
  arrangementMax: 200,
  teamNoteMax: 500,
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

const SONG_OPTION_KEYS = ['transpose', 'arrangement', 'teamNote', 'referenceUrl'];

function present(value) {
  return value !== undefined && value !== null && value !== '';
}

// Song options of one item -> { value } or { error }. song: { sections } or null (deleted).
function validateSongOptions(item, n, t, song) {
  let transpose = 0;
  if (present(item.transpose)) {
    const v = Number(item.transpose);
    if (!Number.isInteger(v) || Math.abs(v) > LIMITS.transposeMax) {
      return { error: t('errors.itemTransposeInvalid', { n, max: LIMITS.transposeMax }) };
    }
    transpose = v;
  }
  const arrangementText = text(item.arrangement);
  if (arrangementText === null || arrangementText.length > LIMITS.arrangementMax) {
    return { error: t('errors.itemArrangementTooLong', { n, max: LIMITS.arrangementMax }) };
  }
  let arrangement = null;
  if (arrangementText && song) {
    const parsed = parseArrangement(arrangementText, song.sections);
    if (parsed.unknown.length) return { error: t('errors.itemArrangementUnknown', { n, codes: parsed.unknown.join(', ') }) };
    arrangement = parsed.codes.join(' ') || null;
  } else if (arrangementText) {
    arrangement = arrangementText; // deleted song: nothing to check against, kept as it was
  }
  const teamNote = text(item.teamNote);
  if (teamNote === null || teamNote.length > LIMITS.teamNoteMax) {
    return { error: t('errors.itemTeamNoteTooLong', { n, max: LIMITS.teamNoteMax }) };
  }
  const referenceUrl = text(item.referenceUrl);
  if (referenceUrl === null || (referenceUrl && (referenceUrl.length > LIMITS.urlMax || !httpsUrl(referenceUrl)))) {
    return { error: t('errors.itemReferenceUrlInvalid', { n, max: LIMITS.urlMax }) };
  }
  return { value: { transpose, arrangement, teamNote: teamNote || null, referenceUrl: referenceUrl || null } };
}

// items: [{ id?, type, songId, mediaId (video), title, body, reference, url, durationMin,
//           song items only: transpose, arrangement, teamNote, referenceUrl }]
// id: an existing item of the event keeps its id when saved again (live mode follows
// items by id); anything else becomes a new item.
// findSong(id) -> { id, title, sections: [{ type }] } of a song of the same admin, or null.
// findMedia(id) -> { id, title } of a media library entry of the same admin, or null.
// Returns { value: [clean items] } or { error }.
function validateItems(items, t, findSong, findMedia = () => null) {
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

    const out = {
      id: Number.isInteger(item.id) && item.id > 0 ? item.id : null,
      type: item.type, songId: null, mediaId: null, title: null, body: null, reference: null, url: null, durationMin,
      transpose: 0, arrangement: null, teamNote: null, referenceUrl: null,
    };
    if (item.type !== 'song' && SONG_OPTION_KEYS.some((key) => present(item[key]))) {
      return { error: t('errors.itemSongOnlyField', { n }) };
    }
    if (item.type === 'song') {
      const hasId = present(item.songId);
      let song = null;
      if (hasId) {
        song = /^\d{1,15}$/.test(String(item.songId)) ? findSong(Number(item.songId)) : null;
        if (!song) return { error: t('errors.itemSongInvalid', { n }) };
        out.songId = song.id;
        out.title = song.title;
      } else if (title) {
        out.title = title; // a song that was deleted from the library: kept by its cached title
      } else {
        return { error: t('errors.itemSongInvalid', { n }) };
      }
      const options = validateSongOptions(item, n, t, song);
      if (options.error) return options;
      Object.assign(out, options.value);
    } else if (item.type === 'verse') {
      if (!reference && !body) return { error: t('errors.itemEmpty', { n }) };
      Object.assign(out, { reference: reference || null, body: body || null });
    } else if (item.type === 'video') {
      // A video from the media library, or (older items) a raw https link.
      if (present(item.mediaId)) {
        const found = /^\d{1,15}$/.test(String(item.mediaId)) ? findMedia(Number(item.mediaId)) : null;
        if (!found) return { error: t('errors.itemMediaInvalid', { n }) };
        Object.assign(out, { title: title || found.title, mediaId: found.id, url: null });
      } else {
        if (!url) return { error: t('errors.itemUrlInvalid', { n, max: LIMITS.urlMax }) };
        Object.assign(out, { title: title || null, url });
      }
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

// Song options as the API returns them. song: { song_key, presentation, sections } or null.
// Stored codes that no longer resolve (the song was edited) are skipped and reported in
// arrangementWarnings; if none resolve, the default arrangement is used.
function songOptions(row, song, t) {
  const transpose = row.transpose || 0;
  const base = { transpose, teamNote: row.team_note, referenceUrl: row.reference_url };
  if (!song) {
    return { ...base, displayKey: null, arrangement: row.arrangement, arrangementIsDefault: !row.arrangement, arrangementResolved: [], arrangementWarnings: [] };
  }
  const defaults = defaultArrangement({ presentation: song.presentation, sections: song.sections });
  let codes = defaults;
  let isDefault = !row.arrangement;
  let warnings = [];
  if (row.arrangement) {
    const parsed = parseArrangement(row.arrangement, song.sections);
    warnings = parsed.unknown;
    if (parsed.codes.length) codes = parsed.codes;
    else isDefault = true;
  }
  const canonical = sectionCodes(song.sections);
  const labels = sectionLabels(song.sections, t);
  return {
    ...base,
    displayKey: keyAfter(song.song_key, transpose),
    arrangement: isDefault ? defaults.join(' ') : row.arrangement,
    arrangementIsDefault: isDefault,
    arrangementResolved: codes.map((code) => {
      const index = canonical.indexOf(code);
      return { code, label: labels[index], sectionId: song.sections[index].id };
    }),
    arrangementWarnings: warnings,
  };
}

function toItem(row, song, t) {
  const songDeleted = row.type === 'song' && row.song_id === null;
  const options = row.type === 'song' ? songOptions(row, song, t) : null;
  return {
    id: row.id,
    position: row.position,
    type: row.type,
    songId: row.song_id,
    title: row.type === 'song' && row.song_title ? row.song_title : row.title,
    body: row.body,
    reference: row.reference,
    url: row.url,
    mediaId: row.media_id,
    media: row.media_id !== null && row.media_title !== null ? { id: row.media_id, title: row.media_title, kind: row.media_kind } : null,
    durationMin: row.duration_min,
    song: row.type === 'song' && row.song_id !== null
      ? { id: row.song_id, title: row.song_title, key: row.song_key, sectionCount: row.section_count }
      : null,
    songDeleted,
    // 'shared' (the setlist everyone sees) or 'projector' (an operator addition for the
    // projector only).
    scope: row.scope,
    ...options,
  };
}

const EVENT_COLUMNS = `e.id, e.name, e.event_date, e.start_time, e.status, e.is_template, e.notes,
  e.created_at, e.updated_at,
  (SELECT COUNT(*) FROM setlist_items i WHERE i.event_id = e.id AND i.admin_id = e.admin_id AND i.scope = 'shared') AS item_count,
  (SELECT COALESCE(SUM(i.duration_min), 0) FROM setlist_items i
    WHERE i.event_id = e.id AND i.admin_id = e.admin_id AND i.scope = 'shared') AS total_duration`;

function createEventStore(db) {
  const selectEvent = db.prepare(`SELECT ${EVENT_COLUMNS} FROM events e WHERE e.id = ? AND e.admin_id = ?`);
  // scope 'shared': the setlist everyone sees; 'all': with the operator's projector-only items.
  const itemsQuery = (onlyShared) => db.prepare(`SELECT i.id, i.position, i.type, i.song_id, i.title, i.body, i.reference, i.url,
      i.duration_min, i.transpose, i.arrangement, i.team_note, i.reference_url, i.media_id,
      i.scope,
      m.title AS media_title, m.kind AS media_kind,
      s.title AS song_title, s.song_key, s.presentation,
      (SELECT COUNT(*) FROM song_sections ss WHERE ss.song_id = s.id AND ss.admin_id = s.admin_id) AS section_count
    FROM setlist_items i
    LEFT JOIN songs s ON s.id = i.song_id AND s.admin_id = i.admin_id
    LEFT JOIN media m ON m.id = i.media_id AND m.admin_id = i.admin_id
    WHERE i.event_id = ? AND i.admin_id = ?${onlyShared ? " AND i.scope = 'shared'" : ''}
    ORDER BY i.position, i.id`);
  const selectItems = { shared: itemsQuery(true), all: itemsQuery(false) };
  const insertEvent = db.prepare(`INSERT INTO events
    (admin_id, name, event_date, start_time, status, is_template, notes, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`);
  const updateEvent = db.prepare(`UPDATE events SET name = ?, event_date = ?, start_time = ?, notes = ?, updated_at = ?
    WHERE id = ? AND admin_id = ?`);
  const touchEvent = db.prepare('UPDATE events SET updated_at = ? WHERE id = ? AND admin_id = ?');
  const setStatusStmt = db.prepare('UPDATE events SET status = ?, updated_at = ? WHERE id = ? AND admin_id = ?');
  const deleteEvent = db.prepare('DELETE FROM events WHERE id = ? AND admin_id = ?');
  const selectOrder = db.prepare('SELECT id, scope FROM setlist_items WHERE event_id = ? AND admin_id = ? ORDER BY position, id');
  const setPosition = db.prepare('UPDATE setlist_items SET position = ? WHERE id = ? AND event_id = ? AND admin_id = ?');
  const insertOperatorItem = db.prepare(`INSERT INTO setlist_items
    (event_id, admin_id, position, type, song_id, title, body, reference, url, duration_min,
      transpose, arrangement, team_note, reference_url, media_id, scope)
    VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, NULL, ?)`);
  const deleteItem = db.prepare('DELETE FROM setlist_items WHERE id = ? AND event_id = ? AND admin_id = ?');
  const updateItem = db.prepare(`UPDATE setlist_items SET position = ?, type = ?, song_id = ?, title = ?, body = ?,
      reference = ?, url = ?, duration_min = ?, transpose = ?, arrangement = ?, team_note = ?, reference_url = ?,
      media_id = ?
    WHERE id = ? AND event_id = ? AND admin_id = ?`);
  const insertItem = db.prepare(`INSERT INTO setlist_items
    (event_id, admin_id, position, type, song_id, title, body, reference, url, duration_min,
      transpose, arrangement, team_note, reference_url, media_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const selectSongSections = db.prepare(`SELECT id, position, type, label, content, note
    FROM song_sections WHERE song_id = ? AND admin_id = ? ORDER BY position`);
  const selectSongFull = db.prepare(`SELECT id, title, author, song_key, presentation
    FROM songs WHERE id = ? AND admin_id = ?`);
  const copyItems = db.prepare(`INSERT INTO setlist_items
    (event_id, admin_id, position, type, song_id, title, body, reference, url, duration_min,
      transpose, arrangement, team_note, reference_url, media_id)
    SELECT ?, admin_id, position, type, song_id, title, body, reference, url, duration_min,
      transpose, arrangement, team_note, reference_url, media_id
    FROM setlist_items WHERE event_id = ? AND admin_id = ? AND scope = 'shared' ORDER BY position`);
  const selectSongRef = db.prepare('SELECT id, title FROM songs WHERE id = ? AND admin_id = ?');
  const selectMediaRef = db.prepare(`SELECT id, title FROM media WHERE id = ? AND admin_id = ? AND kind IN ('upload', 'url')`);
  const historyRows = db.prepare(`SELECT DISTINCT e.id AS event_id, e.name, e.event_date, e.status
    FROM setlist_items i JOIN events e ON e.id = i.event_id AND e.admin_id = i.admin_id
    WHERE i.admin_id = ? AND i.song_id = ? AND i.scope = 'shared' AND e.is_template = 0
      AND e.status IN ('published', 'live', 'finished')
    ORDER BY e.event_date DESC, e.id DESC LIMIT 20`);
  const lastSungRows = db.prepare(`SELECT i.song_id, MAX(e.event_date) AS last_date
    FROM setlist_items i JOIN events e ON e.id = i.event_id AND e.admin_id = i.admin_id
    WHERE i.admin_id = ? AND i.song_id IS NOT NULL AND i.scope = 'shared' AND e.is_template = 0
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
  // t labels the arrangement's sections (the request's language). scope 'shared' (default):
  // the setlist everyone sees; 'all' adds the operator's projector-only items.
  function get(adminId, id, { teamOnly = false, t = (key) => key, scope = 'shared' } = {}) {
    const row = selectEvent.get(id, adminId);
    if (!row) return null;
    if (teamOnly && (row.is_template || !VISIBLE_TO_TEAM.includes(row.status))) return null;
    const sectionsBySong = new Map();
    const items = selectItems[scope === 'all' ? 'all' : 'shared'].all(id, adminId).map((item) => {
      let song = null;
      if (item.type === 'song' && item.song_id !== null) {
        if (!sectionsBySong.has(item.song_id)) sectionsBySong.set(item.song_id, selectSongSections.all(item.song_id, adminId));
        song = { song_key: item.song_key, presentation: item.presentation, sections: sectionsBySong.get(item.song_id) };
      }
      return toItem(item, song, t);
    });
    return { event: toEvent(row), items };
  }

  // { id, title } of a media library entry of this admin, or null (used to validate items).
  function findMedia(adminId, mediaId) {
    return selectMediaRef.get(mediaId, adminId) || null;
  }

  // { id, title, sections } of a song of this admin, or null (used to validate items).
  function findSong(adminId, songId) {
    const song = selectSongRef.get(songId, adminId);
    return song ? { ...song, sections: selectSongSections.all(songId, adminId) } : null;
  }

  // A song item ready to render: sections transposed, arrangement resolved. null when the
  // item is not a song item of this event or its song was deleted.
  function itemSong(adminId, eventId, itemId, t, { scope = 'shared' } = {}) {
    const found = get(adminId, eventId, { t, scope });
    const item = found && found.items.find((i) => i.id === itemId);
    if (!item || item.type !== 'song' || !item.songId) return null;
    const song = selectSongFull.get(item.songId, adminId);
    if (!song) return null;
    const codes = sectionCodes(selectSongSections.all(item.songId, adminId));
    const sections = selectSongSections.all(item.songId, adminId).map((s, i) => ({
      ...s,
      code: codes[i],
      content: transposeContent(s.content, item.transpose, item.displayKey),
    }));
    return {
      item,
      song: {
        id: song.id,
        title: song.title,
        author: song.author,
        originalKey: song.song_key,
        key: item.displayKey,
        transpose: item.transpose,
        sections,
        arrangement: item.arrangementResolved,
      },
    };
  }

  // Writes positions 0..n-1 in the order of ids.
  function renumber(adminId, eventId, ids) {
    ids.forEach((id, position) => setPosition.run(position, id, eventId, adminId));
  }

  // The shared setlist as the editor saves it. Items that name an existing shared item of
  // this event (once) are updated in place and keep their id; the others are inserted;
  // shared items no longer listed are deleted. The operator's projector-only items are left
  // untouched and keep their place after the shared item they followed.
  function writeItems(adminId, eventId, items) {
    const order = selectOrder.all(eventId, adminId);
    const existing = new Set(order.filter((r) => r.scope === 'shared').map((r) => r.id));
    // projector-only item -> the shared item before it (null: at the start)
    const after = new Map();
    let previous = null;
    for (const row of order) {
      if (row.scope === 'shared') previous = row.id;
      else after.set(row.id, previous);
    }
    const kept = new Set();
    const keepId = items.map((it) => {
      if (!it.id || !existing.has(it.id) || kept.has(it.id)) return null;
      kept.add(it.id);
      return it.id;
    });
    for (const id of existing) if (!kept.has(id)) deleteItem.run(id, eventId, adminId);
    const sharedIds = items.map((it, position) => {
      const values = [position, it.type, it.songId, it.title, it.body, it.reference, it.url, it.durationMin,
        it.transpose || 0, it.arrangement, it.teamNote, it.referenceUrl, it.mediaId || null];
      if (keepId[position]) {
        updateItem.run(...values, keepId[position], eventId, adminId);
        return keepId[position];
      }
      return Number(insertItem.run(eventId, adminId, ...values).lastInsertRowid);
    });
    if (after.size === 0) return;
    // An anchor that was deleted: the nearest shared item before it that still exists.
    const oldShared = order.filter((r) => r.scope === 'shared').map((r) => r.id);
    const survive = (id) => {
      for (let i = oldShared.indexOf(id); i >= 0; i--) if (kept.has(oldShared[i])) return oldShared[i];
      return null;
    };
    const groups = new Map();
    for (const [id, anchor] of after) {
      const key = anchor === null ? null : survive(anchor);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(id);
    }
    renumber(adminId, eventId, [...(groups.get(null) || []), ...sharedIds.flatMap((id) => [id, ...(groups.get(id) || [])])]);
  }

  // --- operator additions (live, stage 6) ----------------------------------------------

  // An item added during live (song / verse / announcement, validated) right after afterId
  // (or at the end). scope 'projector': for the projector only; 'shared': in the setlist
  // everyone sees. Returns its id.
  function addOperatorItem(adminId, eventId, it, afterId, scope) {
    const id = Number(insertOperatorItem.run(eventId, adminId, it.type, it.songId, it.title, it.body, it.reference, it.url,
      it.durationMin, scope).lastInsertRowid);
    moveAfter(adminId, eventId, id, afterId);
    return id;
  }

  // Moves an item right after afterId (null: to the end).
  function moveAfter(adminId, eventId, itemId, afterId) {
    const ids = selectOrder.all(eventId, adminId).map((r) => r.id).filter((id) => id !== itemId);
    const at = afterId === null ? -1 : ids.indexOf(afterId);
    if (at < 0) ids.push(itemId);
    else ids.splice(at + 1, 0, itemId);
    renumber(adminId, eventId, ids);
  }

  // The last shared item of the event, or null.
  function lastShared(adminId, eventId) {
    const shared = selectOrder.all(eventId, adminId).filter((r) => r.scope === 'shared');
    return shared.length ? shared[shared.length - 1].id : null;
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

  return {
    list, get, findSong, findMedia, itemSong, create, updateMeta, replaceItems, setStatus, remove, songHistory, lastSungMap,
    addOperatorItem, moveAfter, lastShared,
  };
}

module.exports = { ITEM_TYPES, VISIBLE_TO_TEAM, EVENT_ROLES, LIMITS, validateEventMeta, validateItems, createEventStore };
