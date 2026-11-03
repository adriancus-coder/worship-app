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
    // "Tematică: [chips] · Setează" (public/themes-ui.js): the editor roles pick from the index
    document.getElementById('song-themes').replaceChildren(window.THEMES_UI.box(song, canSetKey, () => render()));
    renderOrder();
    // "Negativ": the backing track (public/song-audio.js); everyone plays it, editors set it
    document.getElementById('song-audio-box').replaceChildren(window.SONG_AUDIO.box(song, canSetKey, () => render()));

    textOnlyButton.setAttribute('aria-pressed', String(textOnly));
    document.getElementById('sections').replaceChildren(...window.SONG_RENDER.sectionsView(song.sections, { textOnly, tappable: true }));
  }

  // "Cum se cântă": the song's own section order (presentation, the default arrangement of
  // every event). "V1 · Refren · V2 · Refren" with "Schimbă" (the editors: the arrange sheet
  // without the key row, saved with PUT /api/songs/:id/presentation) or "Vezi" (everyone:
  // the whole song in that order).
  function renderOrder() {
    const { SECTIONS } = window;
    const codes = SECTIONS.defaultArrangement(song);
    const canonical = SECTIONS.sectionCodes(song.sections);
    const labels = SECTIONS.sectionLabels(song.sections, t);
    const isDefault = codes.join(' ') === canonical.join(' ');
    const names = codes.map((code) => labels[canonical.indexOf(code)] || code);
    const openSheet = () => window.ARRANGE_SHEET.open({
      title: song.title, song: { sections: song.sections, song_key: song.song_key }, codes, defaultCodes: canonical, transpose: 0,
      readOnly: !canSetKey, transposable: false, kicker: canSetKey ? 'song.orderKicker' : 'song.orderKickerView',
      onApply: async ({ codes: chosen, isDefault: backToDefault }) => {
        const res = await api(`/api/songs/${song.id}/presentation`, { method: 'PUT', body: { codes: backToDefault ? [] : chosen } }).catch(() => ({ ok: false, body: {} }));
        if (!res.ok) { setStatus(res.body.error || t('common.networkError')); return; }
        song = res.body.song;
        setStatus(t('song.orderSaved'));
        render();
      },
    });
    document.getElementById('song-order').replaceChildren(
      el('span', { class: 'song-order-label', text: `${t('song.orderLabel')}:` }),
      el('span', { class: `song-order-codes${isDefault ? ' is-default' : ''}`, id: 'song-order-codes', text: isDefault ? t('song.orderDefault') : names.join(' · ') }),
      el('span', { class: 'song-order-sep', 'aria-hidden': 'true', text: '·' }),
      el('button', { type: 'button', class: 'song-key-change song-order-open', id: 'song-order-open', 'data-icon': canSetKey ? 'edit' : 'list', text: t(canSetKey ? 'song.orderChange' : 'song.orderView'), onclick: openSheet }));
  }

  // "Tipărește": the song as a PDF made here (public/song-pdf.js) from what the page shows
  // (the key, the themes, chords or text only): the share sheet on a phone (Tipărește /
  // Salvează în Fișiere…), a download elsewhere. window.print() does nothing in the
  // installed app on phones; the print styles (styles.css @media print) still serve Ctrl+P.
  function pdfDoc() {
    const textOf = (node) => (node ? node.textContent.trim() : '');
    const keyValue = textOf(document.querySelector('#song-key-box .song-key-value'));
    const themes = [...document.querySelectorAll('#song-themes .theme-chip')].map((a) => a.textContent.trim());
    const sections = [...document.querySelectorAll('#sections .song-section')].map((sec) => {
      const base = { label: textOf(sec.querySelector('.section-label')), note: textOf(sec.querySelector('.section-note')) };
      const sheet = sec.querySelector('.chord-sheet');
      if (!sheet) return { ...base, text: textOf(sec.querySelector('.lyrics')) };
      const lines = [];
      for (const row of sheet.children) {
        if (row.classList.contains('chord-line')) lines.push({ chords: row.textContent, lyrics: null });
        else if (row.classList.contains('lyric-line')) {
          const last = lines[lines.length - 1];
          if (last && last.lyrics === null) last.lyrics = row.textContent.replace(/\s+$/, '');
          else lines.push({ chords: null, lyrics: row.textContent.replace(/\s+$/, '') });
        }
      }
      return { ...base, lines };
    });
    return {
      title: song.title,
      subtitle: [keyValue ? `${t('song.keyLabel')}: ${keyValue}` : '', ...themes].filter(Boolean).join(' · '),
      meta: song.author ? t('song.author', { author: song.author }) : '',
      sections,
      producer: document.documentElement.dataset.appName || 'worship-app',
    };
  }
  const printButton = document.getElementById('print-song');
  printButton.addEventListener('click', async () => {
    if (!song || !window.SONG_PDF) return;
    printButton.disabled = true;
    setStatus(t('song.pdfMaking'));
    try {
      const bytes = await window.SONG_PDF.make(pdfDoc());
      const how = await window.SONG_PDF.deliver(bytes, window.SONG_PDF.fileName(song.title), song.title);
      setStatus(how === 'downloaded' ? t('song.pdfDownloaded') : how === 'shared' ? t('song.pdfShared') : '');
    } catch (err) {
      setStatus(t('song.pdfError'));
    }
    printButton.disabled = false;
  });

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
    editLink.hidden = !window.PAGE.canEditSong(meRes.body, song);
    canSetKey = window.PAGE.canEditSong(meRes.body, song);
    setStatus('');
    article.hidden = false;
    render();
    // the PDF's fonts, fetched once in the background so "Tipărește" answers at once
    if (window.SONG_PDF) setTimeout(() => window.SONG_PDF.preload().catch(() => {}), 1500);
  })().catch(() => setStatus(t('common.networkError')));
})();
