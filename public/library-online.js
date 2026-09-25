'use strict';

// resursecrestine.ro from the library's one search field (owner and leader). Enter or
// "Caută și pe resurse" searches the site (never on every keystroke) and shows "De pe
// resurse" under the library results; the section disappears as soon as the query changes
// (its results would be stale). A pasted resursecrestine.ro link opens its preview instead.
// Each result: Previzualizare (a bottom sheet on phones, a dialog on wider screens, with
// Importă) and a direct Importă; a title already in the library shows "Există deja".
// The server does all network access.

(function () {
  const { api, el, canEdit } = window.PAGE;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const input = $('q');
  const form = $('search-form');
  const button = $('online-search');
  const section = $('online-section');
  const status = $('online-status');
  const errorBox = $('online-error');
  const resultsList = $('online-results');
  const dialog = $('online-preview');
  const previewTitle = $('preview-title');
  const previewMeta = $('preview-meta');
  const previewSections = $('preview-sections');
  const previewMessage = $('preview-message');
  const importButton = $('preview-import');

  // Everything shown is rebuilt from this state, so a language switch re-renders it.
  const state = {
    allowed: false,
    shown: false, // the "De pe resurse" section
    query: '', // what the results (or the link preview) belong to
    results: null,
    rows: new Map(), // result id -> { kind: 'imported' | 'exists', songId } | { kind: 'error', text }
    status: null, // { key, vars, spin }
    error: null, // server text
    preview: null, // { source, resultId, song, existingId, invalid }
    outcome: null, // { kind: 'imported' | 'exists' | 'error', id?, text? }
    busy: false, // 'search' | 'preview' | 'import' | 'row:<id>'
  };

  const isLink = (text) => /^https?:\/\//i.test(text) || /(^|\.)resursecrestine\.ro\b/i.test(text);

  function failText(res) {
    return (res && res.body && res.body.error) || t('common.networkError');
  }

  // --- rendering ------------------------------------------------------------------

  function rowActions(item) {
    const row = state.rows.get(item.id);
    const existing = (row && (row.kind === 'imported' || row.kind === 'exists')) ? row.songId : item.existingId;
    if (existing) {
      const imported = row && row.kind === 'imported';
      return [
        el('span', { class: `row-state${imported ? ' success' : ''}`, text: t(imported ? 'online.importedShort' : 'online.exists') }),
        el('a', { class: 'button secondary', href: `/songs/${existing}`, text: t('online.open'), 'aria-label': t('online.openSongTitle', { title: item.title }) }),
      ];
    }
    const busy = Boolean(state.busy);
    return [
      el('button', {
        type: 'button', class: 'secondary', disabled: busy,
        'aria-label': t('online.previewSong', { title: item.title }),
        onclick: () => openPreview({ id: item.id }, item.id),
      }, t('online.preview')),
      el('button', {
        type: 'button', disabled: busy,
        'aria-label': t('online.importSong', { title: item.title }),
        onclick: () => importRow(item),
      }, state.busy === `row:${item.id}` ? t('online.importing') : t('online.import')),
    ];
  }

  function render() {
    button.hidden = !state.allowed;
    button.disabled = state.busy === 'search';
    section.hidden = !state.shown;
    const st = state.status;
    status.replaceChildren(...(st ? [st.spin ? el('span', { class: 'spinner', 'aria-hidden': 'true' }) : null, t(st.key, st.vars)] : []));
    status.hidden = !st;
    errorBox.textContent = state.error || '';
    const results = state.results || [];
    $('online-count').textContent = state.results && results.length ? `(${results.length})` : '';
    resultsList.replaceChildren(...results.map((item) => {
      const row = state.rows.get(item.id);
      return el('li', { class: 'result-row' },
        el('div', { class: 'result-text' },
          el('span', { class: 'song-title', text: item.title }),
          item.author ? el('span', { class: 'song-meta', text: item.author }) : null,
          row && row.kind === 'error' ? el('span', { class: 'message error', role: 'alert', text: row.text }) : null),
        el('div', { class: 'result-actions' }, ...rowActions(item)));
    }));
    renderPreview();
  }

  function renderPreview() {
    const p = state.preview;
    if (!p) return;
    const song = p.song;
    previewTitle.textContent = song.title;
    previewMeta.textContent = [
      song.key ? t('song.key', { key: window.NOTATION.chord(song.key) }) : null,
      song.author ? t('song.author', { author: song.author }) : null,
      song.presentation ? t('online.presentation', { order: song.presentation }) : null,
    ].filter(Boolean).join(' · ');
    previewSections.replaceChildren(...window.SONG_RENDER.sectionsView(song.sections, { headingLevel: 3 }));

    const outcome = state.outcome;
    let message = [];
    let tone = '';
    if (outcome && outcome.kind === 'imported') {
      tone = 'success';
      message = [t('online.imported'), ' ', el('a', { href: `/songs/${outcome.id}`, text: t('online.openSong') })];
    } else if (outcome && outcome.kind === 'error') {
      tone = 'error';
      message = [outcome.text];
    } else if (p.existingId || (outcome && outcome.kind === 'exists')) {
      tone = 'error';
      message = [t('online.alreadyExists'), ' ', el('a', { href: `/songs/${p.existingId || outcome.id}`, text: t('online.openExisting') })];
    } else if (p.invalid) {
      tone = 'error';
      message = [p.invalid];
    }
    previewMessage.className = `message ${tone}`;
    previewMessage.replaceChildren(...message);

    const blocked = Boolean(p.existingId || p.invalid || (outcome && outcome.kind !== 'error'));
    importButton.disabled = blocked || state.busy === 'import';
    importButton.hidden = Boolean(outcome && outcome.kind === 'imported');
    importButton.textContent = state.busy === 'import' ? t('online.importing') : t('online.import');
  }

  // --- search / link ----------------------------------------------------------------

  async function search(query) {
    state.shown = true;
    state.query = query;
    state.results = null;
    state.rows = new Map();
    state.error = null;
    if (query.length < 2) {
      state.status = null;
      state.error = t('errors.resurseQueryTooShort');
      render();
      return;
    }
    state.busy = 'search';
    state.status = { key: 'online.searching', spin: true };
    render();
    try {
      const res = await api('/api/resurse/search', { method: 'POST', body: { query } });
      if (state.query !== query) return; // the query changed meanwhile
      if (res.ok) {
        state.results = res.body;
        state.status = res.body.length === 0 ? { key: 'online.noResults', vars: { q: query } } : null;
      } else {
        state.status = null;
        state.error = failText(res);
      }
    } catch (err) {
      state.status = null;
      state.error = t('common.networkError');
    } finally {
      state.busy = false;
      render();
    }
  }

  form.addEventListener('submit', () => {
    if (!state.allowed) return;
    const query = input.value.trim();
    if (!query) return;
    if (isLink(query)) {
      // A pasted link: its preview (another host -> the server's clear error).
      state.shown = true;
      state.query = query;
      state.results = null;
      state.rows = new Map();
      openPreview({ url: query }, null);
      return;
    }
    search(query);
  });

  // A different query makes the online results stale: hide them until the next Enter.
  input.addEventListener('input', () => {
    if (!state.shown || input.value.trim() === state.query) return;
    Object.assign(state, { shown: false, query: '', results: null, rows: new Map(), status: null, error: null });
    render();
  });

  // --- preview and import -------------------------------------------------------------

  async function openPreview(source, resultId) {
    state.busy = 'preview';
    state.error = null;
    state.outcome = null;
    state.status = { key: 'online.loadingPreview', spin: true };
    render();
    try {
      const res = await api('/api/resurse/preview', { method: 'POST', body: source });
      if (res.ok) {
        state.preview = { source, resultId, song: res.body.song, existingId: res.body.existingId, invalid: res.body.invalid };
        state.status = null;
      } else {
        state.status = null;
        state.error = failText(res);
      }
    } catch (err) {
      state.status = null;
      state.error = t('common.networkError');
    } finally {
      state.busy = false;
      render();
      if (state.preview && !dialog.open) {
        dialog.showModal();
        previewTitle.focus({ preventScroll: true });
      }
    }
  }

  function imported(resultId, songId) {
    if (resultId) state.rows.set(resultId, { kind: 'imported', songId });
    document.dispatchEvent(new CustomEvent('library:changed'));
  }

  async function importRow(item) {
    state.busy = `row:${item.id}`;
    state.rows.delete(item.id);
    render();
    try {
      const res = await api('/api/resurse/import', { method: 'POST', body: { id: item.id } });
      if (res.status === 201) imported(item.id, res.body.song.id);
      else if (res.status === 409) state.rows.set(item.id, { kind: 'exists', songId: res.body.existingId });
      else state.rows.set(item.id, { kind: 'error', text: failText(res) });
    } catch (err) {
      state.rows.set(item.id, { kind: 'error', text: t('common.networkError') });
    } finally {
      state.busy = false;
      render();
    }
  }

  importButton.addEventListener('click', async () => {
    const p = state.preview;
    if (!p) return;
    state.busy = 'import';
    state.outcome = null;
    renderPreview();
    try {
      const res = await api('/api/resurse/import', { method: 'POST', body: p.source });
      if (res.status === 201) {
        state.outcome = { kind: 'imported', id: res.body.song.id };
        imported(p.resultId, res.body.song.id);
      } else if (res.status === 409) {
        state.outcome = { kind: 'exists', id: res.body.existingId };
        if (p.resultId) state.rows.set(p.resultId, { kind: 'exists', songId: res.body.existingId });
      } else {
        state.outcome = { kind: 'error', text: failText(res) };
      }
    } catch (err) {
      state.outcome = { kind: 'error', text: t('common.networkError') };
    } finally {
      state.busy = false;
      render();
    }
  });

  for (const close of [$('preview-close'), $('preview-close-x')]) close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    state.preview = null;
    state.outcome = null;
    render();
  });
  // A tap on the dimmed area closes it too.
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const inside = event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
    if (!inside) dialog.close();
  });

  document.addEventListener('library:me', (event) => {
    state.allowed = canEdit(event.detail);
    render();
  });
  document.addEventListener('notation:change', () => render());
  document.addEventListener('i18n:change', () => {
    // Server messages are in the previous language; drop them rather than mix languages.
    state.error = null;
    if (state.outcome && state.outcome.kind === 'error') state.outcome = null;
    for (const [id, row] of state.rows) if (row.kind === 'error') state.rows.delete(id);
    render();
  });
})();
