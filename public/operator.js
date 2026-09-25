'use strict';

// Operator console (/events/:id/operator: the event roles), on the projector PC. Full
// controls, like the leader page: start / end, the live mode and the team mode.
//   Împreună  the console moves the ONE main position (worship.*): projector and team follow
//   Separat   the console moves the projector (projector.*); it shows where the team is, with
//             "Sari acolo" (W) to bring the projector there
// Additions go where the operator chooses: "Doar pe proiector" (a projector-only item) or
// "În setlist" (shared, the team sees it at once). No approval.
// Like every live page it renders only the server's snapshots (which, for these roles,
// carry every item, projector-only ones included).

(function () {
  const { api, el, setTitle } = window.PAGE;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const eventId = Number(window.location.pathname.split('/')[2]);
  const RESULTS_MAX = 8;
  const SEARCH_DELAY_MS = 250;

  const state = { snap: null, event: null, client: null, queue: Promise.resolve(), selected: null, results: [], screens: 0 };

  // --- helpers ----------------------------------------------------------------------

  const items = () => (state.snap && state.snap.items) || [];
  const live = () => Boolean(state.snap) && state.snap.status === 'live';
  const split = () => live() && state.snap.mode === 'split';

  // Where the projector is: its own position when separate, else the main one.
  function projectorPos() {
    const snap = state.snap;
    return snap.mode === 'split'
      ? { itemId: snap.projector.itemId, step: snap.projector.step }
      : snap.worship;
  }

  // Moves from this page: the projector when separate, the main position together. A
  // projector-only item can only be shown on its own: choosing it switches to separate.
  async function goto(item, step) {
    if (split()) return send('projector.goto', { itemId: item.id, step });
    if (item.scope === 'projector') {
      const reply = await send('live.mode', { mode: 'split' });
      return reply.ok ? send('projector.goto', { itemId: item.id, step }) : reply;
    }
    return send('worship.goto', { itemId: item.id, step });
  }
  const move = (dir) => send(split() ? `projector.${dir}` : `worship.${dir}`);

  function itemTitle(item) {
    if (!item) return '';
    if (item.type === 'song') return item.title || t('setlist.songDeleted');
    if (item.type === 'verse') return item.reference || t('setlist.types.verse');
    return item.title || (item.body ? item.body.split('\n')[0].slice(0, 80) : '') || t(`setlist.types.${item.type}`);
  }

  const stepsOf = (item) => (item && item.type === 'song' && item.songId && item.arrangementResolved && item.arrangementResolved.length
    ? item.arrangementResolved
    : null);

  function positionLabel(pos) {
    const item = items().find((it) => it.id === pos.itemId);
    if (!item) return '—';
    const steps = stepsOf(item);
    return steps && steps[pos.step] ? `${itemTitle(item)} · ${steps[pos.step].label}` : itemTitle(item);
  }

  // The tag of an operator item.
  const tagOf = (item) => (item.scope === 'projector' ? 'projectorOnly' : null);

  function nextPos(pos) {
    const list = items();
    const i = list.findIndex((it) => it.id === pos.itemId);
    if (i < 0) return null;
    const steps = stepsOf(list[i]);
    if (steps && pos.step + 1 < steps.length) return { itemId: pos.itemId, step: pos.step + 1 };
    return i + 1 < list.length ? { itemId: list[i + 1].id, step: 0 } : null;
  }

  function message(id, text, kind) {
    $(id).className = `message${kind ? ` ${kind}` : ''}`;
    $(id).textContent = text || '';
  }

  function errorText(reply) {
    const key = `live.errors.${reply.code}`;
    const text = t(key);
    return text === key ? reply.error || t('live.errors.internal') : text;
  }

  // Commands go one after another. A stale version (someone moved meanwhile) is retried once
  // against the new state, except for moves of the main position (a second "next" would skip
  // a section the other page just moved to).
  function send(type, extra) {
    state.queue = state.queue.then(async () => {
      let reply = await state.client.command(type, extra);
      if (!reply.ok && reply.code === 'stale' && !type.startsWith('worship.')) reply = await state.client.command(type, extra);
      message('op-message', reply.ok ? '' : errorText(reply), reply.ok ? null : 'error');
      return reply;
    });
    return state.queue;
  }

  // --- rendering --------------------------------------------------------------------

  function renderBanner() {
    const mode = !live() ? 'notLive' : state.snap.mode;
    $('mode-banner').dataset.mode = mode;
    $('mode-title').textContent = t(`operator.banner.${mode}`);
    $('mode-detail').textContent = t(`operator.banner.${mode}Detail`);
  }

  function renderConnection(value) {
    $('connection').dataset.state = value;
    $('connection-text').textContent = t(`live.connection.${value}`);
  }

  function renderHead() {
    setTitle('operator.pageTitle', { name: state.event.name });
    $('event-name').textContent = state.event.name;
    const status = state.snap.status;
    $('start-button').hidden = status !== 'published';
    $('end-button').hidden = status !== 'live';
    modes.update(state.snap);
    // Separate: where the team is, and "Sari acolo" (the projector goes there, W).
    $('cross').hidden = !split();
    if (split()) {
      $('cross-text').textContent = t('live.modes.teamAt', { label: positionLabel(state.snap.worship) });
      const pos = projectorPos();
      $('cross-jump').disabled = pos.itemId === state.snap.worship.itemId && pos.step === state.snap.worship.step;
    }
    $('op-screens').textContent = state.screens === 1 ? t('live.projector.screensOne') : t('live.projector.screens', { n: state.screens });
  }

  function renderList() {
    const enabled = live();
    const pos = live() ? projectorPos() : { itemId: null };
    const worship = live() ? state.snap.worship : { itemId: null };
    const list = items();
    $('op-list').replaceChildren(...list.map((item, i) => {
      const tag = tagOf(item);
      const onProjector = item.id === pos.itemId;
      return el('li', null, el('button', {
        type: 'button',
        class: `op-item${onProjector ? ' on-projector' : ''}${item.id === worship.itemId ? ' at-worship' : ''}${item.scope === 'projector' ? ' projector-only' : ''}`,
        'aria-current': onProjector ? 'step' : null,
        disabled: !enabled,
        onclick: () => goto(item, 0),
      },
      el('span', { class: 'item-number', text: String(i + 1) }),
      el('span', { class: 'item-text' },
        el('span', { class: `type-badge type-${item.type}`, text: t(`setlist.types.${item.type}`) }),
        el('span', { class: 'item-title', text: itemTitle(item) }),
        tag ? el('span', { class: `op-tag tag-${tag}`, text: t(`operator.tags.${tag}`) }) : null),
      el('span', { class: 'op-markers' },
        onProjector ? el('span', { class: 'marker projector', text: t('operator.onProjector') }) : null,
        item.id === worship.itemId ? el('span', { class: 'marker worship', text: t('operator.worship') }) : null)));
    }));
    if (!list.length) $('op-list').replaceChildren(el('li', { class: 'muted', text: t('setlist.empty') }));
  }

  function renderCenter() {
    const enabled = live();
    const pos = live() ? projectorPos() : { itemId: null, step: 0 };
    const worship = live() ? state.snap.worship : { itemId: null, step: 0 };
    const item = items().find((it) => it.id === pos.itemId);
    $('op-item-type').hidden = !item;
    if (item) {
      $('op-item-type').className = `type-badge type-${item.type}`;
      $('op-item-type').textContent = t(`setlist.types.${item.type}`);
    }
    $('op-item-title').textContent = item ? itemTitle(item) : t(live() ? 'setlist.empty' : 'operator.notLiveShort');
    const steps = stepsOf(item) || (item ? [{ code: '', label: itemTitle(item) }] : []);
    $('op-steps').replaceChildren(...steps.map((entry, step) => {
      const here = step === pos.step;
      const worshipHere = worship.itemId === item.id && worship.step === step;
      return el('li', null, el('button', {
        type: 'button',
        class: `op-step${here ? ' projector' : ''}${worshipHere ? ' worship' : ''}`,
        'aria-current': here ? 'step' : null,
        'aria-label': t('live.stepLabel', { n: step + 1, label: entry.label }),
        disabled: !enabled,
        onclick: () => goto(item, step),
      },
      el('span', { class: 'step-code', text: entry.code }),
      el('span', { class: 'step-label', text: entry.label }),
      here ? el('span', { class: 'marker projector', text: t('operator.onProjector') }) : null,
      worshipHere ? el('span', { class: 'marker worship', text: t('operator.worshipHere') }) : null));
    }));
    const list = items();
    const index = list.findIndex((it) => it.id === pos.itemId);
    const after = item ? nextPos(pos) : null;
    $('op-prev').disabled = !enabled || !item || (index === 0 && pos.step === 0);
    $('op-next').disabled = !enabled || !after;
    $('op-next').textContent = after ? t('live.next', { label: after.itemId === pos.itemId ? stepsOf(item)[after.step].label : itemTitle(list.find((it) => it.id === after.itemId)) }) : t('live.nextEnd');
    const synced = live() && pos.itemId === worship.itemId && pos.step === worship.step;
    $('op-sync').hidden = !split();
    $('op-sync').disabled = !split() || synced;
  }

  function renderSources() {
    const enabled = live();
    const source = live() ? state.snap.projector.source : 'content';
    const video = live() ? state.snap.video : null;
    for (const button of document.querySelectorAll('[data-source]')) {
      button.setAttribute('aria-pressed', String(live() && button.dataset.source === source));
      // Video plays the prepared video (it is chosen in the video panel below).
      const noVideo = button.dataset.source === 'video' && !(video && video.state !== 'none' && !(video.local && !video.localName));
      button.disabled = !enabled || noVideo;
    }
  }

  function renderAdd() {
    const enabled = live();
    $('add-search').disabled = !enabled;
    $('add-projector').disabled = !enabled || !state.selected;
    $('add-setlist').disabled = !enabled || !state.selected;
    $('add-search').placeholder = t('operator.searchPlaceholder');
    $('add-results').replaceChildren(...state.results.map((song) => el('li', null, el('button', {
      type: 'button',
      class: `op-result${state.selected === song.id ? ' selected' : ''}`,
      'aria-pressed': String(state.selected === song.id),
      disabled: !enabled,
      onclick: () => {
        state.selected = state.selected === song.id ? null : song.id;
        renderAdd();
      },
    },
    el('span', { class: 'item-title', text: song.title }),
    song.key ? el('span', { class: 'item-sub', text: t('options.songKeyShort', { key: song.key }) }) : null))));
  }

  function render() {
    if (!state.event || !state.snap) return;
    renderBanner();
    renderHead();
    renderList();
    renderCenter();
    renderSources();
    renderAdd();
    videoPanel.setSetlist(items());
    videoPanel.update(state.snap);
    videoPanel.setLocked(!live());
  }

  function gone() {
    $('console').hidden = true;
    $('status').hidden = false;
    $('status').removeAttribute('data-i18n');
    $('status').textContent = t('setlist.notFound');
  }

  // --- projector preview, screens, video --------------------------------------------

  const preview = window.PROJECTOR_RENDER.create($('projector-preview'), { videoPlaceholder: true });
  const videoPanel = window.VIDEO_PANEL.create($('video-panel'), {
    send, api, t, el,
    canAddUrl: false, // adding to the media library: owner / leader, on /media
  });
  window.PROJECTOR_WINDOW.setup({ button: $('open-projector'), hint: $('projector-permission'), message: $('projector-message'), api, t });
  const modes = window.LIVE_MODES.controls($('mode-controls'), { send, t, el });
  const toast = window.LIVE_MODES.toast($('info-toast'), { t });

  function watchProjector(socket) {
    socket.emit('projector:watch', {}, (reply) => {
      if (!reply || !reply.ok) return;
      preview.show(reply.frame);
      state.screens = reply.screens;
      videoPanel.setScreens(reply.screens);
      if (reply.videoStatus && reply.videoStatus.length) videoPanel.status(reply.videoStatus);
      if (state.event) renderHead();
    });
  }

  // --- controls ---------------------------------------------------------------------

  function toggleSource(source) {
    const current = state.snap && state.snap.projector.source;
    send('projector.source', { source: current === source ? 'content' : source });
  }

  for (const button of document.querySelectorAll('[data-source]')) {
    button.addEventListener('click', () => {
      if (button.dataset.source === 'video') send('video.play');
      else send('projector.source', { source: button.dataset.source });
    });
  }
  $('op-prev').addEventListener('click', () => move('prev'));
  $('op-next').addEventListener('click', () => move('next'));
  $('op-sync').addEventListener('click', () => send('projector.syncToWorship'));
  $('cross-jump').addEventListener('click', () => send('projector.syncToWorship'));
  $('start-button').addEventListener('click', () => send('event.start'));
  $('end-button').addEventListener('click', () => {
    $('end-dialog').returnValue = '';
    $('end-dialog').showModal();
  });
  $('end-dialog').addEventListener('close', () => {
    if ($('end-dialog').returnValue !== 'end') return;
    send('event.end').then((reply) => { if (reply && reply.ok) window.location.assign('/app'); });
  });

  document.addEventListener('keydown', (event) => {
    if (!live() || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target.closest('input, textarea, select, dialog')) return;
    if (event.key === ' ' && event.target.closest('button, a')) return; // Space clicks the focused button
    const keys = {
      ArrowRight: () => move('next'),
      ' ': () => move('next'),
      ArrowLeft: () => move('prev'),
      b: () => toggleSource('black'),
      l: () => toggleSource('logo'),
      w: () => { if (split()) send('projector.syncToWorship'); },
    };
    const action = keys[event.key.length === 1 ? event.key.toLowerCase() : event.key];
    if (!action) return;
    event.preventDefault();
    action();
  });

  // Library search for the add panel.
  let searchTimer = null;
  let searchToken = 0;
  $('add-search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const q = $('add-search').value.trim();
      const mine = ++searchToken;
      if (!q) {
        state.results = [];
        state.selected = null;
        renderAdd();
        return;
      }
      const res = await api(`/api/songs?q=${encodeURIComponent(q)}`).catch(() => null);
      if (mine !== searchToken) return;
      state.results = res && res.ok ? res.body.songs.slice(0, RESULTS_MAX).map((s) => ({ id: s.id, title: s.title, key: s.song_key || null })) : [];
      if (!state.results.some((s) => s.id === state.selected)) state.selected = null;
      message('add-message', res && res.ok && !state.results.length ? t('operator.noResults') : '');
      renderAdd();
    }, SEARCH_DELAY_MS);
  });

  async function addSelected(target) {
    if (!state.selected) {
      message('add-message', t('operator.addNeedsSong'), 'error');
      return;
    }
    const reply = await send('operator.addItem', { target, item: { type: 'song', songId: state.selected } });
    if (!reply.ok) {
      message('add-message', errorText(reply), 'error');
      return;
    }
    message('add-message', t(target === 'setlist' ? 'operator.addedSetlist' : 'operator.addedProjector'), 'success');
    state.selected = null;
    renderAdd();
  }
  $('add-projector').addEventListener('click', () => addSelected('projector'));
  $('add-setlist').addEventListener('click', () => addSelected('setlist'));

  document.addEventListener('i18n:change', () => {
    if (!state.snap) return;
    renderConnection(state.client.connection);
    render();
    videoPanel.render();
    // Section labels come from the server in the connection's language: reconnect.
    state.client.socket.disconnect().connect();
  });

  // --- start ------------------------------------------------------------------------

  // Loaded without the server (the installed app reloaded offline): the last snapshot saved
  // on this device, shown read-only until the connection is back.
  async function cachedSnapshot() {
    const record = await window.EVENT_CACHE.load(eventId);
    if (!record || !record.event || !record.snap) return null;
    state.event = record.event;
    return { ...record.snap, items: record.snap.items || record.items || [] };
  }

  (async () => {
    let initialState;
    let res = null;
    if (!window.EVENT_CACHE.offline()) res = await api(`/api/events/${eventId}`).catch(() => null);
    if (res && res.ok) {
      state.event = res.body.event;
      window.EVENT_CACHE.save({ eventId, event: state.event });
    } else if (res && res.status === 404) {
      return gone();
    } else {
      initialState = await cachedSnapshot();
      if (!initialState) {
        $('status').removeAttribute('data-i18n');
        $('status').textContent = t('offline.text');
        return;
      }
    }
    state.client = window.LIVE.connect({
      eventId,
      initialState,
      onState: (snap) => {
        state.snap = snap;
        // While the event is live the "new version" toast waits (public/pwa.js).
        document.documentElement.toggleAttribute('data-pwa-hold', snap.status === 'live');
        if (snap !== initialState) window.EVENT_CACHE.save({ eventId, snap });
        $('status').hidden = true;
        $('console').hidden = false;
        render();
      },
      onConnection: renderConnection,
      onGone: gone,
      onConnect: watchProjector,
    });
    state.client.socket.on('projector:frame', (frame) => preview.show(frame));
    state.client.socket.on('projector:screens', ({ count }) => {
      state.screens = count;
      videoPanel.setScreens(count);
      if (state.event) renderHead();
    });
    state.client.socket.on('projector:video-status', (status) => videoPanel.status(status));
    state.client.socket.on('live:notice', toast.show);
    renderConnection('connecting');
  })().catch(() => {
    $('status').textContent = t('common.networkError');
  });
})();
