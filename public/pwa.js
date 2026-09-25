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

  window.PWA = {
    ready,
    clearPrivate,
    get registration() { return registration; },
    get updateWaiting() { return Boolean(update.waiting); },
    get build() { return build; },
  };
})();
