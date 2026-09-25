'use strict';

// Live rooms over socket.io. Every socket is authenticated with the wa_sid session cookie;
// a socket joins at most one event room, "admin:<adminId>:event:<eventId>", and receives
// full `live:state` snapshots from the server (the single source of truth).

const { createLiveStore } = require('../lib/live');
const { resolveLang, t: translate } = require('../lib/i18n');

const ROLES = ['owner', 'leader', 'operator', 'member'];
const PRESENCE_DEBOUNCE_MS = 1000;
const SESSION_SWEEP_MS = 30 * 1000;

const roomName = (adminId, eventId) => `admin:${adminId}:event:${eventId}`;

// Created before the HTTP routes (they notify it), attached to socket.io once it exists.
function createLiveHub({ db, auth, logger }) {
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

  function onConnection(socket) {
    logger.debug(`socket ${socket.id} connected: user #${socket.data.userId} (admin #${socket.data.adminId})`);
    socket.on('live:join', (payload, ack) => onJoin(socket, payload, ack));
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

  return { attach, closeSession, closeUser, roomName };
}

module.exports = { createLiveHub, roomName };
