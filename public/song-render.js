'use strict';

// Renders song sections the same way everywhere (song view, online preview):
// computed labels, optional note, chords above lyrics in monospace or lyrics only.

(function () {
  function sectionsView(sections, { textOnly = false, headingLevel = 2 } = {}) {
    const { el } = window.PAGE;
    const { t } = window.I18N;
    const { inlineLinePairs, stripChords } = window.CHORDS;
    const labels = window.SECTIONS.sectionLabels(sections, t);

    function chordSheet(content) {
      const lines = [];
      for (const { chords, lyrics } of inlineLinePairs(content)) {
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
