'use strict';

// Leader control (/events/:id/live, the event roles): moves the main (team) position. The
// page never moves on its own: every change is a command, and it renders only the live:state
// snapshots the server broadcasts, except in emergency mode (below).
// Live control "Împreună · Separat": together, the operator console moves the same position;
// separate, the projector has its own position (moved from the console) and this page shows
// where it is, with "Sari acolo" to bring the team there. "Echipa: Urmărește live ·
// Derulează liber" sets how team phones follow. Additions made from the console show a short
// info toast.

(function () {
  const { api, el, setTitle } = window.PAGE;
  const { t } = window.I18N;
  const { stepsOf, nextPosition } = window.LIVE;
  const $ = (id) => document.getElementById(id);
  const eventId = Number(window.location.pathname.split('/')[2]);

  const state = { event: null, items: [], loadedKey: null, loading: null, songs: new Map(), snap: null, seq: 0, client: null, queue: Promise.resolve(), cached: null,
    openLyrics: new URLSearchParams(window.location.search).get('view') === 'lyrics' };

  // --- data -------------------------------------------------------------------------

  // Reloads the setlist when the snapshot says it changed (setlistKey).
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
      cacheEvent();
    });
    // Unreachable server: forget the attempt (the next snapshot tries again), keep the data.
    promise.catch(() => { if (state.loading && state.loading.promise === promise) state.loading = null; });
    state.loading = { key: snap.setlistKey, promise };
    return promise;
  }

  // A song item ready to render (sections transposed, arrangement resolved), once each.
  function loadSong(item) {
    if (!state.songs.has(item.id)) {
      state.songs.set(item.id, api(`/api/events/${eventId}/items/${item.id}/song`)
        .then((res) => (res.ok ? res.body.song : null))
        .catch(() => null));
    }
    return state.songs.get(item.id);
  }

  // Everything needed to compute projector frames without the server (public/frames.js):
  // the setlist, every song ready to render and the logo, saved in IndexedDB whenever the
  // setlist changes (and when the logo is first known).
  async function cacheEvent() {
    const key = state.loadedKey;
    const items = state.items;
    const songs = await Promise.all(items.filter((it) => it.type === 'song' && it.songId)
      .map(async (it) => [it.id, await loadSong(it)]));
    if (state.loadedKey !== key) return; // a newer setlist is being loaded
    const logoUrl = projector.logoUrl;
    const logo = logoUrl ? { url: logoUrl, dataUrl: await window.EVENT_CACHE.logoData(logoUrl) } : null;
    if (state.loadedKey !== key) return;
    state.cached = { eventId, setlistKey: key, event: state.event, items, songs: songs.filter(([, song]) => song), logo };
    await window.EVENT_CACHE.save(state.cached);
  }

  // --- helpers ----------------------------------------------------------------------

  function itemTitle(item) {
    if (item.type === 'song') return item.title || t('setlist.songDeleted');
    if (item.type === 'verse') return item.reference || t('setlist.types.verse');
    return item.title || (item.body ? item.body.split('\n')[0].slice(0, 80) : '') || t(`setlist.types.${item.type}`);
  }

  function current() {
    const snap = state.snap;
    const pos = snap && snap.worship;
    const item = pos && state.items.find((it) => it.id === pos.itemId);
    return { pos, item: item || null };
  }

  function showMessage(text, isError) {
    $('live-message').textContent = text || '';
    $('live-message').className = `message${isError ? ' error' : ''}`;
  }

  function errorText(reply) {
    const key = `live.errors.${reply.code}`;
    const text = t(key);
    return text === key ? reply.error || t('live.errors.internal') : text;
  }

  // Commands are sent one after another, each against the newest version.
  function send(type, extra) {
    if (emergency.active) return Promise.resolve(localCommand(type, extra));
    state.queue = state.queue.then(async () => {
      const reply = await state.client.command(type, extra);
      if (reply.ok) showMessage('');
      else showMessage(errorText(reply), true);
      return reply;
    });
    return state.queue;
  }

  // --- rendering --------------------------------------------------------------------

  function renderHead() {
    const ev = state.event;
    const snap = state.snap;
    setTitle('live.pageTitle', { name: ev.name });
    $('event-name').textContent = ev.name;
    const status = snap.status;
    $('event-status').className = `pill pill-${status}`;
    $('event-status').textContent = t(`events.status.${status}`);
    $('start-button').hidden = status !== 'planned';
    $('end-button').hidden = status !== 'live';
    renderPresence();
    liveClock.update(snap, snap.worship);
  }

  // The time and "Live de hh:mm" / "pe elementul curent de mm:ss" in the status line.
  const liveClock = window.LIVE_CLOCK.create($('live-clock'), { t });

  function renderPresence() {
    const presence = (state.snap && state.snap.presence) || {};
    const parts = ['presenter', 'leader', 'owner', 'operator', 'member'].filter((role) => presence[role])
      .map((role) => t(`live.presenceRoles.${role}`, { n: presence[role] }));
    const total = Object.values(presence).reduce((a, b) => a + b, 0);
    $('presence').textContent = `${t('live.online', { n: total })}${parts.length ? ` · ${parts.join(' · ')}` : ''}`;
  }

  function renderConnection(value) {
    $('connection').dataset.state = value;
    $('connection-text').textContent = t(`live.connection.${value}`);
  }

  function renderSetlist() {
    const { pos } = current();
    const live = state.snap.status === 'live';
    $('setlist').replaceChildren(...state.items.map((item, i) => {
      const isCurrent = live && pos.itemId === item.id;
      const canArrange = live && arrangeable(item);
      const goThere = () => send('worship.goto', { itemId: item.id, step: 0 });
      const main = el('button', {
        type: 'button',
        class: `live-item${isCurrent ? ' current' : ''}`,
        'aria-current': isCurrent ? 'step' : null,
        'aria-keyshortcuts': canArrange ? 'Shift+Enter' : null,
        disabled: !live,
      },
      el('span', { class: 'item-number', text: String(i + 1) }),
      // Top row: the type and, at the top right, the status badge; the title below.
      el('span', { class: 'item-text' },
        el('span', { class: 'op-item-top' },
          el('span', { class: `type-badge type-${item.type}`, text: t(`setlist.types.${item.type}`) }),
          isCurrent ? el('span', { class: 'op-markers' }, el('span', { class: 'live-badge', text: t('live.liveBadge') })) : null),
        el('span', { class: 'item-title', text: itemTitle(item) }),
        item.type === 'song' && item.displayKey ? el('span', { class: 'item-sub', text: t('options.songKeyShort', { key: window.NOTATION.chord(item.displayKey) }) }) : null));
      // Short tap: the team goes there; long press (or "Aranjează"): the arrange sheet.
      window.PRESS.bind(main, { tap: goThere, hold: canArrange ? () => arrange(item, goThere) : null });
      return el('li', { class: canArrange ? 'has-arrange' : null }, main, canArrange ? arrangeButton(item, () => arrange(item, goThere)) : null);
    }));
    if (!state.items.length) $('setlist').replaceChildren(el('li', { class: 'muted', text: t('setlist.empty') }));
    showPressHint();
  }

  // The visible way to arrange a song from the Program (the long press is a shortcut).
  function arrangeButton(item, open) {
    return el('button', {
      type: 'button', class: 'secondary item-arrange', 'data-icon': 'edit',
      'aria-label': t('arrange.buttonLabel', { title: itemTitle(item) }), onclick: open,
    }, el('span', { text: t('arrange.button') }));
  }

  function showPressHint() {
    if ($('press-hint-live') || !state.items.some((it) => arrangeable(it)) || state.snap.status !== 'live') return;
    const node = window.PRESS.hint('live', 'press.hintLive');
    if (node) $('setlist').before(node);
  }

  function textOf(item) {
    const parts = [];
    if (item.type === 'video' && item.url) parts.push(el('p', { class: 'muted video-url', text: item.url }));
    if (item.body) parts.push(el('p', { class: 'lyrics slide-body', text: item.body }));
    return parts;
  }

  async function renderCurrent() {
    const snap = state.snap;
    const box = $('current');
    const { pos, item } = current();
    const status = snap.status;
    $('prev-button').hidden = status !== 'live';
    $('next-button').hidden = status !== 'live';
    $('end-item-button').hidden = status !== 'live';
    if (status === 'planned') {
      box.replaceChildren(el('p', { class: 'live-note', text: t('live.notStartedLeader') }));
      return;
    }
    if (status === 'finished') {
      box.replaceChildren(el('p', { class: 'live-note', text: t('live.finished') }));
      return;
    }
    if (!item) {
      box.replaceChildren(el('p', { class: 'muted', text: t('setlist.empty') }));
      $('prev-button').disabled = true;
      $('next-button').disabled = true;
      $('next-button').textContent = t('live.nextEnd');
      renderEndItem(null);
      return;
    }

    const index = state.items.indexOf(item);
    renderEndItem(item);
    $('prev-button').disabled = index === 0 && pos.step === 0 && !pos.ended;
    // After "Sfârșit" the next move is the next item's first step.
    const following = state.items[index + 1];
    const after = pos.ended ? (following ? { itemId: following.id, step: 0 } : null) : nextPosition(state.items, pos);
    $('next-button').disabled = !after;
    $('next-button').textContent = after ? t('live.next', { label: window.LIVE.nextText(state.items, pos).label }) : t('live.nextEnd');

    const head = el('header', { class: 'current-head' },
      el('span', { class: `type-badge type-${item.type}`, text: t(`setlist.types.${item.type}`) }),
      el('h3', { class: 'current-title' }, arrangeable(item) && state.snap.status === 'live'
        ? el('button', { type: 'button', class: 'title-button', id: 'arrange-current', 'aria-label': t('arrange.buttonLabel', { title: itemTitle(item) }), onclick: () => arrange(item) },
          itemTitle(item), el('span', { class: 'title-button-hint', 'data-icon': 'edit', text: t('arrange.button') }))
        : itemTitle(item)),
      item.type === 'song' && item.displayKey ? el('span', { class: 'key-badge', text: t('rehearse.key', { key: window.NOTATION.chord(item.displayKey) }) }) : null);

    if (item.type !== 'song' || !item.songId) {
      box.replaceChildren(head, ...(item.type === 'song' ? [el('p', { class: 'muted', text: t('setlist.songDeletedHint') })] : textOf(item)));
      return;
    }

    const arrangement = item.arrangementResolved || [];
    const steps = el('ol', { class: 'step-grid', 'aria-label': t('live.stepsLabel') },
      arrangement.map((entry, step) => {
        const isCurrent = step === pos.step;
        const label = t('live.stepLabel', { n: step + 1, label: entry.label });
        return el('li', null, el('button', {
          type: 'button',
          class: `step${isCurrent ? ' current' : ''}`,
          'aria-current': isCurrent ? 'step' : null,
          'aria-label': entry.firstLine ? `${label}: ${entry.firstLine}` : label,
          title: entry.firstLine || null,
          // The current step opens the big lyrics; any other moves there.
          onclick: () => (isCurrent && !pos.ended ? big.open() : send('worship.goto', { itemId: item.id, step })),
        },
        el('span', { class: 'step-head' },
          el('span', { class: 'step-code', text: entry.code }),
          el('span', { class: 'step-label', text: entry.label })),
        entry.firstLine ? el('span', { class: 'step-line', text: entry.firstLine }) : null,
        isCurrent ? el('span', { class: 'step-badges' }, el('span', { class: 'live-badge', text: t('live.liveBadge') })) : null));
      }));
    box.replaceChildren(head, steps, el('p', { class: 'big-open-row' },
      el('button', { type: 'button', class: 'secondary big-open', id: 'big-open', 'data-icon': 'expand', 'aria-keyshortcuts': 'F', text: t('big.open'), onclick: () => big.open() })));

    const version = snap.version;
    const song = await loadSong(item);
    if (state.snap.version !== version || !song) return;
    const entry = song.arrangement[pos.step];
    const sectionIndex = entry ? song.sections.findIndex((s) => s.id === entry.sectionId) : -1;
    if (sectionIndex < 0) return;
    const labels = window.SECTIONS.sectionLabels(song.sections, t);
    box.append(el('div', { class: 'current-section' },
      window.SONG_RENDER.sectionsView([song.sections[sectionIndex]], { headingLevel: 4, labels: [labels[sectionIndex]] })));
  }

  // "■ Sfârșit" (worship.endItem, key E): ends the item on screen in place (black); "✓ Terminat"
  // until the next move. The team's position (in split mode the projector is not this page's).
  function renderEndItem(item) {
    window.LIVE.renderEndButton($('end-item-button'), { ended: Boolean(state.snap.worship.ended), hasItem: Boolean(item) });
  }

  function renderInfo() {
    const { pos, item } = current();
    const parts = [];
    if (state.snap.status === 'live' && item) {
      const i = state.items.indexOf(item);
      const upcoming = state.items[i + 1];
      if (item.type === 'song' && item.song) {
        if (item.transpose) parts.push(el('p', { class: 'muted', text: t('rehearse.keyOriginal', { key: window.NOTATION.chord(item.song.key) || '—' }) }));
        if (item.arrangementResolved && item.arrangementResolved.length > 1) {
          parts.push(el('ol', { class: 'arr-strip', 'aria-label': t('rehearse.arrangement') },
            item.arrangementResolved.map((a, step) => el('li', { class: step === pos.step ? 'current' : null, title: a.label, text: a.code }))));
        }
      }
      if (item.teamNote) {
        parts.push(el('div', { class: 'team-note', role: 'note' },
          el('span', { class: 'ro-label', text: t('rehearse.teamNote') }), el('p', { text: item.teamNote })));
      }
      if (item.referenceUrl) {
        parts.push(el('p', null, el('a', { class: 'button secondary', href: item.referenceUrl, target: '_blank', rel: 'noopener noreferrer', text: t('options.listenReference') })));
      }
      parts.push(el('p', { class: 'upcoming' },
        el('span', { class: 'ro-label', text: t('live.upNext') }),
        el('span', { text: upcoming ? itemTitle(upcoming) : t('live.nothingAfter') })));
    } else {
      parts.push(el('p', { class: 'muted', text: t('live.infoIdle') }));
    }
    $('info').replaceChildren(...parts);
  }

  function render() {
    if (!state.event || !state.snap) return;
    renderHead();
    renderSetlist();
    renderInfo();
    renderCurrent();
    arrangedNote();
    big.update(state.snap, state.items);
  }

  // "⤢ Versuri mari" (public/big-lyrics.js): the team's position, the page's own commands.
  const big = window.BIG_LYRICS.create({
    api, eventId,
    position: () => (state.snap && state.snap.status === 'live' ? state.snap.worship : null),
    commands: { prev: () => send('worship.prev'), next: () => send('worship.next'), end: () => send('worship.endItem'), toggleBlack: () => toggleSource('black') },
    connection: () => (state.client ? state.client.connection : 'connecting'),
    extraStatus: () => modes.statusText(), // the handover request / answer
  });

  // --- arranging a song during live (public/arrange-sheet.js): saved at once ------------

  const arrangeable = (item) => item && item.type === 'song' && item.songId && item.scope !== 'projector';

  function arrange(item, goTo = null) {
    window.ARRANGE_SHEET.openForItem(item, {
      goTo,
      onApply: async (result) => {
        const out = await window.ARRANGE_SHEET.saveToEvent(state.event.id, item.id, result);
        if (out.error) return showMessage(out.error, true);
        showMessage(t('arrange.saved'));
        state.arranged = { itemId: item.id, codes: result.codes.join(' ') };
        render();
      },
    });
  }

  // Once the new order has arrived: where the team is now, if on that song.
  function arrangedNote() {
    const done = state.arranged;
    if (!done || state.snap.status !== 'live') return;
    const item = state.items.find((it) => it.id === done.itemId);
    const steps = item && item.arrangementResolved;
    if (!steps || steps.map((x) => x.code).join(' ') !== done.codes) return; // not yet here
    state.arranged = null;
    const { pos } = current();
    if (pos && pos.itemId === item.id && steps[pos.step]) showMessage(t('arrange.moved', { label: `${steps[pos.step].code} · ${steps[pos.step].label}` }));
  }

  function gone() {
    $('live').hidden = true;
    $('status').hidden = false;
    $('status').removeAttribute('data-i18n');
    $('status').textContent = t('setlist.notFound');
  }

  // --- projector panel --------------------------------------------------------------

  // The small preview renders exactly the frame the screens get (same render module).
  const preview = window.PROJECTOR_RENDER.create($('projector-preview'), { videoPlaceholder: true, guide: true });
  // Video controls (a module the operator console will reuse in stage 6).
  const videoPanel = window.VIDEO_PANEL.create($('video-panel'), { send, api, t, el });
  const projector = { screens: 0, logoUrl: null, frame: null, safeMargin: null };
  const backgroundButton = window.BG_PICKER.liveButton($('bg-live'), { send });
  // The corner clock (clock.set: show / corner / size; key K toggles it).
  const clockPanel = window.CLOCK_PANEL.create($('clock-panel'), { t, el, onChange: (patch) => send('clock.set', patch) });

  function renderProjector() {
    const snap = state.snap;
    const live = Boolean(snap) && snap.status === 'live';
    const source = snap ? snap.projector.source : 'content';
    for (const button of document.querySelectorAll('[data-source]')) {
      button.setAttribute('aria-pressed', String(live && button.dataset.source === source));
      button.disabled = !live;
    }
    $('projector-screens').textContent = projector.screens === 1
      ? t('live.projector.screensOne')
      : t('live.projector.screens', { n: projector.screens });
    modes.update(snap);
    backgroundButton.update(snap);
    clockPanel.update({ clock: snap && snap.clock, enabled: live && !emergency.active });
    // Separate: where the projector is, and "Sari acolo" (the team goes there).
    const split = live && snap.mode === 'split';
    $('cross').hidden = !split;
    if (split) {
      const at = { itemId: snap.projector.itemId, step: snap.projector.step };
      // (shared items from the setlist loaded in the page language; projector-only ones from the snapshot)
      const shared = state.items.find((it) => it.id === at.itemId);
      const item = shared || (snap.items || []).find((it) => it.id === at.itemId);
      const step = item && item.arrangementResolved && item.arrangementResolved[at.step];
      const label = item ? [itemTitle(item), step ? step.label : null].filter(Boolean).join(' · ') : '—';
      $('cross-text').textContent = shared || !item
        ? t('live.modes.projectorAt', { label })
        : `${t('live.modes.projectorAt', { label })} — ${t('live.modes.projectorOnlyNote')}`;
      const here = snap.worship.itemId === at.itemId && snap.worship.step === at.step;
      $('cross-jump').disabled = !shared || here; // the team cannot go to a projector-only item
    }
  }

  $('cross-jump').addEventListener('click', () => {
    const snap = state.snap;
    if (snap && snap.mode === 'split') send('worship.goto', { itemId: snap.projector.itemId, step: snap.projector.step });
  });

  function toggleSource(source) {
    const currentSource = state.snap && state.snap.projector.source;
    send('projector.source', { source: currentSource === source ? 'content' : source });
  }

  for (const button of document.querySelectorAll('[data-source]')) {
    button.addEventListener('click', () => send('projector.source', { source: button.dataset.source }));
  }

  function watchProjector(socket) {
    socket.emit('projector:watch', {}, (reply) => {
      if (!reply || !reply.ok) return;
      openChannel(reply.adminId);
      showServerFrame(reply.frame);
      projector.screens = reply.screens;
      videoPanel.setScreens(reply.screens);
      if (reply.videoStatus && reply.videoStatus.length) videoPanel.status(reply.videoStatus);
      renderProjector();
      if (Number.isInteger(reply.safeMargin)) projector.safeMargin = reply.safeMargin;
      if (reply.logoUrl !== projector.logoUrl) {
        projector.logoUrl = reply.logoUrl || null;
        if (state.event) cacheEvent();
      }
    });
  }

  window.PROJECTOR_WINDOW.setup({
    button: $('open-projector'), hint: $('projector-permission'), message: $('projector-message'), api, t,
  });
  // Opening the projector window (a paired screen) is the operator's and the owner's; the
  // leader keeps the preview and the sources (lib/events.js SCREEN_ROLES).
  window.SHELL.me.then((me) => {
    if (me && !['owner', 'operator'].includes(me.user.role)) {
      $('open-projector').hidden = true;
      $('projector-permission').hidden = true;
    }
    if (me) modes.setMe(me.user); // the handover flow depends on who this page is
  });

  // Together / separate and the team mode; the info toast for additions from the console.
  const modes = window.LIVE_MODES.controls($('mode-controls'), { send, t, el });
  const toast = window.LIVE_MODES.toast($('info-toast'), { t });

  // --- emergency mode ---------------------------------------------------------------
  // Without the server for more than 5 s the leader keeps moving the projector: positions and
  // frames are computed here (public/positions.js, public/frames.js) from the cached event
  // and sent to the projector windows of this browser over a BroadcastChannel; screens show
  // them only while their own connection is down. Back online: if nobody moved meanwhile
  // (the server version is unchanged) this page's position is sent to the server; otherwise
  // the server wins.

  const { layoutOf, movePosition, samePosition } = window.POSITIONS;
  const emergency = { active: false, reconnected: false, base: null, dirty: false, channel: null, adminId: null };

  function openChannel(adminId) {
    if (!adminId || emergency.adminId === adminId || !('BroadcastChannel' in window)) return;
    window.EVENT_CACHE.save({ eventId, adminId }); // for a reload without the server
    if (emergency.channel) emergency.channel.close();
    emergency.adminId = adminId;
    emergency.channel = new BroadcastChannel(`wa-projector-${adminId}`);
  }

  function post(message) {
    if (emergency.channel) emergency.channel.postMessage(message);
  }

  function showServerFrame(frame) {
    projector.frame = frame;
    if (!emergency.active) preview.show(frame);
  }

  // Emergency is possible only for a live event whose data is cached.
  const canRunLocally = () => Boolean(emergency.base && emergency.base.status === 'live' && state.cached
    && state.cached.setlistKey === emergency.base.setlistKey);

  function renderEmergency() {
    $('emergency-banner').hidden = !emergency.active;
    $('emergency-detail').textContent = emergency.active
      ? t(canRunLocally() ? 'live.emergency.detail' : 'live.emergency.noCache')
      : '';
  }

  function enterEmergency() {
    if (emergency.active || !state.snap) return;
    emergency.active = true;
    emergency.base = state.snap;
    emergency.dirty = false;
    renderEmergency();
    renderProjector(); // the clock controls wait for the server
    showMessage('');
  }

  // The frame the screens would get from the server for the local state.
  function localFrame() {
    const cache = state.cached;
    const logoUrl = cache.logo ? cache.logo.dataUrl || cache.logo.url : null;
    const last = projector.frame;
    return window.FRAMES.projectorFrame(state.snap, { items: cache.items }, new Map(cache.songs), {
      logoUrl,
      videoMedia: last && last.video ? last.video.media : null, // keeps a prepared video loaded
      backgrounds: state.snap.backgrounds || null, // the event's backgrounds, from the last snapshot
      safeMargin: projector.safeMargin === null ? (last ? last.safeMargin : undefined) : projector.safeMargin,
    });
  }

  function localCommand(type, extra = {}) {
    if (!canRunLocally()) {
      showMessage(t('live.emergency.noCache'), true);
      return { ok: false, code: 'offline' };
    }
    const snap = state.snap;
    const layout = layoutOf(state.cached.items);
    let worship = snap.worship;
    let source = snap.projector.source;
    // The same rules as the server (lib/live.js): "■ Sfârșit" ends the item in place; the
    // move after it clears the flag and puts the content back.
    const moves = { 'worship.next': 'next', 'worship.prev': 'prev', 'worship.goto': 'goto' };
    if (moves[type]) {
      const target = movePosition(layout, worship, moves[type], extra.itemId, extra.step);
      const stays = !target || (samePosition(target, worship) && (!worship.ended || type === 'worship.next'));
      if (!stays) {
        if (worship.ended) source = 'content';
        worship = { itemId: target.itemId, step: target.step, ended: false };
      }
    } else if (type === 'worship.endItem') {
      if (worship.itemId !== null && !worship.ended) worship = { ...worship, ended: true };
    } else if (type === 'projector.source' && window.FRAMES.LEADER_SOURCES.includes(extra.source)) source = extra.source;
    else {
      showMessage(t('live.emergency.unavailable'), true);
      return { ok: false, code: 'offline' };
    }
    showMessage('');
    if (samePosition(worship, snap.worship) && Boolean(worship.ended) === Boolean(snap.worship.ended) && source === snap.projector.source) return { ok: true, local: true };
    state.snap = { ...snap, worship, projector: { ...snap.projector, source } };
    emergency.dirty = true;
    render();
    renderProjector();
    const frame = localFrame();
    preview.show(frame);
    post({ type: 'frame', eventId, baseVersion: emergency.base.version, frame });
    return { ok: true, local: true };
  }

  // The first snapshot after the connection came back.
  async function reconcile(server) {
    const local = state.snap;
    const { base, dirty } = emergency;
    emergency.active = false;
    emergency.reconnected = false;
    renderEmergency();
    if (projector.frame) preview.show(projector.frame);
    if (!dirty) {
      post({ type: 'resync', eventId });
      return;
    }
    let pushed = false;
    if (server.version === base.version && server.status === 'live') {
      // Nobody moved meanwhile: this page's position goes to the server.
      pushed = true;
      if (!samePosition(local.worship, server.worship) || (server.worship.ended && !local.worship.ended)) {
        pushed = (await send('worship.goto', { itemId: local.worship.itemId, step: local.worship.step })).ok;
      }
      if (pushed && local.worship.ended && !server.worship.ended) pushed = (await send('worship.endItem')).ok;
      if (pushed && local.projector.source !== server.projector.source) {
        pushed = (await send('projector.source', { source: local.projector.source })).ok;
      }
    }
    showMessage(t(pushed ? 'live.emergency.pushed' : 'live.emergency.synced'));
    post({ type: 'resync', eventId });
  }

  // --- controls ---------------------------------------------------------------------

  $('prev-button').addEventListener('click', () => send('worship.prev'));
  $('next-button').addEventListener('click', () => send('worship.next'));
  $('end-item-button').addEventListener('click', () => send('worship.endItem'));
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
    if (!state.snap || state.snap.status !== 'live' || document.querySelector('dialog[open]')) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input, textarea, select')) return;
    // Space on a focused button or link already clicks it.
    if (event.key === ' ' && event.target.closest('button, a')) return;
    if (event.key === 'ArrowRight' || event.key === ' ') {
      event.preventDefault();
      send('worship.next');
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      send('worship.prev');
    } else if (event.key === 'e' || event.key === 'E') {
      if (!$('end-item-button').disabled) send('worship.endItem'); // end of the item
    } else if (event.key === 'f' || event.key === 'F') {
      big.open(); // full-screen lyrics
    } else if (event.key === 'b' || event.key === 'B') {
      toggleSource('black'); // black <-> content
    } else if (event.key === 'l' || event.key === 'L') {
      toggleSource('logo'); // logo <-> content
    } else if (event.key === 'k' || event.key === 'K') {
      clockPanel.toggle(); // the corner clock on / off
    }
  });

  document.addEventListener('notation:change', () => {
    if (state.snap && state.event) render();
  });

  document.addEventListener('i18n:change', () => {
    if (!state.snap) return;
    renderConnection(state.client.connection);
    renderEmergency();
    renderProjector();
    videoPanel.render();
    modes.render();
    clockPanel.render();
    liveClock.render();
    // Section labels come from the server in the page language: reload.
    const key = state.loadedKey;
    state.loadedKey = null;
    syncSetlist(state.snap).catch(() => { state.loadedKey = key; }).then(render); // offline: old labels
  });

  // --- start ------------------------------------------------------------------------

  $('status').hidden = false;
  // Loaded without the server (the installed app reloaded offline): start from the copy of
  // the event saved on this device; emergency mode takes over after 5 s as usual.
  async function cachedStart() {
    if (!window.EVENT_CACHE.offline()) return null;
    const record = await window.EVENT_CACHE.load(eventId);
    if (!record || !record.snap || !record.event || !record.items) return null;
    state.event = record.event;
    state.items = record.items;
    state.songs = new Map((record.songs || []).map(([id, song]) => [id, Promise.resolve(song)]));
    state.loadedKey = record.setlistKey;
    state.cached = record;
    projector.logoUrl = record.logo ? record.logo.url : null;
    openChannel(record.adminId);
    return record.snap;
  }

  function start(initialState) {
    state.client = window.LIVE.connect({
      eventId,
      initialState,
      onState: (snap) => {
        if (emergency.reconnected) reconcile(snap);
        state.snap = snap;
        // Only a newer snapshot makes this one stale - not a presence update, which replaces
        // state.snap too (else a page joined while someone else is online never renders).
        const seq = ++state.seq;
        // While the event is live the "new version" toast waits (public/pwa.js).
        document.documentElement.toggleAttribute('data-pwa-hold', snap.status === 'live');
        if (!emergency.active) window.EVENT_CACHE.save({ eventId, snap });
        syncSetlist(snap).then(() => {
          if (state.seq !== seq || !state.event) return;
          $('status').hidden = true;
          $('live').hidden = false;
          render();
          renderProjector();
          videoPanel.setSetlist(state.items);
          videoPanel.update(state.snap); // with the presence that may have arrived meanwhile
          // ?view=lyrics (the leader's entry point): the big lyrics open over the page at once.
          if (state.openLyrics) {
            state.openLyrics = false;
            big.open();
          }
        }).catch(() => {}); // server unreachable meanwhile: the next snapshot tries again
      },
      onPresence: (presence) => {
        if (state.snap) state.snap = { ...state.snap, presence };
        if (state.event) renderPresence();
      },
      onConnection: renderConnection,
      onGone: gone,
      onConnect: watchProjector,
      onLongOffline: (offline) => {
        if (offline) enterEmergency();
        else if (emergency.active) emergency.reconnected = true; // reconciled on the next snapshot
      },
    });
    state.client.socket.on('projector:frame', showServerFrame);
    state.client.socket.on('projector:screens', ({ count }) => {
      projector.screens = count;
      videoPanel.setScreens(count);
      renderProjector();
    });
    state.client.socket.on('projector:video-status', (status) => videoPanel.status(status));
    state.client.socket.on('live:notice', toast.show);
    state.client.socket.on('live:handover', (ev) => { modes.handover(ev); big.update(state.snap, state.items); });
    renderConnection('connecting');
  }

  cachedStart().then((snap) => {
    if (!snap && window.EVENT_CACHE.offline()) {
      $('status').removeAttribute('data-i18n');
      $('status').textContent = t('offline.text');
    }
    start(snap || undefined);
  }, () => start(undefined));
})();
