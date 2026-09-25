'use strict';

// Live rooms over socket.io. Every socket is authenticated with the wa_sid session cookie;
// a socket joins at most one event room, "admin:<adminId>:event:<eventId>", and receives
// full `live:state` snapshots from the server (the single source of truth).

const { LiveError, createLiveStore } = require('../lib/live');
const { EVENT_ROLES } = require('../lib/events');
const { resolveLang, t: translate } = require('../lib/i18n');

const ROLES = ['owner', 'leader', 'operator', 'member'];
const PRESENCE_DEBOUNCE_MS = 1000;
const SESSION_SWEEP_MS = 30 * 1000;

const COMMANDS = ['event.start', 'event.end', 'worship.next', 'worship.prev', 'worship.goto',
  'live.mode', 'team.mode',
  'projector.next', 'projector.prev', 'projector.goto', 'projector.syncToWorship', 'projector.source',
  'video.prepare', 'video.play', 'video.pause', 'video.restart', 'video.stop', 'video.volume',
  'operator.addItem'];
// Roles that may send commands at all; the store decides the rest (lib/live.js permission).
const COMMAND_ROLES = EVENT_ROLES;

const roomName = (adminId, eventId) => `admin:${adminId}:event:${eventId}`;
// Home pages ("Acum") of an admin: told when an event starts, ends or changes status.
const homeRoom = (adminId) => `admin:${adminId}:home`;
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

  // role, lang: the receiver's. The event roles also get every item (with the projector-only
  // ones, section labels in their language); team phones never see those.
  function fullSnapshot(adminId, eventId, role, lang) {
    const state = store.snapshot(adminId, eventId);
    if (!state) return null;
    const extra = COMMAND_ROLES.includes(role)
      ? { items: store.items(adminId, eventId, 'all', (key, vars) => translate(key, vars, lang)) }
      : {};
    return { ...state, ...extra, presence: presence(roomName(adminId, eventId)), serverTime: Date.now() };
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
    socket.data.mustChangePassword = session.user.mustChangePassword;
    return true;
  }

  function reply(ack, payload) {
    if (typeof ack === 'function') ack(payload);
  }

  // A valid session that may use live mode (not one with a temporary password to change).
  function ready(socket, ack) {
    if (!refresh(socket)) return false;
    if (!socket.data.mustChangePassword) return true;
    reply(ack, { ok: false, code: 'mustChangePassword', error: tr(socket, 'errors.mustChangePassword') });
    return false;
  }

  function onJoin(socket, payload, ack) {
    if (!ready(socket, ack)) return;
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
    const state = fullSnapshot(adminId, eventId, role, socket.data.lang);
    socket.emit('live:state', state);
    reply(ack, { ok: true, version: state.version });
  }

  // Every change goes to the event room and, if it changes what the projector shows, to
  // the admin's screens.
  function broadcast(adminId, eventId) {
    const room = roomName(adminId, eventId);
    const team = fullSnapshot(adminId, eventId, 'member');
    if (team) {
      const full = new Map(); // one per language
      for (const id of io.sockets.adapter.rooms.get(room) || []) {
        const socket = io.sockets.sockets.get(id);
        if (!socket) continue;
        if (!COMMAND_ROLES.includes(socket.data.role)) {
          socket.emit('live:state', team);
          continue;
        }
        const { lang } = socket.data;
        if (!full.has(lang)) full.set(lang, fullSnapshot(adminId, eventId, 'owner', lang));
        socket.emit('live:state', full.get(lang));
      }
    }
    screensHub.update(adminId);
  }

  // A short info for the other event-role pages in the room ("<name> a adăugat <title>");
  // never for team phones (a projector-only item is not theirs to see), nor for the page that
  // made the change (it shows its own confirmation).
  function notice(adminId, eventId, payload, fromSocketId) {
    for (const id of io.sockets.adapter.rooms.get(roomName(adminId, eventId)) || []) {
      const socket = io.sockets.sockets.get(id);
      if (socket && id !== fromSocketId && COMMAND_ROLES.includes(socket.data.role)) socket.emit('live:notice', { eventId, ...payload });
    }
  }

  function notifyHome(adminId, eventId) {
    io.to(homeRoom(adminId)).emit('home:changed', { eventId });
  }

  function fail(socket, ack, code, extra) {
    reply(ack, { ok: false, code, error: tr(socket, `live.errors.${code}`), ...extra });
  }

  // live:command { type, eventId, expectedVersion?, itemId?, step? } -> ack { ok, version }
  // or { ok: false, code, error } (+ state when the expected version was stale).
  function onCommand(socket, payload, ack) {
    if (!ready(socket, ack)) return;
    const cmd = payload && typeof payload === 'object' ? payload : {};
    const { adminId, role, userId } = socket.data;
    if (!COMMANDS.includes(cmd.type) || !isId(cmd.eventId)) return fail(socket, ack, 'badCommand');
    if (!COMMAND_ROLES.includes(role)) return fail(socket, ack, 'forbidden');
    if (!store.visibleEvent(adminId, cmd.eventId, role)) return fail(socket, ack, 'notFound');
    if (socket.data.eventId !== cmd.eventId) return fail(socket, ack, 'notJoined');
    const expected = cmd.expectedVersion;
    if (expected !== undefined && expected !== null && !Number.isInteger(expected)) return fail(socket, ack, 'badCommand');
    if ((cmd.type === 'worship.goto' || cmd.type === 'projector.goto') && (!isId(cmd.itemId) || !Number.isInteger(cmd.step))) {
      return fail(socket, ack, 'badPosition');
    }
    // Pausing keeps the position the screens last reported.
    const command = cmd.type === 'video.pause' ? { ...cmd, position: screensHub.lastVideoPosition(adminId) } : cmd;
    let result;
    try {
      result = store.command(adminId, cmd.eventId, command, expected, role);
    } catch (err) {
      if (!(err instanceof LiveError)) throw err;
      if (err.code === 'stale') return fail(socket, ack, 'stale', { state: fullSnapshot(adminId, cmd.eventId, role, socket.data.lang) });
      return fail(socket, ack, err.code);
    }
    if (cmd.type === 'event.start' || cmd.type === 'event.end') {
      logger.info(`Event #${cmd.eventId} ${cmd.type === 'event.start' ? 'started' : 'ended'} by user #${userId} (admin #${adminId})`);
    }
    if (result.changed) broadcast(adminId, cmd.eventId);
    if (result.notice) notice(adminId, cmd.eventId, { ...result.notice, by: socket.data.userName, byUserId: userId }, socket.id);
    if (result.changed && (cmd.type === 'event.start' || cmd.type === 'event.end')) notifyHome(adminId, cmd.eventId);
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
    // The leader's projector panel and the operator console: the frame the screens show and
    // how many are connected.
    socket.on('projector:watch', (payload, ack) => {
      if (!ready(socket, ack)) return;
      if (!COMMAND_ROLES.includes(socket.data.role)) return fail(socket, ack, 'forbidden');
      reply(ack, { ok: true, ...screensHub.watch(socket) });
    });
    // The home page: an admin-level room, no event room needed.
    socket.on('home:watch', (payload, ack) => {
      if (!ready(socket, ack)) return;
      socket.join(homeRoom(socket.data.adminId));
      reply(ack, { ok: true });
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
        userName: session.user.name,
        adminId: session.admin.id,
        role: session.user.role,
        lang: resolveLang(socket.request),
        mustChangePassword: session.user.mustChangePassword,
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
    return store.layouts(adminId, eventId);
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
    return store.liveEventsWithSongId(adminId, songId).map((eventId) => ({ eventId, layout: store.layouts(adminId, eventId) }));
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
    notifyHome(adminId, eventId);
  }

  return { attach, closeSession, closeUser, roomName, setlistBefore, setlistChanged, songBefore, songChanged, eventChanged };
}

module.exports = { createLiveHub, roomName };
