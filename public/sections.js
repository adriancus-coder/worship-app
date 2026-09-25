'use strict';

// Song section types and their display labels. Shared by the pages and the server
// (lib/sections.js). Labels come from the i18n dictionary (songs.sectionTypes.*).

(function (root) {
  const SECTION_TYPES = ['verse', 'chorus', 'pre_chorus', 'bridge', 'intro', 'outro', 'tag', 'other'];

  // Allowed song keys: each root, major and minor ("G", "Gm").
  const SONG_KEYS = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B']
    .flatMap((root) => [root, `${root}m`]);

  // Display labels for an ordered list of sections ({ type, label }).
  // A custom label wins. Verses are always numbered ("Strofa 1"); other types are
  // numbered only when the song has more than one of them ("Punte 1", "Punte 2").
  function sectionLabels(sections, t) {
    const totals = {};
    for (const s of sections) totals[s.type] = (totals[s.type] || 0) + 1;
    const seen = {};
    return sections.map((s) => {
      seen[s.type] = (seen[s.type] || 0) + 1;
      const custom = typeof s.label === 'string' ? s.label.trim() : '';
      if (custom) return custom;
      const name = t(`songs.sectionTypes.${s.type}`);
      if (s.type === 'verse' || totals[s.type] > 1) {
        return t('songs.sectionNumbered', { type: name, n: seen[s.type] });
      }
      return name;
    });
  }

  // --- section codes and arrangements ------------------------------------------
  // verse V, chorus C, pre_chorus P, bridge B, intro I, outro O, tag T, other X; the number
  // is the ordinal among sections of the same type. "C" and "C1" are the same section.
  // Canonical codes omit the 1 when a type occurs once, except verses (always numbered).

  const TYPE_CODES = { verse: 'V', chorus: 'C', pre_chorus: 'P', bridge: 'B', intro: 'I', outro: 'O', tag: 'T', other: 'X' };
  const CODE_TYPES = Object.fromEntries(Object.entries(TYPE_CODES).map(([type, code]) => [code, type]));

  // Canonical code of every section, in order: ['V1', 'C', 'V2', 'B'].
  function sectionCodes(sections) {
    const totals = {};
    for (const s of sections) totals[s.type] = (totals[s.type] || 0) + 1;
    const seen = {};
    return sections.map((s) => {
      seen[s.type] = (seen[s.type] || 0) + 1;
      const letter = TYPE_CODES[s.type] || 'X';
      return s.type === 'verse' || totals[s.type] > 1 ? `${letter}${seen[s.type]}` : letter;
    });
  }

  // Section index for one code ("c", "C1", "v2"...), or -1.
  function codeIndex(code, sections) {
    const m = /^([A-Z])(\d*)$/.exec(String(code).trim().toUpperCase());
    const type = m && CODE_TYPES[m[1]];
    if (!type) return -1;
    const n = m[2] ? Number(m[2]) : 1;
    let seen = 0;
    for (let i = 0; i < sections.length; i++) {
      if (sections[i].type === type && ++seen === n) return i;
    }
    return -1;
  }

  // "V1 C, v2 c B" -> { codes: canonical codes that resolve, indexes: their sections,
  // unknown: tokens that match no section }.
  function parseArrangement(str, sections) {
    const canonical = sectionCodes(sections);
    const out = { codes: [], indexes: [], unknown: [] };
    for (const token of String(str || '').split(/[\s,]+/).filter(Boolean)) {
      const index = codeIndex(token, sections);
      if (index < 0) {
        out.unknown.push(token);
      } else {
        out.codes.push(canonical[index]);
        out.indexes.push(index);
      }
    }
    return out;
  }

  // The song's own presentation when all of its codes resolve, else every section once.
  function defaultArrangement(song) {
    const sections = song.sections || [];
    const fromPresentation = parseArrangement(song.presentation || '', sections);
    if (fromPresentation.codes.length && !fromPresentation.unknown.length) return fromPresentation.codes;
    return sectionCodes(sections);
  }

  const SECTIONS = {
    SECTION_TYPES,
    SONG_KEYS,
    TYPE_CODES,
    sectionLabels,
    sectionCodes,
    codeIndex,
    parseArrangement,
    defaultArrangement,
  };

  if (typeof module === 'object' && module.exports) module.exports = SECTIONS;
  else root.SECTIONS = SECTIONS;
})(typeof window !== 'undefined' ? window : this);
