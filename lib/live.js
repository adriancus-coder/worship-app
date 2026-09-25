'use strict';

// Live state of an event (stage 4): the worship position the team follows, plus the
// projector fields stage 5 will use. Rows live in live_state; an event that never went
// live has no row and reads as version 0 with no position. Positions and layouts: see
// public/positions.js.

const crypto = require('crypto');
const { VISIBLE_TO_TEAM, createEventStore } = require('./events');
const { LEADER_SOURCES } = require('./projector');
const {
  NO_POSITION, layoutOf, firstPosition, samePosition, nextPosition, prevPosition, gotoPosition, clampPosition,
} = require('../public/positions.js');

const EDITOR_ROLES = ['owner', 'leader'];
// Commands that move the projector position: only while an operator controls the projector.
const PROJECTOR_COMMANDS = ['projector.next', 'projector.prev', 'projector.goto', 'projector.syncToWorship'];

// Who may send a command, given who controls the projector ('worship' | 'operator').
// null = allowed, else the error code. No role = the server itself (screen reports).
//   owner, leader  everything; the projector position only in operator mode
//   operator       projector position, source and video, only in operator mode
//   member         nothing
function permission(role, type, follows) {
  if (!role) return null;
  const operatorMode = follows === 'operator';
  const projectorSide = PROJECTOR_COMMANDS.includes(type) || type === 'projector.source' || type.startsWith('video.');
  if (EDITOR_ROLES.includes(role)) return PROJECTOR_COMMANDS.includes(type) && !operatorMode ? 'notOperatorMode' : null;
  if (role === 'operator' && projectorSide) return operatorMode ? null : 'notOperatorMode';
  return 'forbidden';
}
const NO_VIDEO = Object.freeze({ mediaId: null, itemId: null, local: false, localName: null, state: 'none', position: 0, volume: 1, seq: 0 });

function numberIn(value, min, max, fallback) {
  return typeof value === 'number' && value >= min && value <= max ? value : fallback;
}

// The video part of a live_state row (a local file has neither a media id nor an item id).
function videoOf(row) {
  if (!row || !row.video_state || row.video_state === 'none') return { ...NO_VIDEO, seq: row ? row.video_seq || 0 : 0, volume: row ? row.video_volume ?? 1 : 1 };
  return {
    mediaId: row.video_media_id,
    itemId: row.video_item_id,
    local: row.video_media_id === null && row.video_item_id === null,
    localName: row.video_local_name,
    state: row.video_state,
    position: row.video_position_s,
    volume: row.video_volume,
    seq: row.video_seq,
  };
}

// Changes whenever what the team sees of the setlist changes (items, order, songs, keys,
// arrangements): clients reload the event when it does.
function setlistKey(items) {
  const essence = items.map((it) => [it.id, it.type, it.songId, it.mediaId, it.title, it.body, it.reference, it.url,
    it.transpose, (it.arrangementResolved || []).map((r) => r.sectionId)]);
  return crypto.createHash('sha1').update(JSON.stringify(essence)).digest('hex').slice(0, 12);
}

// --- store ------------------------------------------------------------------------

class LiveError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function createLiveStore(db) {
  const events = createEventStore(db);
  const selectEvent = db.prepare('SELECT id, status, is_template FROM events WHERE id = ? AND admin_id = ?');
  const selectState = db.prepare('SELECT * FROM live_state WHERE event_id = ? AND admin_id = ?');
  const upsertState = db.prepare(`INSERT INTO live_state
      (event_id, admin_id, version, worship_item_id, worship_step, projector_follows, projector_item_id, projector_step,
        projector_source, started_at, updated_at,
        video_media_id, video_item_id, video_local_name, video_state, video_position_s, video_volume, video_seq, video_updated_at)
    VALUES (@eventId, @adminId, @version, @itemId, @step, @follows, @projectorItemId, @projectorStep, @source, @startedAt, @now,
        @videoMediaId, @videoItemId, @videoLocalName, @videoState, @videoPosition, @videoVolume, @videoSeq, @videoUpdatedAt)
    ON CONFLICT (event_id) DO UPDATE SET version = @version, worship_item_id = @itemId,
      worship_step = @step, projector_follows = @follows, projector_item_id = @projectorItemId,
      projector_step = @projectorStep, projector_source = @source, started_at = @startedAt, updated_at = @now,
      video_media_id = @videoMediaId, video_item_id = @videoItemId, video_local_name = @videoLocalName,
      video_state = @videoState, video_position_s = @videoPosition, video_volume = @videoVolume,
      video_seq = @videoSeq, video_updated_at = @videoUpdatedAt`);
  const selectMedia = db.prepare('SELECT id FROM media WHERE id = ? AND admin_id = ?');
  const otherLive = db.prepare("SELECT id FROM events WHERE admin_id = ? AND status = 'live' AND id <> ? LIMIT 1");
  const setStatus = db.prepare('UPDATE events SET status = ?, updated_at = ? WHERE id = ? AND admin_id = ?');
  const liveEvents = db.prepare("SELECT id FROM events WHERE admin_id = ? AND status = 'live'");
  const liveEventsWithSong = db.prepare(`SELECT DISTINCT e.id FROM events e
    JOIN setlist_items i ON i.event_id = e.id AND i.admin_id = e.admin_id
    WHERE e.admin_id = ? AND e.status = 'live' AND i.song_id = ?`);

