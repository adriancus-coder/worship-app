'use strict';

// Home (/app), "the hymn board": the live event, else the next one, as one board: the day and
// time, the person's own slot (Vin / Poate / Nu pot, their positions and guides), the Program as
// numbered rows with each song's key on a plate, the team, and ONE big button for what this
// role does with it ("▶ Pornește live" starts it in one tap for the event roles); beside or
// under it, the next weeks with the person's own positions on them.
// Each event role gets its own live page: live page (owner, presenter), big lyrics (leader),
// console (operator).
// The page watches its admin's home room: an event starting or ending swaps the card
// without a reload.

(function () {
  const { api, el, formatDate, canEdit: canEditLibrary, can, liveEntryRole } = window.PAGE;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);

  const state = { me: null, home: null, failed: false, pickedItem: null, keyBusy: false, keyMinor: false, expanded: null, newKey: null };

  const editor = () => can(state.me, 'events'); // creates events

  function when(event) {
    const today = state.home.today;
    const day = event.eventDate === today ? t('home.today') : formatDate(event.eventDate, today.slice(0, 4));
    return event.startTime ? `${day} · ${event.startTime}` : day;
  }

  // Whole days from today to the event's date (dates as YYYY-MM-DD in the admin's time zone).
  const daysUntil = (date) => Math.round((Date.UTC(...date.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0))) - Date.UTC(...state.home.today.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0)))) / 86400000);

  // The board's big line: "Azi · 10:00", "Mâine · 10:00", "Duminică, 30 noiembrie · 10:00".
  function whenBig(event) {
    const days = daysUntil(event.eventDate);
    const day = days === 0 ? t('home.today') : days === 1 ? t('home.tomorrow') : formatDate(event.eventDate, state.home.today.slice(0, 4));
    return event.startTime ? `${day} · ${event.startTime}` : day;
  }
  // "peste 3 zile" on the plate beside it, from two days on.
  const countdown = (event) => { const days = daysUntil(event.eventDate); return days >= 2 ? t('home.inDays', { n: days }) : null; };

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
    // Event roles: "▶ Pornește live" starts it and opens that role's page in one tap, for
    // those who start events (the 'screens' right: the operator, and the owner). The owner
    // starts first; the operator prepares first (primary) and starts second. The leader and
    // the presenter prepare, and enter their live page (the operator starts the event).
    // Without the events right: "Vezi programul" (the event page).
    const prepare = can(state.me, 'events') ? { text: t('home.prepare'), href: eventUrl(event, '/edit'), icon: 'edit' } : null;
    const programme = { text: t('home.programme'), href: eventUrl(event, ''), icon: 'list' };
    if (entry) {
      const starter = can(state.me, 'screens');
      const start = { text: t('home.startLive'), icon: 'play', run: () => startLive(event, eventUrl(event, entry.path)) };
      const enter = { text: t(role === 'leader' ? 'home.bigLyrics' : 'live.link'), href: eventUrl(event, entry.path), icon: 'play' };
      if (role === 'owner') return [start, prepare];
      return [prepare || programme, starter ? start : enter];
    }
    return [prepare || programme];
  }

  // --- the card's Program with the keys, the key choice, the team row ----------------------
  const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const keyIndex = (key) => { const m = /^([A-G])([#b]?)/.exec(String(key || '')); return m ? (NOTE_INDEX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12 : null; };
  const itemLabel = (it) => it.title || it.who || it.reference || t(`setlist.types.${it.type}`);

  // Picks the item whose key is changed (editors); a tap on it again lets go.
  // The card has one current song: the key choice and the opened song belong to it; a tap
  // on another song's key badge or row closes what the previous one had open.
  function pickItem(it) {
    state.pickedItem = state.pickedItem === it.id ? null : it.id;
    if (state.pickedItem && state.expanded && state.expanded !== it.id) state.expanded = null;
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
    state.newKey = it.id; // the new plate slides into its groove
    await load();
  }

  // A song with no key yet: the same row sets the song's key in the library (the library
  // right), with a "minor" switch for Lam / Mim …; without the right, a hint.
  async function setSongKey(it, key) {
    if (state.keyBusy) return;
    state.keyBusy = true;
    const res = await api(`/api/songs/${it.songId}`, { method: 'PUT', body: { song_key: key } }).catch(() => ({ ok: false, body: {} }));
    state.keyBusy = false;
    const out = $('start-message');
    if (!res.ok) { out.textContent = res.body.error || t('common.networkError'); return; }
    out.textContent = '';
    state.newKey = it.id;
    await load();
  }

  // The popover under the picked row (public/key-popover.js): the key for this event, or the
  // library key for a song that has none.
  function keyChoice(event, it) {
    return window.KEY_POPOVER.build({
      title: itemLabel(it), songKey: it.songKey, transpose: it.transpose, canSetKey: canEditLibrary(state.me), minor: state.keyMinor, busy: state.keyBusy,
      onMinor: () => { state.keyMinor = !state.keyMinor; render(); },
      onTranspose: (semitones) => chooseKey(event, it, semitones),
      onSetKey: (key) => setSongKey(it, key),
    });
  }

  // --- the song under its row, and the big view --------------------------------------------
  // A tap on a song row opens the whole song under it; a tap on a section opens "⤢ Versuri
  // mari" with its own place (public/programme-big.js, shared with the event page).
  const topEvent = () => (state.home ? state.home.live || state.home.next : null); // the card's event
  const programItems = () => (state.home && state.home.program) || [];
  const songItems = () => programItems().filter((it) => it.type === 'song' && it.songId);
  const songs = window.PROGRAMME_BIG.create({
    api, eventId: () => topEvent().id, items: songItems,
    onItemChange: (itemId) => { if (state.expanded !== itemId) { state.expanded = itemId; render(); } },
  });
  function toggleSong(it) {
    state.expanded = state.expanded === it.id ? null : it.id;
    if (state.expanded && state.pickedItem && state.pickedItem !== it.id) state.pickedItem = null; // another song: its key choice closes
    if (state.expanded) songs.load(it).then(() => { if (state.expanded === it.id) render(); });
    render();
  }
  const songBox = (it) => songs.box(it);

  function programBlock(event) {
    const items = programItems();
    if (!items.length) return null;
    const picker = editor();
    const picked = picker ? items.find((it) => it.id === state.pickedItem && it.type === 'song') : null;
    let number = 0; // the songs are numbered, like on the board on the wall
    const slid = state.newKey;
    state.newKey = null;
    return el('div', { class: 'now-program' },
      el('p', { class: 'now-section-label', text: t('home.program') }),
      el('ol', { class: 'now-items' }, ...items.map((it) => {
        const isSong = it.type === 'song' && Boolean(it.songId);
        const open = isSong && state.expanded === it.id;
        // the key on the right: the editors tap it to change the key for this event
        const keyText = it.key ? window.NOTATION.chord(it.key) : '—';
        const keyClass = `key-badge now-item-key${it.key ? '' : ' is-unset'}${slid === it.id ? ' is-new' : ''}`;
        const key = it.type !== 'song' ? null
          : picker && isSong
            ? el('button', { type: 'button', class: keyClass, 'aria-pressed': String(Boolean(picked && picked.id === it.id)), 'aria-label': t('home.pickSong', { title: itemLabel(it) }), onclick: () => pickItem(it) }, keyText)
            : el('span', { class: keyClass, text: keyText });
        // a song: its number on the board; anything else: what it is (Verset, Anunț…) after it
        const inner = it.type === 'song'
          ? [el('span', { class: 'board-num', 'aria-hidden': 'true', text: String((number += 1)) }), el('span', { class: 'now-item-title', text: itemLabel(it) })]
          : [el('span', { class: 'board-num', 'aria-hidden': 'true' }), el('span', { class: 'now-item-title', text: itemLabel(it) }), el('span', { class: `now-item-type board-type type-${it.type}`, text: t(`setlist.types.${it.type}`) })];
        const isPicked = Boolean(picked && picked.id === it.id);
        return el('li', { class: `now-item now-item-${it.type}${isPicked ? ' is-picked' : ''}${open ? ' is-open' : ''}` },
          el('div', { class: 'now-item-row' },
            isSong
              ? el('button', { type: 'button', class: 'now-item-button', 'aria-expanded': String(open), 'aria-controls': `now-song-${it.id}`, 'aria-label': t(open ? 'home.closeSong' : 'home.openSong', { title: itemLabel(it) }), onclick: () => toggleSong(it) }, ...inner)
              : el('span', { class: 'now-item-button' }, ...inner),
            key),
          // the key choice opens right under its row, as a popover
          isPicked ? keyChoice(event, picked) : null,
          open ? songBox(it) : null);
      })),
      !picked && picker && items.some((it) => it.type === 'song' && it.songId) ? el('p', { class: 'muted now-key-hint', text: t('home.keyHint') }) : null);
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

  // The person's own slot, first on the board: the invitation ("Participi?" Vin / Poate / Nu
  // pot) and each position they serve on ("Ești programat: 🎤 Voce" Vin / Nu pot), with the
  // guides for that position (Ghiduri). Changeable; the note is for the event page.
  function youSlot(event) {
    const invited = state.home.attendance;
    const mine = state.home.assignments || [];
    if (!invited && !mine.length) return null;
    return el('section', { class: 'board-you', 'aria-label': t('home.you') },
      invited ? el('div', { class: 'now-assignment now-attend' },
        el('span', { class: 'now-assignment-text', text: t('attend.question') }),
        window.TEAM_CARD.answers(['accepted', 'maybe', 'declined'], invited.status, (status) => attend(event, status), (v) => t(`attend.answers.${v}`), t('attend.question'))) : null,
      ...mine.map((a) => el('div', { class: `now-assignment now-assignment-${a.status}` },
        el('span', { class: 'now-assignment-text', text: t('assign.youAre', { position: window.PAGE.positionLabel({ name: a.positionName, emoji: a.positionEmoji }) }) }),
        window.TEAM_CARD.answers(['accepted', 'declined'], a.status, (status) => answer(event, a, status), (v) => t(v === 'accepted' ? 'assign.yes' : 'assign.no'), t('assign.youAre', { position: a.positionName })),
        ...(a.status === 'declined' ? [] : (state.guides || []).filter((g) => g.positionIds.includes(a.positionId)).map((g) => el('a', { class: 'now-guide', href: `/guides/${g.id}`, text: `${g.emoji || '📘'} ${t('guides.homeLink', { title: g.title })}` }))))));
  }

  function card(event, live) {
    const [primary, secondary] = actions(event, live);
    const soon = live ? null : countdown(event);
    const button = (a, cls) => (a.run
      ? el('button', { type: 'button', class: cls, id: 'start-live', 'data-icon': a.icon, text: a.text, onclick: a.run })
      : el('a', { class: `button ${cls}`, href: a.href, 'data-icon': a.icon, text: a.text }));
    return el('article', { class: `board now-card${live ? ' live' : ''}`, 'aria-labelledby': 'now-title' },
      el('header', { class: 'board-head' },
        el('p', { class: 'board-when' },
          live ? el('span', { class: 'board-live' }, el('span', { class: 'live-dot', 'aria-hidden': 'true' }), t('home.liveNow')) : null,
          el('span', { class: 'board-day', text: whenBig(event) }),
          soon ? el('span', { class: 'board-soon', text: soon }) : null),
        el('h2', { id: 'now-title', class: 'now-title' }, el('a', { href: eventUrl(event), text: event.name })),
        event.notes ? el('p', { class: 'event-note now-note', text: event.notes }) : null),
      youSlot(event),
      programBlock(event),
      teamBlock(),
      state.home.proposalsOpen || (state.home.teamSummary && state.home.teamSummary.total)
        ? el('p', { class: 'board-links' },
          state.home.teamSummary && state.home.teamSummary.total
            ? el('a', { class: `now-team-summary${state.home.teamSummary.declined ? ' has-declined' : ''}`, href: eventUrl(event), text: window.TEAM_CARD.summaryText(state.home.teamSummary) })
            : null,
          state.home.proposalsOpen
            ? el('a', { class: 'pill proposals-badge now-proposals', href: eventUrl(event, '/edit'), text: t('proposals.badge', { n: state.home.proposalsOpen }) })
            : null)
        : null,
      // Live for more than a day (someone forgot to end it): a small hint with "Încheie".
      live && staleLive(event) ? el('p', { class: 'now-stale', id: 'stale-live' },
        el('span', { text: t('home.staleLive') }),
        can(state.me, 'screens')
          ? el('button', { type: 'button', class: 'secondary danger-text', id: 'end-stale', 'data-icon': 'stop', text: t('home.staleEnd'), onclick: () => endStale(event) })
          : null) : null,
      el('p', { class: 'message error', id: 'start-message', role: 'alert' }),
      // the ledge under the board: ONE primary action, maybe a second
      el('div', { class: 'now-actions board-ledge' },
        button(primary, 'now-primary'),
        secondary ? button(secondary, 'secondary') : null));
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
    return el('article', { class: 'board now-card empty' },
      el('p', { class: 'board-when', text: t('home.empty') }),
      el('p', { class: 'board-hint', text: editor() ? t('home.emptyEditor') : t('home.emptyTeam') }),
      editor() ? el('div', { class: 'now-actions board-ledge' }, el('a', { class: 'button now-primary', href: '/events?new=1', 'data-icon': 'plus', text: t('events.newEvent') })) : null);
  }

  // A row of the next weeks: the date on a plate, the name and time, and, when the person
  // serves on it, their positions with their answer ("🎤 Voce · Vin").
  function weekRow(event) {
    const d = window.PAGE.dateBlock(event.eventDate);
    const mine = event.mine || [];
    const answer = (s) => (s === 'pending' ? t('home.noAnswer') : t(`attend.answers.${s}`));
    return el('li', null,
      el('a', { class: 'home-row', href: eventUrl(event) },
        el('span', { class: 'week-plate', 'aria-hidden': 'true' },
          el('span', { class: 'week-plate-day', text: d.weekday }),
          el('span', { class: 'week-plate-num', text: d.day }),
          el('span', { class: 'week-plate-month', text: d.month })),
        el('span', { class: 'home-row-text' },
          el('span', { class: 'home-row-name', text: event.name }),
          el('span', { class: 'home-row-when', text: when(event) }),
          mine.length ? el('span', { class: 'week-mine' }, ...mine.map((m) => el('span', { class: `week-pos week-pos-${m.status}`, text: `${window.PAGE.positionLabel({ name: m.positionName, emoji: m.positionEmoji })} · ${answer(m.status)}` }))) : null,
          event.notes ? el('span', { class: 'event-note', text: event.notes }) : null)));
  }

  function render() {
    if (state.failed) {
      $('status').hidden = false;
      $('status').removeAttribute('data-i18n');
      $('status').textContent = t('app.loadFailed');
      $('now').replaceChildren();
      return;
    }
    if (!state.me || !state.home) return;
    $('status').hidden = true;
    const { live, next, upcoming } = state.home;
    const top = live || next;
    $('now').replaceChildren(top ? card(top, Boolean(live)) : empty());
    // With a live event, the next one joins the list beside it.
    const more = live && next ? [next, ...upcoming] : upcoming;
    $('upcoming-section').hidden = more.length === 0;
    $('upcoming').replaceChildren(...more.map(weekRow));
    renderBackupCard();
  }

  // The owner's backup reminder (no backup for 30 days, or never): one quiet line under the
  // board, dismissible.
  function renderBackupCard() {
    const reminder = state.home.backupReminder;
    if (!reminder || state.backupDismissed) {
      $('backup-card').replaceChildren();
      return;
    }
    const date = reminder.lastAt
      ? new Date(reminder.lastAt).toLocaleDateString(window.I18N.lang === 'ro' ? 'ro-RO' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
      : t('home.backupNever');
    $('backup-card').replaceChildren(el('section', { class: 'backup-card home-backup', 'aria-labelledby': 'backup-card-title', title: t('home.backupHint') },
      el('p', { class: 'backup-card-title', id: 'backup-card-title', text: t('home.backupLast', { date }) }),
      el('a', { class: 'button secondary', href: '/settings#backup-heading', 'data-icon': 'import', text: t('home.backupGo') }),
      el('button', {
        type: 'button', class: 'secondary home-backup-close', 'data-icon': 'close', 'aria-label': t('home.backupDismiss'), title: t('home.backupDismiss'),
        onclick: async () => {
          state.backupDismissed = true;
          renderBackupCard();
          await api('/api/backup/reminder/dismiss', { method: 'POST' }).catch(() => {});
        },
      })));
  }

  async function load() {
    const res = await api('/api/home');
    if (!res.ok) throw new Error('home');
    const was = topEvent();
    const now = res.body.live || res.body.next;
    if (was && now && was.id !== now.id) state.expanded = null; // another event on the card: its songs are others
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
