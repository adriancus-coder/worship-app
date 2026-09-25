'use strict';

// The app menu on every signed-in page: Acasă · Evenimente · Bibliotecă · Mai mult.
// Phones (< 900px): a fixed bottom tab bar; tablets and desktops: a left rail. "Mai mult"
// opens a sheet (phones) or a panel by the rail with the pages a role may use (Media,
// Ecrane, Echipa, Setări), the language, the chord notation, the password and Deconectare.
//
//   <body data-shell="events">              the menu, with "Evenimente" as the current section
//   <body data-shell="exit">                full-screen work pages (live, follow): only "← Ieși",
//                                            back to the parent path (or data-shell-exit)
// Pages without data-shell (/screen, login, setup) get nothing.

(function () {
  const { t } = window.I18N;
  const EDITOR_ROLES = ['owner', 'leader'];
  const NOTATION_KEY = 'wa_chord_notation';

  const ICONS = {
    home: 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    events: 'M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8 12h3v3H8z',
    library: 'M9 18V6l11-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    media: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM10 9l5 3-5 3z',
    screens: 'M3 4h18v12H3zM8 20h8M12 16v4',
    team: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8',
    settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3.1 15H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6V4a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    password: 'M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V7a4 4 0 0 1 8 0v4M12 15v2',
    logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
    chevron: 'M9 6l6 6-6 6',
    install: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  };

  function icon(name) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', `shell-icon shell-icon-${name}`);
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', ICONS[name]);
    svg.append(path);
    return svg;
  }

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children) if (child) node.append(child);
    return node;
  }

  const body = document.body;
  const mode = body.dataset.shell;
  if (!mode) return;

  // --- the user (role decides the entries), the language saved per user ----------------

  const mePromise = fetch('/api/auth/me', { cache: 'no-store' })
    .then((res) => {
      if (res.status === 401) {
        window.location.replace('/login');
        return new Promise(() => {});
      }
      return res.ok ? res.json() : null;
    })
    .catch(() => null);

  document.addEventListener('i18n:change', (event) => {
    fetch('/api/me/locale', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: event.detail.lang }),
    }).catch(() => {}); // the wa_lang cookie already holds the choice
  });

  // --- full-screen work pages: "← Ieși" only --------------------------------------------

  if (mode === 'exit') {
    // /events/12/live -> /events/12
    const exit = el('a', { class: 'shell-exit', href: body.dataset.shellExit || window.location.pathname.replace(/\/[^/]+\/?$/, '') || '/app' });
    const render = () => { exit.textContent = t('shell.exit'); };
    render();
    document.addEventListener('i18n:change', render);
    body.prepend(exit);
    body.classList.add('has-shell-exit');
    window.SHELL = { me: mePromise };
    return;
  }

  // --- the menu ---------------------------------------------------------------------------

  body.classList.add('has-shell');
  const nav = el('nav', { class: 'app-shell', id: 'app-shell' });
  const list = el('ul', { class: 'shell-list' });
  nav.append(list);

  const sections = [
    { id: 'home', href: '/app' },
    { id: 'events', href: '/events' },
    { id: 'library', href: '/library' },
  ];
  const links = sections.map((s) => {
    const label = el('span', { class: 'shell-label' });
    const link = el('a', { class: 'shell-item', href: s.href, 'data-section': s.id }, icon(s.id), label);
    if (mode === s.id) link.setAttribute('aria-current', 'page');
    list.append(el('li', {}, link));
    return { ...s, link, label };
  });

  const moreLabel = el('span', { class: 'shell-label' });
  const moreButton = el('button', {
    type: 'button', class: 'shell-item shell-more', 'aria-expanded': 'false', 'aria-controls': 'shell-panel',
  }, icon('more'), moreLabel);
  if (mode === 'more') moreButton.classList.add('current');
  list.append(el('li', {}, moreButton));

  // "Mai mult": a bottom sheet on phones, a panel next to the rail from 900px, both over a
  // dimmed backdrop (role="dialog", aria-modal). Grouped: Navigare (pages the role may use),
  // Preferințe (language, chord notation), Cont (password, Deconectare).
  const backdrop = el('div', { class: 'shell-backdrop', hidden: true });
  const panel = el('div', { class: 'shell-panel', id: 'shell-panel', role: 'dialog', 'aria-modal': 'true', hidden: true });
  const handle = el('div', { class: 'shell-handle', 'aria-hidden': 'true' }, el('span'));
  const whoName = el('h2', { class: 'shell-who-name', id: 'shell-panel-title' });
  const whoRole = el('p', { class: 'shell-who-role' });
  const closeButton = el('button', { type: 'button', class: 'shell-close', text: '✕' });
  panel.setAttribute('aria-labelledby', 'shell-panel-title');

  const section = (key, ...children) => {
    const heading = el('h3', { class: 'shell-section-title', 'data-key': key });
    const box = el('section', { class: 'shell-section' }, heading, ...children);
    return box;
  };

  // A row that opens a page: icon, label, chevron.
  const pageRow = (p) => {
    const label = el('span', { class: 'shell-row-label' });
    const link = el('a', { class: 'shell-row', href: p.href, 'data-page': p.id }, icon(p.icon), label, icon('chevron'));
    if (window.location.pathname === p.href) link.setAttribute('aria-current', 'page');
    const item = el('li', { hidden: true }, link);
    return { ...p, link, label, item };
  };

  const navLinks = [
    { id: 'media', href: '/media', key: 'shell.media', icon: 'media', roles: EDITOR_ROLES },
    { id: 'screens', href: '/screens', key: 'shell.screens', icon: 'screens', roles: EDITOR_ROLES },
    { id: 'team', href: '/team', key: 'shell.team', icon: 'team', roles: ['owner'] },
    { id: 'settings', href: '/settings', key: 'shell.settings', icon: 'settings', roles: ['owner'] },
  ].map(pageRow);
  const accountLinks = [
    { id: 'password', href: '/change-password', key: 'shell.password', icon: 'password', roles: ['owner', 'leader', 'operator', 'member'] },
  ].map(pageRow);
  const pageLinks = [...navLinks, ...accountLinks];

  const langLabel = el('span', { class: 'shell-setting-label', id: 'shell-lang-label' });
  const langSwitch = el('div', { class: 'lang-switch', role: 'group', 'aria-labelledby': 'shell-lang-label' },
    el('button', { type: 'button', 'data-lang': 'ro', lang: 'ro', 'aria-pressed': 'false', text: 'RO' }),
    el('button', { type: 'button', 'data-lang': 'en', lang: 'en', 'aria-pressed': 'false', text: 'EN' }));

  const notationLabel = el('span', { class: 'shell-setting-label', id: 'shell-notation-label' });
  const notationSlot = el('span', { class: 'shell-notation' });

  const logoutLabel = el('span', { class: 'shell-row-label' });
  const logout = el('button', {
    type: 'button',
    class: 'shell-row shell-logout',
    onclick: async () => {
      logout.disabled = true;
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } finally {
        window.location.replace('/login');
      }
    },
  }, icon('logout'), logoutLabel);

  // "Instalează aplicația": not in the installed app itself (public/pwa.js does the rest).
  const standalone = () => Boolean((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
    || window.navigator.standalone);
  const installLabel = el('span', { class: 'shell-row-label' });
  const installRow = el('button', {
    type: 'button',
    class: 'shell-row shell-install',
    hidden: standalone(),
    onclick: () => {
      open(false);
      if (window.PWA) window.PWA.install.open();
    },
  }, icon('install'), installLabel, icon('chevron'));

  const navSection = section('shell.sections.navigation', el('ul', { class: 'shell-rows' }, ...navLinks.map((p) => p.item)));
  panel.append(
    handle,
    el('header', { class: 'shell-panel-head' }, el('div', { class: 'shell-who' }, whoName, whoRole), closeButton),
    el('div', { class: 'shell-panel-body' },
      navSection,
      section('shell.sections.preferences',
        el('div', { class: 'shell-setting' }, langLabel, langSwitch),
        el('div', { class: 'shell-setting' }, notationLabel, notationSlot)),
      section('shell.sections.account',
        installRow,
        el('ul', { class: 'shell-rows' }, ...accountLinks.map((p) => p.item)),
        logout)));

  // Chord notation: the page's own switch module when it has one (song pages), else a small
  // one here that saves the same preference.
  let notationGroup = null;
  function notationSwitch() {
    if (window.NOTATION) return window.NOTATION.createSwitch();
    const group = el('span', { class: 'notation-switch', role: 'group' });
    let current = 'letters';
    try {
      current = window.localStorage.getItem(NOTATION_KEY) === 'solfege' ? 'solfege' : 'letters';
    } catch (err) {
      // no storage: letters until /api/auth/me answers
    }
    const buttons = [['letters', 'C'], ['solfege', 'Do']].map(([value, text]) => el('button', {
      type: 'button',
      class: 'secondary',
      'data-value': value,
      text,
      onclick: () => set(value, true),
    }));
    function render() {
      group.setAttribute('aria-labelledby', 'shell-notation-label');
      for (const b of buttons) {
        b.setAttribute('aria-pressed', String(b.dataset.value === current));
        b.setAttribute('aria-label', t(`notation.${b.dataset.value}`));
      }
    }
    function set(value, save) {
      current = value;
      try {
        window.localStorage.setItem(NOTATION_KEY, value);
      } catch (err) {
        // private mode: the server copy applies on the next page
      }
      render();
      if (save) {
        fetch('/api/me/chord-notation', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notation: value }),
        }).catch(() => {});
      }
    }
    group.append(...buttons);
    group.renderSwitch = render;
    group.setFromServer = (value) => set(value === 'solfege' ? 'solfege' : 'letters', false);
    render();
    return group;
  }
  notationGroup = notationSwitch();
  notationSlot.append(notationGroup);

  function render(me) {
    for (const item of links) item.label.textContent = t(`nav.${item.id}`);
    nav.setAttribute('aria-label', t('nav.label'));
    moreLabel.textContent = t('shell.more');
    closeButton.setAttribute('aria-label', t('shell.close'));
    closeButton.title = t('shell.close');
    for (const heading of panel.querySelectorAll('.shell-section-title')) heading.textContent = t(heading.dataset.key);
    langLabel.textContent = t('shell.language');
    notationLabel.textContent = t('notation.label');
    logoutLabel.textContent = t('app.logout');
    installLabel.textContent = t('pwa.install');
    for (const p of pageLinks) p.label.textContent = t(p.key);
    if (notationGroup.renderSwitch) notationGroup.renderSwitch();
    if (me) {
      whoName.textContent = me.user.name;
      whoRole.textContent = t('shell.roleAt', { role: t(`roles.${me.user.role}`), adminName: me.admin.name });
      for (const p of pageLinks) p.item.hidden = !p.roles.includes(me.user.role);
    } else {
      whoName.textContent = t('shell.more');
    }
    navSection.hidden = !navLinks.some((p) => !p.item.hidden);
    window.I18N.apply(panel); // the RO / EN buttons' pressed state
  }

  let me = null;
  mePromise.then((result) => {
    me = result;
    if (me && notationGroup.setFromServer) notationGroup.setFromServer(me.user.chordNotation);
    render(me);
  });
  document.addEventListener('i18n:change', () => render(me));

  // --- opening and closing ---------------------------------------------------------------

  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ANIMATION_MS = 200;
  let isOpen = false;
  let lockedScrollY = 0;
  let hideTimer = null;

  // The page behind must not scroll (iOS Safari ignores overflow: hidden on body alone).
  function lockScroll(lock) {
    if (lock) {
      lockedScrollY = window.scrollY;
      body.style.top = `-${lockedScrollY}px`;
      body.classList.add('shell-locked');
    } else {
      body.classList.remove('shell-locked');
      body.style.top = '';
      window.scrollTo(0, lockedScrollY);
    }
  }

  function focusables() {
    return [...panel.querySelectorAll('a[href], button:not([disabled]), input, select, [tabindex]:not([tabindex="-1"])')]
      .filter((node) => !node.closest('[hidden]') && node.getClientRects().length);
  }

  function open(value) {
    if (value === isOpen) return;
    isOpen = value;
    clearTimeout(hideTimer);
    moreButton.setAttribute('aria-expanded', String(value));
    moreButton.classList.toggle('open', value);
    if (value) {
      backdrop.hidden = false;
      panel.hidden = false;
      panel.style.transform = '';
      void panel.offsetWidth; // start the slide from below
      backdrop.classList.add('visible');
      panel.classList.add('visible');
      lockScroll(true);
      closeButton.focus();
      return;
    }
    backdrop.classList.remove('visible');
    panel.classList.remove('visible');
    lockScroll(false);
    const hide = () => {
      if (isOpen) return;
      backdrop.hidden = true;
      panel.hidden = true;
      panel.style.transform = '';
    };
    if (reducedMotion()) hide();
    else hideTimer = setTimeout(hide, ANIMATION_MS);
    moreButton.focus();
  }

  moreButton.addEventListener('click', () => open(!isOpen));
  closeButton.addEventListener('click', () => open(false));
  backdrop.addEventListener('click', () => open(false));
  // A page link inside closes the sheet before leaving (the back button then shows the page).
  panel.addEventListener('click', (event) => {
    if (event.target.closest('a[href]')) open(false);
  });

  document.addEventListener('keydown', (event) => {
    if (!isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      open(false);
      return;
    }
    if (event.key !== 'Tab') return;
    // Focus stays inside the sheet.
    const list = focusables();
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  });

  // Swipe down on the handle (or the header) closes the sheet on phones.
  let drag = null;
  function dragStart(event) {
    if (!isOpen || event.target.closest('button')) return;
    drag = { y: event.clientY, dy: 0, id: event.pointerId };
    panel.classList.add('dragging');
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function dragMove(event) {
    if (!drag || event.pointerId !== drag.id) return;
    drag.dy = Math.max(0, event.clientY - drag.y);
    panel.style.transform = `translateY(${drag.dy}px)`;
  }
  function dragEnd(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const { dy } = drag;
    drag = null;
    panel.classList.remove('dragging');
    if (dy > 60) open(false);
    else panel.style.transform = '';
  }
  for (const zone of [handle, panel.querySelector('.shell-panel-head')]) {
    zone.addEventListener('pointerdown', dragStart);
    zone.addEventListener('pointermove', dragMove);
    zone.addEventListener('pointerup', dragEnd);
    zone.addEventListener('pointercancel', dragEnd);
  }

  render(null);
  body.prepend(nav);
  body.append(backdrop, panel);

  window.SHELL = { me: mePromise, open };
})();
