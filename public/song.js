'use strict';

(function () {
  const { api, el, canEdit, setTitle } = window.PAGE;
  const { t } = window.I18N;
  const { inlineLinePairs, stripChords } = window.CHORDS;
  const { sectionLabels } = window.SECTIONS;
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

  // Chords above lyrics, both monospace so the columns line up.
  function chordSheet(content) {
    const lines = [];
    for (const { chords, lyrics } of inlineLinePairs(content)) {
      if (chords !== null) lines.push(el('span', { class: 'chord-line', text: chords }));
      if (lyrics !== null) lines.push(el('span', { class: 'lyric-line', text: lyrics || ' ' }));
    }
    return el('div', { class: 'chord-sheet' }, lines);
  }

  function render() {
    if (!song) return;
    setTitle('song.pageTitle', { title: song.title });
    document.getElementById('song-title').textContent = song.title;
    const meta = [
      song.song_key ? t('song.key', { key: song.song_key }) : null,
      song.author ? t('song.author', { author: song.author }) : null,
    ].filter(Boolean).join(' · ');
    const metaEl = document.getElementById('song-meta');
    metaEl.textContent = meta;
    metaEl.hidden = !meta;

    textOnlyButton.setAttribute('aria-pressed', String(textOnly));
    const labels = sectionLabels(song.sections, t);
    document.getElementById('sections').replaceChildren(...song.sections.map((section, i) => el('section', { class: 'song-section' },
      el('h2', { class: 'section-label', text: labels[i] }),
      section.note ? el('p', { class: 'section-note', text: section.note }) : null,
      textOnly
        ? el('p', { class: 'lyrics', text: stripChords(section.content) })
        : chordSheet(section.content))));
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
