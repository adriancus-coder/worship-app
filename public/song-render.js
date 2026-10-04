'use strict';

// Renders song sections the same way everywhere (song view, online preview):
// computed labels, optional note, chords above lyrics in monospace or lyrics only.

(function () {
  // labels: optional display labels aligned with `sections` (e.g. computed on the whole song
  // when only some sections are shown).
  function sectionsView(sections, { textOnly = false, headingLevel = 2, labels: givenLabels = null } = {}) {
    const { el } = window.PAGE;
    const { t } = window.I18N;
    const { inlineLinePairs, stripChords } = window.CHORDS;
    const labels = givenLabels || window.SECTIONS.sectionLabels(sections, t);

    // Chords in the reader's notation (letters or solfège); storage stays letters.
    function chordSheet(content) {
      const lines = [];
      const shown = window.NOTATION ? window.NOTATION.content(content) : content;
      for (const { chords, lyrics } of inlineLinePairs(shown)) {
        if (chords !== null) lines.push(el('span', { class: 'chord-line', text: chords }));
        if (lyrics !== null) lines.push(el('span', { class: 'lyric-line', text: lyrics || ' ' }));
      }
      return el('div', { class: 'chord-sheet' }, lines);
    }

    return sections.map((section, i) => el('section', { class: 'song-section' },
      el(`h${headingLevel}`, { class: 'section-label', text: labels[i] }),
      section.note ? el('p', { class: 'section-note', text: section.note }) : null,
      textOnly
        ? el('p', { class: 'lyrics', text: stripChords(section.content) })
        : chordSheet(section.content)));
  }

  window.SONG_RENDER = { sectionsView };
})();
