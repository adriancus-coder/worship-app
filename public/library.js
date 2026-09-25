'use strict';

(function () {
  const { api, el, canEdit } = window.PAGE;
  const { t } = window.I18N;
  const input = document.getElementById('q');
  const sort = document.getElementById('sort');
  const status = document.getElementById('status');
  const list = document.getElementById('songs');
  const newSong = document.getElementById('new-song');
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
    status.textContent = text;
  }

  function render() {
    if (!songs) return;
    list.replaceChildren(...songs.map((song) => {
      const meta = [song.song_key ? t('library.key', { key: song.song_key }) : null, song.author].filter(Boolean).join(' · ');
      return el('li', null,
        el('a', { class: 'song-link', href: `/songs/${song.id}` },
          el('span', { class: 'song-title', text: song.title }),
          meta ? el('span', { class: 'song-meta', text: meta }) : null,
          song.matchedIn === 'lyrics' ? el('span', { class: 'song-hint', text: t('library.matchedInLyrics') }) : null));
    }));
    if (songs.length === 1) setStatus(t('library.countOne'));
    else if (songs.length > 1) setStatus(t('library.count', { n: songs.length }));
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
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      clearTimeout(timer);
      load();
    }
  });
  sort.addEventListener('change', load);
  document.addEventListener('i18n:change', render);

  (async () => {
    const res = await api('/api/auth/me');
    me = res.body;
    newSong.hidden = !canEdit(me);
    load();
  })().catch(() => setStatus(t('common.networkError')));
})();
