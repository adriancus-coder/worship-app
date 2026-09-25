'use strict';

// Live rooms over socket.io. Every socket is authenticated with the wa_sid session cookie;
// a socket joins at most one event room, "admin:<adminId>:event:<eventId>", and receives
// full `live:state` snapshots from the server (the single source of truth).

const { EDITOR_ROLES, LiveError, createLiveStore } = require('../lib/live');
const { resolveLang, t: translate } = require('../lib/i18n');

const ROLES = ['owner', 'leader', 'operator', 'member'];
const PRESENCE_DEBOUNCE_MS = 1000;
const SESSION_SWEEP_MS = 30 * 1000;

const COMMANDS = ['event.start', 'event.end', 'worship.next', 'worship.prev', 'worship.goto', 'projector.source',
  'video.prepare', 'video.play', 'video.pause', 'video.restart', 'video.stop', 'video.volume'];

const roomName = (adminId, eventId) => `admin:${adminId}:event:${eventId}`;
const isId = (value) => Number.isInteger(value) && value > 0;

// Created before the HTTP routes (they notify it), attached to socket.io once it exists.
function createLiveHub({ db, auth, logger, screensHub }) {
  const store = createLiveStore(db);
  const presenceTimers = new Map();
  let io = null;

  function tr(socket, key, vars) {
    return translate(key, vars, socket.data.lang);
  }

  // Distinct users per role in the room (several tabs of one person count once).
  function presence(room) {
    const counts = Object.fromEntries(ROLES.map((role) => [role, 0]));
    const seen = new Set();
    for (const id of io.sockets.adapter.rooms.get(room) || []) {
      const socket = io.sockets.sockets.get(id);
      if (!socket || seen.has(socket.data.userId)) continue;
      seen.add(socket.data.userId);
      counts[socket.data.role] = (counts[socket.data.role] || 0) + 1;
    }
    return counts;
  }

  function fullSnapshot(adminId, eventId) {
    const state = store.snapshot(adminId, eventId);
    if (!state) return null;
    return { ...state, presence: presence(roomName(adminId, eventId)), serverTime: Date.now() };
  }

  // Presence changes are broadcast at most once a second per room.
  function schedulePresence(adminId, eventId) {
    const room = roomName(adminId, eventId);
    if (presenceTimers.has(room)) return;
    presenceTimers.set(room, setTimeout(() => {
      presenceTimers.delete(room);
      io.to(room).emit('live:presence', { eventId, presence: presence(room), serverTime: Date.now() });
    }, PRESENCE_DEBOUNCE_MS));
  }

  function leaveRoom(socket) {
    const current = socket.data.eventId;
    if (!current) return;
    socket.leave(roomName(socket.data.adminId, current));
    socket.data.eventId = null;
    schedulePresence(socket.data.adminId, current);
  }

  // Re-reads the session on every message: logged-out or deactivated users are dropped.
  function refresh(socket) {
    const session = auth.getSession(socket.request);
    if (!session || session.sessionId !== socket.data.sessionId) {
      socket.disconnect(true);
      return false;
    }
    socket.data.role = session.user.role;
    return true;
  }

  function reply(ack, payload) {
    if (typeof ack === 'function') ack(payload);
  }

  function onJoin(socket, payload, ack) {
    if (!refresh(socket)) return;
    const eventId = payload && /^\d{1,15}$/.test(String(payload.eventId)) ? Number(payload.eventId) : null;
    if (!eventId) return reply(ack, { ok: false, code: 'badRequest', error: tr(socket, 'errors.badRequest') });
    const { adminId, role } = socket.data;
    if (!store.visibleEvent(adminId, eventId, role)) {
      return reply(ack, { ok: false, code: 'notFound', error: tr(socket, 'errors.eventNotFound') });
    }
    if (socket.data.eventId !== eventId) {
      leaveRoom(socket);
      socket.join(roomName(adminId, eventId));
      socket.data.eventId = eventId;
      schedulePresence(adminId, eventId);
    }
    const state = fullSnapshot(adminId, eventId);
    socket.emit('live:state', state);
    reply(ack, { ok: true, version: state.version });
  }

  // Every change goes to the event room and, if it changes what the projector shows, to
  // the admin's screens.
  function broadcast(adminId, eventId) {
    const state = fullSnapshot(adminId, eventId);
    if (state) io.to(roomName(adminId, eventId)).emit('live:state', state);
    screensHub.update(adminId);
  }

  function fail(socket, ack, code, extra) {
    reply(ack, { ok: false, code, error: tr(socket, `live.errors.${code}`), ...extra });
  }

  // live:command { type, eventId, expectedVersion?, itemId?, step? } -> ack { ok, version }
  // or { ok: false, code, error } (+ state when the expected version was stale).
  function onCommand(socket, payload, ack) {
    if (!refresh(socket)) return;
    const cmd = payload && typeof payload === 'object' ? payload : {};
    const { adminId, role, userId } = socket.data;
    if (!COMMANDS.includes(cmd.type) || !isId(cmd.eventId)) return fail(socket, ack, 'badCommand');
    if (!EDITOR_ROLES.includes(role)) return fail(socket, ack, 'forbidden');
    if (!store.visibleEvent(adminId, cmd.eventId, role)) return fail(socket, ack, 'notFound');
    if (socket.data.eventId !== cmd.eventId) return fail(socket, ack, 'notJoined');
    const expected = cmd.expectedVersion;
    if (expected !== undefined && expected !== null && !Number.isInteger(expected)) return fail(socket, ack, 'badCommand');
    if (cmd.type === 'worship.goto' && (!isId(cmd.itemId) || !Number.isInteger(cmd.step))) return fail(socket, ack, 'badPosition');
    // Pausing keeps the position the screens last reported.
    const command = cmd.type === 'video.pause' ? { ...cmd, position: screensHub.lastVideoPosition(adminId) } : cmd;
    let result;
    try {
      result = store.command(adminId, cmd.eventId, command, expected);
    } catch (err) {
      if (!(err instanceof LiveError)) throw err;
      if (err.code === 'stale') return fail(socket, ack, 'stale', { state: fullSnapshot(adminId, cmd.eventId) });
      return fail(socket, ack, err.code);
    }
    if (cmd.type === 'event.start' || cmd.type === 'event.end') {
      logger.info(`Event #${cmd.eventId} ${cmd.type === 'event.start' ? 'started' : 'ended'} by user #${userId} (admin #${adminId})`);
    }
    if (result.changed) broadcast(adminId, cmd.eventId);
    reply(ack, { ok: true, version: result.version });
  }

  // Video events from the screens: the end of a video, a local file chosen on the PC.
  screensHub.setVideoHandler((adminId, cmd) => {
    const eventId = store.liveEventId(adminId);
    if (!eventId) return;
    try {
      if (store.command(adminId, eventId, cmd).changed) broadcast(adminId, eventId);
    } catch (err) {
      if (!(err instanceof LiveError)) logger.error('video event failed', err);
    }
  });

  function onConnection(socket) {
    logger.debug(`socket ${socket.id} connected: user #${socket.data.userId} (admin #${socket.data.adminId})`);
    socket.on('live:join', (payload, ack) => onJoin(socket, payload, ack));
    socket.on('live:command', (payload, ack) => {
      try {
        onCommand(socket, payload, ack);
      } catch (err) {
        logger.error('live:command failed', err);
        fail(socket, ack, 'internal');
      }
    });
    // The leader's projector panel: the frame the screens show and how many are connected.
    socket.on('projector:watch', (payload, ack) => {
      if (!refresh(socket)) return;
      if (!EDITOR_ROLES.includes(socket.data.role)) return fail(socket, ack, 'forbidden');
      reply(ack, { ok: true, ...screensHub.watch(socket) });
    });
    socket.on('live:leave', (payload, ack) => {
      if (!refresh(socket)) return;
      leaveRoom(socket);
      reply(ack, { ok: true });
    });
    socket.on('disconnect', () => {
      if (socket.data.eventId) schedulePresence(socket.data.adminId, socket.data.eventId);
    });
  }

  function attach(server) {
    io = server;
    // Handshake: a valid session (active user) or the connection is refused.
    io.use((socket, next) => {
      const session = auth.getSession(socket.request);
      if (!session) return next(new Error('unauthenticated'));
      socket.data = {
        sessionId: session.sessionId,
        userId: session.user.id,
        adminId: session.admin.id,
        role: session.user.role,
        lang: resolveLang(socket.request),
        eventId: null,
      };
      next();
    });
    io.on('connection', onConnection);
    // Catches sessions that expired or users deactivated while connected and idle.
    setInterval(() => {
      for (const socket of io.sockets.sockets.values()) refresh(socket);
    }, SESSION_SWEEP_MS).unref();
  }

  // Logout: close every socket of that session right away.
  function closeSession(sessionId) {
    if (!io) return;
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.sessionId === sessionId) socket.disconnect(true);
    }
  }

  // A user was deactivated (or removed): close all their sockets.
  function closeUser(userId) {
    if (!io) return;
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.userId === userId) socket.disconnect(true);
    }
  }

  // --- changes made through the HTTP API ------------------------------------------

  // Call before a setlist is saved; pass the result to setlistChanged afterwards.
  function setlistBefore(adminId, eventId) {
    return store.layout(adminId, eventId);
  }

  // The setlist was saved: a live event clamps its position (new version); either way the
  // room gets the new snapshot, whose setlistKey tells clients to reload the setlist.
  function setlistChanged(adminId, eventId, before) {
    if (!io) return;
    store.setlistChanged(adminId, eventId, before);
    broadcast(adminId, eventId);
  }

  // Call before a song is edited or deleted (a deleted song leaves its items without a
  // song id, so they must be found first). No songId: every live event of the admin
  // (a library import that updates many songs).
  function songBefore(adminId, songId) {
    return store.liveEventsWithSongId(adminId, songId).map((eventId) => ({ eventId, layout: store.layout(adminId, eventId) }));
  }

  function songChanged(adminId, before) {
    for (const { eventId, layout } of before) setlistChanged(adminId, eventId, layout);
  }

  // Status or details changed, or the event was deleted: sockets that may no longer see it
  // leave the room (live:gone); the others get the new snapshot.
  function eventChanged(adminId, eventId) {
    if (!io) return;
    const room = roomName(adminId, eventId);
    for (const id of [...(io.sockets.adapter.rooms.get(room) || [])]) {
      const socket = io.sockets.sockets.get(id);
      if (socket && !store.visibleEvent(adminId, eventId, socket.data.role)) {
        socket.leave(room);
        socket.data.eventId = null;
        socket.emit('live:gone', { eventId });
      }
    }
    broadcast(adminId, eventId);
    schedulePresence(adminId, eventId);
  }

  return { attach, closeSession, closeUser, roomName, setlistBefore, setlistChanged, songBefore, songChanged, eventChanged };
}

module.exports = { createLiveHub, roomName };
