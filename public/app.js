'use strict';

// "Acum" (/app): the live event, else the next one, with ONE big button for what this
// role does with it; then the next few events and, for the event roles, quick actions.
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
    const livePage = `/events/${event.id}/${role === 'operator' ? 'operator' : 'live'}`;
    if (live) {
      if (EDITOR_ROLES.includes(role)) return [{ text: t('home.enterLive'), href: livePage, icon: 'play' }];
      return [{ text: t('home.follow'), href: `/events/${event.id}/follow`, icon: 'follow' }];
    }
    if (EDITOR_ROLES.includes(role)) {
      const list = [{ text: t('home.prepare'), href: eventUrl(event, '/edit'), icon: 'edit' }];
      if (event.status === 'published') list.push({ text: t('home.startLive'), href: livePage, icon: 'play' });
      return list;
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
      event.status === 'draft' ? el('p', { class: 'hint', text: t('home.draftNote') }) : null,
      el('div', { class: 'now-actions' },
        el('a', { class: 'button now-primary', href: primary.href, 'data-icon': primary.icon, text: primary.text }),
        secondary ? el('a', { class: 'button secondary', href: secondary.href, 'data-icon': secondary.icon, text: secondary.text }) : null));
  }

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
    $('quick-section').hidden = !editor() || !top;
    $('quick-new-song').hidden = !canEditLibrary(state.me); // the library: owner and leader
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
