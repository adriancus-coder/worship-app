'use strict';

// "Search online" tab of /library: resursecrestine.ro search, preview and import
// (owner and leader). The server does all network access.

(function () {
  const { api, el, canEdit } = window.PAGE;
  const { t } = window.I18N;
  const tabs = document.getElementById('library-tabs');
  const tabButtons = [document.getElementById('tab-local'), document.getElementById('tab-online')];
  const searchForm = document.getElementById('online-search-form');
  const searchInput = document.getElementById('online-q');
  const searchButton = document.getElementById('online-search');
  const linkForm = document.getElementById('online-link-form');
  const linkInput = document.getElementById('online-link');
  const status = document.getElementById('online-status');
  const errorBox = document.getElementById('online-error');
  const resultsList = document.getElementById('online-results');
  const preview = document.getElementById('online-preview');
  const previewTitle = document.getElementById('preview-title');
  const previewMeta = document.getElementById('preview-meta');
  const previewSections = document.getElementById('preview-sections');
  const previewMessage = document.getElementById('preview-message');
  const importButton = document.getElementById('preview-import');

  // Everything shown is rebuilt from this state, so a language switch re-renders it.
  const state = {
    query: '',
    results: null,
    status: null, // { key, vars }
    error: null, // server text
    preview: null, // { source, song, existingId, invalid }
    outcome: null, // { kind: 'imported' | 'exists' | 'error', id?, text? }
    busy: false,
  };

  // --- tabs -----------------------------------------------------------------

  function selectTab(index, focus) {
    tabButtons.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
    });
    if (focus) tabButtons[index].focus();
  }

  tabButtons.forEach((tab, i) => {
    tab.addEventListener('click', () => selectTab(i, false));
    tab.addEventListener('keydown', (event) => {
      const moves = { ArrowRight: 1, ArrowLeft: -1, Home: -i, End: tabButtons.length - 1 - i };
      if (!(event.key in moves)) return;
      event.preventDefault();
      selectTab((i + moves[event.key] + tabButtons.length) % tabButtons.length, true);
    });
  });

  document.addEventListener('library:me', (event) => {
    tabs.hidden = !canEdit(event.detail);
  });

  // --- rendering ------------------------------------------------------------

  function render() {
    status.textContent = state.status ? t(state.status.key, state.status.vars) : '';
    errorBox.textContent = state.error || '';
    searchButton.textContent = state.busy === 'search' ? t('online.searching') : t('online.search');

    resultsList.replaceChildren(...(state.results || []).map((item) => el('li', { class: 'result-row' },
      el('div', { class: 'result-text' },
        el('span', { class: 'song-title', text: item.title }),
        item.author ? el('span', { class: 'song-meta', text: item.author }) : null),
      el('button', {
        type: 'button',
        class: 'secondary',
        'aria-label': t('online.previewSong', { title: item.title }),
        disabled: Boolean(state.busy),
        onclick: () => openPreview({ id: item.id }),
      }, t('online.preview')))));

    renderPreview();
  }

  function renderPreview() {
    const p = state.preview;
    preview.hidden = !p;
    if (!p) return;
    const song = p.song;
    previewTitle.textContent = song.title;
    previewMeta.textContent = [
      song.key ? t('song.key', { key: song.key }) : null,
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

  function failText(res) {
    return (res && res.body && res.body.error) || t('common.networkError');
  }

  // --- actions --------------------------------------------------------------

  searchForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = searchInput.value.trim();
    state.error = null;
    if (query.length < 2) {
      state.error = t('errors.resurseQueryTooShort');
      render();
      searchInput.focus();
      return;
    }
    state.busy = 'search';
    state.status = { key: 'online.searching' };
    state.preview = null;
    render();
    try {
      const res = await api('/api/resurse/search', { method: 'POST', body: { query } });
      if (res.ok) {
        state.query = query;
        state.results = res.body;
        state.status = res.body.length === 0
          ? { key: 'online.noResults', vars: { q: query } }
          : { key: res.body.length === 1 ? 'online.resultOne' : 'online.results', vars: { n: res.body.length } };
      } else {
        state.results = null;
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
  });

  linkForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const url = linkInput.value.trim();
    if (!url) {
      state.error = t('errors.resurseInvalidUrl');
      render();
      linkInput.focus();
      return;
    }
    openPreview({ url });
  });

  async function openPreview(source) {
    state.busy = 'preview';
    state.error = null;
    state.outcome = null;
    state.status = { key: 'online.loadingPreview' };
    render();
    try {
      const res = await api('/api/resurse/preview', { method: 'POST', body: source });
      if (res.ok) {
        state.preview = { source, song: res.body.song, existingId: res.body.existingId, invalid: res.body.invalid };
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
      if (state.preview) {
        preview.scrollIntoView({ block: 'start' });
        previewTitle.focus({ preventScroll: true });
      }
    }
  }

  importButton.addEventListener('click', async () => {
    if (!state.preview) return;
    state.busy = 'import';
    state.outcome = null;
    renderPreview();
    try {
      const res = await api('/api/resurse/import', { method: 'POST', body: state.preview.source });
      if (res.status === 201) {
        state.outcome = { kind: 'imported', id: res.body.song.id };
        document.dispatchEvent(new CustomEvent('library:changed'));
      } else if (res.status === 409) {
        state.outcome = { kind: 'exists', id: res.body.existingId };
      } else {
        state.outcome = { kind: 'error', text: failText(res) };
      }
    } catch (err) {
      state.outcome = { kind: 'error', text: t('common.networkError') };
    } finally {
      state.busy = false;
      renderPreview();
      previewMessage.scrollIntoView({ block: 'nearest' });
    }
  });

  document.getElementById('preview-close').addEventListener('click', () => {
    state.preview = null;
    state.outcome = null;
    render();
    (resultsList.querySelector('button') || searchInput).focus();
  });

  document.addEventListener('i18n:change', () => {
    // Server messages are in the previous language; drop them rather than mix languages.
    state.error = null;
    if (state.outcome && state.outcome.kind === 'error') state.outcome = null;
    render();
  });
})();
