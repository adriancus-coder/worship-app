'use strict';

// Projector screens over socket.io, in their own namespace "/screens". A screen connects
// with its screen token (handshake auth.token), never a user session, and joins
// "admin:<adminId>:screens". It receives `projector:frame` when it connects and whenever
// what the admin's projector shows changes (worship moves, source, setlist, start / end).

const { createScreenStore } = require('../lib/screens');
const { createLiveStore } = require('../lib/live');
const { createEventStore } = require('../lib/events');
const { createAdminSettings } = require('../lib/admin-settings');
const { projectorFrame } = require('../lib/projector');

const NAMESPACE = '/screens';
const SEEN_EVERY_MS = 60 * 1000;

const screensRoom = (adminId) => `admin:${adminId}:screens`;
// Owner / leader pages watching the projector (main namespace): same frames, screen count.
const watchersRoom = (adminId) => `admin:${adminId}:projector`;

function createScreensHub({ db, logger }) {
  const screens = createScreenStore(db);
  const live = createLiveStore(db);
  const events = createEventStore(db);
  const settings = createAdminSettings(db);
  const lastSent = new Map(); // adminId -> JSON of the last frame (without its version)
  let nsp = null;
  let mainIo = null;

  function logoUrl(adminId) {
    const file = settings.get(adminId, 'logo');
    return file ? `/api/logo/${file}` : null;
  }

  // The frame the admin's screens should show now.
  function frameFor(adminId) {
    const eventId = live.liveEventId(adminId);
    if (!eventId) return projectorFrame(null, null, null, { logoUrl: logoUrl(adminId) });
    const state = live.snapshot(adminId, eventId);
    const found = events.get(adminId, eventId);
    const songs = new Map();
    const current = found && found.items.find((it) => it.id === state.worship.itemId);
    if (current && current.type === 'song' && current.songId) {
      const ready = events.itemSong(adminId, eventId, current.id);
      if (ready) songs.set(current.id, ready.song);
    }
    return projectorFrame(state, found, songs, { logoUrl: logoUrl(adminId) });
  }

  const withoutVersion = (frame) => JSON.stringify({ ...frame, version: undefined });

  // Something the projector may show changed: send the new frame if it differs.
  function update(adminId) {
    if (!nsp) return;
    const frame = frameFor(adminId);
    const key = withoutVersion(frame);
    if (lastSent.get(adminId) === key) return;
    lastSent.set(adminId, key);
    nsp.to(screensRoom(adminId)).emit('projector:frame', frame);
    mainIo.to(watchersRoom(adminId)).emit('projector:frame', frame);
  }

  function socketsOf(adminId) {
    return [...(nsp ? nsp.sockets.values() : [])].filter((s) => s.data.adminId === adminId);
  }

  function screenCount(adminId) {
    return onlineIds(adminId).size;
  }

  function sendCount(adminId) {
    if (mainIo) mainIo.to(watchersRoom(adminId)).emit('projector:screens', { count: screenCount(adminId) });
  }

  // An owner / leader page (main namespace socket) starts watching the projector.
  function watch(socket) {
    const { adminId } = socket.data;
    socket.join(watchersRoom(adminId));
    return { frame: frameFor(adminId), screens: screenCount(adminId) };
  }

  // Ids of the admin's screens that are connected now.
  function onlineIds(adminId) {
    return new Set(socketsOf(adminId).map((s) => s.data.screenId));
  }

  // A revoked screen is disconnected at once.
  function revoked(adminId, screenId) {
    for (const socket of socketsOf(adminId)) {
      if (socket.data.screenId === screenId) {
        socket.emit('screen:revoked');
        socket.disconnect(true);
      }
    }
  }

  function attach(io) {
    mainIo = io;
    nsp = io.of(NAMESPACE);
    nsp.use((socket, next) => {
      const screen = screens.findByToken(socket.handshake.auth && socket.handshake.auth.token);
      if (!screen) return next(new Error('unauthorized'));
      socket.data = { screenId: screen.id, adminId: screen.adminId };
      next();
    });
    nsp.on('connection', (socket) => {
      const { adminId, screenId } = socket.data;
      screens.touch(screenId);
      socket.join(screensRoom(adminId));
      socket.emit('screen:hello', { screen: { id: screenId } });
      socket.emit('projector:frame', frameFor(adminId));
      sendCount(adminId);
      socket.on('disconnect', () => sendCount(adminId));
      logger.debug(`screen #${screenId} connected (admin #${adminId})`);
    });
    // last_seen_at while connected; a screen revoked meanwhile is dropped.
    setInterval(() => {
      for (const socket of nsp.sockets.values()) {
        const screen = screens.findByToken(socket.handshake.auth.token);
        if (!screen) socket.disconnect(true);
        else screens.touch(screen.id);
      }
    }, SEEN_EVERY_MS).unref();
  }

  return { attach, update, frameFor, onlineIds, revoked, watch };
}

module.exports = { NAMESPACE, screensRoom, createScreensHub };
