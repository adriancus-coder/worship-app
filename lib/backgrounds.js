'use strict';

// Backgrounds behind the text on the projector (images and silent loops from the media
// library). Resolution, first match wins (migration 017):
//   1) the live override (live_state.background_override: a media id, 'none' or NULL)
//   2) the setlist item's background        3) the song's default background
//   4) the church default for the item type 5) none (black)
// Levels 2-4 are resolved here per item of an event; level 1 is applied by the shared
// frame code (public/frames.js), so a page holding the snapshot computes the same frame.
// "none" at a level stops the lookup (explicitly no background); a missing or deleted
// media item falls through to the next level.

const { createAdminSettings } = require('./admin-settings');

// Which church default an item type uses (titles such as a sermon share the announcements').
const DEFAULT_OF_TYPE = { song: 'song', verse: 'verse', announcement: 'announcement', sermon: 'announcement', other: 'announcement' };
const DEFAULT_KEYS = { song: 'background_default_song', verse: 'background_default_verse', announcement: 'background_default_announcement' };
const READABILITY = {
  dim: { min: 0, max: 80, fallback: 45 },
  blur: { min: 0, max: 20, fallback: 0 },
};

// A background choice from a request body: undefined (not given), null (inherit), 'none'
// or a positive integer media id. Returns { value } or { error: true }.
function parseChoice(value) {
  if (value === undefined) return { value: undefined };
  if (value === null || value === '') return { value: null };
  if (value === 'none') return { value: 'none' };
  if (/^\d{1,15}$/.test(String(value))) return { value: Number(value) };
  return { error: true };
}

// Stored columns <-> the API form (null | 'none' | id).
const toColumns = (choice) => ({ mediaId: typeof choice === 'number' ? choice : null, none: choice === 'none' ? 1 : 0 });
const fromColumns = (mediaId, none) => (none ? 'none' : mediaId || null);

// { dim, blur, shadow } from a request body, each optional; { error } when out of range.
function parseReadability(body) {
  const out = {};
  for (const key of ['dim', 'blur']) {
    if (body[key] === undefined) continue;
    const n = Number(body[key]);
    const { min, max } = READABILITY[key];
    if (!Number.isInteger(n) || n < min || n > max) return { error: key };
    out[key] = n;
  }
  if (body.shadow !== undefined) {
    if (typeof body.shadow !== 'boolean') return { error: 'shadow' };
    out.shadow = body.shadow;
  }
  return { value: out };
}

