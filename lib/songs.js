'use strict';

// Song library: validation, derived fields and storage. Every query is scoped by admin_id.

const crypto = require('crypto');
const { normalizeForSearch, searchSongs } = require('./search');
const { stripChords, chordsOverLyricsToInline } = require('./chords');
const { SECTION_TYPES, SONG_KEYS } = require('./sections');
const keyDetect = require('./key-detect');

const LIMITS = {
  titleMax: 200,
  authorMax: 200,
  sectionsMin: 1,
  sectionsMax: 40,
  contentMax: 5000,
  noteMax: 300,
  labelMax: 60,
  queryMax: 200,
  themesMax: 10,
  themeMax: 40,
};

const KEYS = SONG_KEYS;

// The libraries: the church's and the Sunday school's (migration 060, the 'school' right).
const COLLECTIONS = ['main', 'school'];
const SORT_MODES = ['az', 'za', 'recent'];
const LIBRARY_FORMAT = 'worship-app-library';

class DuplicateTitleError extends Error {
  constructor(existingId) {
    super('duplicate title');
    this.existingId = existingId;
  }
}

// sha256 of the lyrics without chords, whitespace collapsed (identifies a section's text).
function lyricsHash(content) {
  const text = stripChords(content).replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function optionalText(value) {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value.trim() : null;
}

// Returns { value } with a clean song, or { error } with a message from t().
// The sections of a song (or of a song item's own lyrics, lib/events.js): type, label, text
// (chords inline, or chord-over-lyrics lines folded in), note. -> { value: [...] } or { error }.
function validateSections(sections, t) {
  if (!Array.isArray(sections) || sections.length < LIMITS.sectionsMin || sections.length > LIMITS.sectionsMax) {
    return { error: t('errors.songSectionsCount', { min: LIMITS.sectionsMin, max: LIMITS.sectionsMax }) };
  }

  const clean = [];
  for (let i = 0; i < sections.length; i++) {
    const n = i + 1;
    const s = sections[i] && typeof sections[i] === 'object' ? sections[i] : {};
    if (!SECTION_TYPES.includes(s.type)) {
      return { error: t('errors.sectionTypeInvalid', { n }) };
    }
    const label = optionalText(s.label);
    if (label === null || label.length > LIMITS.labelMax) {
      return { error: t('errors.sectionLabelTooLong', { n, max: LIMITS.labelMax }) };
    }
    const raw = typeof s.content === 'string' ? s.content.replace(/\r\n?/g, '\n') : '';
    const content = chordsOverLyricsToInline(raw).replace(/^\n+|\s+$/g, '');
    if (!content.trim() || content.length > LIMITS.contentMax) {
      return { error: t('errors.sectionContentInvalid', { n, max: LIMITS.contentMax }) };
    }
    const note = optionalText(s.note);
    if (note === null || note.length > LIMITS.noteMax) {
      return { error: t('errors.sectionNoteTooLong', { n, max: LIMITS.noteMax }) };
    }
    clean.push({ type: s.type, label: label || null, content, note: note || null });
  }
  return { value: clean };
}

// The themes of a song ("tematică": Paști, închinare…): an array of strings or one string
// with commas; trimmed, empty ones dropped, duplicates (same normalized form) merged, at
// most LIMITS.themesMax, each at most LIMITS.themeMax characters. { value } or { error }.
function validateThemes(input, t) {
  if (input === undefined || input === null) return { value: [] };
  const list = Array.isArray(input) ? input : (typeof input === 'string' ? input.split(/[,;\n]/) : null);
  if (!list) return { error: t('errors.songThemesInvalid', { max: LIMITS.themesMax, len: LIMITS.themeMax }) };
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (typeof raw !== 'string') return { error: t('errors.songThemesInvalid', { max: LIMITS.themesMax, len: LIMITS.themeMax }) };
    const name = raw.trim().replace(/\s+/g, ' ');
    if (!name) continue;
    const norm = normalizeForSearch(name);
    if (!norm || seen.has(norm)) continue;
    if (name.length > LIMITS.themeMax) return { error: t('errors.songThemesInvalid', { max: LIMITS.themesMax, len: LIMITS.themeMax }) };
    seen.add(norm);
    out.push({ name, norm });
  }
  if (out.length > LIMITS.themesMax) return { error: t('errors.songThemesInvalid', { max: LIMITS.themesMax, len: LIMITS.themeMax }) };
  return { value: out };
}

