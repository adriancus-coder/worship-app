'use strict';

// Leader control (/events/:id/live, owner and leader): moves the worship position. The page
// never moves on its own: every change is a command, and it renders only the live:state
// snapshots the server broadcasts.

(function () {
  const { api, el, setTitle } = window.PAGE;
  const { t } = window.I18N;
  const { stepsOf, nextPosition } = window.LIVE;
  const $ = (id) => document.getElementById(id);
  const eventId = Number(window.location.pathname.split('/')[2]);

  const state = { event: null, items: [], loadedKey: null, loading: null, songs: new Map(), snap: null, client: null, queue: Promise.resolve() };

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
    });
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

  // --- helpers ----------------------------------------------------------------------

  function itemTitle(item) {
    if (item.type === 'song') return item.title || t('setlist.songDeleted');
    if (item.type === 'verse') return item.reference || t('setlist.types.verse');
    return item.title || (item.body ? item.body.split('\n')[0].slice(0, 80) : '') || t(`setlist.types.${item.type}`);
  }

  function stepLabel(item, step) {
    const entry = item.type === 'song' && item.arrangementResolved ? item.arrangementResolved[step] : null;
    return entry ? entry.label : itemTitle(item);
  }

  // "Următoarea: …": the next section of the same song, else the next item's title.
  function positionLabel(pos) {
    const item = state.items.find((it) => it.id === pos.itemId);
    if (!item) return '';
    return current().item === item ? stepLabel(item, pos.step) : itemTitle(item);
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
    $('back-link').textContent = t('rehearse.back', { name: ev.name });
    $('back-link').href = `/events/${ev.id}`;
    const status = snap.status;
    $('event-status').className = `pill pill-${status}`;
    $('event-status').textContent = t(`events.status.${status}`);
    $('start-button').hidden = status !== 'published';
    $('end-button').hidden = status !== 'live';
    renderPresence();
  }

  function renderPresence() {
    const presence = (state.snap && state.snap.presence) || {};
    const parts = ['leader', 'owner', 'operator', 'member'].filter((role) => presence[role])
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
      return el('li', null, el('button', {
        type: 'button',
        class: `live-item${isCurrent ? ' current' : ''}`,
        'aria-current': isCurrent ? 'step' : null,
        disabled: !live,
        onclick: () => send('worship.goto', { itemId: item.id, step: 0 }),
      },
      el('span', { class: 'item-number', text: String(i + 1) }),
      el('span', { class: 'item-text' },
        el('span', { class: `type-badge type-${item.type}`, text: t(`setlist.types.${item.type}`) }),
        el('span', { class: 'item-title', text: itemTitle(item) }),
        item.type === 'song' && item.displayKey ? el('span', { class: 'item-sub', text: t('options.songKeyShort', { key: item.displayKey }) }) : null),
      isCurrent ? el('span', { class: 'live-badge', text: t('live.liveBadge') }) : null));
    }));
    if (!state.items.length) $('setlist').replaceChildren(el('li', { class: 'muted', text: t('setlist.empty') }));
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
    if (status === 'draft') {
      box.replaceChildren(el('p', { class: 'live-note' }, t('live.draftHint'), ' ', el('a', { href: `/events/${eventId}/edit`, text: t('setlist.edit') })));
      return;
    }
    if (status === 'published') {
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
      return;
    }

    const index = state.items.indexOf(item);
    $('prev-button').disabled = index === 0 && pos.step === 0;
    const after = nextPosition(state.items, pos);
    $('next-button').disabled = !after;
    $('next-button').textContent = after ? t('live.next', { label: positionLabel(after) }) : t('live.nextEnd');

    const head = el('header', { class: 'current-head' },
      el('span', { class: `type-badge type-${item.type}`, text: t(`setlist.types.${item.type}`) }),
      el('h3', { class: 'current-title', text: itemTitle(item) }),
      item.type === 'song' && item.displayKey ? el('span', { class: 'key-badge', text: t('rehearse.key', { key: item.displayKey }) }) : null);

    if (item.type !== 'song' || !item.songId) {
      box.replaceChildren(head, ...(item.type === 'song' ? [el('p', { class: 'muted', text: t('setlist.songDeletedHint') })] : textOf(item)));
      return;
    }

    const arrangement = item.arrangementResolved || [];
    const steps = el('ol', { class: 'step-grid', 'aria-label': t('live.stepsLabel') },
      arrangement.map((entry, step) => {
        const isCurrent = step === pos.step;
        return el('li', null, el('button', {
          type: 'button',
          class: `step${isCurrent ? ' current' : ''}`,
          'aria-current': isCurrent ? 'step' : null,
          'aria-label': t('live.stepLabel', { n: step + 1, label: entry.label }),
          onclick: () => send('worship.goto', { itemId: item.id, step }),
        },
        el('span', { class: 'step-code', text: entry.code }),
        el('span', { class: 'step-label', text: entry.label }),
        isCurrent ? el('span', { class: 'live-badge', text: t('live.liveBadge') }) : null));
      }));
    box.replaceChildren(head, steps);

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

  function renderInfo() {
    const { pos, item } = current();
    const parts = [];
    if (state.snap.status === 'live' && item) {
      const i = state.items.indexOf(item);
      const upcoming = state.items[i + 1];
      if (item.type === 'song' && item.song) {
        if (item.transpose) parts.push(el('p', { class: 'muted', text: t('rehearse.keyOriginal', { key: item.song.key || '—' }) }));
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
  }

  function gone() {
    $('live').hidden = true;
    $('status').hidden = false;
    $('status').removeAttribute('data-i18n');
    $('status').textContent = t('setlist.notFound');
  }

  // --- projector panel --------------------------------------------------------------

  // The small preview renders exactly the frame the screens get (same render module).
  const preview = window.PROJECTOR_RENDER.create($('projector-preview'));
  const projector = { screens: 0, details: null };

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
  }

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
      preview.show(reply.frame);
      projector.screens = reply.screens;
      renderProjector();
    });
  }

  function projectorMessage(text, kind) {
    $('projector-message').className = `message${kind ? ` ${kind}` : ''}`;
    $('projector-message').textContent = text || '';
  }

  // Window Management API (Chrome / Edge): with the one-time permission the projector window
  // opens directly, fullscreen, on a screen other than this one.
  const canPlace = 'getScreenDetails' in window;
  $('projector-permission').hidden = !canPlace;

  async function screenDetails(ask) {
    if (!canPlace) return null;
    if (projector.details) return projector.details;
    try {
      const permission = await navigator.permissions.query({ name: 'window-management' });
      if (permission.state === 'denied' || (permission.state === 'prompt' && !ask)) return null;
    } catch (err) {
      if (!ask) return null; // permission name unknown: only ask on a click
    }
    try {
      projector.details = await window.getScreenDetails();
    } catch (err) {
      projector.details = null; // denied
    }
    return projector.details;
  }
  screenDetails(false); // already granted earlier: no prompt, the window opens at once

  function otherScreen(details) {
    if (!details) return null;
    const others = details.screens.filter((s) => s !== details.currentScreen);
    return others.find((s) => !s.isPrimary) || others[0] || null;
  }

  $('open-projector').addEventListener('click', async () => {
    projectorMessage('');
    const target = otherScreen(await screenDetails(true));
    const features = target
      ? `popup,left=${target.availLeft},top=${target.availTop},width=${target.availWidth},height=${target.availHeight},fullscreen`
      : 'popup,width=1280,height=720';
    // Opened right away (still inside the click); the claim link is filled in after.
    const win = window.open('about:blank', 'wa-projector', features);
    if (!win) {
      projectorMessage(t('live.projector.blocked'), 'error');
      return;
    }
    const res = await api('/api/screens/auto-claim', { method: 'POST', body: { name: t('live.projector.windowName') } });
    if (!res.ok) {
      win.close();
      projectorMessage(res.body.error || t('common.networkError'), 'error');
      return;
    }
    win.location.href = res.body.claimUrl;
    projectorMessage(target ? t('live.projector.placed') : t('live.projector.dragHint'), target ? 'success' : null);
  });

  // --- controls ---------------------------------------------------------------------

  $('prev-button').addEventListener('click', () => send('worship.prev'));
  $('next-button').addEventListener('click', () => send('worship.next'));
  $('start-button').addEventListener('click', () => send('event.start'));
  $('end-button').addEventListener('click', () => {
    $('end-dialog').returnValue = '';
    $('end-dialog').showModal();
  });
  $('end-dialog').addEventListener('close', () => {
    if ($('end-dialog').returnValue === 'end') send('event.end');
  });

  document.addEventListener('keydown', (event) => {
    if (!state.snap || state.snap.status !== 'live' || $('end-dialog').open) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input, textarea, select')) return;
    // Space on a focused button or link already clicks it.
    if (event.key === ' ' && event.target.closest('button, a')) return;
    if (event.key === 'ArrowRight' || event.key === ' ') {
      event.preventDefault();
      send('worship.next');
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      send('worship.prev');
    } else if (event.key === 'b' || event.key === 'B') {
      toggleSource('black'); // black <-> content
    } else if (event.key === 'l' || event.key === 'L') {
      toggleSource('logo'); // logo <-> content
    }
  });

  document.addEventListener('i18n:change', () => {
    if (!state.snap) return;
    renderConnection(state.client.connection);
    renderProjector();
    // Section labels come from the server in the page language: reload.
    state.loadedKey = null;
    syncSetlist(state.snap).then(render);
  });

  // --- start ------------------------------------------------------------------------

  $('status').hidden = false;
  state.client = window.LIVE.connect({
    eventId,
    onState: (snap) => {
      state.snap = snap;
      syncSetlist(snap).then(() => {
        if (state.snap !== snap || !state.event) return;
        $('status').hidden = true;
        $('live').hidden = false;
        render();
        renderProjector();
      });
    },
    onPresence: (presence) => {
      if (state.snap) state.snap = { ...state.snap, presence };
      if (state.event) renderPresence();
    },
    onConnection: renderConnection,
    onGone: gone,
    onConnect: watchProjector,
  });
  state.client.socket.on('projector:frame', (frame) => preview.show(frame));
  state.client.socket.on('projector:screens', ({ count }) => {
    projector.screens = count;
    renderProjector();
  });
  renderConnection('connecting');
})();