  // The event row if this role may see it (same rules as GET /api/events/:id), else null.
  function visibleEvent(adminId, eventId, role) {
    const row = selectEvent.get(eventId, adminId);
    if (!row) return null;
    if (!EDITOR_ROLES.includes(role) && (row.is_template || !VISIBLE_TO_TEAM.includes(row.status))) return null;
    return row;
  }

  function items(adminId, eventId) {
    const found = events.get(adminId, eventId);
    return found ? found.items : [];
  }

  function layout(adminId, eventId) {
    return layoutOf(items(adminId, eventId));
  }

  // Full state snapshot (without presence) or null when the event does not exist.
  function snapshot(adminId, eventId) {
    const event = selectEvent.get(eventId, adminId);
    if (!event) return null;
    const row = selectState.get(eventId, adminId);
    return {
      version: row ? row.version : 0,
      eventId,
      status: event.status,
      startedAt: row ? row.started_at : null,
      setlistKey: setlistKey(items(adminId, eventId)),
      worship: { itemId: row ? row.worship_item_id : null, step: row ? row.worship_step : 0 },
      // The projector follows worship until the leader hands it to the operator.
      projector: {
        follows: row ? row.projector_follows : 'worship',
        itemId: row ? row.projector_item_id : null,
        step: row ? row.projector_step : 0,
        source: row ? row.projector_source : 'content',
      },
      video: videoOf(row),
    };
  }

  // Runs change(context) in a transaction and stores the result with version + 1.
  // context: { event, row, position, projector, video, layout }; change returns { position?,
  // projector? ({ follows?, itemId?, step? }), status?, start?, source?, video? (the whole next
  // video state) },
  // or { noop: true } to leave everything (version included) as it is,
  // or throws LiveError. expectedVersion (optional) must match the stored version.
  const apply = db.transaction((adminId, eventId, expectedVersion, change) => {
    const event = selectEvent.get(eventId, adminId);
    if (!event) throw new LiveError('notFound');
    const row = selectState.get(eventId, adminId);
    const version = row ? row.version : 0;
    if (expectedVersion !== undefined && expectedVersion !== null && expectedVersion !== version) {
      throw new LiveError('stale');
    }
    const position = { itemId: row ? row.worship_item_id : null, step: row ? row.worship_step : 0 };
    const projector = {
      follows: row ? row.projector_follows : 'worship',
      itemId: row ? row.projector_item_id : null,
      step: row ? row.projector_step : 0,
    };
    const video = videoOf(row);
    const result = change({ event, row, position, projector, video, layout: layout(adminId, eventId) });
    if (result.noop) return { version, changed: false }; // e.g. "next" on the last step
    const now = Date.now();
    const next = result.position || position;
    const proj = { ...projector, ...(result.projector || {}) };
    const v = result.video || video;
    upsertState.run({
      eventId, adminId, version: version + 1, itemId: next.itemId, step: next.step,
      follows: proj.follows, projectorItemId: proj.itemId, projectorStep: proj.step,
      source: result.source || (row ? row.projector_source : 'content'),
      startedAt: result.start ? now : (row ? row.started_at : null), now,
      videoMediaId: v.mediaId, videoItemId: v.itemId, videoLocalName: v.localName, videoState: v.state,
      videoPosition: v.position, videoVolume: v.volume, videoSeq: v.seq,
      videoUpdatedAt: result.video ? now : (row ? row.video_updated_at : null),
    });
    if (result.status && result.status !== event.status) setStatus.run(result.status, now, eventId, adminId);
    return { version: version + 1, changed: true };
  });

