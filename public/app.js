'use strict';

// "Acum" (/app): the live event, else the next one, with ONE big button for what this
// role does with it ("▶ Pornește live" starts it in one tap for the event roles); then the
// next few events and, for the event roles, quick actions.
// The operator gets the leader's buttons, with the console as its live page.
// The page watches its admin's home room: an event starting or ending swaps the card
// without a reload.

(function () {
  const { api, el, formatDate, canEdit: canEditLibrary, EVENT_ROLES } = window.PAGE;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const EDITOR_ROLES = EVENT_ROLES;

  const state = { me: null, home: null, failed: false };

  const editor = () => Boolean(state.me) && EDITOR_ROLES.includes(state.me.user.role);

  function when(event) {
    const today = state.home.today;
    const day = event.eventDate === today ? t('home.today') : formatDate(event.eventDate, today.slice(0, 4));
    return event.startTime ? `${day} · ${event.startTime}` : day;
  }

  function itemCount(n) {
    if (n === 0) return t('events.itemCountZero');
    return n === 1 ? t('events.itemCountOne') : t('events.itemCount', { n });
  }

  const eventUrl = (event, suffix = '') => `/events/${event.id}${suffix}?from=home`;

  // [primary, secondary?] actions for the card, by role and state.
  function actions(event, live) {
    const role = state.me.user.role;
    // The live page of this role: the console for the operator.
    const livePage = `/events/${event.id}/${role === 'operator' ? 'operator' : 'live'}?from=home`;
    if (live) {
      if (EDITOR_ROLES.includes(role)) return [{ text: t('home.enterLive'), href: livePage, icon: 'play' }];
      return [{ text: t('home.follow'), href: `/events/${event.id}/follow?from=home`, icon: 'follow' }];
    }
    // Event roles: "▶ Pornește live" starts it and opens the live page (the console for the
    // operator) in one tap; "Pregătește" stays next to it. The operator prepares first
    // (primary) and starts second; rehearsal is never theirs.
    if (EDITOR_ROLES.includes(role)) {
      const start = { text: t('home.startLive'), icon: 'play', run: () => startLive(event, livePage) };
      const prepare = { text: t('home.prepare'), href: eventUrl(event, '/edit'), icon: 'edit' };
      return role === 'operator' ? [prepare, start] : [start, prepare];
    }
    return [{ text: t('home.rehearse'), href: eventUrl(event, '/rehearse'), icon: 'rehearse' }];
  }

  function card(event, live) {
    const [primary, secondary] = actions(event, live);
    return el('article', { class: `now-card${live ? ' live' : ''}`, 'aria-labelledby': 'now-title' },
      el('p', { class: 'now-kicker' },
        live ? el('span', { class: 'live-dot', 'aria-hidden': 'true' }) : null,
        live ? t('home.liveNow') : t('home.next')),
      el('h2', { id: 'now-title', class: 'now-title' }, el('a', { href: eventUrl(event), text: event.name })),
      el('p', { class: 'now-meta' },
        el('span', { text: when(event) }),
        el('span', { text: itemCount(event.itemCount) }),
        el('span', { class: `pill pill-${event.status}`, text: t(`events.status.${event.status}`) })),
      el('div', { class: 'now-actions' },
        primary.run
          ? el('button', { type: 'button', class: 'now-primary', id: 'start-live', 'data-icon': primary.icon, text: primary.text, onclick: primary.run })
          : el('a', { class: 'button now-primary', href: primary.href, 'data-icon': primary.icon, text: primary.text }),
        !secondary ? null : secondary.run
          ? el('button', { type: 'button', class: 'secondary', id: 'start-live', 'data-icon': secondary.icon, text: secondary.text, onclick: secondary.run })
          : el('a', { class: 'button secondary', href: secondary.href, 'data-icon': secondary.icon, text: secondary.text })),
      // Live for more than a day (someone forgot to end it): a small hint with "Încheie".
      live && staleLive(event) ? el('p', { class: 'now-stale', id: 'stale-live' },
        el('span', { text: t('home.staleLive') }),
        EDITOR_ROLES.includes(state.me.user.role)
          ? el('button', { type: 'button', class: 'secondary danger-text', id: 'end-stale', 'data-icon': 'stop', text: t('home.staleEnd'), onclick: () => endStale(event) })
          : null) : null,
      el('p', { class: 'message error', id: 'start-message', role: 'alert' }));
  }

  const STALE_LIVE_MS = 24 * 60 * 60 * 1000;
  const staleLive = (event) => Boolean(event.startedAt) && Date.now() - event.startedAt >= STALE_LIVE_MS;

  // Never automatic: only this button ends a forgotten live event.
  async function endStale(event) {
    const button = $('end-stale');
    if (button) button.disabled = true;
    const res = await api(`/api/events/${event.id}/end`, { method: 'POST' }).catch(() => ({ ok: false, body: {} }));
    if (!res.ok) {
      $('start-message').textContent = res.body.error || t('common.networkError');
      if (button) button.disabled = false;
      return;
    }
    await load().catch(() => {});
  }

  // --- "▶ Pornește live" --------------------------------------------------------------

  const pending = { event: null, livePage: null };

  async function startLive(event, livePage, endOther = false) {
    const button = $('start-live');
    if (button) button.disabled = true;
    $('start-message').textContent = '';
    try {
      const res = await api(`/api/events/${event.id}/start`, { method: 'POST', body: endOther ? { endOther: true } : {} });
      if (res.ok) {
        window.location.assign(livePage);
        return;
      }
      if (res.body.code === 'anotherLive' && !endOther) {
        // Confirmation only now: another event is live. Offer to end it first.
        Object.assign(pending, { event, livePage });
        $('switch-heading').textContent = t('home.switchHeading', { name: (res.body.live && res.body.live.name) || '' });
        $('switch-text').textContent = t('home.switchText', { name: (res.body.live && res.body.live.name) || '', next: event.name });
        $('switch-message').textContent = '';
        $('switch-dialog').showModal();
        return;
      }
      ($('switch-dialog').open ? $('switch-message') : $('start-message')).textContent = res.body.error || t('common.networkError');
    } catch (err) {
      $('start-message').textContent = t('common.networkError');
    } finally {
      if ($('start-live')) $('start-live').disabled = false;
    }
  }

  $('switch-yes').addEventListener('click', () => {
    $('switch-dialog').close();
    startLive(pending.event, pending.livePage, true);
  });
  $('switch-cancel').addEventListener('click', () => $('switch-dialog').close());

  function empty() {
    return el('article', { class: 'now-card empty' },
      el('p', { class: 'now-title', text: t('home.empty') }),
      el('p', { class: 'muted', text: editor() ? t('home.emptyEditor') : t('home.emptyTeam') }),
      editor() ? el('div', { class: 'now-actions' }, el('a', { class: 'button now-primary', href: '/events?new=1', 'data-icon': 'plus', text: t('events.newEvent') })) : null);
  }

  function render() {
    if (state.failed) {
      $('status').hidden = false;
      $('status').removeAttribute('data-i18n');
      $('status').textContent = t('app.loadFailed');
      return;
    }
    if (!state.me || !state.home) return;
    $('status').hidden = true;
    const { live, next, upcoming } = state.home;
    const top = live || next;
    $('now').replaceChildren(top ? card(top, Boolean(live)) : empty());
    // With a live event, the next one joins the list below.
    const more = live && next ? [next, ...upcoming] : upcoming;
    $('upcoming-section').hidden = more.length === 0;
    $('upcoming').replaceChildren(...more.map((event) => el('li', null,
      el('a', { class: 'home-row', href: eventUrl(event) },
        el('span', { class: 'home-row-text' },
          el('span', { class: 'home-row-name', text: event.name }),
          el('span', { class: 'home-row-when', text: when(event) })),
        el('span', { class: `pill pill-${event.status}`, text: t(`events.status.${event.status}`) })))));
    renderBackupCard();
    $('quick-section').hidden = !editor() || !top;
    $('quick-new-song').hidden = !canEditLibrary(state.me); // the library: the editor roles
  }

  // The owner's backup reminder (no backup for 30 days, or never): one card, dismissible.
  function renderBackupCard() {
    const reminder = state.home.backupReminder;
    if (!reminder || state.backupDismissed) {
      $('backup-card').replaceChildren();
      return;
    }
    const date = reminder.lastAt
      ? new Date(reminder.lastAt).toLocaleDateString(window.I18N.lang === 'ro' ? 'ro-RO' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
      : t('home.backupNever');
    $('backup-card').replaceChildren(el('section', { class: 'backup-card', 'aria-labelledby': 'backup-card-title' },
      el('div', { class: 'backup-card-text' },
        el('p', { class: 'backup-card-title', id: 'backup-card-title', text: t('home.backupLast', { date }) }),
        el('p', { class: 'hint', text: t('home.backupHint') })),
      el('div', { class: 'backup-card-actions' },
        el('a', { class: 'button secondary', href: '/settings#backup-heading', 'data-icon': 'import', text: t('home.backupGo') }),
        el('button', {
          type: 'button', class: 'secondary', 'data-icon': 'close', text: t('home.backupDismiss'),
          onclick: async () => {
            state.backupDismissed = true;
            renderBackupCard();
            await api('/api/backup/reminder/dismiss', { method: 'POST' }).catch(() => {});
          },
        }))));
  }

  async function load() {
    const res = await api('/api/home');
    if (!res.ok) throw new Error('home');
    state.home = res.body;
    state.failed = false;
    render();
  }

  document.addEventListener('i18n:change', render);

  // Live updates: an event of this admin started, ended or changed status.
  function watch() {
    if (!window.io) return;
    const socket = window.io({ transports: ['websocket', 'polling'] });
    socket.on('connect', () => {
      socket.emit('home:watch', {});
      load().catch(() => {}); // anything missed while disconnected
    });
    socket.on('home:changed', () => load().catch(() => {}));
  }

  (async () => {
    state.me = await window.SHELL.me;
    if (!state.me) throw new Error('me');
    await load();
    watch();
  })().catch(() => {
    state.failed = true;
    render();
  });
})();
