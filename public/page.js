'use strict';

// Small helpers shared by the signed-in pages.

(function () {
  // fetch() wrapper: JSON in and out; a 401 sends the user to the login page.
  async function api(url, options = {}) {
    const opts = { cache: 'no-store', ...options, headers: { ...(options.headers || {}) } };
    if (opts.body !== undefined && typeof opts.body !== 'string') {
      opts.body = JSON.stringify(opts.body);
      opts.headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(url, opts);
    if (res.status === 401) {
      window.location.replace('/login');
      return new Promise(() => {});
    }
    const body = await res.json().catch(() => ({}));
    // A temporary password must be changed first.
    if (res.status === 403 && body.code === 'mustChangePassword') {
      window.location.replace('/change-password');
      return new Promise(() => {});
    }
    return { ok: res.ok, status: res.status, body };
  }

  // el('a', { class: 'x', href: '/', text: 'Hi', onclick: fn }, child, ...)
  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'value') node.value = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  // The built-in roles with event rights (lib/events.js EVENT_ROLES): the live engine's roles.
  const EVENT_ROLES = ['owner', 'presenter', 'leader', 'operator'];

  // The user's rights (lib/roles.js PERMS, from /api/auth/me): library, events, media, live,
  // screens, schedule. The role itself only decides which page an event opens on.
  function can(me, perm) {
    return Boolean(me && me.user && Array.isArray(me.user.perms) && me.user.perms.includes(perm));
  }
  // Sees every event (unshared ones, templates): the events or the live right.
  const seesAll = (me) => can(me, 'events') || can(me, 'live');

  // Library writing (songs, a song's key and background).
  function canEdit(me) {
    return can(me, 'library');
  }

  // Creating and editing events, setlists and templates.
  function canEditEvents(me) {
    return can(me, 'events');
  }

  // The live page this user opens (docs/ROADMAP.md "Roles"): by the role, within the rights -
  // 'owner' / 'presenter' (the live page), 'leader' (big lyrics), 'operator' (the console);
  // null without the live right.
  function liveEntryRole(me) {
    if (!can(me, 'live')) return null;
    const role = me.user.role;
    if (role === 'owner' || role === 'leader') return role;
    if (role === 'operator') return can(me, 'screens') ? 'operator' : 'presenter';
    return 'presenter';
  }

  function setTitle(key, vars) {
    document.title = window.I18N.t(key, { appName: document.documentElement.dataset.appName || '', ...vars });
  }

  // Calendar dates ("2026-10-11") shown in the page language:
  // formatDate(d) -> "Duminică, 11 octombrie" / "Sunday, 11 October" (+ year when not thisYear).
  const LOCALES = { ro: 'ro-RO', en: 'en-GB' };

  function dateParts(dateStr, options) {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const locale = LOCALES[window.I18N.lang] || LOCALES.ro;
    const parts = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options }).formatToParts(new Date(Date.UTC(y, m - 1, d)));
    return Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  }

  const capitalize = (s) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

  function formatDate(dateStr, thisYear) {
    const p = dateParts(dateStr, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const base = `${capitalize(p.weekday)}, ${p.day} ${p.month}`;
    return thisYear && String(thisYear) !== p.year ? `${base} ${p.year}` : base;
  }

  // { weekday: "DUM", day: "11", month: "OCT" } for a date block.
  function dateBlock(dateStr) {
    const p = dateParts(dateStr, { weekday: 'short', day: 'numeric', month: 'short' });
    const clean = (s) => s.replace(/\.$/, '').toLocaleUpperCase();
    return { weekday: clean(p.weekday), day: p.day, month: clean(p.month) };
  }

  // ARIA tabs: click and arrow/Home/End keys select; onSelect(index) is called on change.
  function setupTabs(buttons, onSelect) {
    function select(index, focus) {
      buttons.forEach((tab, i) => {
        tab.setAttribute('aria-selected', String(i === index));
        tab.tabIndex = i === index ? 0 : -1;
      });
      if (focus) buttons[index].focus();
      onSelect(index);
    }
    buttons.forEach((tab, i) => {
      tab.addEventListener('click', () => select(i, false));
      tab.addEventListener('keydown', (event) => {
        const visible = buttons.filter((b) => !b.hidden);
        const at = visible.indexOf(tab);
        const moves = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: visible.length - 1 };
        if (!(event.key in moves)) return;
        event.preventDefault();
        const next = visible[(moves[event.key] + visible.length) % visible.length];
        select(buttons.indexOf(next), true);
      });
    });
    return { select };
  }

  // Back paths: pages reached from the home page carry ?from=home and lead back there;
  // everything else leads back to Evenimente.
  const cameFromHome = () => new URLSearchParams(window.location.search).get('from') === 'home';

  function backLink() {
    return cameFromHome()
      ? { href: '/app', text: window.I18N.t('nav.backHome') }
      : { href: '/events', text: window.I18N.t('nav.backEvents') };
  }

  // A link to another page of the same trip (event -> editor / rehearsal), keeping ?from.
  function keepFrom(url) {
    return cameFromHome() ? `${url}${url.includes('?') ? '&' : '?'}from=home` : url;
  }

  // The event page a sub-page (rehearsal, live, console, follow, a song) returns to.
  function eventBack(eventId) {
    return { href: keepFrom(`/events/${eventId}`), text: window.I18N.t('nav.backEvent') };
  }

  // Back links and the browser's Back must agree: when the page we came from (a link
  // followed, not a history step) is exactly the link's target, the link steps back in
  // history instead of adding a new entry, so Back afterwards never returns here (no loop,
  // no double step). The trail is the last page left in this tab (sessionStorage).
  const TRAIL_KEY = 'wa_nav_last';
  const here = () => window.location.pathname + window.location.search;
  let previous = null;
  let arrivedByLink = false;
  function readTrail(persisted) {
    try {
      previous = window.sessionStorage.getItem(TRAIL_KEY);
    } catch (err) {
      previous = null;
    }
    const nav = window.performance && performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
    arrivedByLink = !persisted && (!nav || nav.type === 'navigate');
  }
  readTrail(false);
  window.addEventListener('pageshow', (event) => { if (event.persisted) readTrail(true); });
  window.addEventListener('pagehide', () => {
    try {
      window.sessionStorage.setItem(TRAIL_KEY, here());
    } catch (err) {
      // no storage: back links are plain links
    }
  });

  function linkBack(anchor) {
    if (!anchor || anchor.dataset.linkBack) return;
    anchor.dataset.linkBack = '1';
    anchor.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = new URL(anchor.href, window.location.href);
      if (arrivedByLink && previous === target.pathname + target.search && window.history.length > 1) {
        event.preventDefault();
        window.history.back();
      }
    });
  }

  // Emoji before a role or a position name (Echipa, the event's team, the pickers). The role
  // ones are fixed; a position's comes from Echipa → Poziții (lib/positions.js).
  const ROLE_EMOJI = { owner: '👑', presenter: '🎙️', leader: '⭐', operator: '💻', member: '🎵' };
  const withEmoji = (emoji, text) => (emoji ? `${emoji} ${text}` : text);
  // A built-in role the owner renamed (/api/auth/me roleNames, set by the shell) shows that
  // name and emoji; the owner role never changes.
  let roleNames = {};
  const setRoleNames = (map) => { roleNames = map && typeof map === 'object' ? map : {}; };
  const roleName = (role) => (role !== 'owner' && roleNames[role] && roleNames[role].name) || window.I18N.t(`team.roles.${role}`);
  const roleEmoji = (role) => (role !== 'owner' && roleNames[role] && roleNames[role].emoji) || ROLE_EMOJI[role];
  const roleLabel = (role) => withEmoji(roleEmoji(role), roleName(role));
  const positionLabel = (p) => (p ? withEmoji(p.emoji, p.name) : '');

  window.PAGE = { api, el, ROLE_EMOJI, roleLabel, roleName, roleEmoji, setRoleNames, positionLabel, can, seesAll, liveEntryRole, canEdit, canEditEvents, EVENT_ROLES, setTitle, formatDate, dateBlock, setupTabs, backLink, keepFrom, eventBack, linkBack };
})();
