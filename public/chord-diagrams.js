'use strict';

// Chord diagrams ("Diagrame"): tap a chord on the song page or at the rehearsal and see how
// to play it, on the guitar (frets and dots) or on the piano (the keys), with a Chitară / Pian
// switch kept on the device (wa_chord_instrument). Nothing leaves the device: the shapes and
// the notes are computed here (shared with the server for tests: lib/chord-diagrams.js).
//
//   CHORD_DIAGRAMS.parse('D/F#')     -> { root: 2, name: 'D', quality: '', intervals, bass: 6, bassName: 'F#' } | null
//   CHORD_DIAGRAMS.pianoNotes(parsed) -> key indexes on a two-octave keyboard from C (0..23)
//   CHORD_DIAGRAMS.guitarShape(parsed) -> { frets: [6], baseFret, barre } | null (low E first; -1 = not played)
//   CHORD_DIAGRAMS.open(chord)        -> the pop-up (pages); song-render.js makes chords tappable.

(function (root) {
  const shared = typeof module === 'object' && module.exports;
  const { fromSolfege, isChord } = shared ? require('./chords.js') : root.CHORDS;

  const NATURAL = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const PARTS_RE = /^([A-G])([#b]?)(.*?)(?:\/([A-G])([#b]?))?$/;
  const noteIndex = (letter, acc) => (NATURAL[letter] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + 12) % 12;

  // Suffix -> canonical quality; quality -> semitones above the root.
  const QUALITY_ALIASES = {
    '': '', maj: '', M: '', m: 'm', min: 'm', 7: '7', m7: 'm7', maj7: 'maj7', M7: 'maj7', sus4: 'sus4', sus: 'sus4', sus2: 'sus2',
    dim: 'dim', '°': 'dim', dim7: 'dim7', '°7': 'dim7', aug: 'aug', '+': 'aug', 6: '6', m6: 'm6', 9: '9', m9: 'm9', maj9: 'maj9', M9: 'maj9',
    add9: 'add9', 2: 'add9', '(add9)': 'add9', madd9: 'madd9', '7sus4': '7sus4', '7sus': '7sus4', m7b5: 'm7b5', 'ø': 'm7b5', 'ø7': 'm7b5',
    5: '5', 11: '11', 13: '13', mmaj7: 'mmaj7', mM7: 'mmaj7', '7b9': '7b9', '7#9': '7#9', '6/9': '69', 69: '69', add2: 'add9',
  };
  const INTERVALS = {
    '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], sus4: [0, 5, 7], sus2: [0, 2, 7],
    dim: [0, 3, 6], dim7: [0, 3, 6, 9], aug: [0, 4, 8], 6: [0, 4, 7, 9], m6: [0, 3, 7, 9], 9: [0, 4, 7, 10, 14], m9: [0, 3, 7, 10, 14],
    maj9: [0, 4, 7, 11, 14], add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14], '7sus4': [0, 5, 7, 10], m7b5: [0, 3, 6, 10], 5: [0, 7],
    11: [0, 4, 7, 10, 14, 17], 13: [0, 4, 7, 10, 14, 21], mmaj7: [0, 3, 7, 11], '7b9': [0, 4, 7, 10, 13], '7#9': [0, 4, 7, 10, 15], 69: [0, 4, 7, 9, 14],
  };

  // A chord (letters or solfège) -> its parts, or null when it is not a chord we know.
  function parse(chord) {
    const text = fromSolfege(String(chord || '').trim());
    if (!isChord(text) || /^N\.?C\.?$/.test(text)) return null;
    const m = PARTS_RE.exec(text);
    if (!m) return null;
    const quality = QUALITY_ALIASES[m[3]];
    if (quality === undefined) return null;
    const rootIndex = noteIndex(m[1], m[2]);
    const bass = m[4] ? noteIndex(m[4], m[5]) : null;
    return {
      root: rootIndex, name: m[1] + m[2], quality, intervals: INTERVALS[quality],
      bass, bassName: m[4] ? m[4] + m[5] : null, label: text,
    };
  }

  // The keys lit on a two-octave keyboard from C (0 = C, 23 = B): the chord from its root
  // upwards, a slash bass below it. { keys: [index], root: index, bass: index | null }
  function pianoNotes(parsed) {
    const base = parsed.root;
    const keys = parsed.intervals.map((i) => base + i).map((k) => (k > 23 ? k - 12 : k));
    let bass = null;
    if (parsed.bass !== null && parsed.bass !== parsed.root) {
      bass = parsed.bass < base ? parsed.bass : null; // below the root when it fits, else just lit
      if (bass === null && !keys.includes(parsed.bass) && !keys.includes(parsed.bass + 12)) keys.unshift(parsed.bass);
    }
    return { keys: [...new Set(bass === null ? keys : [bass, ...keys])].sort((a, b) => a - b), root: base, bass };
  }

  // --- guitar ---------------------------------------------------------------------------
  // Open-position shapes, low E string first (-1 = not played, 0 = open). Keys use sharps.
  const OPEN = {
    C: [-1, 3, 2, 0, 1, 0], D: [-1, -1, 0, 2, 3, 2], E: [0, 2, 2, 1, 0, 0], G: [3, 2, 0, 0, 0, 3], A: [-1, 0, 2, 2, 2, 0],
    Am: [-1, 0, 2, 2, 1, 0], Dm: [-1, -1, 0, 2, 3, 1], Em: [0, 2, 2, 0, 0, 0],
    A7: [-1, 0, 2, 0, 2, 0], B7: [-1, 2, 1, 2, 0, 2], C7: [-1, 3, 2, 3, 1, 0], D7: [-1, -1, 0, 2, 1, 2], E7: [0, 2, 0, 1, 0, 0], G7: [3, 2, 0, 0, 0, 1],
    Am7: [-1, 0, 2, 0, 1, 0], Dm7: [-1, -1, 0, 2, 1, 1], Em7: [0, 2, 0, 0, 0, 0],
    Cmaj7: [-1, 3, 2, 0, 0, 0], Dmaj7: [-1, -1, 0, 2, 2, 2], Amaj7: [-1, 0, 2, 1, 2, 0], Fmaj7: [-1, -1, 3, 2, 1, 0], Gmaj7: [3, 2, 0, 0, 0, 2], Emaj7: [0, 2, 1, 1, 0, 0],
    Asus4: [-1, 0, 2, 2, 3, 0], Dsus4: [-1, -1, 0, 2, 3, 3], Esus4: [0, 2, 2, 2, 0, 0], Asus2: [-1, 0, 2, 2, 0, 0], Dsus2: [-1, -1, 0, 2, 3, 0],
    Cadd9: [-1, 3, 2, 0, 3, 0], Gadd9: [3, 2, 0, 2, 0, 3], Eadd9: [0, 2, 2, 1, 0, 2],
    E5: [0, 2, 2, -1, -1, -1], A5: [-1, 0, 2, 2, -1, -1], D5: [-1, -1, 0, 2, 3, -1],
    'D/F#': [2, 0, 0, 2, 3, 2], 'G/B': [-1, 2, 0, 0, 0, 3], 'C/E': [0, 3, 2, 0, 1, 0], 'C/G': [3, 3, 2, 0, 1, 0], 'Am/G': [3, 0, 2, 2, 1, 0], 'D/A': [-1, 0, 0, 2, 3, 2], 'A/C#': [-1, 4, 2, 2, 2, 0], 'E/G#': [4, -1, 2, 1, 0, 0],
  };
  // Barre templates: frets relative to the barre (1); the root on the 6th (E), 5th (A) or
  // 4th (D) string, which decides the fret of the root.
  const TEMPLATES = {
    E: { string: 4, shapes: { '': [1, 3, 3, 2, 1, 1], m: [1, 3, 3, 1, 1, 1], 7: [1, 3, 1, 2, 1, 1], m7: [1, 3, 1, 1, 1, 1], maj7: [1, -1, 2, 2, 1, -1], sus4: [1, 3, 3, 3, 1, 1], '7sus4': [1, 3, 1, 3, 1, 1], 5: [1, 3, 3, -1, -1, -1], add9: [1, 3, 3, 2, 1, 3], 9: [1, 3, 1, 2, 1, 3] } },
    A: { string: 9, shapes: { '': [-1, 1, 3, 3, 3, 1], m: [-1, 1, 3, 3, 2, 1], 7: [-1, 1, 3, 1, 3, 1], m7: [-1, 1, 3, 1, 2, 1], maj7: [-1, 1, 3, 2, 3, 1], sus4: [-1, 1, 3, 3, 4, 1], sus2: [-1, 1, 3, 3, 1, 1], '7sus4': [-1, 1, 3, 1, 4, 1], m7b5: [-1, 1, 2, 1, 2, -1], 5: [-1, 1, 3, 3, -1, -1], 6: [-1, 1, 3, 3, 3, 3], m6: [-1, 1, 3, 3, 2, 3], 9: [-1, 1, 3, 1, 3, 3], add9: [-1, 1, 3, 3, 1, 1] } },
    D: { string: 2, shapes: { dim: [-1, -1, 1, 2, 1, 2], dim7: [-1, -1, 1, 2, 1, 2], aug: [-1, -1, 1, 4, 4, 3], mmaj7: [-1, -1, 1, 3, 3, 2] } },
  };

  // The shape for a chord: an open one when we have it, else a barre (the family whose root
  // fret is lowest). null when no template fits the quality.
  function guitarShape(parsed) {
    const key = SHARP_NAMES[parsed.root] + parsed.quality;
    const withBass = parsed.bass !== null ? `${key}/${SHARP_NAMES[parsed.bass]}` : null;
    const open = (withBass && OPEN[withBass]) || OPEN[key];
    if (open) return { frets: open, baseFret: 1, barre: null, bassShown: Boolean(withBass && OPEN[withBass]) };
    let best = null;
    for (const [family, { string, shapes }] of Object.entries(TEMPLATES)) {
      const rel = shapes[parsed.quality];
      if (!rel) continue;
      let fret = (parsed.root - string + 12) % 12;
      if (fret === 0) fret = 12;
      if (!best || fret < best.fret) best = { fret, rel, family };
    }
    if (!best) return null;
    const frets = best.rel.map((f) => (f < 0 ? -1 : f + best.fret - 1));
    const played = frets.filter((f) => f >= 0);
    const barre = best.rel.filter((f) => f === 1).length >= 2 ? { fret: best.fret, from: frets.findIndex((f) => f === best.fret), to: 5 - [...frets].reverse().findIndex((f) => f === best.fret) } : null;
    const baseFret = Math.max(1, Math.min(...played) );
    return { frets, baseFret: baseFret > 1 ? baseFret : 1, barre, bassShown: false };
  }

  const MODEL = { parse, pianoNotes, guitarShape, INTERVALS, OPEN, SHARP_NAMES };
  if (shared) { module.exports = MODEL; return; }

  // --- the pop-up (pages) ----------------------------------------------------------------
  const INSTRUMENT_KEY = 'wa_chord_instrument';
  const INSTRUMENTS = ['guitar', 'piano'];
  let instrument = 'guitar';
  try { if (INSTRUMENTS.includes(localStorage.getItem(INSTRUMENT_KEY))) instrument = localStorage.getItem(INSTRUMENT_KEY); } catch { /* this page only */ }
  let dialog = null;
  let current = null;

  const svg = (tag, attrs = {}, ...children) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) node.setAttribute(k, String(v));
    for (const c of children.flat()) if (c) node.append(c);
    return node;
  };

  // Six strings, five frets; dots on the fingered frets, a bar for a barre, x / o over the
  // nut, the base fret number on the left when the shape sits higher up.
  function guitarSvg(shape) {
    const W = 120; const H = 140; const left = 24; const top = 28; const sw = 16; const fh = 20;
    const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chord-svg chord-guitar', role: 'img', 'aria-hidden': 'true' });
    const nut = shape.baseFret === 1;
    g.append(svg('rect', { x: left, y: top, width: sw * 5, height: nut ? 4 : 1.5, class: nut ? 'gtr-nut' : 'gtr-fret' }));
    for (let f = 1; f <= 5; f++) g.append(svg('line', { x1: left, x2: left + sw * 5, y1: top + fh * f, y2: top + fh * f, class: 'gtr-fret' }));
    for (let s = 0; s < 6; s++) g.append(svg('line', { x1: left + sw * s, x2: left + sw * s, y1: top, y2: top + fh * 5, class: 'gtr-string' }));
    if (!nut) g.append(svg('text', { x: left - 6, y: top + fh - 6, class: 'gtr-text', 'text-anchor': 'end' }, `${shape.baseFret}`));
    if (shape.barre) {
      const y = top + fh * (shape.barre.fret - shape.baseFret + 1) - fh / 2;
      g.append(svg('rect', { x: left + sw * shape.barre.from - 6, y: y - 6, width: sw * (shape.barre.to - shape.barre.from) + 12, height: 12, rx: 6, class: 'gtr-dot' }));
    }
    shape.frets.forEach((fret, s) => {
      const x = left + sw * s;
      if (fret < 0) g.append(svg('text', { x, y: top - 8, class: 'gtr-text', 'text-anchor': 'middle' }, '×'));
      else if (fret === 0) g.append(svg('circle', { cx: x, cy: top - 11, r: 4, class: 'gtr-open' }));
      else g.append(svg('circle', { cx: x, cy: top + fh * (fret - shape.baseFret + 1) - fh / 2, r: 6, class: 'gtr-dot' }));
    });
    return g;
  }

  // Two octaves from C; the chord's keys lit, the root and a slash bass marked.
  function pianoSvg(notes) {
    const W = 196; const H = 90; const ww = 14; const wh = 84; const bw = 9; const bh = 52;
    const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chord-svg chord-piano', role: 'img', 'aria-hidden': 'true' });
    const BLACK = [1, 3, 6, 8, 10];
    const whiteOf = (k) => { const pc = k % 12; const octave = Math.floor(k / 12); return octave * 7 + [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6][pc]; };
    const cls = (k) => `${notes.keys.includes(k) ? ' is-on' : ''}${k === notes.root ? ' is-root' : ''}${k === notes.bass ? ' is-bass' : ''}`;
    for (let k = 0; k < 24; k++) {
      if (BLACK.includes(k % 12)) continue;
      g.append(svg('rect', { x: whiteOf(k) * ww + 1, y: 2, width: ww - 1, height: wh, rx: 2, class: `pno-key pno-white${cls(k)}` }));
    }
    for (let k = 0; k < 24; k++) {
      if (!BLACK.includes(k % 12)) continue;
      g.append(svg('rect', { x: (whiteOf(k) + 1) * ww - bw / 2 + 0.5, y: 2, width: bw, height: bh, rx: 2, class: `pno-key pno-black${cls(k)}` }));
    }
    return g;
  }

  function build() {
    const { el } = root.PAGE;
    dialog = el('dialog', { class: 'chord-dialog', id: 'chord-dialog', 'aria-labelledby': 'chord-dialog-title' });
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); }); // the backdrop
    document.body.append(dialog);
  }

  function setInstrument(value) {
    instrument = value;
    try { localStorage.setItem(INSTRUMENT_KEY, value); } catch { /* this page only */ }
    if (current) render();
  }

  function render() {
    const { el } = root.PAGE;
    const { t } = root.I18N;
    const parsed = current;
    const shown = root.NOTATION ? root.NOTATION.chord(parsed.label) : parsed.label;
    let picture;
    let note = null;
    if (instrument === 'piano') {
      picture = pianoSvg(pianoNotes(parsed));
    } else {
      const shape = guitarShape(parsed);
      picture = shape ? guitarSvg(shape) : el('p', { class: 'muted chord-none', text: t('chordDiagram.noGuitar') });
      if (shape && parsed.bass !== null && !shape.bassShown) note = t('chordDiagram.bass', { note: root.NOTATION ? root.NOTATION.chord(parsed.bassName) : parsed.bassName });
    }
    dialog.replaceChildren(
      el('div', { class: 'chord-dialog-head' },
        el('h2', { id: 'chord-dialog-title', text: shown }),
        el('button', { type: 'button', class: 'secondary chord-close', 'data-icon': 'close', 'aria-label': t('chordDiagram.close'), onclick: () => dialog.close() })),
      el('div', { class: 'choice-group chord-instrument', role: 'group', 'aria-label': t('chordDiagram.instrument') },
        ...INSTRUMENTS.map((v) => el('button', { type: 'button', 'data-instrument': v, 'aria-pressed': String(v === instrument), text: t(`chordDiagram.${v}`), onclick: () => setInstrument(v) }))),
      el('div', { class: 'chord-picture' }, picture),
      ...(note ? [el('p', { class: 'muted chord-bass', text: note })] : []));
  }

  // The pop-up for a chord (letters or solfège); a chord we do not know says so.
  function open(chord) {
    const parsed = parse(chord);
    if (!dialog) build();
    current = parsed;
    if (!parsed) {
      const { el } = root.PAGE;
      const { t } = root.I18N;
      dialog.replaceChildren(
        el('div', { class: 'chord-dialog-head' }, el('h2', { id: 'chord-dialog-title', text: String(chord) }), el('button', { type: 'button', class: 'secondary chord-close', 'data-icon': 'close', 'aria-label': t('chordDiagram.close'), onclick: () => dialog.close() })),
        el('p', { class: 'muted chord-none', text: t('chordDiagram.unknown') }));
    } else {
      render();
    }
    if (!dialog.open) dialog.showModal();
  }

  // Tapped chords (song-render.js renders them as .chord-tap) anywhere on the page.
  document.addEventListener('click', (event) => {
    const tap = event.target.closest('.chord-tap');
    if (tap) open(tap.dataset.chord || tap.textContent);
  });
  document.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.classList && event.target.classList.contains('chord-tap')) {
      event.preventDefault();
      open(event.target.dataset.chord || event.target.textContent);
    }
  });
  document.addEventListener('i18n:change', () => { if (dialog && dialog.open && current) render(); });

  root.CHORD_DIAGRAMS = { ...MODEL, open, instrument: () => instrument };
})(typeof window !== 'undefined' ? window : this);
