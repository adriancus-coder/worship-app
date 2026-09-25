'use strict';

// Arranging a song for an event while seeing all of it: a bottom sheet on phones (up to
// 95vh), a large dialog on tablets and desktops (backdrop, ✕, Escape; a modal <dialog>
// keeps the focus inside).
//
// From 900 px, two columns: "Cântarea" (every section with lyrics and chords, transposed,
// in the reader's notation or "Doar text", each with "+ Adaugă") and "Ordinea" (the
// arrangement: code, label and first line, ↑ / ↓ / ✕, "Resetează la implicit", the key
// −/+ "A · original G · +2"), with "Cum va curge" (the whole song in that order, repeats
// included) under it. Below 900 px the three are tabs. Nothing changes until "Aplică".
// "+ Adaugă" puts the section after the chosen row of "Ordinea" (the last one by default).
//
//   ARRANGE_SHEET.open({ title, song: { sections, song_key }, codes, defaultCodes,
//     transpose, readOnly, onApply({ codes, transpose, isDefault }) })
//   readOnly (the team): the whole song in the event's order, no controls.
//
// The list logic below is pure and shared with scripts/test-lib.js.

(function (root) {
  const isNode = typeof module === 'object' && module.exports;
  const CHORDS = isNode ? require('./chords.js') : root.CHORDS;
  const SECTIONS = isNode ? require('./sections.js') : root.SECTIONS;
  const TRANSPOSE_MAX = 11; // lib/events.js LIMITS.transposeMax

  // --- the arrangement as a list of section codes ------------------------------------

  // code inserted after index `after` (-1: first; null / out of range: last).
  function insert(codes, code, after = null) {
    const next = codes.slice();
    const at = after === null || after >= codes.length ? codes.length : Math.max(0, after + 1);
    next.splice(at, 0, code);
    return next;
  }

  function move(codes, index, delta) {
    const to = index + delta;
    if (index < 0 || index >= codes.length || to < 0 || to >= codes.length) return codes.slice();
    const next = codes.slice();
    [next[index], next[to]] = [next[to], next[index]];
    return next;
  }

  function remove(codes, index) {
    return codes.filter((code, i) => i !== index);
  }

  const sameCodes = (a, b) => a.length === b.length && a.every((code, i) => code === b[i]);

  function clampTranspose(value) {
    const n = Math.trunc(Number(value) || 0);
    return Math.max(-TRANSPOSE_MAX, Math.min(TRANSPOSE_MAX, n));
  }

  const offsetText = (n) => (n > 0 ? `+${n}` : String(n));

  // The song in arrangement order, repeats included: [{ code, index }] (unknown codes skipped).
  function flow(sections, codes) {
    return codes.map((code) => ({ code, index: SECTIONS.codeIndex(code, sections) })).filter((x) => x.index >= 0);
  }

  // The first lyric line of a section (chords stripped).
  function firstLine(content) {
    return CHORDS.stripChords(content || '').split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).find(Boolean) || '';
  }

  // Sections with their chords moved to the key after `transpose` semitones.
  function transposed(song, transpose) {
    const key = CHORDS.keyAfter(song.song_key, transpose);
    return song.sections.map((s) => ({ ...s, content: CHORDS.transposeContent(s.content, transpose, key) }));
  }

  const LOGIC = { TRANSPOSE_MAX, insert, move, remove, sameCodes, clampTranspose, offsetText, flow, firstLine, transposed };
  if (isNode) {
    module.exports = LOGIC;
    return;
  }

  // --- the sheet ----------------------------------------------------------------------

  const WIDE = window.matchMedia('(min-width: 900px)');
  const TEXT_ONLY_KEY = 'wa_text_only'; // the same choice as the song and rehearsal pages

  function readTextOnly() {
    try {
      return window.localStorage.getItem(TEXT_ONLY_KEY) === '1';
    } catch (err) {
      return false;
    }
  }

  function writeTextOnly(value) {
    try {
      window.localStorage.setItem(TEXT_ONLY_KEY, value ? '1' : '0');
    } catch (err) {
      // no storage: this sheet only
    }
  }

  function open({ title, song, codes, defaultCodes, transpose = 0, readOnly = false, onApply }) {
    const { el } = window.PAGE;
    const { t } = window.I18N;
    const labels = SECTIONS.sectionLabels(song.sections, t);
    const canonical = SECTIONS.sectionCodes(song.sections);
    const labelOf = (code) => labels[canonical.indexOf(code)] || code;
    const state = {
      codes: codes.slice(),
      transpose: clampTranspose(transpose),
      selected: codes.length - 1, // "+ Adaugă" inserts after this row
      tab: readOnly ? 'flow' : 'order',
      textOnly: readTextOnly(),
    };

    const dialog = el('dialog', { class: `preview-dialog arrange-sheet${readOnly ? ' read-only' : ''}`, 'aria-labelledby': 'arrange-title' });
    const heading = el('h2', { id: 'arrange-title', tabindex: '-1', text: title });
    const keyOut = el('output', { class: 'key-display arrange-key', 'aria-live': 'polite' });
    const panels = {
      order: el('section', { class: 'arrange-panel arrange-order', 'aria-labelledby': 'arrange-order-h', id: 'arrange-panel-order', role: readOnly ? null : 'tabpanel' }),
      song: el('section', { class: 'arrange-panel arrange-song', 'aria-labelledby': 'arrange-song-h', id: 'arrange-panel-song', role: readOnly ? null : 'tabpanel' }),
      flow: el('section', { class: 'arrange-panel arrange-flow', 'aria-labelledby': 'arrange-flow-h', id: 'arrange-panel-flow', role: readOnly ? null : 'tabpanel' }),
    };
    const tabs = el('div', { class: 'tabs arrange-tabs', role: 'tablist', 'aria-label': t('arrange.tabsLabel') },
      ['order', 'song', 'flow'].map((name) => el('button', {
        type: 'button', role: 'tab', id: `arrange-tab-${name}`, 'aria-controls': `arrange-panel-${name}`, 'data-tab': name,
        onclick: () => { state.tab = name; renderTabs(); },
      }, t(`arrange.${name}`))));
    const body = el('div', { class: 'preview-dialog-body arrange-body' }, readOnly ? null : tabs,
      el('div', { class: 'arrange-cols' }, readOnly ? [panels.flow] : [panels.song, panels.order, panels.flow]));
    const close = () => dialog.close();
    const apply = el('button', {
      type: 'button', 'data-icon': 'check', id: 'arrange-apply',
      onclick: () => {
        close();
        if (onApply) onApply({ codes: state.codes.slice(), transpose: state.transpose, isDefault: sameCodes(state.codes, defaultCodes) });
      },
    }, t('arrange.apply'));
    dialog.append(
      el('div', { class: 'preview-dialog-head' },
        el('div', { class: 'preview-dialog-title' },
          el('p', { class: 'preview-kicker', text: t(readOnly ? 'arrange.kickerReadOnly' : 'arrange.kicker') }),
          heading),
        el('button', { type: 'button', class: 'shell-close preview-close-x', id: 'arrange-close-x', 'aria-label': t('arrange.close'), onclick: close }, '✕')),
      body,
      el('div', { class: 'preview-dialog-foot' },
        el('div', { class: 'form-actions' }, readOnly
          ? el('button', { type: 'button', class: 'secondary', id: 'arrange-cancel', onclick: close }, t('arrange.close'))
          : [el('button', { type: 'button', class: 'secondary', id: 'arrange-cancel', onclick: close }, t('arrange.cancel')), apply])));

    // A tap on the dimmed area closes it (like "Mai mult"): the same as Anulează.
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close();
    });

    function keyText() {
      if (!song.song_key) return state.transpose ? t('arrange.keyNoKey', { offset: offsetText(state.transpose) }) : t('options.keyNoKeyNone');
      const now = window.NOTATION.chord(CHORDS.keyAfter(song.song_key, state.transpose));
      const original = window.NOTATION.chord(song.song_key);
      return state.transpose
        ? t('options.keyDisplay', { key: now, original, offset: offsetText(state.transpose) })
        : t('options.keyOriginalOnly', { key: original });
    }

    function sectionsBlock(sections, indexes, headingLevel) {
      return window.SONG_RENDER.sectionsView(indexes.map((i) => sections[i]), {
        textOnly: state.textOnly, headingLevel, labels: indexes.map((i) => labels[i]),
      });
    }

    function textOnlyToggle() {
      return el('button', {
        type: 'button', class: 'secondary arrange-text-only', 'aria-pressed': String(state.textOnly),
        onclick: () => { state.textOnly = !state.textOnly; writeTextOnly(state.textOnly); render(); },
      }, t('song.textOnly'));
    }

    function renderSong(sections) {
      const views = sectionsBlock(sections, sections.map((s, i) => i), 4);
      panels.song.replaceChildren(
        el('div', { class: 'arrange-panel-head' },
          el('h3', { id: 'arrange-song-h', text: t('arrange.song') }),
          el('div', { class: 'arrange-tools' }, window.NOTATION.createSwitch(), textOnlyToggle())),
        el('ol', { class: 'arrange-sections' }, views.map((view, i) => el('li', null,
          view,
          el('button', {
            type: 'button', class: 'secondary arrange-add', 'data-icon': 'plus', 'data-code': canonical[i],
            'aria-label': t('arrange.addLabel', { label: labels[i], after: state.codes[state.selected] ? labelOf(state.codes[state.selected]) : t('arrange.atStart') }),
            onclick: () => {
              state.codes = insert(state.codes, canonical[i], state.codes.length ? state.selected : null);
              state.selected = Math.min(state.selected + 1, state.codes.length - 1);
              if (state.codes.length === 1) state.selected = 0;
              render();
            },
          }, t('arrange.add'))))));
    }

    function renderOrder() {
      const row = (code, i) => {
        const index = SECTIONS.codeIndex(code, song.sections);
        const line = index >= 0 ? firstLine(song.sections[index].content) : '';
        const tool = (symbol, labelKey, disabled, onclick) => el('button', {
          type: 'button', class: 'secondary icon-button', disabled, 'aria-label': t(labelKey, { label: labelOf(code), n: i + 1 }), onclick,
        }, el('span', { 'aria-hidden': 'true', text: symbol }));
        return el('li', { class: 'arrange-row' },
          el('button', {
            type: 'button', class: 'arrange-pick', 'aria-pressed': String(i === state.selected), title: line || null,
            'aria-label': t('arrange.rowLabel', { n: i + 1, label: labelOf(code), line }),
            onclick: () => { state.selected = i; render(); },
          },
          el('span', { class: 'step-head' }, el('span', { class: 'step-code', text: code }), el('span', { class: 'step-label', text: labelOf(code) })),
          line ? el('span', { class: 'step-line', text: line }) : null),
          el('span', { class: 'arrange-row-tools' },
            tool('↑', 'arrange.upLabel', i === 0, () => { state.codes = move(state.codes, i, -1); state.selected = i - 1; render(); }),
            tool('↓', 'arrange.downLabel', i === state.codes.length - 1, () => { state.codes = move(state.codes, i, 1); state.selected = i + 1; render(); }),
            tool('✕', 'arrange.removeLabel', false, () => {
              state.codes = remove(state.codes, i);
              state.selected = Math.min(state.selected, state.codes.length - 1);
              render();
            })));
      };
      const setTranspose = (value) => { state.transpose = clampTranspose(value); render(); };
      keyOut.textContent = keyText();
      panels.order.replaceChildren(
        el('div', { class: 'arrange-panel-head' }, el('h3', { id: 'arrange-order-h', text: t('arrange.order') })),
        el('div', { class: 'key-row arrange-key-row', role: 'group', 'aria-label': t('options.keyLabel') },
          el('button', { type: 'button', class: 'secondary icon-button', id: 'arrange-key-down', 'aria-label': t('options.keyDown'), disabled: state.transpose <= -TRANSPOSE_MAX, onclick: () => setTranspose(state.transpose - 1) }, el('span', { 'aria-hidden': 'true', text: '−' })),
          keyOut,
          el('button', { type: 'button', class: 'secondary icon-button', id: 'arrange-key-up', 'aria-label': t('options.keyUp'), disabled: state.transpose >= TRANSPOSE_MAX, onclick: () => setTranspose(state.transpose + 1) }, el('span', { 'aria-hidden': 'true', text: '+' }))),
        state.codes.length
          ? el('ol', { class: 'arrange-list', 'aria-label': t('arrange.order') }, state.codes.map(row))
          : el('p', { class: 'muted', text: t('arrange.empty') }),
        el('p', { class: 'hint arrange-hint', text: state.codes.length ? t('arrange.addHint', { label: labelOf(state.codes[state.selected]) }) : t('arrange.addHintEmpty') }),
        el('button', {
          type: 'button', class: 'secondary', id: 'arrange-reset', disabled: sameCodes(state.codes, defaultCodes),
          onclick: () => { state.codes = defaultCodes.slice(); state.selected = state.codes.length - 1; render(); },
        }, t('options.resetArrangement')));
    }

    function renderFlow(sections) {
      const order = flow(sections, state.codes);
      panels.flow.replaceChildren(
        el('div', { class: 'arrange-panel-head' },
          el('h3', { id: 'arrange-flow-h', text: t(readOnly ? 'arrange.flowReadOnly' : 'arrange.flow') }),
          readOnly ? el('div', { class: 'arrange-tools' }, window.NOTATION.createSwitch(), textOnlyToggle()) : null),
        el('p', { class: 'muted arrange-flow-codes', text: order.map((x) => x.code).join(' · ') || t('arrange.empty') }),
        el('div', { class: 'arrange-flow-sections' }, sectionsBlock(sections, order.map((x) => x.index), 4)));
    }

    function renderTabs() {
      const wide = WIDE.matches;
      for (const button of tabs.querySelectorAll('[role="tab"]')) {
        const on = button.dataset.tab === state.tab;
        button.setAttribute('aria-selected', String(on));
        button.tabIndex = on ? 0 : -1;
      }
      tabs.hidden = wide || readOnly;
      for (const [name, panel] of Object.entries(panels)) panel.hidden = !readOnly && !wide && name !== state.tab;
    }

    function render() {
      const scroll = body.scrollTop;
      const sections = transposed(song, state.transpose);
      if (!readOnly) {
        renderSong(sections);
        renderOrder();
      }
      renderFlow(sections);
      renderTabs();
      body.scrollTop = scroll;
    }

    const onWide = () => renderTabs();
    const onNotation = () => render();
    WIDE.addEventListener('change', onWide);
    document.addEventListener('notation:change', onNotation);
    dialog.addEventListener('close', () => {
      WIDE.removeEventListener('change', onWide);
      document.removeEventListener('notation:change', onNotation);
      dialog.remove();
    });
    render();
    document.body.append(dialog);
    dialog.showModal();
    heading.focus({ preventScroll: true });
    return { dialog };
  }

  root.ARRANGE_SHEET = { ...LOGIC, open };
})(typeof window !== 'undefined' ? window : this);
