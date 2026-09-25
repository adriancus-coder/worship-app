'use strict';

// Installed-app support on every page (not /setup): registers the service worker (/sw.js)
// and keeps private pages private: on the login page (after logout or an expired session)
// the cached pages and the offline event copies of the previous user are removed.
// Later parts of the app use window.PWA.
//
// Updates: a new deploy installs a new worker that waits. Scripts and styles carry the build
// in their URL (lib/pages.js), so any page loaded after the deploy already runs the new code
// (<html data-build>), whichever worker is in charge. Then:
// - a page of the new build, once loaded, lets the waiting worker take over (no reload: it
//   is current; never in the middle of a navigation);
// - a page of the previous build shows a small toast "Versiune nouă disponibilă · Reîncarcă";
//   a tap reloads it (-> the new build). The next normal navigation does the same.
// Nothing reloads by itself. A page with an event live marks <html data-pwa-hold> (live,
// follow, operator, /screen): no toast there, and no worker switch, while it is set. The
// projector screen never shows the toast; with no event live it reloads silently after 60 s.
//
// Installing: PWA.install.open() (from "Mai mult → Instalează aplicația" and the home card)
// uses Chrome / Edge's own install prompt when the browser offered one; on iPhone / iPad
// (every browser there is Safari underneath) it shows a sheet with the three "Add to Home
// Screen" steps; elsewhere a short note. The home page (/app) shows, at most once a week
// and only in the browser (not in the installed app), a small dismissible card.

