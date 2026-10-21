'use strict';

(function () {
  const { api, el, canEdit, setTitle, formatDate } = window.PAGE;
  const { t } = window.I18N;
  const songId = window.location.pathname.split('/')[2];
  const status = document.getElementById('status');
  const article = document.getElementById('song');
  const textOnlyButton = document.getElementById('text-only');
  const editLink = document.getElementById('edit-song');
  const TEXT_ONLY_KEY = 'wa_text_only';

  // Opened from an event (?back=/events/12, /events/12/edit, optionally ?from=home): the back
  // link returns there; only those paths are accepted (never another site or page).
  const backParam = new URLSearchParams(window.location.search).get('back');
  const backToEvent = /^\/events\/\d+(\/edit)?(\?from=home)?$/.test(backParam || '') ? backParam : null;
  const backLinkEl = document.getElementById('song-back');
  function renderBack() {
    if (!backToEvent) return;
    backLinkEl.removeAttribute('data-i18n');
    backLinkEl.href = backToEvent;
    backLinkEl.textContent = t('nav.backEvent');
  }
  renderBack();
  window.PAGE.linkBack(backLinkEl);
  document.addEventListener('i18n:change', renderBack);

  let song = null;
  let canSetKey = false;
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

  // "Cântată ultima dată: Duminică, 11 octombrie · 4 evenimente" and, opened, the events
  // (newest first; a planned one says so). For everyone who opens the song.
  let history = null;
  function renderHistory() {
    const box = document.getElementById('song-history');
    if (!history) { box.hidden = true; return; }
    box.hidden = false;
    const { dates, lastSung, today } = history;
    const year = String(today || '').slice(0, 4);
    if (!dates.length) {
      box.replaceChildren(el('summary', { text: t('song.historyNever') }));
      return;
    }
    box.replaceChildren(
      el('summary', null,
        el('span', { text: lastSung ? t('song.historyLast', { date: formatDate(lastSung, year) }) : t('song.historyNever') }),
        el('span', { class: 'muted song-history-count', text: ` · ${t('song.historyCount', { n: dates.length })}` })),
      el('ul', { class: 'song-history-list', 'aria-label': t('song.historyLabel') },
        ...dates.map((d) => el('li', null,
          el('a', { href: `/events/${d.eventId}`, text: `${formatDate(d.eventDate, year)} · ${d.name}` }),
          d.status === 'planned' && d.eventDate > today ? el('span', { class: 'muted', text: ` (${t('song.historyPlanned')})` }) : null))));
  }

  function render() {
    if (!song) return;
    renderHistory();
    setTitle('song.pageTitle', { title: song.title });
    document.getElementById('song-title').textContent = song.title;
    // The key row, always: "Ton: Sol · Schimbă" (the editor roles change it inline) or
    // "Tonul nu e setat · Setează"; the team sees the key without the button.
    document.getElementById('song-key').replaceChildren(window.ARRANGE_SHEET.keyBox(song, canSetKey, () => render(), { id: 'song-key-box' }));
    const meta = song.author ? t('song.author', { author: song.author }) : '';
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
    const [meRes, songRes, historyRes] = await Promise.all([api('/api/auth/me'), api(`/api/songs/${songId}`), api(`/api/songs/${songId}/history`)]);
    if (historyRes.ok) history = historyRes.body;
    if (!songRes.ok) {
      status.dataset.state = 'missing';
      setStatus(songRes.status === 404 ? t('song.notFound') : (songRes.body.error || t('common.networkError')));
      return;
    }
    song = songRes.body.song;
    editLink.href = `/songs/${song.id}/edit`;
    editLink.hidden = !canEdit(meRes.body);
    canSetKey = canEdit(meRes.body);
    setStatus('');
    article.hidden = false;
    render();
  })().catch(() => setStatus(t('common.networkError')));
})();