  // Live commands. role: the sender's role (checked against who controls the projector, in
  // the same transaction); none for the server's own events. Returns { version, changed };
  // throws LiveError.
  function command(adminId, eventId, cmd, expectedVersion, role) {
    return apply(adminId, eventId, expectedVersion, ({ event, row, position, projector, video, layout: lay }) => {
      const refused = permission(role, cmd.type, projector.follows);
      if (refused) throw new LiveError(refused);
      if (cmd.type.startsWith('projector.') && cmd.type !== 'projector.source') {
        if (event.status !== 'live') throw new LiveError('notLive');
        return projectorCommand(cmd, position, projector, lay);
      }
      if (cmd.type.startsWith('video.')) {
        if (event.status !== 'live') throw new LiveError('notLive');
        return videoCommand(adminId, eventId, cmd, video, (row && row.projector_source) || 'content');
      }
      if (event.is_template) throw new LiveError('notFound');
      switch (cmd.type) {
        case 'event.start':
          if (event.status === 'draft') throw new LiveError('notPublished');
          if (event.status === 'live') throw new LiveError('alreadyLive');
          if (event.status === 'finished') throw new LiveError('finished');
          // One live event per admin: the projector shows only one.
          if (otherLive.get(adminId, eventId)) throw new LiveError('anotherLive');
          return {
            status: 'live', start: true, position: firstPosition(lay), source: 'content',
            projector: { follows: 'worship', itemId: null, step: 0 }, video: { ...NO_VIDEO, seq: video.seq },
          };
        case 'event.end':
          if (event.status !== 'live') throw new LiveError('notLive');
          return { status: 'finished' };
        case 'worship.next':
        case 'worship.prev':
        case 'worship.goto': {
          if (event.status !== 'live') throw new LiveError('notLive');
          let target;
          if (cmd.type === 'worship.next') target = nextPosition(lay, position);
          else if (cmd.type === 'worship.prev') target = prevPosition(lay, position);
          else target = gotoPosition(lay, cmd.itemId, cmd.step);
          if (!target) throw new LiveError('badPosition');
          return samePosition(target, position) ? { noop: true } : { position: target };
        }
        case 'projector.source':
          if (event.status !== 'live') throw new LiveError('notLive');
          if (!LEADER_SOURCES.includes(cmd.source)) throw new LiveError('badCommand');
          return cmd.source === ((row && row.projector_source) || 'content') ? { noop: true } : { source: cmd.source };
        default:
          throw new LiveError('badCommand');
      }
    });
  }

  // Who controls the projector, and the projector position in operator mode. Worship
  // commands never move it; in worship mode the projector shows the worship position.
  function projectorCommand(cmd, worship, projector, lay) {
    if (cmd.type === 'projector.follow') {
      if (!['worship', 'operator'].includes(cmd.mode)) throw new LiveError('badCommand');
      if (cmd.mode === projector.follows) return { noop: true };
      // Taking over starts where worship is; handing back shows the worship position at once.
      return cmd.mode === 'operator'
        ? { projector: { follows: 'operator', itemId: worship.itemId, step: worship.step } }
        : { projector: { follows: 'worship' } };
    }
    const pos = { itemId: projector.itemId, step: projector.step };
    let target;
    if (cmd.type === 'projector.next') target = nextPosition(lay, pos);
    else if (cmd.type === 'projector.prev') target = prevPosition(lay, pos);
    else if (cmd.type === 'projector.goto') target = gotoPosition(lay, cmd.itemId, cmd.step);
    else if (cmd.type === 'projector.syncToWorship') target = { ...worship };
    else throw new LiveError('badCommand');
    if (!target) throw new LiveError('badPosition');
    return samePosition(target, pos) ? { noop: true } : { projector: { itemId: target.itemId, step: target.step } };
  }

