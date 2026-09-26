'use strict';

// Team phones (/events/:id/follow): the live position of the team. Shows the current
// section with chords (transposed) and what comes next; it sends no commands. The team mode
// (set from the leader page or the console) decides how it follows:
//   follow  it moves with live. A person who moves away here (swipe, ← / →) sees their own
//           place with a floating "Revino la live"; a tap, or 30 s without touching it,
//           brings them back.
//   free    it never jumps: everyone navigates on their own (← / →, the setlist), with a
//           slim "Live: <song> · <section>" bar and "Mergi la live". Switching modes keeps
//           the person's place in free mode and jumps to live in follow mode.
// Without the server for more than 5 s it keeps the event it holds (every song is loaded
// up front) and offers manual Back / Next until it reconnects.

(function () {
  const { api, el, setTitle } = window.PAGE;
  const { t } = window.I18N;
  const { nextPosition } = window.LIVE;
  const POS = window.POSITIONS;
  const $ = (id) => document.getElementById(id);
  const eventId = Number(window.location.pathname.split('/')[2]);
  const slide = $('slide');
  const textOnlyButton = $('text-only');
  // Same saved preferences as the song view and the rehearsal view.
  const TEXT_ONLY_KEY = 'wa_text_only';
  const SCALE_KEY = 'wa_rehearse_scale';
  const WAKE_HINT_KEY = 'wa_wake_hint_seen';
  const SCALE = { min: 0.8, max: 1.8, step: 0.1 };
  const REATTACH_MS = 30 * 1000;
  const SWIPE_PX = 60;

  // manual: the place while offline; away: the person's own place online (moved away in
  // follow mode, or anywhere in free mode); null = live.
  const state = { event: null, items: [], loadedKey: null, loading: null, songs: new Map(), snap: null, textOnly: false, scale: 1, renderId: 0,
    manual: null, away: null, reattach: null };

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
      // Every song now, so the whole event is here if the connection drops (and saved on the
      // device for a reload without the server).
      const key = snap.setlistKey;
      const songs = state.items.filter((item) => item.type === 'song' && item.songId)
        .map(async (item) => [item.id, await loadSong(item)]);
      Promise.all(songs).then((pairs) => {
        if (state.loadedKey !== key) return;
        window.EVENT_CACHE.save({ eventId, setlistKey: key, event: state.event, items: state.items, songs: pairs.filter(([, song]) => song) });
      });
    });
    // Unreachable server: forget the attempt (the next snapshot tries again), keep the data.
    promise.catch(() => { if (state.loading && state.loading.promise === promise) state.loading = null; });
    state.loading = { key: snap.setlistKey, promise };
    return promise;
  }

  function loadSong(item) {
    if (!state.songs.has(item.id)) {
      const promise = api(`/api/events/${eventId}/items/${item.id}/song`)
        .then((res) => (res.ok ? res.body.song : null))
        .catch(() => null);
      state.songs.set(item.id, promise);
      promise.then((song) => { if (!song && state.songs.get(item.id) === promise) state.songs.delete(item.id); }); // retried later
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
      item.type === 'song' && item.displayKey ? el('span', { class: 'muted', text: ` · ${t('options.songKeyShort', { key: window.NOTATION.chord(item.displayKey) })}` }) : null)));
  }

  function upNext(pos) {
    return el('p', { class: 'up-next' },
      el('span', { class: 'ro-label', text: t('live.upNext') }),
      el('strong', { text: nextLabel(pos) }));
  }

  // "Toată cântarea": the whole song in the event's order, read-only (public/arrange-sheet.js).
  $('whole-song').addEventListener('click', () => {
    const item = state.snap && state.items.find((it) => it.id === shownPosition().itemId);
    if (item) window.ARRANGE_SHEET.openForItem(item, { readOnly: true });
  });

  async function renderSlide() {
    const renderId = ++state.renderId;
    const snap = state.snap;
    const status = snap.status;
    textOnlyButton.hidden = true;
    $('whole-song').hidden = true;
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
    const pos = shownPosition();
    const item = state.items.find((it) => it.id === pos.itemId);
    if (!item) {
      $('position').textContent = '';
      slide.replaceChildren(el('p', { class: 'muted', text: t('setlist.empty') }));
      return;
    }
    const index = state.items.indexOf(item);
    $('whole-song').hidden = !(item.type === 'song' && item.songId);
    $('position').textContent = t('follow.position', { n: index + 1, total: state.items.length });
    const head = el('header', { class: 'slide-head' },
      el('span', { class: `type-badge type-${item.type}`, text: t(`setlist.types.${item.type}`) }),
      el('h1', { text: itemTitle(item) }),
      item.type === 'song' && item.displayKey ? el('p', { class: 'slide-key' }, el('span', { class: 'key-badge', text: t('rehearse.key', { key: window.NOTATION.chord(item.displayKey) }) })) : null);

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

  const live = () => Boolean(state.snap) && state.snap.status === 'live';
  const free = () => live() && state.snap.teamMode === 'free';
  // What this phone shows: offline its own place, else the person's place, else live.
  const shownPosition = () => state.manual || state.away || state.snap.worship;

  function liveLabel() {
    const pos = state.snap.worship;
    const item = state.items.find((it) => it.id === pos.itemId);
    if (!item) return '—';
    const entry = item.type === 'song' && item.arrangementResolved ? item.arrangementResolved[pos.step] : null;
    return entry ? `${itemTitle(item)} · ${entry.label}` : itemTitle(item);
  }

  function renderNav() {
    const manual = Boolean(state.manual);
    const online = live() && !manual;
    $('offline-banner').hidden = !manual;
    // Own navigation: always while live (moving away in follow mode detaches this phone).
    $('manual-nav').hidden = !live();
    if (live()) {
      const layout = POS.layoutOf(state.items);
      const pos = shownPosition();
      $('manual-prev').disabled = POS.samePosition(POS.prevPosition(layout, pos), pos);
      $('manual-next').disabled = POS.samePosition(POS.nextPosition(layout, pos), pos);
    }
    // Free: the live bar and the whole setlist; follow: "Revino la live" while away.
    $('live-bar').hidden = !(online && free());
    if (online && free()) {
      $('live-bar-text').textContent = t('follow.liveBar', { label: liveLabel() });
      const at = shownPosition();
      $('go-live').disabled = POS.samePosition(at, state.snap.worship);
    }
    $('back-live').hidden = !(online && !free() && state.away);
    $('jump-nav').hidden = !(live() && (free() || manual));
    if (!$('jump-nav').hidden) {
      const current = shownPosition().itemId;
      $('jump-list').replaceChildren(...state.items.map((item) => el('li', null, el('button', {
        type: 'button',
        class: `jump-item${item.id === current ? ' current' : ''}`,
        'aria-current': item.id === current ? 'true' : null,
        onclick: () => jumpTo({ itemId: item.id, step: 0 }),
      },
      el('span', { class: `type-badge type-${item.type}`, text: t(`setlist.types.${item.type}`) }),
      el('span', { class: 'follow-setlist-title', text: itemTitle(item) }),
      item.id === state.snap.worship.itemId ? el('span', { class: 'live-badge', text: t('live.liveBadge') }) : null))));
    }
  }

  function render() {
    if (!state.event || !state.snap) return;
    renderHead();
    renderNav();
    renderSlide();
  }

  // --- the person's own place ---------------------------------------------------------

  function stopReattach() {
    clearTimeout(state.reattach);
    state.reattach = null;
  }

  // Follow mode: back to live after 30 s without touching the page.
  function armReattach() {
    stopReattach();
    if (free() || !state.away) return;
    state.reattach = setTimeout(backToLive, REATTACH_MS);
  }

  function backToLive() {
    stopReattach();
    if (free()) state.away = { ...state.snap.worship }; // free: go there, stay free
    else state.away = null;
    render();
  }

  function jumpTo(pos) {
    if (state.manual) state.manual = pos;
    else state.away = pos;
    armReattach();
    render();
    window.scrollTo({ top: 0 });
  }

  function moveLocal(step) {
    if (!live()) return;
    const layout = POS.layoutOf(state.items);
    const from = shownPosition();
    const to = step > 0 ? POS.nextPosition(layout, from) : POS.prevPosition(layout, from);
    if (POS.samePosition(to, from)) return;
    jumpTo(to);
  }

  // A new snapshot: team mode switches, a changed setlist, live moving on.
  function followSnapshot(previous, snap) {
    const wasFree = previous && previous.status === 'live' && previous.teamMode === 'free';
    const isFree = snap.status === 'live' && snap.teamMode === 'free';
    if (snap.status !== 'live') {
      state.away = null;
      stopReattach();
    } else if (isFree && !wasFree) {
      // Free now: everyone stays where they are.
      state.away = state.away || (previous && previous.status === 'live' ? { ...previous.worship } : { ...snap.worship });
      stopReattach();
    } else if (!isFree && wasFree) {
      state.away = null; // follow again: straight to live
      stopReattach();
    }
  }

  // The person's place no longer exists (the setlist changed): back to live.
  function checkAway() {
    if (state.away && !state.items.some((it) => it.id === state.away.itemId)) {
      state.away = free() ? { ...state.snap.worship } : null;
      stopReattach();
    }
  }

  // Offline for a while: the team member moves on their own (from where the team was).
  function goOffline(offline) {
    if (offline && state.snap && state.snap.status === 'live' && state.event) {
      state.manual = state.manual || { ...state.snap.worship };
    } else if (!offline) {
      return; // manual mode ends with the first snapshot of the new connection
    }
    render();
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
  $('manual-prev').addEventListener('click', () => moveLocal(-1));
  $('manual-next').addEventListener('click', () => moveLocal(1));
  $('back-live').addEventListener('click', backToLive);
  $('go-live').addEventListener('click', backToLive);

  // A horizontal swipe on the slide moves this phone on its own.
  let swipe = null;
  slide.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') return;
    swipe = { x: event.clientX, y: event.clientY, id: event.pointerId };
  });
  slide.addEventListener('pointerup', (event) => {
    if (!swipe || swipe.id !== event.pointerId) return;
    const dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) moveLocal(dx < 0 ? 1 : -1);
  });
  slide.addEventListener('pointercancel', () => { swipe = null; });
  // Any touch on the page while away restarts the 30 s (reading is not idling).
  document.addEventListener('pointerdown', () => { if (state.away && !free()) armReattach(); });
  $('text-smaller').addEventListener('click', () => setScale(-SCALE.step));
  $('text-larger').addEventListener('click', () => setScale(SCALE.step));

  document.addEventListener('notation:change', () => render());

  document.addEventListener('i18n:change', () => {
    if (!state.snap) return;
    renderConnection(client ? client.connection : 'connecting');
    const key = state.loadedKey;
    state.loadedKey = null; // labels come from the server in the page language
    syncSetlist(state.snap).catch(() => { state.loadedKey = key; }).then(render); // offline: old labels
  });

  // --- start ------------------------------------------------------------------------

  // Loaded without the server (the installed app reloaded offline): the event saved on this
  // device, in manual mode at once.
  async function cachedStart() {
    if (!window.EVENT_CACHE.offline()) return null;
    const record = await window.EVENT_CACHE.load(eventId);
    if (!record || !record.snap || !record.event || !record.items) return null;
    state.event = record.event;
    state.items = record.items;
    state.songs = new Map((record.songs || []).map(([id, song]) => [id, Promise.resolve(song)]));
    state.loadedKey = record.setlistKey;
    return record.snap;
  }

  let client = null;
  function start(initialState) {
    client = window.LIVE.connect({
      eventId,
      initialState,
      onState: (snap) => {
        const previous = state.snap;
        state.snap = snap;
        // While the event is live the "new version" toast waits (public/pwa.js).
        document.documentElement.toggleAttribute('data-pwa-hold', snap.status === 'live');
        if (state.manual && snap !== initialState && snap.teamMode === 'free') state.away = state.manual; // keep the place
        state.manual = null; // back online: follow the team again
        followSnapshot(previous, snap);
        if (!initialState || snap !== initialState) window.EVENT_CACHE.save({ eventId, snap });
        syncSetlist(snap).then(() => {
          if (state.snap !== snap || !state.event) return;
          $('status').hidden = true;
          $('follow').hidden = false;
          if (snap === initialState) goOffline(true);
          checkAway();
          render();
        }).catch(() => {}); // server unreachable meanwhile: the next snapshot tries again
      },
      onConnection: renderConnection,
      onGone: gone,
      onLongOffline: goOffline,
    });
  }

  cachedStart().then((snap) => {
    if (!snap && window.EVENT_CACHE.offline()) {
      $('status').removeAttribute('data-i18n');
      $('status').textContent = t('offline.text');
    }
    start(snap || undefined);
  }, () => start(undefined));
  renderConnection('connecting');
  keepScreenOn();
})();
