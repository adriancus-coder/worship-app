'use strict';

// "Acum" (/app): the live event, else the next one, with ONE big button for what this
// role does with it ("▶ Pornește live" starts it in one tap for the event roles); then the
// next few events and, for the event roles, quick actions.
// Each event role gets its own live page: live page (owner, presenter), big lyrics (leader),
// console (operator).
// The page watches its admin's home room: an event starting or ending swaps the card
// without a reload.

(function () {
  const { api, el, formatDate, canEdit: canEditLibrary, can, liveEntryRole } = window.PAGE;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);

  const state = { me: null, home: null, failed: false, pickedItem: null, keyBusy: false };

  const editor = () => can(state.me, 'events'); // creates events

  function when(event) {
    const today = state.home.today;
    const day = event.eventDate === today ? t('home.today') : formatDate(event.eventDate, today.slice(0, 4));
    return event.startTime ? `${day} · ${event.startTime}` : day;
  }

  function itemCount(n) {
    if (n === 0) return t('events.itemCountZero');
    return n === 1 ? t('events.itemCountOne') : t('events.itemCount', { n });
  }

  const eventUrl = (event, suffix = '') => `/events/${event.id}${suffix}${suffix.includes('?') ? '&' : '?'}from=home`;

  // Where each event role lands on a live event (docs/ROADMAP.md "Roles"): the presenter and
  // the owner on the live page, the leader straight in the big lyrics, the operator in the
  // console. Members follow.
  const LIVE_ENTRY = {
    owner: { path: '/live', key: 'home.enterLive' },
    presenter: { path: '/live', key: 'home.enterLive' },
    leader: { path: '/live?view=lyrics', key: 'home.bigLyrics' },
    operator: { path: '/operator', key: 'home.console' },
  };

  // [primary, secondary?] actions for the card, by role and state, within the rights.
  function actions(event, live) {
    const role = state.me.user.role;
    const entry = LIVE_ENTRY[liveEntryRole(state.me)];
    if (live) {
      if (entry) return [{ text: t(entry.key), href: eventUrl(event, entry.path), icon: 'play' }];
      return [{ text: t('home.follow'), href: eventUrl(event, '/follow'), icon: 'follow' }];
    }
    // Event roles: "▶ Pornește live" starts it and opens that role's page in one tap. The
    // owner starts first; the presenter and the operator prepare first (primary) and start
    // second; the leader rehearses first. Rehearsal is never the operator's.
    const prepare = can(state.me, 'events') ? { text: t('home.prepare'), href: eventUrl(event, '/edit'), icon: 'edit' } : null;
    const rehearse = role === 'operator' ? null : { text: t('home.rehearse'), href: eventUrl(event, '/rehearse'), icon: 'rehearse' };
    if (entry) {
      const start = { text: t('home.startLive'), icon: 'play', run: () => startLive(event, eventUrl(event, entry.path)) };
      if (role === 'owner') return [start, prepare];
      if (role === 'leader') return [rehearse, start];
      return [prepare, start].filter(Boolean);
    }
    return [prepare, rehearse || { text: t('home.rehearse'), href: eventUrl(event, '/rehearse'), icon: 'rehearse' }].filter(Boolean);
  }

  // --- the card's Program with the keys, the key choice, the team row ----------------------
  const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const keyIndex = (key) => { const m = /^([A-G])([#b]?)/.exec(String(key || '')); return m ? (NOTE_INDEX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12 : null; };
  const itemLabel = (it) => it.title || it.who || it.reference || t(`setlist.types.${it.type}`);

  // Picks the item whose key is changed (editors); a tap on it again lets go.
  function pickItem(it) {
    state.pickedItem = state.pickedItem === it.id ? null : it.id;
    render();
  }

  // "Gamă": the 12 keys from the song's own, spelled by lib/chords.js keyAfter (a minor song
  // keeps "m"); the one sung at this event is selected. A tap saves the transposition for
  // this event (ARRANGE_SHEET.saveToEvent) and re-reads the home.
  async function chooseKey(event, it, semitones) {
    if (state.keyBusy) return;
    state.keyBusy = true;
    const res = await window.ARRANGE_SHEET.saveToEvent(event.id, it.id, { transpose: semitones });
    state.keyBusy = false;
    const out = $('start-message');
    if (res.error) { out.textContent = res.error; return; }
    out.textContent = '';
    await load();
  }

  function keyChoice(event, it) {
    if (!it.songKey) return el('p', { class: 'muted now-key-hint', text: t('home.keyNoKey') });
    const base = keyIndex(it.songKey);
    const current = ((it.transpose % 12) + 12) % 12;
    const keys = [];
    for (let n = 0; n < 12; n++) keys.push({ n, name: window.CHORDS.keyAfter(it.songKey, n), index: (base + n) % 12 });
    keys.sort((a, b) => a.index - b.index);
    return el('div', { class: 'now-key-row' },
      el('span', { class: 'now-section-label', id: 'now-key-label', text: t('home.keyLabel', { title: itemLabel(it) }) }),
      el('div', { class: 'choice-group now-keys', role: 'group', 'aria-labelledby': 'now-key-label' },
        ...keys.map((k) => el('button', {
          type: 'button', 'data-key': k.name, 'aria-pressed': String(k.n === current), disabled: state.keyBusy ? 'disabled' : null,
          text: window.NOTATION.chord(k.name),
          onclick: () => { if (k.n !== current) chooseKey(event, it, k.n > 6 ? k.n - 12 : k.n); },
        }))));
  }

  function programBlock(event) {
    const items = state.home.program || [];
    if (!items.length) return null;
    const picker = editor();
    const picked = picker ? items.find((it) => it.id === state.pickedItem && it.type === 'song') : null;
    return el('div', { class: 'now-program' },
      el('p', { class: 'now-section-label', text: t('home.program') }),
      el('ol', { class: 'now-items' }, ...items.map((it) => {
        const key = it.type === 'song' ? el('span', { class: `key-badge now-item-key${it.key ? '' : ' is-unset'}`, text: it.key ? window.NOTATION.chord(it.key) : '—' }) : null;
        const inner = [el('span', { class: `now-item-type type-badge type-${it.type}`, text: t(`setlist.types.${it.type}`) }), el('span', { class: 'now-item-title', text: itemLabel(it) }), key];
        return el('li', { class: `now-item${picked && picked.id === it.id ? ' is-picked' : ''}` },
          picker && it.type === 'song' && it.songId
            ? el('button', { type: 'button', class: 'now-item-button', 'aria-pressed': String(Boolean(picked && picked.id === it.id)), 'aria-label': t('home.pickSong', { title: itemLabel(it) }), onclick: () => pickItem(it) }, ...inner)
            : el('span', { class: 'now-item-button' }, ...inner));
      })),
      picked ? keyChoice(event, picked) : (picker && items.some((it) => it.type === 'song' && it.songId) ? el('p', { class: 'muted now-key-hint', text: t('home.keyHint') }) : null));
  }

  // The team: a circle with the initials per person, a dot with their answer, a legend.
  const initials = (name) => String(name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
  function teamBlock() {
    const team = state.home.team || [];
    if (!team.length) return null;
    const answer = (s) => t(s === 'pending' ? 'home.noAnswer' : `attend.answers.${s}`);
    return el('div', { class: 'now-team' },
      el('p', { class: 'now-section-label', text: t('home.team') }),
      el('ul', { class: 'now-people', 'aria-label': t('home.team') }, ...team.map((p) => el('li', { class: `now-person now-person-${p.status}`, title: `${p.name} · ${answer(p.status)}${p.positions.length ? ` · ${p.positions.map((x) => window.PAGE.positionLabel(x)).join(', ')}` : ''}` },
        el('span', { class: 'now-avatar', 'aria-hidden': 'true', text: initials(p.name) }),
        el('span', { class: 'now-dot', 'aria-hidden': 'true' }),
        el('span', { class: 'sr-only', text: `${p.name}: ${answer(p.status)}` })))),
      el('p', { class: 'now-legend', 'aria-hidden': 'true' }, ...['accepted', 'maybe', 'declined', 'pending'].map((s) => el('span', { class: `now-legend-item now-person-${s}` }, el('span', { class: 'now-dot' }), ` ${answer(s)}`))));
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
      event.notes ? el('p', { class: 'event-note now-note', text: event.notes }) : null,
      programBlock(event),
      teamBlock(),
      el('div', { class: 'now-actions' },
        primary.run
          ? el('button', { type: 'button', class: 'now-primary', id: 'start-live', 'data-icon': primary.icon, text: primary.text, onclick: primary.run })
          : el('a', { class: 'button now-primary', href: primary.href, 'data-icon': primary.icon, text: primary.text }),
        !secondary ? null : secondary.run
          ? el('button', { type: 'button', class: 'secondary', id: 'start-live', 'data-icon': secondary.icon, text: secondary.text, onclick: secondary.run })
          : el('a', { class: 'button secondary', href: secondary.href, 'data-icon': secondary.icon, text: secondary.text })),
      // Stage 7: this person's assignments on the event ("Ești programat: Chitară", Vin / Nu pot
      // while pending) and, for the event roles, the team summary.
      // the invitation: "Participi?" Vin / Poate / Nu pot (the chosen one filled), changeable
      state.home.attendance ? el('div', { class: 'now-assignment now-attend' },
        el('span', { class: 'now-assignment-text', text: t('attend.question') }),
        window.TEAM_CARD.answers(['accepted', 'maybe', 'declined'], state.home.attendance.status, (status) => attend(event, status), (v) => t(`attend.answers.${v}`), t('attend.question'))) : null,
      ...(state.home.assignments || []).map((a) => el('div', { class: `now-assignment now-assignment-${a.status}` },
        el('span', { class: 'now-assignment-text', text: t('assign.youAre', { position: window.PAGE.positionLabel({ name: a.positionName, emoji: a.positionEmoji }) }) }),
        window.TEAM_CARD.answers(['accepted', 'declined'], a.status, (status) => answer(event, a, status), (v) => t(v === 'accepted' ? 'assign.yes' : 'assign.no'), t('assign.youAre', { position: a.positionName })),
        // the guides for this position (Ghiduri): "📘 Ghid: Pornirea sunetului"
        ...(a.status === 'declined' ? [] : (state.guides || []).filter((g) => g.positionIds.includes(a.positionId)).map((g) => el('a', { class: 'now-guide', href: `/guides/${g.id}`, text: `${g.emoji || '📘'} ${t('guides.homeLink', { title: g.title })}` }))))),
      state.home.proposalsOpen
        ? el('a', { class: 'pill proposals-badge now-proposals', href: eventUrl(event, '/edit'), text: t('proposals.badge', { n: state.home.proposalsOpen }) })
        : null,
      state.home.teamSummary && state.home.teamSummary.total
        ? el('a', { class: `now-team-summary${state.home.teamSummary.declined ? ' has-declined' : ''}`, href: eventUrl(event), text: window.TEAM_CARD.summaryText(state.home.teamSummary) })
        : null,
      // Live for more than a day (someone forgot to end it): a small hint with "Încheie".
      live && staleLive(event) ? el('p', { class: 'now-stale', id: 'stale-live' },
        el('span', { text: t('home.staleLive') }),
        can(state.me, 'live')
          ? el('button', { type: 'button', class: 'secondary danger-text', id: 'end-stale', 'data-icon': 'stop', text: t('home.staleEnd'), onclick: () => endStale(event) })
          : null) : null,
      el('p', { class: 'message error', id: 'start-message', role: 'alert' }));
  }

  // Vin / Nu pot from the home card (the note is for the event page).
  async function answer(event, a, status) {
    const res = await api(`/api/events/${event.id}/assignments/${a.id}/respond`, { method: 'POST', body: { status, note: a.note || '' } }).catch(() => ({ ok: false, body: {} }));
    if (!res.ok) { $('start-message').textContent = res.body.error || t('common.networkError'); return; }
    await load().catch(() => {});
  }

  // Vin / Poate / Nu pot to the invitation, from the home card (the note is for the event page).
  async function attend(event, status) {
    const res = await api(`/api/events/${event.id}/attendance/respond`, { method: 'POST', body: { status, note: (state.home.attendance && state.home.attendance.note) || '' } }).catch(() => ({ ok: false, body: {} }));
    if (!res.ok) { $('start-message').textContent = res.body.error || t('common.networkError'); return; }
    await load().catch(() => {});
  }

  // An answer given in the pop-up (public/answer-popup.js): the card again.
  document.addEventListener('answers:changed', () => { load().catch(() => {}); });

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
          el('span', { class: 'home-row-when', text: when(event) }),
          event.notes ? el('span', { class: 'event-note', text: event.notes }) : null),
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
    // the guides for my positions on the top event, only when I am scheduled there
    if ((state.home.assignments || []).length) {
      const guides = await api('/api/guides').catch(() => null);
      state.guides = guides && guides.ok ? guides.body.guides : [];
    }
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