function createBackgroundStore(db, signer) {
  const settings = createAdminSettings(db);
  const selectMedia = db.prepare(`SELECT id, kind, title, bg_dim, bg_blur, bg_shadow FROM media
    WHERE id = ? AND admin_id = ? AND kind IN ('image', 'loop')`);
  const selectItems = db.prepare(`SELECT i.id, i.type, i.background_media_id AS item_bg, i.background_none AS item_none,
      s.background_media_id AS song_bg, s.background_none AS song_none
    FROM setlist_items i LEFT JOIN songs s ON s.id = i.song_id AND s.admin_id = i.admin_id
    WHERE i.event_id = ? AND i.admin_id = ?`);
  const selectSong = db.prepare('SELECT background_media_id, background_none FROM songs WHERE id = ? AND admin_id = ?');
  const updateSong = db.prepare('UPDATE songs SET background_media_id = ?, background_none = ? WHERE id = ? AND admin_id = ?');
  const updateReadability = db.prepare(`UPDATE media SET bg_dim = COALESCE(@dim, bg_dim), bg_blur = COALESCE(@blur, bg_blur),
      bg_shadow = COALESCE(@shadow, bg_shadow) WHERE id = @id AND admin_id = @adminId AND kind IN ('image', 'loop')`);

  // The media row of a background of this admin, or null (unknown, deleted, not a background).
  function find(adminId, id) {
    if (!Number.isInteger(id)) return null;
    return selectMedia.get(id, adminId) || null;
  }

  // What the projector needs to show a background: { kind, url, dim, blur, shadow }.
  function describe(adminId, row) {
    return {
      id: row.id,
      kind: row.kind,
      url: signer.url(adminId, row.id, Date.now(), row.kind === 'image' ? 'display' : 'original'),
      dim: row.bg_dim,
      blur: row.bg_blur,
      shadow: Boolean(row.bg_shadow),
    };
  }

  // The church defaults: { song, verse, announcement } -> media id or null.
  function defaults(adminId) {
    const out = {};
    for (const [type, key] of Object.entries(DEFAULT_KEYS)) {
      const id = Number(settings.get(adminId, key));
      out[type] = Number.isInteger(id) && id > 0 ? id : null;
    }
    return out;
  }

  function setDefaults(adminId, values) {
    for (const [type, value] of Object.entries(values)) {
      if (DEFAULT_KEYS[type]) settings.set(adminId, DEFAULT_KEYS[type], value === null ? '' : String(value));
    }
  }

  // Levels 2-4 for one row; returns a media id or null. `levels` (optional) records which
  // level decided ('item' | 'song' | 'church' | null) for the editor's "Implicit (…)".
  function resolveRow(adminId, row, churchDefaults, withSong = true) {
    if (row.item_none) return { id: null, level: 'item' };
    if (find(adminId, row.item_bg)) return { id: row.item_bg, level: 'item' };
    return inherited(adminId, row, churchDefaults, withSong);
  }

  // What applies without the item's own choice (levels 3-4).
  function inherited(adminId, row, churchDefaults, withSong = true) {
    if (withSong && row.type === 'song') {
      if (row.song_none) return { id: null, level: 'song' };
      if (find(adminId, row.song_bg)) return { id: row.song_bg, level: 'song' };
    }
    const church = churchDefaults[DEFAULT_OF_TYPE[row.type]];
    if (find(adminId, church)) return { id: church, level: 'church' };
    return { id: null, level: null };
  }

  // For the frames of an event: { items: { itemId: mediaId | null }, media: { id: {...} },
  // inherited: { itemId: { id, level } } } — media holds every background an item uses plus
  // the override, if any, and the church defaults (so an override to any of them works offline).
  function forEvent(adminId, eventId, override = null) {
    const churchDefaults = defaults(adminId);
    const items = {};
    const inheritedOf = {};
    const used = new Set(Object.values(churchDefaults).filter(Boolean));
    for (const row of selectItems.all(eventId, adminId)) {
      const own = resolveRow(adminId, row, churchDefaults);
      items[row.id] = own.id;
      inheritedOf[row.id] = inherited(adminId, row, churchDefaults);
      if (own.id) used.add(own.id);
      if (inheritedOf[row.id].id) used.add(inheritedOf[row.id].id);
    }
    const overrideId = Number(override);
    if (Number.isInteger(overrideId) && overrideId > 0) used.add(overrideId);
    const media = {};
    for (const id of used) {
      const row = find(adminId, id);
      if (row) media[id] = describe(adminId, row);
    }
    return { items, media, inherited: inheritedOf };
  }

  function songBackground(adminId, songId) {
    const row = selectSong.get(songId, adminId);
    return row ? fromColumns(row.background_media_id, row.background_none) : undefined;
  }

  function setSongBackground(adminId, songId, choice) {
    const { mediaId, none } = toColumns(choice);
    return updateSong.run(mediaId, none, songId, adminId).changes > 0;
  }

  function setReadability(adminId, id, values) {
    return updateReadability.run({
      id, adminId,
      dim: values.dim === undefined ? null : values.dim,
      blur: values.blur === undefined ? null : values.blur,
      shadow: values.shadow === undefined ? null : (values.shadow ? 1 : 0),
    }).changes > 0;
  }

  return { find, describe, defaults, setDefaults, forEvent, songBackground, setSongBackground, setReadability };
}

module.exports = { DEFAULT_OF_TYPE, DEFAULT_KEYS, READABILITY, parseChoice, parseReadability, toColumns, fromColumns, createBackgroundStore };
