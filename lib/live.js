'use strict';

// Live state of an event (stage 4): the worship position the team follows, plus the
// projector fields stage 5 will use. Rows live in live_state; an event that never went
// live has no row and reads as version 0 with no position.
//
// A position is { itemId, step }. A layout is the setlist as [{ id, steps }]: a song has
// one step per entry of its arrangement WITH repeats (V1 C V2 C B C -> 6); every other
// item (and a song deleted from the library) has exactly one step.

const crypto = require('crypto');
const { VISIBLE_TO_TEAM, createEventStore } = require('./events');
const { LEADER_SOURCES } = require('./projector');

const EDITOR_ROLES = ['owner', 'leader'];
const NO_POSITION = Object.freeze({ itemId: null, step: 0 });

// --- pure functions ---------------------------------------------------------------

function layoutOf(items) {
  return items.map((item) => ({
    id: item.id,
    steps: item.type === 'song' && item.songId && Array.isArray(item.arrangementResolved)
      ? Math.max(1, item.arrangementResolved.length)
      : 1,
  }));
}

function firstPosition(layout) {
  return layout.length ? { itemId: layout[0].id, step: 0 } : { ...NO_POSITION };
}

function indexOf(layout, pos) {
  return pos && pos.itemId !== null ? layout.findIndex((it) => it.id === pos.itemId) : -1;
}

function samePosition(a, b) {
  return a.itemId === b.itemId && a.step === b.step;
}

// Next step, else the next item's first step; stays put at the end.
function nextPosition(layout, pos) {
  const i = indexOf(layout, pos);
  if (i < 0) return firstPosition(layout);
  if (pos.step + 1 < layout[i].steps) return { itemId: pos.itemId, step: pos.step + 1 };
  if (i + 1 < layout.length) return { itemId: layout[i + 1].id, step: 0 };
  return { itemId: pos.itemId, step: pos.step };
}

// Previous step, else the previous item's last step; stays put at the start.
function prevPosition(layout, pos) {
  const i = indexOf(layout, pos);
  if (i < 0) return firstPosition(layout);
  if (pos.step > 0) return { itemId: pos.itemId, step: pos.step - 1 };
  if (i > 0) return { itemId: layout[i - 1].id, step: layout[i - 1].steps - 1 };
  return { itemId: pos.itemId, step: pos.step };
}

// A valid position in the layout, or null.
function gotoPosition(layout, itemId, step) {
  const item = layout.find((it) => it.id === itemId);
  if (!item || !Number.isInteger(step) || step < 0 || step >= item.steps) return null;
  return { itemId, step };
}

// After the setlist or a song changed: the same item if it still exists (step clamped to
// its new step count), else the nearest following item that still exists, else the last
// item; no position when the setlist is empty.
function clampPosition(oldLayout, newLayout, pos) {
  if (!newLayout.length) return { ...NO_POSITION };
  if (!pos || pos.itemId === null) return firstPosition(newLayout);
  const same = newLayout.find((it) => it.id === pos.itemId);
  if (same) return { itemId: same.id, step: Math.min(Math.max(pos.step, 0), same.steps - 1) };
  const old = indexOf(oldLayout, pos);
  if (old >= 0) {
    for (const candidate of oldLayout.slice(old + 1)) {
      if (newLayout.some((it) => it.id === candidate.id)) return { itemId: candidate.id, step: 0 };
    }
  }
  return { itemId: newLayout[newLayout.length - 1].id, step: 0 };
}

// Changes whenever what the team sees of the setlist changes (items, order, songs, keys,
// arrangements): clients reload the event when it does.
function setlistKey(items) {
  const essence = items.map((it) => [it.id, it.type, it.songId, it.title, it.body, it.reference, it.url,
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
      (event_id, admin_id, version, worship_item_id, worship_step, projector_source, started_at, updated_at)
    VALUES (@eventId, @adminId, @version, @itemId, @step, @source, @startedAt, @now)
    ON CONFLICT (event_id) DO UPDATE SET version = @version, worship_item_id = @itemId,
      worship_step = @step, projector_source = @source, started_at = @startedAt, updated_at = @now`);
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
      // Stage 5: the projector follows worship until an operator takes it over.
      projector: {
        follows: row ? row.projector_follows : 'worship',
        itemId: row ? row.projector_item_id : null,
        step: row ? row.projector_step : 0,
        source: row ? row.projector_source : 'content',
      },
    };
  }

  // Runs change(context) in a transaction and stores the result with version + 1.
  // context: { event, row, position, layout }; change returns { position?, status?, start?,
  // source? },
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
    const result = change({ event, row, position, layout: layout(adminId, eventId) });
    if (result.noop) return { version, changed: false }; // e.g. "next" on the last step
    const now = Date.now();
    const next = result.position || position;
    upsertState.run({
      eventId, adminId, version: version + 1, itemId: next.itemId, step: next.step,
      source: result.source || (row ? row.projector_source : 'content'),
      startedAt: result.start ? now : (row ? row.started_at : null), now,
    });
    if (result.status && result.status !== event.status) setStatus.run(result.status, now, eventId, adminId);
    return { version: version + 1, changed: true };
  });

  // Commands of the worship position. Returns { version, changed }; throws LiveError.
  function command(adminId, eventId, cmd, expectedVersion) {
    return apply(adminId, eventId, expectedVersion, ({ event, row, position, layout: lay }) => {
      if (event.is_template) throw new LiveError('notFound');
      switch (cmd.type) {
        case 'event.start':
          if (event.status === 'draft') throw new LiveError('notPublished');
          if (event.status === 'live') throw new LiveError('alreadyLive');
          if (event.status === 'finished') throw new LiveError('finished');
          // One live event per admin: the projector shows only one.
          if (otherLive.get(adminId, eventId)) throw new LiveError('anotherLive');
          return { status: 'live', start: true, position: firstPosition(lay), source: 'content' };
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

  // The setlist of a live event changed (before = its layout before the change): clamp the
  // position. Returns { version, changed }, or null when the event is not live.
  function setlistChanged(adminId, eventId, before) {
    const event = selectEvent.get(eventId, adminId);
    if (!event || event.status !== 'live') return null;
    return apply(adminId, eventId, null, ({ position, layout: lay }) => ({ position: clampPosition(before, lay, position) }));
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
