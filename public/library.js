'use strict';

// /library: ONE search field. Typing filters the library (debounced /api/songs?q=) under
// "Din bibliotecă"; owner and leader can also search resursecrestine.ro with Enter or
// "Caută și pe resurse" (public/library-online.js). Import / export of the whole library
// live in the "⋯" menu of the header.

(function () {
  const { api, el, canEdit } = window.PAGE;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const input = $('q');
  const sort = $('sort');
  const status = $('status');
  const list = $('songs');
  const SEARCH_DELAY_MS = 250;

  let me = null;
  let songs = null;
  let lastQuery = '';
  let requestId = 0;
  let timer = null;

  // Keep the search in the URL so Back from a song returns to the same results.
  const params = new URLSearchParams(window.location.search);
  input.value = params.get('q') || '';
  if (['az', 'za', 'recent'].includes(params.get('sort'))) sort.value = params.get('sort');

  function setStatus(text) {
    status.removeAttribute('data-i18n');
    status.textContent = text || '';
    status.hidden = !text;
  }

  function renderChrome() {
    input.placeholder = t('library.searchPlaceholder');
    $('q-hint').textContent = t(canEdit(me) ? 'library.searchHintOnline' : 'library.searchHint');
  }

  function render() {
    renderChrome();
    if (!songs) return;
    list.replaceChildren(...songs.map((song) => {
      const meta = [song.song_key ? t('library.key', { key: window.NOTATION.chord(song.song_key) }) : null, song.author].filter(Boolean).join(' · ');
      return el('li', null,
        el('a', { class: 'song-link', href: `/songs/${song.id}` },
          el('span', { class: 'song-title', text: song.title }),
          meta ? el('span', { class: 'song-meta', text: meta }) : null,
          song.matchedIn === 'lyrics' ? el('span', { class: 'song-hint', text: t('library.matchedInLyrics') }) : null));
    }));
    $('local-count').textContent = songs.length ? `(${songs.length})` : '';
    if (songs.length) setStatus('');
    else if (lastQuery) setStatus(t('library.noResults', { q: lastQuery }));
    else setStatus(t(canEdit(me) ? 'library.empty' : 'library.emptyMember'));
  }

  async function load() {
    const query = input.value.trim();
    const id = ++requestId;
    const qs = new URLSearchParams();
    if (query) qs.set('q', query);
    if (sort.value !== 'az') qs.set('sort', sort.value);
    const search = qs.toString();
    window.history.replaceState(null, '', search ? `?${search}` : window.location.pathname);
    try {
      const { ok, body } = await api(`/api/songs?${new URLSearchParams({ q: query, sort: sort.value })}`);
      if (id !== requestId) return; // a newer search is on its way
      if (!ok) {
        setStatus(body.error || t('common.networkError'));
        return;
      }
      songs = body.songs;
      lastQuery = query;
      render();
    } catch (err) {
      if (id === requestId) setStatus(t('common.networkError'));
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(load, SEARCH_DELAY_MS);
  });
  // A new tap replaces the old query: select all on focus, and keep the selection through the
  // mouseup (also emulated after a tap) that would otherwise place the caret.
  let keepSelection = false;
  input.addEventListener('focus', () => {
    input.select();
    keepSelection = true;
  });
  input.addEventListener('mouseup', (event) => {
    if (keepSelection) event.preventDefault();
    keepSelection = false;
  });
  input.addEventListener('keydown', () => { keepSelection = false; });
  // Enter: the library right away (the online search, if allowed, runs from library-online.js).
  // After a search the field lets go of focus (on phones the keyboard closes and the results
  // show); the next tap selects the whole query again.
  $('search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    clearTimeout(timer);
    load();
    input.blur();
  });
  sort.addEventListener('change', load);
  document.addEventListener('library:changed', load);
  document.addEventListener('i18n:change', render);
  document.addEventListener('notation:change', render);

  // --- "⋯" menu (import / export) ----------------------------------------------------

  const menu = $('library-menu');
  const menuButton = $('library-menu-button');
  const menuList = $('library-menu-list');
  function openMenu(value) {
    menuList.hidden = !value;
    menuButton.setAttribute('aria-expanded', String(value));
    if (value) menuList.querySelector('a, button').focus();
  }
  menuButton.addEventListener('click', () => openMenu(menuList.hidden));
  menuList.addEventListener('click', () => openMenu(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menuList.hidden) {
      openMenu(false);
      menuButton.focus();
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!menuList.hidden && !menu.contains(event.target)) openMenu(false);
  });

  (async () => {
    const res = await api('/api/auth/me');
    me = res.body;
    $('new-song').hidden = !canEdit(me);
    menu.hidden = !canEdit(me);
    renderChrome();
    document.dispatchEvent(new CustomEvent('library:me', { detail: me }));
    load();
  })().catch(() => setStatus(t('common.networkError')));
})();
