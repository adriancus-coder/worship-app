'use strict';

// The event data the live pages need to keep working without the server (emergency mode,
// and reloading an installed app offline): kept in IndexedDB, one record per event. Pages
// save the parts they have; save() merges them into the record.
//   { eventId, setlistKey, event, items, songs: [[itemId, song]], logo: { url, dataUrl } | null,
//     snap (the last live snapshot), adminId, savedAt }
// Every call resolves (null / false) instead of failing: a private window or a browser
// without IndexedDB simply has no cache.

(function () {
  const DB_NAME = 'worship-app';
  const STORE = 'live-events';
  const LOGO_MAX_BYTES = 512 * 1024; // larger logos are not cached (the projector keeps its own copy)

  let opening = null;
  function open() {
    if (!opening) {
      opening = new Promise((resolve) => {
        try {
          const req = window.indexedDB.open(DB_NAME, 1);
          req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'eventId' });
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
          req.onblocked = () => resolve(null);
        } catch (err) {
          resolve(null);
        }
      });
    }
    return opening;
  }

  function run(mode, fn) {
    return open().then((db) => new Promise((resolve) => {
      if (!db) return resolve(null);
      try {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req ? req.result ?? null : true);
        tx.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
      } catch (err) {
        resolve(null);
      }
    }));
  }

  function load(eventId) {
    return run('readonly', (store) => store.get(eventId));
  }

  function save(record) {
    return load(record.eventId).then((existing) => run('readwrite', (store) => {
      store.put({ ...(existing || {}), ...record, savedAt: Date.now() });
      return null;
    })).then((ok) => ok === true);
  }

  // Whether this page load has no server to talk to (the socket.io client did not load, which
  // is what an installed app reloaded offline looks like, or the browser says so).
  function offline() {
    return !window.io || navigator.onLine === false;
  }

  // A small logo as a data URL (works with no server); null when missing, too large or offline.
  async function logoData(url) {
    if (!url) return null;
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) return null;
      const blob = await res.blob();
      if (blob.size > LOGO_MAX_BYTES) return null;
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      return null;
    }
  }

  window.EVENT_CACHE = { load, save, logoData, offline, LOGO_MAX_BYTES };
})();
