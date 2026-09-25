'use strict';

// Song section types and their display labels. Shared by the pages and the server
// (lib/sections.js). Labels come from the i18n dictionary (songs.sectionTypes.*).

(function (root) {
  const SECTION_TYPES = ['verse', 'chorus', 'pre_chorus', 'bridge', 'intro', 'outro', 'tag', 'other'];

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

  const SECTIONS = { SECTION_TYPES, sectionLabels };

  if (typeof module === 'object' && module.exports) module.exports = SECTIONS;
  else root.SECTIONS = SECTIONS;
})(typeof window !== 'undefined' ? window : this);
