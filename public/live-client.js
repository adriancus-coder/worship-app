'use strict';

// Live connection shared by the live pages: joins the event room, keeps the newest
// snapshot (the server is the source of truth; pages render only what it sends), sends
// commands with the version they were made against, and reports the connection state.
// Needs /socket.io/socket.io.js (served by the app's own server: no external service).

(function () {
  // Without the server for this long, pages switch to their emergency mode (onLongOffline).
  const LONG_OFFLINE_MS = 5000;

  // connection: 'connecting' | 'connected' | 'reconnecting' | 'offline'
  // onLongOffline(true) after LONG_OFFLINE_MS without the server, onLongOffline(false) when
  // it is back (before the first snapshot of the new connection arrives).
  // Stands in for socket.io when its client script could not load (a page reloaded offline
  // from the installed app's cache). It keeps trying to load the script; once the network is
  // back it creates the real socket, hands it every listener the page registered, and from
  // then on forwards to it, so the page reconnects without a reload (and emergency mode's
  // reconnect rule applies as usual).
  const RETRY_MS = 5000;
  function lazySocket(create) {
    const listeners = [];
    let real = null;
    const proxy = {
      get connected() { return Boolean(real && real.connected); },
      on(event, fn) {
        listeners.push([event, fn]);
        if (real) real.on(event, fn);
        return proxy;
      },
      once(event, fn) {
        const wrapped = (...args) => { proxy.off(event, wrapped); fn(...args); };
        return proxy.on(event, wrapped);
      },
      off(event, fn) {
        const i = listeners.findIndex(([e, f]) => e === event && f === fn);
        if (i >= 0) listeners.splice(i, 1);
        if (real) real.off(event, fn);
        return proxy;
      },
      emit(...args) {
        if (real) real.emit(...args);
        return proxy;
      },
      timeout(ms) { return real ? real.timeout(ms) : proxy; },
      connect() {
        if (real) real.connect();
        return proxy;
      },
      disconnect() {
        if (real) real.disconnect();
        return proxy;
      },
      close() { if (real) real.close(); },
      removeAllListeners() {
        listeners.length = 0;
        if (real) real.removeAllListeners();
        return proxy;
      },
    };
    function attach() {
      real = create();
      for (const [event, fn] of listeners) real.on(event, fn);
    }
    function tryLoad() {
      if (window.io) return attach();
      const script = document.createElement('script');
      script.src = '/socket.io/socket.io.js';
      script.onload = () => { if (window.io && !real) attach(); };
      script.onerror = () => {
        script.remove();
        setTimeout(tryLoad, RETRY_MS);
      };
      document.head.append(script);
      return undefined;
    }
    setTimeout(tryLoad, RETRY_MS);
    return proxy;
  }

  // initialState: a cached snapshot to start from when the page loads without the server.
  function connect({ eventId, onState, onPresence, onConnection, onGone, onConnect, onLongOffline, initialState }) {
    const open = () => window.io({ transports: ['websocket', 'polling'], reconnectionDelayMax: 4000 });
    const socket = window.io ? open() : lazySocket(open);
    let state = null;
    let connection = 'connecting';
    let longOffline = false;
    let offlineTimer = null;

    function setConnection(value) {
      const next = navigator.onLine === false && value !== 'connected' ? 'offline' : value;
      if (next === 'connected') {
        clearTimeout(offlineTimer);
        offlineTimer = null;
        if (longOffline) {
          longOffline = false;
          if (onLongOffline) onLongOffline(false);
        }
      } else if (state && !offlineTimer && !longOffline) {
        offlineTimer = setTimeout(() => {
          offlineTimer = null;
          longOffline = true;
          if (onLongOffline) onLongOffline(true);
        }, LONG_OFFLINE_MS);
      }
      if (next === connection) return;
      connection = next;
      if (onConnection) onConnection(connection);
    }

    // Newer versions win; the same version is taken again when the setlist or status
    // changed without a new position (e.g. the setlist was edited before the start).
    function accept(next) {
      if (!next || next.eventId !== eventId) return;
      if (state && next.version < state.version) return;
      state = next;
      onState(state);
    }

    function join() {
      socket.emit('live:join', { eventId }, (reply) => {
        if (reply && reply.code === 'mustChangePassword') window.location.replace('/change-password');
        if (reply && reply.ok === false && reply.code === 'notFound' && onGone) onGone();
      });
    }

    socket.on('connect', () => {
      setConnection('connected');
      join();
      if (onConnect) onConnect(socket); // e.g. subscribe again after a reconnect
    });
    socket.on('live:state', accept);
    socket.on('live:presence', (payload) => {
      if (!payload || payload.eventId !== eventId) return;
      if (state) state = { ...state, presence: payload.presence };
      if (onPresence) onPresence(payload.presence);
    });
    socket.on('live:gone', (payload) => {
      if (payload && payload.eventId === eventId && onGone) onGone();
    });
    socket.on('connect_error', (err) => {
      // The session is gone (logged out elsewhere, expired): back to the login page.
      if (err && err.message === 'unauthenticated') window.location.replace('/login');
      else setConnection('reconnecting');
    });
    socket.on('disconnect', (reason) => {
      setConnection('reconnecting');
      // The server closed us (logout, deactivated user): check the session before retrying.
      if (reason === 'io server disconnect') {
        window.PAGE.api('/api/auth/me').then((res) => {
          if (res.ok) socket.connect();
        }).catch(() => socket.connect());
      }
    });
    window.addEventListener('offline', () => setConnection(socket.connected ? 'connected' : 'offline'));
    window.addEventListener('online', () => setConnection(socket.connected ? 'connected' : 'reconnecting'));

    // Resolves with the server's reply: { ok, version } or { ok: false, code, error }.
    // A stale reply carries the current state, which is rendered (nothing was applied).
    function command(type, extra = {}) {
      return new Promise((resolve) => {
        if (!socket.connected) {
          resolve({ ok: false, code: 'offline' });
          return;
        }
        const payload = { type, eventId, expectedVersion: state ? state.version : undefined, ...extra };
        socket.timeout(8000).emit('live:command', payload, (err, reply) => {
          if (err) return resolve({ ok: false, code: 'timeout' });
          if (reply && reply.code === 'stale' && reply.state) accept(reply.state);
          resolve(reply || { ok: false, code: 'internal' });
        });
      });
    }

    if (initialState) {
      // After connect() returns, so the page already holds this client.
      Promise.resolve().then(() => {
        accept(initialState);
        if (!socket.connected) setConnection('offline'); // starts the long-offline timer
      });
    }

    return {
      command,
      socket,
      get state() { return state; },
      get connection() { return connection; },
      get longOffline() { return longOffline; },
    };
  }

  // Step layout of a setlist, as the server counts it: a song has one step per entry of its
  // arrangement (with repeats), anything else one step.
  function stepsOf(item) {
    return item.type === 'song' && item.songId && Array.isArray(item.arrangementResolved)
      ? Math.max(1, item.arrangementResolved.length)
      : 1;
  }

  // The position after `pos` in items (display only: the server decides), or null at the end.
  function nextPosition(items, pos) {
    const i = items.findIndex((it) => it.id === pos.itemId);
    if (i < 0) return null;
    if (pos.step + 1 < stepsOf(items[i])) return { itemId: pos.itemId, step: pos.step + 1 };
    return i + 1 < items.length ? { itemId: items[i + 1].id, step: 0 } : null;
  }

  // The "end of this item" button (worship.endItem), the same on the leader page and the
  // console: "Următoarea cântare →" / "Următorul element →" with the next title under it,
  // or "Sfârșit" (stop) after the last item. next: the next item in the list the page drives
  // (null at the end); title(item): its display title; clear: 'logo' | 'black' (what the
  // end shows); teamOnly: the end changes nothing (split mode, the team's list).
  function renderEndButton(button, { next, title, clear, teamOnly }) {
    const { el } = window.PAGE;
    const { t } = window.I18N;
    if (next) {
      const kind = t(next.type === 'song' ? 'live.endItem.nextSong' : 'live.endItem.nextItem');
      button.replaceChildren(el('span', { class: 'end-item-label', text: kind }), el('span', { class: 'end-item-sub', text: title(next) }));
      button.setAttribute('aria-label', t('live.endItem.nextLabel', { kind: kind.replace(/\s*→$/, ''), title: title(next) }));
    } else {
      button.replaceChildren(el('span', { class: 'end-item-label', 'data-icon': 'stop', text: t('live.endItem.end') }));
      button.setAttribute('aria-label', t(teamOnly ? 'live.endItem.endSplit' : (clear === 'logo' ? 'live.endItem.endLogo' : 'live.endItem.endBlack')));
    }
    button.title = button.getAttribute('aria-label');
  }

  window.LIVE = { connect, stepsOf, nextPosition, renderEndButton };
})();
