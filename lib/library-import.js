'use strict';

// Library file import: our own export (worship-app-library v1) and the Sanctuary Voice
// admin export (sanctuary-voice-library v1). Parsing and planning are pure; routes/songs.js
// runs the plan against the database.

const { chordsOverLyricsToInline } = require('./chords');
const { SONG_KEYS, sectionLabels } = require('./sections');
const { normalizeForSearch } = require('./search');
const { validateSong, LIBRARY_FORMAT } = require('./songs');
const I18N = require('./i18n');

const MAX_SONGS = 2000;
const SV_FORMAT = 'sanctuary-voice-library';
const SV_SECTION_TYPES = ['verse', 'chorus', 'bridge'];

class LibraryFileError extends Error {
  constructor(code) {
    super(code);
    this.code = code; // 'format' | 'too_many'
  }
}

function str(value) {
  return typeof value === 'string' ? value : '';
}

function optional(value, max) {
  const s = str(value).trim();
  return s && s.length <= max ? s : null;
}

function sourceLang(value) {
  const s = str(value).trim();
  return /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(s) ? s : 'ro';
}

function httpUrl(value) {
  const s = optional(value, 500);
  return s && /^https?:\/\//i.test(s) ? s : null;
}

function keyOrEmpty(value) {
  const s = str(value).trim();
  return SONG_KEYS.includes(s) ? s : '';
}

// worship-app-library v1 -> entries
function fromOwnFormat(song) {
  const s = song && typeof song === 'object' ? song : {};
  return {
    title: str(s.title).trim(),
    body: {
      title: s.title,
      author: typeof s.author === 'string' ? s.author : '',
      song_key: typeof s.key === 'string' ? s.key : '',
      sections: Array.isArray(s.sections)
        ? s.sections.map((x) => (x && typeof x === 'object'
          ? { type: x.type, label: x.label || '', content: x.content, note: x.note || '' }
          : x))
        : s.sections,
    },
    meta: {
      sourceLang: sourceLang(s.sourceLang),
      sourceProvider: optional(s.sourceProvider, 50),
      sourceUrl: httpUrl(s.sourceUrl),
      presentation: optional(s.presentation, 200),
    },
  };
}

// Default labels a song would get without custom labels: ours in every UI language,
// plus Sanctuary Voice's own fallback "Verse {index + 1}".
function defaultLabelSets(sections) {
  const bare = sections.map(({ type }) => ({ type }));
  return I18N.LANGS.map((lang) => sectionLabels(bare, (k, v) => I18N.t(k, v, lang)));
}

// sanctuary-voice-library v1 -> entries. Blocks are split on blank lines; type from
// sections[i], note from sectionNotes[i]; labels[i] only when it is not a default label.
// Ids and translationsByHash are dropped.
function fromSanctuaryVoice(song) {
  const s = song && typeof song === 'object' ? song : {};
  const blocks = str(s.text).replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/)
    .map((block) => block.replace(/^\n+|\s+$/g, ''))
    .filter((block) => block.trim());
  const types = Array.isArray(s.sections) ? s.sections : [];
  const notes = Array.isArray(s.sectionNotes) ? s.sectionNotes : [];
  const labels = Array.isArray(s.labels) ? s.labels : [];

  const sections = blocks.map((block, i) => ({
    type: SV_SECTION_TYPES.includes(types[i]) ? types[i] : 'verse',
    label: '',
    content: chordsOverLyricsToInline(block),
    note: str(notes[i]).trim().slice(0, 300),
  }));
  const defaults = defaultLabelSets(sections);
  sections.forEach((section, i) => {
    const given = str(labels[i]).trim();
    if (!given) return;
    const norm = normalizeForSearch(given);
    const isDefault = norm === normalizeForSearch(`Verse ${i + 1}`)
      || defaults.some((set) => normalizeForSearch(set[i]) === norm);
    if (!isDefault) section.label = given;
  });

  return {
    title: str(s.title).trim(),
    body: { title: s.title, author: '', song_key: keyOrEmpty(s.key), sections },
    // Sanctuary Voice has no author/source/presentation: they keep their current values on update.
    meta: { sourceLang: sourceLang(s.sourceLang) },
    keepAuthor: true,
  };
}

// Parsed JSON -> { format, entries: [{ title, body, meta }] }. Throws LibraryFileError.
function parseLibraryFile(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.songs)) {
    throw new LibraryFileError('format');
  }
  let convert;
  if (data.type === LIBRARY_FORMAT && data.version === 1) convert = fromOwnFormat;
  else if (data.type === SV_FORMAT && data.version === 1) convert = fromSanctuaryVoice;
  else throw new LibraryFileError('format');
  if (data.songs.length > MAX_SONGS) throw new LibraryFileError('too_many');
  return { format: data.type, entries: data.songs.map(convert) };
}

// entries -> { add: [{ value, meta }], existing: [{ id, value, meta, keepAuthor }], invalid: [{ title, reason }] }.
// Every song goes through validateSong (same rules as POST /api/songs). Within one file
// the first valid song with a given title wins; later ones are reported as invalid.
function planImport(entries, { t, findIdByTitle }) {
  const plan = { add: [], existing: [], invalid: [] };
  const seen = new Set();
  entries.forEach((entry, i) => {
    const title = entry.title || `#${i + 1}`;
    const { error, value } = validateSong(entry.body, t);
    if (error) {
      plan.invalid.push({ title, reason: error });
      return;
    }
    if (seen.has(value.titleNorm)) {
      plan.invalid.push({ title, reason: t('errors.importDuplicateInFile') });
      return;
    }
    seen.add(value.titleNorm);
    const id = findIdByTitle(value.title);
    if (id === null) plan.add.push({ value, meta: entry.meta });
    else plan.existing.push({ id, value, meta: entry.meta, keepAuthor: Boolean(entry.keepAuthor) });
  });
  return plan;
}

module.exports = { MAX_SONGS, SV_FORMAT, LibraryFileError, parseLibraryFile, planImport };