  // Video commands. Preparing only loads a video: the projector keeps showing what it
  // showed. Playing switches the projector to the video; stopping, or the end of the video,
  // switches it to black (never back to lyrics on its own).
  function videoCommand(adminId, eventId, cmd, video, source) {
    const loaded = video.state !== 'none';
    switch (cmd.type) {
      case 'video.prepare': {
        let target;
        if (cmd.local === true) {
          target = { mediaId: null, itemId: null };
        } else if (Number.isInteger(cmd.mediaId)) {
          if (!selectMedia.get(cmd.mediaId, adminId)) throw new LiveError('videoNotFound');
          target = { mediaId: cmd.mediaId, itemId: null };
        } else if (Number.isInteger(cmd.itemId)) {
          const item = items(adminId, eventId).find((it) => it.id === cmd.itemId);
          if (!item || item.type !== 'video' || (!item.mediaId && !item.url)) throw new LiveError('videoNotFound');
          target = item.mediaId ? { mediaId: item.mediaId, itemId: null } : { mediaId: null, itemId: item.id };
        } else {
          throw new LiveError('badCommand');
        }
        return { video: { ...video, ...target, local: cmd.local === true, localName: null, state: 'prepared', position: 0, seq: video.seq + 1 } };
      }
      case 'video.play':
        if (!loaded) throw new LiveError('videoNotPrepared');
        if (video.local && !video.localName) throw new LiveError('videoLocalNotChosen');
        if (video.state === 'playing' && source === 'video') return { noop: true };
        return {
          source: 'video',
          video: { ...video, state: 'playing', ...(video.state === 'ended' ? { position: 0, seq: video.seq + 1 } : {}) },
        };
      case 'video.pause':
        if (video.state !== 'playing') return { noop: true };
        return { video: { ...video, state: 'paused', position: numberIn(cmd.position, 0, 86400, video.position) } };
      case 'video.restart':
        if (!loaded) throw new LiveError('videoNotPrepared');
        return { video: { ...video, state: video.state === 'ended' ? 'prepared' : video.state, position: 0, seq: video.seq + 1 } };
      case 'video.stop':
        if (!loaded) return { noop: true };
        return { source: source === 'video' ? 'black' : source, video: { ...video, state: 'prepared', position: 0, seq: video.seq + 1 } };
      case 'video.volume':
        if (typeof cmd.volume !== 'number' || !(cmd.volume >= 0 && cmd.volume <= 1)) throw new LiveError('badCommand');
        return { video: { ...video, volume: Math.round(cmd.volume * 100) / 100 } };
      // From the screens (not user commands): the video ended / a local file was chosen.
      case 'video.ended':
        if (video.state !== 'playing') return { noop: true };
        return { source: source === 'video' ? 'black' : source, video: { ...video, state: 'ended', position: 0 } };
      case 'video.localChosen':
        if (!video.local || typeof cmd.name !== 'string') return { noop: true };
        return { video: { ...video, localName: cmd.name.slice(0, 200) } };
      default:
        throw new LiveError('badCommand');
    }
  }

  // The setlist of a live event changed (before = its layout before the change): clamp both
  // positions, each on its own. Returns { version, changed }, or null when the event is not live.
  function setlistChanged(adminId, eventId, before) {
    const event = selectEvent.get(eventId, adminId);
    if (!event || event.status !== 'live') return null;
    return apply(adminId, eventId, null, ({ position, projector, layout: lay }) => {
      const proj = projector.itemId === null ? projector : clampPosition(before, lay, projector);
      return { position: clampPosition(before, lay, position), projector: { itemId: proj.itemId, step: proj.step } };
    });
  }

  // The admin's live event id (at most one), or null.
  function liveEventId(adminId) {
    const id = liveEvents.pluck().get(adminId);
    return id === undefined ? null : id;
  }

  // Live events of this admin whose setlist contains the song (or all of them).
  function liveEventsWithSongId(adminId, songId) {
    return songId === undefined ? liveEvents.pluck().all(adminId) : liveEventsWithSong.pluck().all(adminId, songId);
  }

  return { visibleEvent, layout, items, snapshot, command, setlistChanged, liveEventId, liveEventsWithSongId };
}

module.exports = {
  EDITOR_ROLES,
  PROJECTOR_COMMANDS,
  permission,
  LiveError,
  layoutOf,
  firstPosition,
  nextPosition,
  prevPosition,
  gotoPosition,
  clampPosition,
  samePosition,
  setlistKey,
  createLiveStore,
};
