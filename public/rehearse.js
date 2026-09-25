'use strict';

// Rehearsal view (/events/:id/rehearse): one setlist item per screen, songs transposed and in
// their event arrangement (sections in order of first appearance).

(function () {
  const { api, el, setTitle } = window.PAGE;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const eventId = window.location.pathname.split('/')[2];
  const slide = $('slide');
  const textOnlyButton = $('text-only');
  const TEXT_ONLY_KEY = 'wa_text_only';
  const SCALE_KEY = 'wa_rehearse_scale';
  const SCALE = { min: 0.8, max: 1.8, step: 0.1 };

  const state = { event: null, items: [], index: 0, songs: new Map(), textOnly: false, scale: 1 };

  function stored(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function store(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (err) {
      // Private mode or full storage: the setting just is not remembered.
    }
  }

  state.textOnly = stored(TEXT_ONLY_KEY) === '1';
  const savedScale = Number(stored(SCALE_KEY));
  if (savedScale >= SCALE.min && savedScale <= SCALE.max) state.scale = savedScale;

  // --- data -------------------------------------------------------------------------

  // Song items are fetched ready to render (transposed, arranged), once each.
  function loadSong(item) {
    if (!state.songs.has(item.id)) {
      state.songs.set(item.id, api(`/api/events/${eventId}/items/${item.id}/song`)
        .then((res) => (res.ok ? res.body.song : null))
        .catch(() => null));
    }
    return state.songs.get(item.id);
  }

  function prefetch(index) {
    const item = state.items[index];
    if (item && item.type === 'song' && item.songId) loadSong(item);
  }

  // --- rendering --------------------------------------------------------------------

  function itemTitle(item) {
    if (item.type === 'song') return item.title || t('setlist.songDeleted');
    if (item.type === 'verse') return item.reference || item.title || t('setlist.types.verse');
    return item.title || t(`setlist.types.${item.type}`);
  }

  function header(item, extra) {
    return el('header', { class: 'slide-head' },
      el('span', { class: `type-badge type-${item.type}`, text: t(`setlist.types.${item.type}`) }),
      el('h1', { id: 'slide-title', text: itemTitle(item) }),
      extra);
  }

  function songSlide(item, song) {
    // Sections in order of first appearance in the arrangement; labels from the whole song.
    const labels = window.SECTIONS.sectionLabels(song.sections, t);
    const order = [];
    for (const { sectionId } of song.arrangement) {
      const index = song.sections.findIndex((s) => s.id === sectionId);
      if (index >= 0 && !order.includes(index)) order.push(index);
    }
    if (!order.length) song.sections.forEach((s, i) => order.push(i));

    // A song without a key shows only its semitone offset, when it has one.
    const offset = song.transpose > 0 ? `+${song.transpose}` : String(song.transpose);
    let keyBadge = null;
    if (song.key) {
      keyBadge = el('p', { class: 'slide-key' },
        el('span', { class: 'key-badge', text: t('rehearse.key', { key: window.NOTATION.chord(song.key) }) }),
        song.transpose ? el('span', { class: 'muted', text: ` ${t('rehearse.keyOriginal', { key: window.NOTATION.chord(song.originalKey) })}` }) : null);
    } else if (song.transpose) {
      keyBadge = el('p', { class: 'slide-key muted', text: t(Math.abs(song.transpose) === 1 ? 'options.keyNoKeyOne' : 'options.keyNoKey', { offset }) });
    }

    return [
      header(item, keyBadge),
      song.arrangement.length > 1
        ? el('ol', { class: 'arr-strip', 'aria-label': t('rehearse.arrangement') },
          song.arrangement.map((a) => el('li', { title: a.label, text: a.code })))
        : null,
      item.teamNote
        ? el('div', { class: 'team-note', role: 'note' },
          el('span', { class: 'ro-label', text: t('rehearse.teamNote') }),
          el('p', { text: item.teamNote }))
        : null,
      item.referenceUrl
        ? el('p', null, el('a', { class: 'button secondary', href: item.referenceUrl, target: '_blank', rel: 'noopener noreferrer', text: t('options.listenReference') }))
        : null,
      el('div', { class: 'slide-sections' },
        window.SONG_RENDER.sectionsView(order.map((i) => song.sections[i]), {
          textOnly: state.textOnly,
          headingLevel: 2,
          labels: order.map((i) => labels[i]),
        })),
    ];
  }

  function textSlide(item) {
    const parts = [header(item)];
    if (item.type === 'video') {
      parts.push(el('p', null, el('a', { class: 'button', href: item.url, target: '_blank', rel: 'noopener noreferrer', text: t('rehearse.openVideo') })));
      parts.push(el('p', { class: 'muted video-url', text: item.url }));
    } else if (item.body) {
      parts.push(el('p', { class: 'lyrics slide-body', text: item.body }));
    }
    return parts;
  }

  async function render(focusSlide) {
    const item = state.items[state.index];
    const total = state.items.length;
    $('position').textContent = total ? t('rehearse.position', { n: state.index + 1, total }) : '';
    $('prev').disabled = state.index <= 0;
    $('next').disabled = state.index >= total - 1;
    slide.style.fontSize = `${state.scale}rem`;
    $('text-smaller').disabled = state.scale <= SCALE.min + 1e-9;
    $('text-larger').disabled = state.scale >= SCALE.max - 1e-9;

    if (!item) {
      textOnlyButton.hidden = true;
      slide.replaceChildren(el('p', { class: 'muted', text: t('rehearse.empty') }));
      return;
    }
    const isSong = item.type === 'song' && Boolean(item.songId);
    textOnlyButton.hidden = !isSong;
    textOnlyButton.setAttribute('aria-pressed', String(state.textOnly));

    if (isSong) {
      const index = state.index;
      slide.replaceChildren(header(item), el('p', { class: 'muted', text: t('events.loading') }));
      const song = await loadSong(item);
      if (index !== state.index) return; // moved on meanwhile
      slide.replaceChildren(...(song ? songSlide(item, song) : [header(item), el('p', { class: 'message error', text: t('common.networkError') })]).filter(Boolean));
    } else {
      const parts = item.type === 'song' ? [header(item), el('p', { class: 'muted', text: t('setlist.songDeletedHint') })] : textSlide(item);
      slide.replaceChildren(...parts.filter(Boolean));
    }
    prefetch(state.index + 1);
    if (focusSlide) slide.focus({ preventScroll: true });
  }

  function go(index) {
    if (index < 0 || index >= state.items.length || index === state.index) return;
    state.index = index;
    const url = new URL(window.location.href);
    url.searchParams.set('i', String(index + 1));
    window.history.replaceState(null, '', url);
    window.scrollTo({ top: 0 });
    render(true);
  }

  // --- controls ---------------------------------------------------------------------

  $('prev').addEventListener('click', () => go(state.index - 1));
  $('next').addEventListener('click', () => go(state.index + 1));

  document.addEventListener('keydown', (event) => {
    if (event.target.closest('input, textarea, select') || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowRight') go(state.index + 1);
    else if (event.key === 'ArrowLeft') go(state.index - 1);
  });

  textOnlyButton.addEventListener('click', () => {
    state.textOnly = !state.textOnly;
    store(TEXT_ONLY_KEY, state.textOnly ? '1' : '0');
    render(false);
  });

  function setScale(delta) {
    state.scale = Math.round(Math.min(SCALE.max, Math.max(SCALE.min, state.scale + delta)) * 10) / 10;
    store(SCALE_KEY, String(state.scale));
    render(false);
  }
  $('text-smaller').addEventListener('click', () => setScale(-SCALE.step));
  $('text-larger').addEventListener('click', () => setScale(SCALE.step));

  function renderChrome() {
    const ev = state.event;
    setTitle('rehearse.pageTitle', { name: ev.name });
    $('back-link').textContent = t('rehearse.back', { name: ev.name });
    $('back-link').href = `/events/${ev.id}`;
  }

  document.addEventListener('notation:change', () => {
    if (state.event) render(false);
  });

  document.addEventListener('i18n:change', () => {
    if (!state.event) return;
    // Section labels come from the server in the old language: fetch again.
    state.songs.clear();
    renderChrome();
    render(false);
  });

  // --- start ------------------------------------------------------------------------

  (async () => {
    const res = await api(`/api/events/${eventId}`);
    if (!res.ok) {
      $('status').removeAttribute('data-i18n');
      $('status').textContent = res.status === 404 ? t('setlist.notFound') : (res.body.error || t('common.networkError'));
      return;
    }
    state.event = res.body.event;
    state.items = res.body.items;
    const url = new URL(window.location.href);
    const asked = Number(url.searchParams.get('i'));
    if (Number.isInteger(asked) && asked >= 1 && asked <= state.items.length) {
      state.index = asked - 1;
    } else if (url.searchParams.has('i')) {
      url.searchParams.delete('i'); // out of range (the setlist changed): start at the first item
      window.history.replaceState(null, '', url);
    }
    renderChrome();
    $('status').hidden = true;
    $('rehearse').hidden = false;
    render(false);
  })().catch(() => {
    $('status').removeAttribute('data-i18n');
    $('status').textContent = t('common.networkError');
  });
})();
