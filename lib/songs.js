'use strict';

// Song library: validation, derived fields and storage. Every query is scoped by admin_id.

const crypto = require('crypto');
const { normalizeForSearch, searchSongs } = require('./search');
const { stripChords, chordsOverLyricsToInline } = require('./chords');
const { SECTION_TYPES } = require('./sections');

const LIMITS = {
  titleMax: 200,
  authorMax: 200,
  sectionsMin: 1,
  sectionsMax: 40,
  contentMax: 5000,
  noteMax: 300,
  labelMax: 60,
  queryMax: 200,
};

const KEYS = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B']
  .flatMap((root) => [root, `${root}m`]);

const SORT_MODES = ['az', 'za', 'recent'];

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
  const sections = input.sections;
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

  return {
    value: {
      title,
      titleNorm: normalizeForSearch(title),
      author: author || null,
      songKey: songKey || null,
      sections: clean,
    },
  };
}

function createSongStore(db) {
  const listRows = db.prepare(`SELECT s.id, s.title, s.author, s.song_key, s.updated_at,
      COUNT(ss.id) AS section_count, group_concat(ss.content, char(10)) AS content
    FROM songs s
    LEFT JOIN song_sections ss ON ss.song_id = s.id AND ss.admin_id = s.admin_id
    WHERE s.admin_id = ?
    GROUP BY s.id`);
  const selectSong = db.prepare(`SELECT id, title, author, song_key, source_lang, source_provider,
      source_url, created_at, updated_at
    FROM songs WHERE id = ? AND admin_id = ?`);
  const selectSections = db.prepare(`SELECT id, position, type, label, content, note, content_hash
    FROM song_sections WHERE song_id = ? AND admin_id = ? ORDER BY position`);
  const selectByTitle = db.prepare('SELECT id FROM songs WHERE admin_id = ? AND title_norm = ?').pluck();
  const insertSong = db.prepare(`INSERT INTO songs
    (admin_id, title, title_norm, author, song_key, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const updateSong = db.prepare(`UPDATE songs SET title = ?, title_norm = ?, author = ?, song_key = ?,
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

  function writeSections(adminId, songId, sections) {
    deleteSections.run(songId, adminId);
    sections.forEach((s, position) => {
      insertSection.run(songId, adminId, position, s.type, s.label, s.content, s.note, lyricsHash(s.content));
    });
  }

  function get(adminId, id) {
    const song = selectSong.get(id, adminId);
    if (!song) return null;
    return { ...song, sections: selectSections.all(id, adminId) };
  }

  function list(adminId, { q, sort }) {
    const items = listRows.all(adminId).map(({ content, ...row }) => ({ ...row, text: stripChords(content || '') }));
    return searchSongs(items, q, sort).map(({ text, ...row }) => row);
  }

  const create = db.transaction((adminId, userId, song) => {
    assertUniqueTitle(adminId, song.titleNorm);
    const now = Date.now();
    const id = Number(insertSong.run(adminId, song.title, song.titleNorm, song.author, song.songKey, userId, now, now).lastInsertRowid);
    writeSections(adminId, id, song.sections);
    return id;
  });

  // Returns false when the song does not exist for this admin.
  const update = db.transaction((adminId, id, song) => {
    if (!selectSong.get(id, adminId)) return false;
    assertUniqueTitle(adminId, song.titleNorm, id);
    updateSong.run(song.title, song.titleNorm, song.author, song.songKey, Date.now(), id, adminId);
    writeSections(adminId, id, song.sections);
    return true;
  });

  function remove(adminId, id) {
    return deleteSong.run(id, adminId).changes > 0;
  }

  return { get, list, create, update, remove };
}

module.exports = { LIMITS, KEYS, SORT_MODES, DuplicateTitleError, lyricsHash, validateSong, createSongStore };
