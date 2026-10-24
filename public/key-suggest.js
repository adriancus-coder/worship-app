'use strict';

// "Detectează gama la toate" on /library (the "⋯" menu, owner and leader): the server
// estimates the key of every song that has chords but no key (GET /api/songs/key-suggestions,
// lib/key-detect.js). The review replaces the library's search and list: one row per song
// with a checkbox, the title, the key to save (the best estimate first, the two other
// candidates, then every other key) and the confidence; "Salvează N game" sends the ticked
// rows (PUT /api/songs/keys), which sets a key only where none is set yet.

(function () {
  const { api, el } = window.PAGE;
  const { t } = window.I18N;
  const CONFIDENCE_KEYS = { sure: 'keyDetect.sure', likely: 'keyDetect.likely', unsure: 'keyDetect.unsure' };

  const review = document.getElementById('key-review');
  if (!review) return;
  const heading = document.getElementById('key-review-heading');
  const status = document.getElementById('key-review-status');
  const errorBox = document.getElementById('key-review-error');
  const tools = document.getElementById('key-review-tools');
  const listBox = document.getElementById('key-review-list');
  const actions = document.getElementById('key-review-actions');
  const saveButton = document.getElementById('key-review-save');
  const libraryParts = ['library-search', 'library-results'].map((id) => document.getElementById(id));

  const state = { songs: null, withoutChords: 0, rows: new Map(), status: null, error: null, busy: false, result: null };
  let hiddenBefore = [];

  function keyText(key) {
    return window.NOTATION ? window.NOTATION.chord(key) : key;
  }

  function ticked() {
    return state.songs ? state.songs.filter((s) => state.rows.get(s.id).checked) : [];
  }

  function keySelect(song) {
    const others = window.SECTIONS.SONG_KEYS.filter((k) => k !== song.key && !song.alternatives.includes(k));
    const select = el('select', { class: 'key-review-select', 'aria-label': t('keySuggest.keyFor', { title: song.title }) },
      el('optgroup', { label: t('keySuggest.candidates') },
        [song.key, ...song.alternatives].map((k) => el('option', { value: k, text: keyText(k) }))),
      el('optgroup', { label: t('keySuggest.otherKeys') }, others.map((k) => el('option', { value: k, text: keyText(k) }))));
    select.value = state.rows.get(song.id).key;
    select.addEventListener('change', () => { state.rows.get(song.id).key = select.value; });
    return select;
  }

  function row(song) {
    const entry = state.rows.get(song.id);
    const box = el('input', { type: 'checkbox', class: 'key-review-check', id: `key-review-${song.id}`, checked: entry.checked, 'aria-label': t('keySuggest.tick', { title: song.title }) });
    box.addEventListener('change', () => { entry.checked = box.checked; renderActions(); });
    return el('li', { class: 'key-review-row', 'data-song-id': song.id },
      box,
      el('div', { class: 'key-review-main' },
        el('a', { class: 'key-review-title', href: `/songs/${song.id}`, text: song.title }),
        el('span', { class: 'muted key-review-meta' }, `${t('keySuggest.chords', { n: song.chords })} · `,
          el('span', { class: `key-detect-confidence is-${song.confidence}`, text: t(CONFIDENCE_KEYS[song.confidence]) }))),
      keySelect(song));
  }

  function renderActions() {
    const n = ticked().length;
    saveButton.disabled = n === 0 || state.busy;
    saveButton.textContent = state.busy ? t('keySuggest.saving') : n === 1 ? t('keySuggest.saveOne') : t('keySuggest.save', { n });
  }

  function render() {
    status.textContent = state.status ? t(state.status, state.result || {}) : '';
    errorBox.textContent = state.error ? (state.error.key ? t(state.error.key) : state.error.text) : '';
    const songs = state.songs || [];
    tools.hidden = !songs.length;
    actions.hidden = Boolean(state.result);
    document.getElementById('key-review-finish').hidden = !state.result;
    listBox.replaceChildren(...(state.songs === null ? [] : songs.length
      ? [el('ul', { class: 'key-review-rows', 'aria-label': t('keySuggest.heading') }, songs.map(row)),
        state.withoutChords ? el('p', { class: 'muted key-review-note', text: t('keySuggest.withoutChords', { n: state.withoutChords }) }) : null]
      : [el('p', { class: 'muted pane-state', text: t(state.withoutChords ? 'keySuggest.noneWithChords' : 'keySuggest.none', { n: state.withoutChords }) })]));
    renderActions();
  }

  function open() {
    hiddenBefore = libraryParts.map((node) => node.hidden);
    libraryParts.forEach((node) => { node.hidden = true; });
    review.hidden = false;
    heading.focus();
  }

  function close() {
    review.hidden = true;
    libraryParts.forEach((node, i) => { node.hidden = hiddenBefore[i]; });
    Object.assign(state, { songs: null, withoutChords: 0, rows: new Map(), status: null, error: null, busy: false, result: null });
    document.getElementById('library-menu-button').focus();
  }

  async function load() {
    Object.assign(state, { songs: null, rows: new Map(), status: 'keySuggest.loading', error: null, result: null });
    open();
    render();
    const res = await api('/api/songs/key-suggestions').catch(() => null);
    if (!res || !res.ok) {
      state.status = null;
      state.error = { text: (res && res.body && res.body.error) || t('common.networkError') };
    } else {
      state.songs = res.body.songs;
      state.withoutChords = res.body.withoutChords;
      // ticked by default when the estimate is sure or likely; an unsure one is for the user to decide
      for (const song of state.songs) state.rows.set(song.id, { key: song.key, checked: song.confidence !== 'unsure' });
      state.status = state.songs.length ? 'keySuggest.intro' : null;
    }
    render();
  }

  async function save() {
    const keys = ticked().map((s) => ({ id: s.id, song_key: state.rows.get(s.id).key }));
    if (!keys.length) return;
    state.busy = true;
    state.error = null;
    render();
    const res = await api('/api/songs/keys', { method: 'PUT', body: { keys } }).catch(() => null);
    state.busy = false;
    if (res && res.ok) {
      state.result = { n: res.body.saved.length };
      state.status = 'keySuggest.saved';
      state.songs = state.songs.filter((s) => !res.body.saved.includes(s.id));
      document.dispatchEvent(new CustomEvent('library:changed'));
    } else {
      state.error = { text: (res && res.body && res.body.error) || t('common.networkError') };
    }
    render();
    if (state.result) document.getElementById('key-review-done').focus();
  }

  document.getElementById('detect-keys').addEventListener('click', load);
  document.getElementById('key-review-all').addEventListener('click', () => { state.rows.forEach((r) => { r.checked = true; }); render(); });
  document.getElementById('key-review-none').addEventListener('click', () => { state.rows.forEach((r) => { r.checked = false; }); render(); });
  saveButton.addEventListener('click', save);
  document.getElementById('key-review-cancel').addEventListener('click', close);
  document.getElementById('key-review-done').addEventListener('click', close);
  document.addEventListener('i18n:change', () => { if (!review.hidden) render(); });
  document.addEventListener('notation:change', () => { if (!review.hidden) render(); });
})();
