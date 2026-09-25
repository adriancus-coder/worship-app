'use strict';

// Installed-app support on every page (not /setup): registers the service worker (/sw.js)
// and keeps private pages private: on the login page (after logout or an expired session)
// the cached pages and the offline event copies of the previous user are removed.
// Later parts of the app use window.PWA.

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

  window.PWA = {
    ready,
    clearPrivate,
    get registration() { return registration; },
  };
})();
