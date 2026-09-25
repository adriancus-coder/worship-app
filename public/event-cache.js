'use strict';

// The event data a live page needs to keep working without the server (emergency mode):
// kept in IndexedDB, one record per event, replaced whenever the setlist changes.
//   { eventId, setlistKey, event, items, songs: [[itemId, song]], logo: { url, dataUrl } | null, savedAt }
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
    return run('readwrite', (store) => { store.put({ ...record, savedAt: Date.now() }); return null; })
      .then((ok) => ok === true);
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

  window.EVENT_CACHE = { load, save, logoData, LOGO_MAX_BYTES };
})();
