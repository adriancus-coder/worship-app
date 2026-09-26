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
// "+ Adaugă" appends the section to the order; ↑ / ↓ move it.
//
//   ARRANGE_SHEET.open({ title, song: { sections, song_key }, codes, defaultCodes,
//     transpose, readOnly, onApply({ codes, transpose, isDefault }) })
//   readOnly (the team): the whole song in the event's order, no controls.
//   ARRANGE_SHEET.openForItem(item, { readOnly, onApply })   // an event's song item
//   ARRANGE_SHEET.saveToEvent(eventId, itemId, result)       // saves at once (live pages)
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

  // canSetKey: a song without a key offers a key picker, saved to the library song.
  // goTo: the live pages' "Mergi la cântare" (tapping a song there opens this sheet).
  function open({ title, song, codes, defaultCodes, transpose = 0, readOnly = false, canSetKey = false, goTo = null, onApply }) {
    const { el } = window.PAGE;
    const { t } = window.I18N;
    const labels = SECTIONS.sectionLabels(song.sections, t);
    const canonical = SECTIONS.sectionCodes(song.sections);
    const labelOf = (code) => labels[canonical.indexOf(code)] || code;
    const state = {
      codes: codes.slice(),
      transpose: clampTranspose(transpose),
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
          : [
            goTo ? el('button', { type: 'button', class: 'secondary', id: 'arrange-goto', 'data-icon': 'jump', onclick: () => { close(); goTo(); } }, t('arrange.goTo')) : null,
            el('button', { type: 'button', class: 'secondary', id: 'arrange-cancel', onclick: close }, t('arrange.cancel')), apply])));

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

    // Sections headed by code + label ("C · Refren").
    function sectionsBlock(sections, indexes, headingLevel) {
      return window.SONG_RENDER.sectionsView(indexes.map((i) => sections[i]), {
        textOnly: state.textOnly, headingLevel, labels: indexes.map((i) => `${canonical[i]} · ${labels[i]}`),
      });
    }

    function textOnlyToggle() {
      return el('button', {
        type: 'button', class: 'secondary arrange-text-only', 'aria-pressed': String(state.textOnly),
        onclick: () => { state.textOnly = !state.textOnly; writeTextOnly(state.textOnly); render(); },
      }, t('song.textOnly'));
    }

    // Every section: a head (code + label, "+ Adaugă" appends it), then its lyrics / chords.
    function renderSong(sections) {
      const views = sectionsBlock(sections, sections.map((s, i) => i), 4);
      panels.song.replaceChildren(
        el('div', { class: 'arrange-panel-head' },
          el('h3', { id: 'arrange-song-h', text: t('arrange.song') }),
          el('div', { class: 'arrange-tools' }, window.NOTATION.createSwitch(), textOnlyToggle())),
        el('ol', { class: 'arrange-sections' }, views.map((view, i) => {
          const heading = view.querySelector('.section-label');
          heading.remove();
          return el('li', null,
            el('div', { class: 'arrange-section-head' },
              heading,
              el('button', {
                type: 'button', class: 'secondary arrange-add', 'data-icon': 'plus', 'data-code': canonical[i],
                'aria-label': t('arrange.addLabel', { label: `${canonical[i]} · ${labels[i]}` }),
                onclick: () => { state.codes = insert(state.codes, canonical[i]); render(); },
              }, t('arrange.add'))),
            view);
        })));
    }

    function renderOrder() {
      const row = (code, i) => {
        const index = SECTIONS.codeIndex(code, song.sections);
        const line = index >= 0 ? firstLine(song.sections[index].content) : '';
        const tool = (symbol, labelKey, disabled, onclick) => el('button', {
          type: 'button', class: 'secondary icon-button', disabled, 'aria-label': t(labelKey, { label: labelOf(code), n: i + 1 }), onclick,
        }, el('span', { 'aria-hidden': 'true', text: symbol }));
        return el('li', { class: 'arrange-row' },
          el('div', { class: 'arrange-row-main', title: line || null },
            el('span', { class: 'step-head' }, el('span', { class: 'step-code', text: code }), el('span', { class: 'step-label', text: labelOf(code) })),
            line ? el('span', { class: 'step-line', text: line }) : null),
          el('span', { class: 'arrange-row-tools' },
            tool('↑', 'arrange.upLabel', i === 0, () => { state.codes = move(state.codes, i, -1); render(); }),
            tool('↓', 'arrange.downLabel', i === state.codes.length - 1, () => { state.codes = move(state.codes, i, 1); render(); }),
            tool('✕', 'arrange.removeLabel', false, () => { state.codes = remove(state.codes, i); render(); })));
      };
      const setTranspose = (value) => { state.transpose = clampTranspose(value); render(); };
      keyOut.textContent = keyText();
      panels.order.replaceChildren(
        el('div', { class: 'arrange-panel-head' }, el('h3', { id: 'arrange-order-h', text: t('arrange.order') })),
        song.song_key ? null : keyMissing(),
        el('div', { class: 'key-row arrange-key-row', role: 'group', 'aria-label': t('options.keyLabel') },
          el('button', { type: 'button', class: 'secondary icon-button', id: 'arrange-key-down', 'aria-label': t('options.keyDown'), disabled: state.transpose <= -TRANSPOSE_MAX, onclick: () => setTranspose(state.transpose - 1) }, el('span', { 'aria-hidden': 'true', text: '−' })),
          keyOut,
          el('button', { type: 'button', class: 'secondary icon-button', id: 'arrange-key-up', 'aria-label': t('options.keyUp'), disabled: state.transpose >= TRANSPOSE_MAX, onclick: () => setTranspose(state.transpose + 1) }, el('span', { 'aria-hidden': 'true', text: '+' }))),
        state.codes.length
          ? el('ol', { class: 'arrange-list', 'aria-label': t('arrange.order') }, state.codes.map(row))
          : el('p', { class: 'muted', text: t('arrange.empty') }),
        el('p', { class: 'hint arrange-hint', text: t('arrange.addHint') }),
        el('button', {
          type: 'button', class: 'secondary', id: 'arrange-reset', disabled: sameCodes(state.codes, defaultCodes),
          onclick: () => { state.codes = defaultCodes.slice(); render(); },
        }, t('options.resetArrangement')));
    }

    // "Tonul original nu e setat" (common for imports): owner / leader pick it here; it is
    // saved on the library song (PUT /api/songs/:id with the key only).
    function keyMissing() {
      const box = el('div', { class: 'arrange-key-missing', role: 'note' }, el('p', { class: 'arrange-key-missing-text', text: t('arrange.keyMissing') }));
      if (!canSetKey) return box;
      const message = el('p', { class: 'message', role: 'status' });
      const select = el('select', {
        id: 'arrange-key-pick', 'aria-label': t('arrange.keyPick'),
        onchange: async () => {
          if (!select.value) return;
          select.disabled = true;
          const res = await window.PAGE.api(`/api/songs/${song.id}`, { method: 'PUT', body: { song_key: select.value } }).catch(() => null);
          if (res && res.ok) {
            song.song_key = res.body.song.song_key;
            render();
            return;
          }
          select.disabled = false;
          message.className = 'message error';
          message.textContent = (res && res.body && res.body.error) || t('common.networkError');
        },
      }, el('option', { value: '', text: t('arrange.keyPick') }),
      SECTIONS.SONG_KEYS.map((key) => el('option', { value: key, text: window.NOTATION.chord(key) })));
      box.append(select, message);
      return box;
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

  // --- entry points: an event item -------------------------------------------------------

  // Opens the sheet for a song item of an event (its song from the library; codes and key
  // from the item). readOnly: the team's view. Resolves false when the song cannot load.
  async function openForItem(item, { readOnly = false, goTo = null, onApply } = {}) {
    const { api, canEdit } = window.PAGE;
    if (!item || item.type !== 'song' || !item.songId) return false;
    const [res, me] = await Promise.all([api(`/api/songs/${item.songId}`).catch(() => null), readOnly ? null : api('/api/auth/me').catch(() => null)]);
    if (!res || !res.ok) return false;
    const song = res.body.song;
    const defaults = SECTIONS.defaultArrangement(song);
    const codes = Array.isArray(item.arrangementCodes) ? item.arrangementCodes
      : (item.arrangementResolved || []).map((r) => r.code);
    open({
      title: item.title || song.title, song, codes: codes.length ? codes : defaults, defaultCodes: defaults, transpose: item.transpose || 0,
      readOnly, goTo, onApply, canSetKey: Boolean(me && me.ok && canEdit(me.body)),
    });
    return true;
  }

  // Saves a new arrangement / key for one song item right away (the live pages): the
  // event's shared setlist as the server has it now, with only that item changed.
  // Returns { ok } or { error }.
  async function saveToEvent(eventId, itemId, { codes, transpose, isDefault }) {
    const { api } = window.PAGE;
    const { t } = window.I18N;
    const fail = (res) => ({ error: (res && res.body && res.body.error) || t('common.networkError') });
    const current = await api(`/api/events/${eventId}`).catch(() => null);
    if (!current || !current.ok) return fail(current);
    const items = current.body.items.filter((it) => it.scope !== 'projector').map((it) => {
      const out = {
        id: it.id, type: it.type, songId: it.type === 'song' ? it.songId : null,
        mediaId: it.type === 'video' ? it.mediaId : null,
        title: it.title || '', body: it.body || '', reference: it.reference || '', url: it.url || '', durationMin: it.durationMin,
      };
      if (it.type !== 'video') out.background = it.background || null;
      if (it.type === 'song') {
        const mine = it.id === itemId;
        Object.assign(out, {
          transpose: mine ? transpose : (it.transpose || 0),
          arrangement: mine ? (isDefault ? null : codes.join(' ')) : (it.arrangementIsDefault ? null : it.arrangement || null),
          teamNote: it.teamNote || '', referenceUrl: it.referenceUrl || '',
        });
      }
      return out;
    });
    const res = await api(`/api/events/${eventId}/items`, { method: 'PUT', body: { items } }).catch(() => null);
    return res && res.ok ? { ok: true } : fail(res);
  }

  root.ARRANGE_SHEET = { ...LOGIC, open, openForItem, saveToEvent };
})(typeof window !== 'undefined' ? window : this);
