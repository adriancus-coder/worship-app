'use strict';

// Team phones (/events/:id/follow): follow the worship position live. Shows the current
// section with chords (transposed) and what comes next; it never moves on its own and
// sends no commands.

(function () {
  const { api, el, setTitle } = window.PAGE;
  const { t } = window.I18N;
  const { nextPosition } = window.LIVE;
  const $ = (id) => document.getElementById(id);
  const eventId = Number(window.location.pathname.split('/')[2]);
  const slide = $('slide');
  const textOnlyButton = $('text-only');
  // Same saved preferences as the song view and the rehearsal view.
  const TEXT_ONLY_KEY = 'wa_text_only';
  const SCALE_KEY = 'wa_rehearse_scale';
  const WAKE_HINT_KEY = 'wa_wake_hint_seen';
  const SCALE = { min: 0.8, max: 1.8, step: 0.1 };

  const state = { event: null, items: [], loadedKey: null, loading: null, songs: new Map(), snap: null, textOnly: false, scale: 1, renderId: 0 };

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

  function syncSetlist(snap) {
    if (state.loadedKey === snap.setlistKey && state.event) return Promise.resolve();
    if (state.loading && state.loading.key === snap.setlistKey) return state.loading.promise;
    const promise = api(`/api/events/${eventId}`).then((res) => {
      if (!res.ok) {
        gone();
        return;
      }
      state.event = res.body.event;
      state.items = res.body.items;
      state.songs.clear();
      state.loadedKey = snap.setlistKey;
    });
    state.loading = { key: snap.setlistKey, promise };
    return promise;
  }

  function loadSong(item) {
    if (!state.songs.has(item.id)) {
      state.songs.set(item.id, api(`/api/events/${eventId}/items/${item.id}/song`)
        .then((res) => (res.ok ? res.body.song : null))
        .catch(() => null));
    }
    return state.songs.get(item.id);
  }

  // --- rendering --------------------------------------------------------------------

  function itemTitle(item) {
    if (item.type === 'song') return item.title || t('setlist.songDeleted');
    if (item.type === 'verse') return item.reference || t('setlist.types.verse');
    return item.title || (item.body ? item.body.split('\n')[0].slice(0, 80) : '') || t(`setlist.types.${item.type}`);
  }

  function stepLabel(item, step) {
    const entry = item.type === 'song' && item.arrangementResolved ? item.arrangementResolved[step] : null;
    return entry ? entry.label : itemTitle(item);
  }

  // "Urmează: …": the next section of this song, else the next item.
  function nextLabel(pos) {
    const after = nextPosition(state.items, pos);
    if (!after) return t('follow.lastItem');
    const item = state.items.find((it) => it.id === after.itemId);
    return after.itemId === pos.itemId ? stepLabel(item, after.step) : itemTitle(item);
  }

  function renderHead() {
    const ev = state.event;
    const status = state.snap.status;
    setTitle('follow.pageTitle', { name: ev.name });
    $('event-name').textContent = ev.name;
    $('event-status').className = `pill pill-${status}`;
    $('event-status').textContent = t(`events.status.${status}`);
    $('back-link').textContent = t('rehearse.back', { name: ev.name });
    $('back-link').href = `/events/${ev.id}`;
    slide.style.fontSize = `${state.scale}rem`;
    $('text-smaller').disabled = state.scale <= SCALE.min + 1e-9;
    $('text-larger').disabled = state.scale >= SCALE.max - 1e-9;
  }

  function renderConnection(value) {
    $('connection').dataset.state = value;
    $('connection-text').textContent = t(`live.connection.${value}`);
  }

  function setlistView() {
    return el('ol', { class: 'follow-setlist' }, state.items.map((item) => el('li', null,
      el('span', { class: `type-badge type-${item.type}`, text: t(`setlist.types.${item.type}`) }),
      el('span', { class: 'follow-setlist-title', text: itemTitle(item) }),
      item.type === 'song' && item.displayKey ? el('span', { class: 'muted', text: ` · ${t('options.songKeyShort', { key: item.displayKey })}` }) : null)));
  }

  function upNext(pos) {
    return el('p', { class: 'up-next' },
      el('span', { class: 'ro-label', text: t('live.upNext') }),
      el('strong', { text: nextLabel(pos) }));
  }

  async function renderSlide() {
    const renderId = ++state.renderId;
    const snap = state.snap;
    const status = snap.status;
    textOnlyButton.hidden = true;
    if (status !== 'live') {
      $('position').textContent = '';
      if (status === 'finished') {
        slide.replaceChildren(el('p', { class: 'live-note', text: t('live.finished') }));
      } else {
        slide.replaceChildren(
          el('p', { class: 'live-note', text: t('live.notStarted') }),
          el('h2', { class: 'follow-setlist-heading', text: t('live.setlistHeading') }),
          state.items.length ? setlistView() : el('p', { class: 'muted', text: t('setlist.empty') }));
      }
      return;
    }
    const pos = snap.worship;
    const item = state.items.find((it) => it.id === pos.itemId);
    if (!item) {
      $('position').textContent = '';
      slide.replaceChildren(el('p', { class: 'muted', text: t('setlist.empty') }));
      return;
    }
    const index = state.items.indexOf(item);
    $('position').textContent = t('follow.position', { n: index + 1, total: state.items.length });
    const head = el('header', { class: 'slide-head' },
      el('span', { class: `type-badge type-${item.type}`, text: t(`setlist.types.${item.type}`) }),
      el('h1', { text: itemTitle(item) }),
      item.type === 'song' && item.displayKey ? el('p', { class: 'slide-key' }, el('span', { class: 'key-badge', text: t('rehearse.key', { key: item.displayKey }) })) : null);

    if (item.type !== 'song' || !item.songId) {
      const body = [];
      if (item.type === 'song') body.push(el('p', { class: 'muted', text: t('setlist.songDeletedHint') }));
      if (item.type === 'video' && item.url) body.push(el('p', { class: 'muted video-url', text: item.url }));
      if (item.body) body.push(el('p', { class: 'lyrics slide-body', text: item.body }));
      slide.replaceChildren(head, ...body, upNext(pos));
      return;
    }

    textOnlyButton.hidden = false;
    textOnlyButton.setAttribute('aria-pressed', String(state.textOnly));
    const song = await loadSong(item);
    if (renderId !== state.renderId) return; // a newer state arrived meanwhile
    const entry = song && song.arrangement[pos.step];
    const sectionIndex = entry ? song.sections.findIndex((s) => s.id === entry.sectionId) : -1;
    if (sectionIndex < 0) {
      slide.replaceChildren(head, el('p', { class: 'message error', text: t('common.networkError') }), upNext(pos));
      return;
    }
    const labels = window.SECTIONS.sectionLabels(song.sections, t);
    slide.replaceChildren(head,
      el('div', { class: 'slide-sections follow-section' },
        window.SONG_RENDER.sectionsView([song.sections[sectionIndex]], { textOnly: state.textOnly, headingLevel: 2, labels: [labels[sectionIndex]] })),
      upNext(pos));
  }

  function render() {
    if (!state.event || !state.snap) return;
    renderHead();
    renderSlide();
  }

  function gone() {
    $('follow').hidden = true;
    $('status').hidden = false;
    $('status').removeAttribute('data-i18n');
    $('status').textContent = t('setlist.notFound');
  }

  // --- screen wake lock -----------------------------------------------------------------

  let wakeLock = null;
  async function keepScreenOn() {
    if (!('wakeLock' in navigator)) {
      if (stored(WAKE_HINT_KEY) !== '1') $('wake-hint').hidden = false;
      return;
    }
    if (document.visibilityState !== 'visible' || (wakeLock && !wakeLock.released)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (err) {
      // Refused (battery saver, not allowed): the screen may dim; nothing else to do.
    }
  }
  // The browser releases the lock when the page is hidden: take it again on return.
  document.addEventListener('visibilitychange', keepScreenOn);
  $('wake-hint-close').addEventListener('click', () => {
    $('wake-hint').hidden = true;
    store(WAKE_HINT_KEY, '1');
  });

  // --- controls ---------------------------------------------------------------------

  textOnlyButton.addEventListener('click', () => {
    state.textOnly = !state.textOnly;
    store(TEXT_ONLY_KEY, state.textOnly ? '1' : '0');
    render();
  });

  function setScale(delta) {
    state.scale = Math.round(Math.min(SCALE.max, Math.max(SCALE.min, state.scale + delta)) * 10) / 10;
    store(SCALE_KEY, String(state.scale));
    render();
  }
  $('text-smaller').addEventListener('click', () => setScale(-SCALE.step));
  $('text-larger').addEventListener('click', () => setScale(SCALE.step));

  document.addEventListener('i18n:change', () => {
    if (!state.snap) return;
    renderConnection(client.connection);
    state.loadedKey = null; // labels come from the server in the page language
    syncSetlist(state.snap).then(render);
  });

  // --- start ------------------------------------------------------------------------

  const client = window.LIVE.connect({
    eventId,
    onState: (snap) => {
      state.snap = snap;
      syncSetlist(snap).then(() => {
        if (state.snap !== snap || !state.event) return;
        $('status').hidden = true;
        $('follow').hidden = false;
        render();
      });
    },
    onConnection: renderConnection,
    onGone: gone,
  });
  renderConnection('connecting');
  keepScreenOn();
})();
