'use strict';

// The app menu on every signed-in page: Acasă · Evenimente · Bibliotecă · Mai mult.
// Phones (< 900px): a fixed bottom tab bar; tablets and desktops: a left rail. "Mai mult"
// opens a panel with the pages a role may use (Media, Ecrane, Setări), the language, the
// chord notation and Deconectare.
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

  // "Mai mult" panel.
  const panel = el('div', { class: 'shell-panel', id: 'shell-panel', role: 'dialog', hidden: true });
  const panelTitle = el('h2', { class: 'shell-panel-title', id: 'shell-panel-title' });
  panel.setAttribute('aria-labelledby', 'shell-panel-title');
  const who = el('p', { class: 'shell-who' });
  const pages = el('ul', { class: 'shell-pages' });
  const pageLinks = [
    { id: 'media', href: '/media', key: 'shell.media', roles: EDITOR_ROLES },
    { id: 'screens', href: '/screens', key: 'shell.screens', roles: EDITOR_ROLES },
    { id: 'team', href: '/team', key: 'shell.team', roles: ['owner'] },
    { id: 'settings', href: '/settings', key: 'shell.settings', roles: ['owner'] },
    { id: 'password', href: '/change-password', key: 'shell.password', roles: ['owner', 'leader', 'operator', 'member'] },
  ].map((p) => {
    const link = el('a', { class: 'shell-page', href: p.href, 'data-page': p.id });
    if (window.location.pathname === p.href) link.setAttribute('aria-current', 'page');
    const item = el('li', { hidden: true }, link);
    pages.append(item);
    return { ...p, link, item };
  });

  const langLabel = el('span', { class: 'shell-setting-label', id: 'shell-lang-label' });
  const langSwitch = el('div', { class: 'lang-switch', role: 'group', 'aria-labelledby': 'shell-lang-label' },
    el('button', { type: 'button', 'data-lang': 'ro', lang: 'ro', 'aria-pressed': 'false', text: 'RO' }),
    el('button', { type: 'button', 'data-lang': 'en', lang: 'en', 'aria-pressed': 'false', text: 'EN' }));

  const notationLabel = el('span', { class: 'shell-setting-label', id: 'shell-notation-label' });
  const notationSlot = el('span', { class: 'shell-notation' });

  const logout = el('button', {
    type: 'button',
    class: 'secondary shell-logout',
    onclick: async () => {
      logout.disabled = true;
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } finally {
        window.location.replace('/login');
      }
    },
  });

  panel.append(panelTitle, who, pages,
    el('div', { class: 'shell-setting' }, langLabel, langSwitch),
    el('div', { class: 'shell-setting' }, notationLabel, notationSlot),
    logout);

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
    for (const s of links) s.label.textContent = t(`nav.${s.id}`);
    nav.setAttribute('aria-label', t('nav.label'));
    moreLabel.textContent = t('shell.more');
    panelTitle.textContent = t('shell.more');
    langLabel.textContent = t('shell.language');
    notationLabel.textContent = t('notation.label');
    logout.textContent = t('app.logout');
    for (const p of pageLinks) p.link.textContent = t(p.key);
    if (notationGroup.renderSwitch) notationGroup.renderSwitch();
    if (me) {
      who.textContent = t('shell.who', { name: me.user.name, role: t(`roles.${me.user.role}`), adminName: me.admin.name });
      for (const p of pageLinks) p.item.hidden = !p.roles.includes(me.user.role);
    }
    window.I18N.apply(panel); // the RO / EN buttons' pressed state
  }

  let me = null;
  mePromise.then((result) => {
    me = result;
    if (me && notationGroup.setFromServer) notationGroup.setFromServer(me.user.chordNotation);
    render(me);
  });
  document.addEventListener('i18n:change', () => render(me));

  // --- opening and closing the panel ---------------------------------------------------

  function open(value) {
    panel.hidden = !value;
    moreButton.setAttribute('aria-expanded', String(value));
    if (value) (panel.querySelector('a:not([hidden]), button') || panel).focus();
  }

  moreButton.addEventListener('click', () => open(panel.hidden));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      open(false);
      moreButton.focus();
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!panel.hidden && !panel.contains(event.target) && !moreButton.contains(event.target)) open(false);
  });

  render(null);
  nav.append(panel);
  body.prepend(nav);

  window.SHELL = { me: mePromise, open };
})();
