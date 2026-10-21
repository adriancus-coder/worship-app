'use strict';

// Renders song sections the same way everywhere (song view, online preview):
// computed labels, optional note, chords above lyrics in monospace or lyrics only.
// tappable: each chord is a .chord-tap (role button) that opens its diagram
// (public/chord-diagrams.js, loaded by the song and rehearsal pages).

(function () {
  // labels: optional display labels aligned with `sections` (e.g. computed on the whole song
  // when only some sections are shown).
  function sectionsView(sections, { textOnly = false, headingLevel = 2, labels: givenLabels = null, tappable = false } = {}) {
    const { el } = window.PAGE;
    const { t } = window.I18N;
    const { inlineLinePairs, stripChords, isChord } = window.CHORDS;
    const taps = tappable && Boolean(window.CHORD_DIAGRAMS);

    // A chord line as text, or with every chord tappable (the spacing kept, white-space: pre).
    function chordLine(chords) {
      if (!taps) return el('span', { class: 'chord-line', text: chords });
      const parts = chords.split(/(\s+)/).map((piece) => (piece && !/^\s+$/.test(piece) && piece !== '|' && isChord(piece)
        ? el('span', { class: 'chord-tap', role: 'button', tabindex: '0', 'data-chord': piece, 'aria-label': t('chordDiagram.tapLabel', { chord: piece }), text: piece })
        : piece));
      return el('span', { class: 'chord-line' }, ...parts);
    }
    const labels = givenLabels || window.SECTIONS.sectionLabels(sections, t);

    // Chords in the reader's notation (letters or solfège); storage stays letters.
    function chordSheet(content) {
      const lines = [];
      const shown = window.NOTATION ? window.NOTATION.content(content) : content;
      for (const { chords, lyrics } of inlineLinePairs(shown)) {
        if (chords !== null) lines.push(chordLine(chords));
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
