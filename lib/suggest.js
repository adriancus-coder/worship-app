'use strict';

// Random song ideas for a programme ("10 cântări la întâmplare"): songs of the library drawn
// at random, leaving out the songs sung at the last RECENT_EVENTS events before the event's
// date, the songs already in the event (saved, plus any the editor passes as `exclude`),
// and preferring songs with a key set (they are drawn first). Drawn with crypto randomness.

const crypto = require('crypto');

const DEFAULT_COUNT = 10;
const MAX_COUNT = 30;
const RECENT_EVENTS = 3;

function shuffle(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function createSuggestStore(db) {
  const selectSongs = db.prepare(`SELECT s.id, s.title, s.song_key,
      (SELECT COUNT(*) FROM song_sections ss WHERE ss.song_id = s.id AND ss.admin_id = s.admin_id) AS section_count
    FROM songs s WHERE s.admin_id = ?`);
  const selectEventDate = db.prepare('SELECT event_date FROM events WHERE id = ? AND admin_id = ?').pluck();
  const selectRecentEvents = db.prepare(`SELECT id FROM events
    WHERE admin_id = ? AND is_template = 0 AND id != ? AND event_date <= ?
    ORDER BY event_date DESC, id DESC LIMIT ?`).pluck();
  const selectEventSongs = db.prepare('SELECT DISTINCT song_id FROM setlist_items WHERE event_id = ? AND admin_id = ? AND song_id IS NOT NULL').pluck();

  // { songs: [{ id, title, song_key, section_count }], total, left } — `left` is how many
  // songs were eligible (the library minus recent and excluded ones).
  function randomSongs(adminId, { eventId = null, count = DEFAULT_COUNT, recentEvents = RECENT_EVENTS, exclude = [], today } = {}) {
    const n = Math.max(1, Math.min(MAX_COUNT, Number(count) || DEFAULT_COUNT));
    const date = (eventId && selectEventDate.get(eventId, adminId)) || today || '9999-12-31';
    const skip = new Set(exclude.map(Number));
    if (eventId) for (const id of selectEventSongs.all(eventId, adminId)) skip.add(id);
    for (const recentId of selectRecentEvents.all(adminId, eventId || 0, date, recentEvents)) {
      for (const id of selectEventSongs.all(recentId, adminId)) skip.add(id);
    }
    const all = selectSongs.all(adminId);
    const pool = all.filter((s) => !skip.has(s.id));
    const withKey = shuffle(pool.filter((s) => s.song_key));
    const withoutKey = shuffle(pool.filter((s) => !s.song_key));
    return { songs: [...withKey, ...withoutKey].slice(0, n), total: all.length, left: pool.length };
  }

  return { randomSongs };
}

module.exports = { DEFAULT_COUNT, MAX_COUNT, RECENT_EVENTS, shuffle, createSuggestStore };
