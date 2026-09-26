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
const { parseVideoUrl, playable, createMediaSigner } = require('../lib/media');
const { createBackgroundStore } = require('../lib/backgrounds');

const NAMESPACE = '/screens';
const SEEN_EVERY_MS = 60 * 1000;

const screensRoom = (adminId) => `admin:${adminId}:screens`;
// Owner / leader pages watching the projector (main namespace): same frames, screen count.
const watchersRoom = (adminId) => `admin:${adminId}:projector`;

const VIDEO_STATES = ['loading', 'ready', 'playing', 'paused', 'ended', 'error', 'waiting'];

function createScreensHub({ db, logger, config }) {
  const screens = createScreenStore(db);
  const live = createLiveStore(db);
  const events = createEventStore(db);
  const settings = createAdminSettings(db);
  const lastSent = new Map(); // adminId -> JSON of the last frame (without its version)
  const signer = createMediaSigner(config.DATA_DIR);
  const backgrounds = createBackgroundStore(db, signer);
  const selectMedia = db.prepare('SELECT * FROM media WHERE id = ? AND admin_id = ?');
  const videoStatus = new Map(); // adminId -> Map(screenId -> last playback status of that screen)
  const patterns = new Map(); // screenId -> the labels of the test pattern it shows (until closed / the next live frame)
  let onVideoEvent = () => {};
  let nsp = null;
  let mainIo = null;

  // How the prepared video is played, for the frame (null when nothing is prepared).
  function videoMedia(adminId, video, items) {
    if (!video || video.state === 'none') return null;
    if (video.local) return { type: 'local', name: video.localName };
    if (video.mediaId) {
      const row = selectMedia.get(video.mediaId, adminId);
      return row ? playable(row, (id) => signer.url(adminId, id)) : null;
    }
    const item = items.find((it) => it.id === video.itemId);
    if (!item || !item.url) return null;
    const parsed = parseVideoUrl(item.url);
    if (!parsed || parsed.kind === 'file') return { type: 'file', src: item.url, title: item.title || '' };
    return { type: parsed.kind, id: parsed.id, title: item.title || '' };
  }

  function logoUrl(adminId) {
    const file = settings.get(adminId, 'logo');
    return file ? `/api/logo/${file}` : null;
  }

  // The church default clock, for the idle screen (a live event carries its own).
  function clockDefaults(adminId) {
    return { ...settings.clock(adminId), timeZone: settings.timezone(adminId), format: settings.timeFormat(adminId) };
  }

  // The frame the admin's screens should show now (with the church safe margin; a screen with
  // its own margin gets it swapped in, see sendFrame).
  function frameFor(adminId) {
    const eventId = live.liveEventId(adminId);
    const safeMargin = settings.safeMargin(adminId);
    if (!eventId) return projectorFrame(null, null, null, { logoUrl: logoUrl(adminId), clock: clockDefaults(adminId), safeMargin });
    const state = live.snapshot(adminId, eventId);
    const found = events.get(adminId, eventId, { scope: 'all' }); // the operator's items too
    const songs = new Map();
    // The item on the projector: the operator's position in operator mode, else worship's.
    const at = state.projector.follows === 'operator' ? state.projector.itemId : state.worship.itemId;
    const current = found && found.items.find((it) => it.id === at);
    if (current && current.type === 'song' && current.songId) {
      const ready = events.itemSong(adminId, eventId, current.id, undefined, { scope: 'all' });
      if (ready) songs.set(current.id, ready.song);
    }
    return projectorFrame(state, found, songs, {
      safeMargin,
      logoUrl: logoUrl(adminId),
      videoMedia: videoMedia(adminId, state.video, found ? found.items : []),
      backgrounds: backgrounds.forEvent(adminId, eventId, state.backgroundOverride),
    });
  }

  const withoutVersion = (frame) => JSON.stringify({ ...frame, version: undefined });

  // The frame as one screen shows it: its own safe margin when it has one.
  function forScreen(frame, socket) {
    const own = socket.data.safeMargin;
    return own === null || own === undefined ? frame : { ...frame, safeMargin: own };
  }

  // "Ecran de test" (calibrating the projector): a special frame for ONE screen, with the
  // screen's margin; the screen renders the border, the markers and its resolution. It stays
  // until the operator closes it or the next live frame (update) arrives.
  function patternFrame(adminId, socket, labels) {
    return forScreen({ kind: 'pattern', version: 0, eventId: null, background: null, clock: null, safeMargin: settings.safeMargin(adminId), labels }, socket);
  }

  // on: labels { resolution, margin, name } (the operator's language); off: the current frame again.
  function testPattern(adminId, screenId, labels) {
    if (labels) patterns.set(screenId, labels);
    else patterns.delete(screenId);
    for (const socket of socketsOf(adminId)) {
      if (socket.data.screenId !== screenId) continue;
      socket.emit('projector:frame', labels ? patternFrame(adminId, socket, labels) : forScreen(frameFor(adminId), socket));
    }
    return patterns.has(screenId);
  }
  const showsPattern = (screenId) => patterns.has(screenId);

  // Something the projector may show changed: send the new frame if it differs.
  function update(adminId) {
    if (!nsp) return;
    const frame = frameFor(adminId);
    const key = withoutVersion(frame);
    if (lastSent.get(adminId) === key) return;
    lastSent.set(adminId, key);
    for (const socket of socketsOf(adminId)) {
      patterns.delete(socket.data.screenId); // a live frame replaces a test pattern
      socket.emit('projector:frame', forScreen(frame, socket));
    }
    mainIo.to(watchersRoom(adminId)).emit('projector:frame', frame);
  }

  // The church safe margin or one screen's changed: the screens re-read theirs and get the
  // current frame again (the watchers too, for the church value).
  function marginChanged(adminId, screenId = null) {
    if (!nsp) return;
    const frame = frameFor(adminId);
    lastSent.set(adminId, withoutVersion(frame));
    for (const socket of socketsOf(adminId)) {
      if (screenId !== null && socket.data.screenId !== screenId) continue;
      const screen = screens.get(adminId, socket.data.screenId);
      socket.data.safeMargin = screen ? screen.safeMargin : null;
      const labels = patterns.get(socket.data.screenId);
      socket.emit('projector:frame', labels ? patternFrame(adminId, socket, labels) : forScreen(frame, socket));
    }
    if (screenId === null) mainIo.to(watchersRoom(adminId)).emit('projector:frame', frame);
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
    return {
      frame: frameFor(adminId),
      screens: screenCount(adminId),
      videoStatus: [...(videoStatus.get(adminId) || new Map()).values()],
      logoUrl: logoUrl(adminId), // for pages that compute frames themselves (public/frames.js)
      safeMargin: settings.safeMargin(adminId), // the same pages' frames carry it too
      adminId, // names the BroadcastChannel to this admin's projector windows (emergency mode)
    };
  }

  // Playback reported by a screen (at most once a second): relayed to the watchers, kept in
  // memory only. "ended" and a chosen local file become live state changes.
  function onScreenVideoStatus(socket, payload) {
    const { adminId, screenId } = socket.data;
    if (!payload || typeof payload !== 'object' || !VIDEO_STATES.includes(payload.state)) return;
    // At most one progress report a second per screen; a state change always goes through.
    const now = Date.now();
    if (socket.data.lastVideoState === payload.state && now - (socket.data.lastVideoAt || 0) < 900) return;
    socket.data.lastVideoState = payload.state;
    socket.data.lastVideoAt = now;
    const status = {
      screenId,
      state: payload.state,
      position: Number.isFinite(payload.position) ? Math.max(0, payload.position) : 0,
      duration: Number.isFinite(payload.duration) ? Math.max(0, payload.duration) : null,
      error: typeof payload.error === 'string' ? payload.error.slice(0, 40) : null,
      seq: Number.isInteger(payload.seq) ? payload.seq : null,
      at: Date.now(),
    };
    if (!videoStatus.has(adminId)) videoStatus.set(adminId, new Map());
    videoStatus.get(adminId).set(screenId, status);
    mainIo.to(watchersRoom(adminId)).emit('projector:video-status', status);
    if (status.state === 'ended') onVideoEvent(adminId, { type: 'video.ended' });
  }

  function onScreenVideoLocal(socket, payload) {
    const name = payload && typeof payload.name === 'string' ? payload.name.trim() : '';
    if (name) onVideoEvent(socket.data.adminId, { type: 'video.localChosen', name });
  }

  // The live hub applies video events coming from screens.
  function setVideoHandler(handler) {
    onVideoEvent = handler;
  }

  // Where the video is, for a pause: the furthest position any screen reported.
  function lastVideoPosition(adminId) {
    const all = [...(videoStatus.get(adminId) || new Map()).values()];
    return all.length ? Math.max(...all.map((s) => s.position)) : null;
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
      if (!screen.adminActive) return next(new Error('suspended')); // deactivated church: retries later
      socket.data = { screenId: screen.id, adminId: screen.adminId, safeMargin: screen.safeMargin };
      next();
    });
    nsp.on('connection', (socket) => {
      const { adminId, screenId } = socket.data;
      screens.touch(screenId);
      socket.join(screensRoom(adminId));
      socket.emit('screen:hello', { screen: { id: screenId }, adminId });
      socket.emit('projector:frame', forScreen(frameFor(adminId), socket));
      sendCount(adminId);
      socket.on('screen:video-status', (payload) => onScreenVideoStatus(socket, payload));
      socket.on('screen:video-local', (payload) => onScreenVideoLocal(socket, payload));
      socket.on('disconnect', () => {
        patterns.delete(screenId);
        if (videoStatus.has(adminId)) videoStatus.get(adminId).delete(screenId);
        sendCount(adminId);
      });
      logger.debug(`screen #${screenId} connected (admin #${adminId})`);
    });
    // last_seen_at while connected; a screen revoked meanwhile is dropped.
    setInterval(() => {
      for (const socket of nsp.sockets.values()) {
        const screen = screens.findByToken(socket.handshake.auth.token);
        if (!screen || !screen.adminActive) socket.disconnect(true);
        else screens.touch(screen.id);
      }
    }, SEEN_EVERY_MS).unref();
  }

  // A church deactivated from the platform page: its screens are told and dropped at once
  // (they keep their tokens and try again every 30 s until it is reactivated).
  function suspend(adminId) {
    for (const socket of socketsOf(adminId)) {
      socket.emit('screen:suspended');
      socket.disconnect(true);
    }
  }

  // The resolved backgrounds of an event, for the live snapshots of the event roles (their
  // pages compute the same frames offline) and the editor's "Implicit (…)".
  const backgroundsFor = (adminId, eventId, override) => backgrounds.forEvent(adminId, eventId, override);

  return { attach, update, marginChanged, testPattern, showsPattern, frameFor, onlineIds, revoked, suspend, watch, setVideoHandler, lastVideoPosition, backgroundsFor };
}

module.exports = { NAMESPACE, screensRoom, createScreensHub };
