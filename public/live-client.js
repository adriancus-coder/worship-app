'use strict';

// Live connection shared by the live pages: joins the event room, keeps the newest
// snapshot (the server is the source of truth; pages render only what it sends), sends
// commands with the version they were made against, and reports the connection state.
// Needs /socket.io/socket.io.js (served by the app's own server: no external service).

(function () {
  // connection: 'connecting' | 'connected' | 'reconnecting' | 'offline'
  function connect({ eventId, onState, onPresence, onConnection, onGone }) {
    const socket = window.io({ transports: ['websocket', 'polling'], reconnectionDelayMax: 4000 });
    let state = null;
    let connection = 'connecting';

    function setConnection(value) {
      const next = navigator.onLine === false && value !== 'connected' ? 'offline' : value;
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
        if (reply && reply.ok === false && reply.code === 'notFound' && onGone) onGone();
      });
    }

    socket.on('connect', () => {
      setConnection('connected');
      join();
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

    return {
      command,
      get state() { return state; },
      get connection() { return connection; },
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

  window.LIVE = { connect, stepsOf, nextPosition };
})();
