'use strict';

// The key popover under a Program row (the home card, the live page's Program): the 12 keys
// to choose from. A song WITH a key in the library: the key sung at this event (a tap saves
// the transposition for the event). A song WITHOUT one: the same row sets the song's key in
// the library (the library right), with a "minor" switch for Lam / Mim …; without that
// right, a hint. The caller keeps the state (which row is picked, busy, minor) and re-renders.
//
//   KEY_POPOVER.build({ title, songKey, transpose, canSetKey, minor, busy, onMinor, onTranspose, onSetKey, arrow })
//     songKey       the library key, or '' / null
//     transpose     semitones for this event (with a songKey)
//     onTranspose(semitones)   a key picked for the event (-5..6)
//     onSetKey(key)            a library key picked (e.g. 'D', 'Em')
//     onMinor()                the "minor" switch tapped
//     arrow         'right' (the badge at the row's right, the default) | 'left'
//   -> the element (.now-key-row), or a hint paragraph

(function () {
  const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const keyIndex = (key) => { const m = /^([A-G])([#b]?)/.exec(String(key || '')); return m ? (NOTE_INDEX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12 : null; };

  function build({ title, songKey, transpose = 0, canSetKey = false, minor = false, busy = false, onMinor, onTranspose, onSetKey, arrow = 'right' }) {
    const { el } = window.PAGE;
    const { t } = window.I18N;
    const row = (label, children) => el('div', { class: `now-key-row${arrow === 'left' ? ' arrow-left' : ''}` },
      el('span', { class: 'now-section-label', id: 'now-key-label', text: label }), ...children);
    if (!songKey) {
      if (!canSetKey) return el('p', { class: 'muted now-key-hint', text: t('home.keyNoKey') });
      const base = minor ? 'Am' : 'C';
      const keys = [];
      for (let n = 0; n < 12; n++) keys.push(window.CHORDS.keyAfter(base, n));
      keys.sort((a, b) => keyIndex(a) - keyIndex(b));
      return row(t('home.keySetLabel', { title }), [
        el('div', { class: 'now-key-set' },
          el('button', { type: 'button', class: 'now-key-minor', 'aria-pressed': String(minor), text: t('home.keyMinor'), onclick: () => onMinor && onMinor() }),
          el('div', { class: 'choice-group now-keys', role: 'group', 'aria-labelledby': 'now-key-label' },
            ...keys.map((k) => el('button', { type: 'button', 'data-key': k, 'aria-pressed': 'false', disabled: busy ? 'disabled' : null, text: window.NOTATION.chord(k), onclick: () => onSetKey && onSetKey(k) })))),
      ]);
    }
    const base = keyIndex(songKey);
    const current = ((transpose % 12) + 12) % 12;
    const keys = [];
    for (let n = 0; n < 12; n++) keys.push({ n, name: window.CHORDS.keyAfter(songKey, n), index: (base + n) % 12 });
    keys.sort((a, b) => a.index - b.index);
    return row(t('home.keyLabel', { title }), [
      el('div', { class: 'choice-group now-keys', role: 'group', 'aria-labelledby': 'now-key-label' },
        ...keys.map((k) => el('button', {
          type: 'button', 'data-key': k.name, 'aria-pressed': String(k.n === current), disabled: busy ? 'disabled' : null,
          text: window.NOTATION.chord(k.name),
          onclick: () => { if (k.n !== current && onTranspose) onTranspose(k.n > 6 ? k.n - 12 : k.n); },
        }))),
    ]);
  }

  window.KEY_POPOVER = { build, keyIndex };
})();