function validateSong(body, t) {
  const input = body && typeof body === 'object' ? body : {};
  const title = optionalText(input.title);
  if (!title || title.length > LIMITS.titleMax) {
    return { error: t('errors.songTitleInvalid', { max: LIMITS.titleMax }) };
  }
  const author = optionalText(input.author);
  if (author === null || author.length > LIMITS.authorMax) {
    return { error: t('errors.songAuthorTooLong', { max: LIMITS.authorMax }) };
  }
  const songKey = optionalText(input.song_key);
  if (songKey === null || (songKey && !KEYS.includes(songKey))) {
    return { error: t('errors.songKeyInvalid') };
  }
  const checked = validateSections(input.sections, t);
  if (checked.error) return checked;
  const clean = checked.value;
  const themes = validateThemes(input.themes, t);
  if (themes.error) return themes;
  const collection = input.collection === undefined || input.collection === null || input.collection === '' ? 'main' : input.collection;
  if (!COLLECTIONS.includes(collection)) return { error: t('errors.songCollectionInvalid') };

  return {
    value: {
      title,
      titleNorm: normalizeForSearch(title),
      author: author || null,
      songKey: songKey || null,
      sections: clean,
      themes: themes.value,
      collection,
    },
  };
}

function createSongStore(db) {
  const listRows = db.prepare(`SELECT s.id, s.title, s.author, s.song_key, s.collection, s.updated_at,
      COUNT(ss.id) AS section_count, group_concat(ss.content, char(10)) AS content,
      (SELECT group_concat(th.name, char(31)) FROM (SELECT name FROM song_themes WHERE song_id = s.id AND admin_id = s.admin_id ORDER BY position) th) AS themes
    FROM songs s
    LEFT JOIN song_sections ss ON ss.song_id = s.id AND ss.admin_id = s.admin_id
    WHERE s.admin_id = ?
    GROUP BY s.id`);
  const selectThemes = db.prepare('SELECT name FROM song_themes WHERE song_id = ? AND admin_id = ? ORDER BY position').pluck();
  const deleteThemes = db.prepare('DELETE FROM song_themes WHERE song_id = ? AND admin_id = ?');
  const insertTheme = db.prepare('INSERT INTO song_themes (song_id, admin_id, position, name, name_norm) VALUES (?, ?, ?, ?, ?)');
  // every theme of the library with how many songs carry it, by name (the spelling seen first)
  const themeRows = db.prepare(`SELECT name_norm, MIN(name) AS name, COUNT(*) AS count FROM song_themes
    WHERE admin_id = ? GROUP BY name_norm ORDER BY name_norm`);
  const songsWithTheme = db.prepare('SELECT song_id FROM song_themes WHERE admin_id = ? AND name_norm = ?').pluck();
  const selectSong = db.prepare(`SELECT id, title, author, song_key, collection, source_lang, source_provider,
      source_url, presentation, background_media_id, background_none, created_at, updated_at
    FROM songs WHERE id = ? AND admin_id = ?`);
  const selectSections = db.prepare(`SELECT id, position, type, label, content, note, content_hash
    FROM song_sections WHERE song_id = ? AND admin_id = ? ORDER BY position`);
  const selectByTitle = db.prepare('SELECT id FROM songs WHERE admin_id = ? AND title_norm = ?').pluck();
  const insertSong = db.prepare(`INSERT INTO songs
    (admin_id, title, title_norm, author, song_key, collection, source_lang, source_provider, source_url,
      presentation, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const updateSong = db.prepare(`UPDATE songs SET title = ?, title_norm = ?, author = ?, song_key = ?, collection = ?,
      updated_at = ? WHERE id = ? AND admin_id = ?`);
  const deleteSections = db.prepare('DELETE FROM song_sections WHERE song_id = ? AND admin_id = ?');
  const insertSection = db.prepare(`INSERT INTO song_sections
    (song_id, admin_id, position, type, label, content, note, content_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const deleteSong = db.prepare('DELETE FROM songs WHERE id = ? AND admin_id = ?');

  function assertUniqueTitle(adminId, titleNorm, exceptId) {
    const existing = selectByTitle.get(adminId, titleNorm);
    if (existing !== undefined && existing !== exceptId) throw new DuplicateTitleError(existing);
  }

  function writeThemes(adminId, songId, themes) {
    deleteThemes.run(songId, adminId);
    (themes || []).forEach((theme, position) => insertTheme.run(songId, adminId, position, theme.name, theme.norm));
  }

  function writeSections(adminId, songId, sections) {
    deleteSections.run(songId, adminId);
    sections.forEach((s, position) => {
      insertSection.run(songId, adminId, position, s.type, s.label, s.content, s.note, lyricsHash(s.content));
    });
  }

  function get(adminId, id) {
    const row = selectSong.get(id, adminId);
    if (!row) return null;
    const { background_media_id: bgId, background_none: bgNone, ...song } = row;
    // The song's default background: null (the church default), 'none' or a media id.
    return { ...song, background: bgNone ? 'none' : bgId || null, sections: selectSections.all(id, adminId), themes: selectThemes.all(id, adminId) };
  }

  // noKey: only the songs without a key (the library's "Fără ton" filter); theme: only the
  // songs with that theme (by its normalized name); collection: 'main' (default), 'school'
  // or 'all'. Every row carries `themes` (names) and `collection`.
  function list(adminId, { q, sort, noKey = false, theme = '', collection = 'main' }) {
    const wanted = theme ? new Set(songsWithTheme.all(adminId, normalizeForSearch(theme))) : null;
    const items = listRows.all(adminId)
      .map(({ content, themes, ...row }) => ({ ...row, themes: themes ? themes.split('\u001f') : [], text: stripChords(content || '') }))
      .filter((s) => (collection === 'all' || s.collection === collection) && (!noKey || !s.song_key) && (!wanted || wanted.has(s.id)));
    return searchSongs(items, q, sort).map(({ text, ...row }) => row);
  }

  // [{ name, count }] of the library's themes, by name.
  function themes(adminId) {
    return themeRows.all(adminId).map((r) => ({ name: r.name, count: r.count }));
  }

  // The themes of one song replaced (the song page's "Tematică · Setează"): validated
  // themes [{ name, norm }]. false when the song is not this admin's.
  const setThemes = db.transaction((adminId, id, list) => {
    if (!selectSong.get(id, adminId)) return false;
    writeThemes(adminId, id, list);
    db.prepare('UPDATE songs SET updated_at = ? WHERE id = ? AND admin_id = ?').run(Date.now(), id, adminId);
    return true;
  });

  const selectTitle = db.prepare('SELECT title FROM songs WHERE id = ? AND admin_id = ?').pluck();

  function findTitle(adminId, id) {
    return selectTitle.get(id, adminId) || null;
  }

  function findIdByTitle(adminId, title) {
    const id = selectByTitle.get(adminId, normalizeForSearch(title));
    return id === undefined ? null : id;
  }

  // meta (optional): { sourceLang, sourceProvider, sourceUrl, presentation } for imports.
  const create = db.transaction((adminId, userId, song, meta = {}) => {
    assertUniqueTitle(adminId, song.titleNorm);
    const now = Date.now();
    const id = Number(insertSong.run(adminId, song.title, song.titleNorm, song.author, song.songKey, song.collection || 'main',
      meta.sourceLang || 'ro', meta.sourceProvider || null, meta.sourceUrl || null, meta.presentation || null,
      userId, now, now).lastInsertRowid);
    writeSections(adminId, id, song.sections);
    writeThemes(adminId, id, song.themes);
    return id;
  });

  const updateMeta = db.prepare(`UPDATE songs SET source_lang = ?, source_provider = ?, source_url = ?,
      presentation = ? WHERE id = ? AND admin_id = ?`);

  // Returns false when the song does not exist for this admin. meta (optional) replaces the
  // source fields and presentation; a field left undefined keeps its current value.
  const update = db.transaction((adminId, id, song, meta) => {
    const current = selectSong.get(id, adminId);
    if (!current) return false;
    assertUniqueTitle(adminId, song.titleNorm, id);
    updateSong.run(song.title, song.titleNorm, song.author, song.songKey, song.collection || current.collection || 'main', Date.now(), id, adminId);
    if (meta) {
      const pick = (key, column) => (meta[key] === undefined ? current[column] : meta[key]);
      updateMeta.run(pick('sourceLang', 'source_lang') || 'ro', pick('sourceProvider', 'source_provider'),
        pick('sourceUrl', 'source_url'), pick('presentation', 'presentation'), id, adminId);
    }
    writeSections(adminId, id, song.sections);
    writeThemes(adminId, id, song.themes);
    return true;
  });

  const exportRows = db.prepare(`SELECT id, title, author, song_key, collection, source_lang, source_provider,
      source_url, presentation
    FROM songs WHERE admin_id = ? ORDER BY title_norm`);
  const exportSections = db.prepare(`SELECT song_id, type, label, content, note
    FROM song_sections WHERE admin_id = ? ORDER BY song_id, position`);

  // Library file (LIBRARY_FORMAT v1): song content only, no ids, no admin or user data.
  // collection: 'all' (default) or one library.
  function exportLibrary(adminId, appName, collection = 'all') {
    const sectionsBySong = new Map();
    for (const s of exportSections.all(adminId)) {
      if (!sectionsBySong.has(s.song_id)) sectionsBySong.set(s.song_id, []);
      sectionsBySong.get(s.song_id).push({ type: s.type, label: s.label, content: s.content, note: s.note });
    }
    const themesBySong = new Map();
    for (const row of db.prepare('SELECT song_id, name FROM song_themes WHERE admin_id = ? ORDER BY song_id, position').all(adminId)) {
      if (!themesBySong.has(row.song_id)) themesBySong.set(row.song_id, []);
      themesBySong.get(row.song_id).push(row.name);
    }
    const list = exportRows.all(adminId).filter((row) => collection === 'all' || row.collection === collection).map((row) => ({
      title: row.title,
      author: row.author,
      key: row.song_key,
      collection: row.collection,
      themes: themesBySong.get(row.id) || [],
      sourceLang: row.source_lang,
      sourceProvider: row.source_provider,
      sourceUrl: row.source_url,
      presentation: row.presentation,
      sections: sectionsBySong.get(row.id) || [],
    }));
    return {
      type: LIBRARY_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      app: appName,
      count: list.length,
      songs: list,
    };
  }

  function remove(adminId, id) {
    return deleteSong.run(id, adminId).changes > 0;
  }

  // Only the original key ('' clears it), e.g. set from the arrange sheet for an import.
  const updateKey = db.prepare('UPDATE songs SET song_key = ?, updated_at = ? WHERE id = ? AND admin_id = ?');
  function setKey(adminId, id, songKey) {
    return updateKey.run(songKey || null, Date.now(), id, adminId).changes > 0;
  }

  // "Detectează gama la toate": the songs without a key, with their estimated key from the
  // chords (lib/key-detect.js): [{ id, title, key, alternatives, confidence, chords }] by
  // title, plus the number of keyless songs without chords (nothing to estimate from).
  const keylessRows = db.prepare(`SELECT s.id, s.title, group_concat(ss.content, char(10)) AS content
    FROM songs s LEFT JOIN song_sections ss ON ss.song_id = s.id AND ss.admin_id = s.admin_id
    WHERE s.admin_id = ? AND s.song_key IS NULL GROUP BY s.id ORDER BY s.title COLLATE NOCASE`);
  function keySuggestions(adminId) {
    const songs = [];
    let withoutChords = 0;
    for (const row of keylessRows.all(adminId)) {
      const result = keyDetect.fromText(row.content || '');
      if (!result) withoutChords += 1;
      else songs.push({ id: row.id, title: row.title, key: result.key, alternatives: result.alternatives, confidence: result.confidence, chords: result.chords });
    }
    return { songs, withoutChords };
  }

  // Sets the keys of several songs at once, only where none is set yet (a key already set
  // is never replaced here): { saved: [ids], skipped: [ids] }.
  const updateKeyIfUnset = db.prepare('UPDATE songs SET song_key = ?, updated_at = ? WHERE id = ? AND admin_id = ? AND song_key IS NULL');
  const setKeys = db.transaction((adminId, keys) => {
    const saved = [];
    const skipped = [];
    const now = Date.now();
    for (const { id, songKey } of keys) (updateKeyIfUnset.run(songKey, now, id, adminId).changes > 0 ? saved : skipped).push(id);
    return { saved, skipped };
  });

  return { get, list, themes, setThemes, findTitle, findIdByTitle, create, update, setKey, keySuggestions, setKeys, remove, exportLibrary };
}

module.exports = { LIMITS, KEYS, COLLECTIONS, SORT_MODES, LIBRARY_FORMAT, DuplicateTitleError, lyricsHash, validateSections, validateThemes, validateSong, createSongStore };