(function () {
  const PAGES_CACHE = 'wa-pages';

  function clearPrivate() {
    const jobs = [];
    if ('caches' in window) jobs.push(caches.delete(PAGES_CACHE).catch(() => false));
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_PAGES' });
    }
    if (window.indexedDB) {
      jobs.push(new Promise((resolve) => {
        try {
          const req = window.indexedDB.deleteDatabase('worship-app');
          req.onsuccess = req.onerror = req.onblocked = () => resolve();
        } catch (err) {
          resolve();
        }
      }));
    }
    return Promise.all(jobs);
  }

  let registration = null;
  const ready = ('serviceWorker' in navigator)
    ? navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((reg) => {
      registration = reg;
      return reg;
    }).catch(() => null)
    : Promise.resolve(null);

  if (window.location.pathname === '/login') clearPrivate();

  // --- updates --------------------------------------------------------------------

  const SCREEN_IDLE_MS = 60 * 1000;
  const CHECK_EVERY_MS = 60 * 60 * 1000;
  const root = document.documentElement;
  const build = root.dataset.build || '';
  const isScreen = () => document.body && document.body.classList.contains('screen-body');
  const held = () => root.hasAttribute('data-pwa-hold');
  // waiting: the installed worker; current: whether this page already runs its build.
  const update = { waiting: null, current: false, dismissed: false, toast: null, idleTimer: null, reloading: false };

  function t(key, fallback) {
    return window.I18N ? window.I18N.t(key) : fallback;
  }

  function versionOf(worker) {
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve(null), 3000);
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        resolve(event.data && event.data.version);
      };
      worker.postMessage({ type: 'VERSION' }, [channel.port2]);
    });
  }

  function reloadNow() {
    if (update.reloading) return;
    update.reloading = true;
    window.location.reload();
  }

  function renderToast() {
    const show = Boolean(update.waiting) && !update.current && !update.dismissed && !held() && !isScreen();
    if (!show) {
      if (update.toast) update.toast.hidden = true;
      return;
    }
    if (!update.toast) {
      const box = document.createElement('div');
      box.className = 'update-toast';
      box.setAttribute('role', 'status');
      const reload = document.createElement('button');
      reload.type = 'button';
      reload.className = 'update-toast-reload';
      reload.addEventListener('click', reloadNow);
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'update-toast-close';
      close.textContent = '✕';
      close.addEventListener('click', () => {
        update.dismissed = true; // the next page loads the new version anyway
        renderToast();
      });
      box.append(reload, close);
      document.body.append(box);
      update.toast = box;
    }
    const [reload, close] = update.toast.children;
    reload.replaceChildren(
      document.createTextNode(t('pwa.updateAvailable', 'Versiune nouă disponibilă')),
      document.createTextNode(' · '),
      Object.assign(document.createElement('strong'), { textContent: t('pwa.updateReload', 'Reîncarcă') }));
    close.setAttribute('aria-label', t('pwa.updateLater', 'Mai târziu'));
    close.title = t('pwa.updateLater', 'Mai târziu');
    update.toast.hidden = false;
  }

  // A page of the new build: the waiting worker takes over now (the page stays as it is).
  function switchWorker() {
    if (!update.waiting || !update.current || held()) return;
    const worker = update.waiting;
    update.waiting = null;
    worker.postMessage({ type: 'SKIP_WAITING' });
  }

  // The projector screen of a previous build: no event live for 60 s -> reload silently.
  function screenIdle() {
    clearTimeout(update.idleTimer);
    update.idleTimer = null;
    if (!isScreen() || !update.waiting || update.current || held()) return;
    update.idleTimer = setTimeout(() => {
      if (!held()) reloadNow();
    }, SCREEN_IDLE_MS);
  }

  function refresh() {
    switchWorker();
    renderToast();
    screenIdle();
  }

  async function waitingFound(worker) {
    if (!navigator.serviceWorker.controller) return; // the first install: nothing to update
    const version = await versionOf(worker);
    if (worker.state !== 'installed') return; // activated meanwhile (another tab)
    update.waiting = worker;
    update.current = Boolean(version) && version === build;
    refresh();
  }

  function watchUpdates(reg) {
    if (!reg) return;
    if (reg.waiting) waitingFound(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed') waitingFound(worker);
      });
    });
    // Pages that stay open for hours (the projector screen, a live page) look for new
    // versions now and then; the browser itself checks on navigations.
    const check = () => reg.update().catch(() => {});
    setInterval(check, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
  }

  if ('serviceWorker' in navigator) {
    // Another tab switched workers: that update no longer waits (this page keeps its toast
    // if it runs an older build: a reload still brings the new one).
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (update.waiting && update.waiting.state !== 'installed') {
        if (update.current) update.waiting = null;
        refresh();
      }
    });
    new MutationObserver(refresh).observe(root, { attributes: true, attributeFilter: ['data-pwa-hold'] });
    document.addEventListener('i18n:change', renderToast);
    ready.then(watchUpdates);
  }

  // --- installing -------------------------------------------------------------------

  const CARD_KEY = 'wa_install_card_at';
  const CARD_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const install = { prompt: null, installed: false, sheet: null };

  const standalone = () => Boolean((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
    || window.navigator.standalone);
  const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS asks for the desktop site

  function node(tag, props = {}, ...children) {
    const n = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (key === 'text') n.textContent = value;
      else if (key === 'class') n.className = value;
      else if (key.startsWith('on')) n.addEventListener(key.slice(2), value);
      else n.setAttribute(key, value);
    }
    for (const child of children) if (child) n.append(child);
    return n;
  }

  function svgIcon(d, cls) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', cls);
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
    return svg;
  }
  const SHARE_ICON = 'M8 9H6.5A1.5 1.5 0 0 0 5 10.5v9A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 17.5 9H16M12 3v11M8.5 6.5 12 3l3.5 3.5';
  const ADD_ICON = 'M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM12 8v8M8 12h8';

  // The three iPhone / iPad steps, each with a small drawing of what to tap.
  function iosSteps() {
    return node('ol', { class: 'install-steps' },
      node('li', null,
        node('span', { class: 'install-art' }, svgIcon(SHARE_ICON, 'install-art-icon')),
        node('p', { text: t('pwa.iosStep1', 'Apasă butonul Partajează.') })),
      node('li', null,
        node('span', { class: 'install-art install-art-row' },
          node('span', { class: 'install-art-label', text: t('pwa.iosAddLabel', 'Adaugă pe ecranul principal') }),
          svgIcon(ADD_ICON, 'install-art-icon')),
        node('p', { text: t('pwa.iosStep2', 'Alege „Adaugă pe ecranul principal”.') })),
      node('li', null,
        node('span', { class: 'install-art install-art-bar' },
          node('span', { class: 'install-art-add', text: t('pwa.iosAddButton', 'Adaugă') })),
        node('p', { text: t('pwa.iosStep3', 'Apasă „Adaugă”.') })));
  }

  function openSheet(kind) {
    if (!install.sheet) {
      install.sheet = node('dialog', { class: 'install-sheet', 'aria-labelledby': 'install-sheet-title' });
      install.sheet.addEventListener('click', (event) => {
        if (event.target === install.sheet) install.sheet.close(); // a tap on the dimmed area
      });
      document.body.append(install.sheet);
    }
    const sheet = install.sheet;
    sheet.dataset.kind = kind;
    let body;
    if (kind === 'ios') {
      body = [node('p', { class: 'muted', text: t('pwa.iosIntro', 'Pe iPhone și iPad, aplicația se adaugă din Safari (sau Edge), în trei pași:') }), iosSteps(),
        node('p', { class: 'hint', text: t('pwa.iosAfter', 'Aplicația apare apoi pe ecranul principal.') })];
    } else if (kind === 'installed') {
      body = [node('p', { text: t('pwa.installedText', 'Aplicația e instalată pe acest dispozitiv.') })];
    } else {
      body = [node('p', { text: t('pwa.otherText', 'Deschide meniul browserului și alege „Instalează aplicația” sau „Adaugă pe ecranul principal”.') })];
    }
    const title = node('h2', { id: 'install-sheet-title', tabindex: '-1', text: t(kind === 'ios' ? 'pwa.iosTitle' : 'pwa.install', 'Instalează aplicația') });
    sheet.replaceChildren(
      node('div', { class: 'install-sheet-body' }, title, ...body),
      node('div', { class: 'install-sheet-foot' },
        node('button', { type: 'button', text: t('pwa.gotIt', 'Am înțeles'), onclick: () => sheet.close() })));
    if (!sheet.open) sheet.showModal();
    title.focus({ preventScroll: true });
  }

  async function openInstall() {
    if (install.prompt) {
      const prompt = install.prompt;
      install.prompt = null; // a saved prompt works once
      prompt.prompt();
      const choice = await prompt.userChoice.catch(() => null);
      if (choice && choice.outcome === 'accepted') install.installed = true;
      return;
    }
    if (install.installed) openSheet('installed');
    else openSheet(isIos() ? 'ios' : 'other');
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // offered from "Mai mult" / the home card instead
    install.prompt = event;
  });
  window.addEventListener('appinstalled', () => {
    install.prompt = null;
    install.installed = true;
    const card = document.getElementById('install-card');
    if (card) card.replaceChildren();
  });

  // Home (/app): "Instalează aplicația pentru acces rapid", at most once a week.
  function installCard() {
    const slot = document.getElementById('install-card');
    if (!slot || standalone() || held()) return;
    let last = 0;
    try {
      last = Number(window.localStorage.getItem(CARD_KEY)) || 0;
      if (Date.now() - last < CARD_EVERY_MS) return;
      window.localStorage.setItem(CARD_KEY, String(Date.now()));
    } catch (err) {
      return; // no storage: no way to keep it to once a week
    }
    const text = node('p', { class: 'install-card-text' });
    const button = node('button', { type: 'button', class: 'secondary', onclick: openInstall });
    const close = node('button', { type: 'button', class: 'install-card-close', text: '✕', onclick: () => slot.replaceChildren() });
    const render = () => {
      text.textContent = t('pwa.cardText', 'Instalează aplicația pentru acces rapid');
      button.textContent = t('pwa.cardButton', 'Instalează');
      close.setAttribute('aria-label', t('pwa.cardClose', 'Nu acum'));
      close.title = t('pwa.cardClose', 'Nu acum');
    };
    render();
    document.addEventListener('i18n:change', render);
    slot.replaceChildren(node('div', { class: 'install-card' },
      node('img', { class: 'install-card-icon', src: '/icons/icon-192.png', alt: '', width: '40', height: '40' }),
      text, button, close));
  }
  installCard();

  document.addEventListener('i18n:change', () => {
    if (install.sheet && install.sheet.open) openSheet(install.sheet.dataset.kind);
  });

  window.PWA = {
    ready,
    clearPrivate,
    get registration() { return registration; },
    get updateWaiting() { return Boolean(update.waiting); },
    get build() { return build; },
    install: {
      open: openInstall,
      get standalone() { return standalone(); },
      get canPrompt() { return Boolean(install.prompt); },
    },
  };
})();
