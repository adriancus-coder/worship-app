'use strict';

(function () {
  const { api, canEdit, setTitle } = window.PAGE;
  const { t } = window.I18N;
  const songId = window.location.pathname.split('/')[2];
  const status = document.getElementById('status');
  const article = document.getElementById('song');
  const textOnlyButton = document.getElementById('text-only');
  const editLink = document.getElementById('edit-song');
  const TEXT_ONLY_KEY = 'wa_text_only';

  let song = null;
  let textOnly = false;
  try {
    textOnly = window.localStorage.getItem(TEXT_ONLY_KEY) === '1';
  } catch (err) {
    // Storage can be unavailable (private mode); the toggle still works for this page.
  }

  function setStatus(text) {
    status.removeAttribute('data-i18n');
    status.textContent = text;
    status.hidden = !text;
  }

  function render() {
    if (!song) return;
    setTitle('song.pageTitle', { title: song.title });
    document.getElementById('song-title').textContent = song.title;
    const meta = [
      song.song_key ? t('song.key', { key: window.NOTATION.chord(song.song_key) }) : null,
      song.author ? t('song.author', { author: song.author }) : null,
    ].filter(Boolean).join(' · ');
    const metaEl = document.getElementById('song-meta');
    metaEl.textContent = meta;
    metaEl.hidden = !meta;

    textOnlyButton.setAttribute('aria-pressed', String(textOnly));
    document.getElementById('sections').replaceChildren(...window.SONG_RENDER.sectionsView(song.sections, { textOnly }));
  }

  textOnlyButton.addEventListener('click', () => {
    textOnly = !textOnly;
    try {
      window.localStorage.setItem(TEXT_ONLY_KEY, textOnly ? '1' : '0');
    } catch (err) {
      // See above.
    }
    render();
  });
  document.addEventListener('notation:change', () => {
    if (song) render();
  });

  document.addEventListener('i18n:change', () => {
    if (song) render();
    else if (!status.hasAttribute('data-i18n') && article.hidden && status.dataset.state === 'missing') setStatus(t('song.notFound'));
  });

  (async () => {
    const [meRes, songRes] = await Promise.all([api('/api/auth/me'), api(`/api/songs/${songId}`)]);
    if (!songRes.ok) {
      status.dataset.state = 'missing';
      setStatus(songRes.status === 404 ? t('song.notFound') : (songRes.body.error || t('common.networkError')));
      return;
    }
    song = songRes.body.song;
    editLink.href = `/songs/${song.id}/edit`;
    editLink.hidden = !canEdit(meRes.body);
    setStatus('');
    article.hidden = false;
    render();
  })().catch(() => setStatus(t('common.networkError')));
})();
