'use strict';

// Live state of an event: the main (worship) position the team follows, the projector
// position used in split mode, the live mode (together | split), the team mode (follow |
// free), source and video. Rows live in live_state; an event that never went live has no
// row and reads as version 0 with no position. Positions and layouts: see public/positions.js.

const crypto = require('crypto');
const { EVENT_ROLES, createEventStore, validateItems } = require('./events');
const { LEADER_SOURCES } = require('./projector');

// A target language code the operator may pick for the translation projector source
// (SV -> worship). Loose ISO-ish check; the bridge / SV own the real list.
const TRANSLATION_LANG_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i;
const { createAdminSettings } = require('./admin-settings');
const { createScreenStore } = require('./screens');
const { normalize: normalizeClock, parsePatch: parseClockPatch } = require('./clock');
const {
  NO_POSITION, layoutOf, firstPosition, samePosition, nextPosition, prevPosition, nextItemPosition, movePosition, gotoPosition, clampPosition,
} = require('../public/positions.js');

// Items added during live: types, and where they go.
const OPERATOR_ITEM_TYPES = ['song', 'verse', 'announcement'];
const ADD_TARGETS = ['projector', 'setlist'];
// Live control (migration 014):
//   together  ONE main position: leader and operator both move it; the projector and the
//             team phones follow it
//   split     the main position (team phones) and the projector position are independent
const LIVE_MODES = ['together', 'split'];
// Team phones: follow the main position, or scroll freely (and see where live is).
const TEAM_MODES = ['follow', 'free'];
// Commands that move the projector position on its own: only in split mode.
const PROJECTOR_COMMANDS = ['projector.next', 'projector.prev', 'projector.goto', 'projector.syncToWorship'];
// Consent before the leader takes the projector (migration 024): in split mode a LEADER's
// live.mode 'together' becomes a handover request (60 s) that the operator or the owner
// answers with handover.accept (-> together) or handover.refuse (nothing changes); the
// requester (or any event role) may handover.cancel it. Owner and operator switch directly.
const HANDOVER_TTL_MS = 60 * 1000;
const HANDOVER_ANSWER_ROLES = ['owner', 'operator'];
const REQUESTING_ROLES = ['presenter', 'leader']; // their split -> together waits for an answer
const HANDOVER_ANSWERS = ['handover.accept', 'handover.refuse'];

// Who may send a command in this live mode. null = allowed, else the error code. No role =
// the server itself (screen reports).
//   owner, leader, operator (EVENT_ROLES)  everything; the projector position only in split;
//                                          handover answers: owner and operator only
//   member                                 nothing
function permission(role, type, mode) {
  if (!role) return null;
  if (!EVENT_ROLES.includes(role)) return 'forbidden';
  if (HANDOVER_ANSWERS.includes(type) && !HANDOVER_ANSWER_ROLES.includes(role)) return 'forbidden';
  return PROJECTOR_COMMANDS.includes(type) && mode !== 'split' ? 'notSplitMode' : null;
}

// The pending handover of a row, or null (none, or expired: expiry is silent).
function handoverOf(row, now) {
  if (!row || row.handover_by === null || row.handover_at === null) return null;
  if (now - row.handover_at >= HANDOVER_TTL_MS) return null;
  return { requestedBy: row.handover_by, requestedAt: row.handover_at, expiresAt: row.handover_at + HANDOVER_TTL_MS };
}
// Stored override (text) -> 'none' | media id.
const parseOverride = (value) => (value === 'none' ? 'none' : Number(value));
// Stored screen ids (JSON text, migration 040) -> null (every screen) | sorted ids.
function screensOf(row) {
  if (!row || !row.screen_ids) return null;
  try {
    const ids = JSON.parse(row.screen_ids);
    return Array.isArray(ids) ? ids.filter((id) => Number.isInteger(id)) : null;
  } catch (err) {
    return null;
  }
}
const sameScreens = (a, b) => (a === null && b === null) || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((id, i) => id === b[i]));
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
  const settings = createAdminSettings(db);
  const screens = createScreenStore(db);
  const selectEvent = db.prepare('SELECT id, status, is_template FROM events WHERE id = ? AND admin_id = ?');
  const selectState = db.prepare('SELECT * FROM live_state WHERE event_id = ? AND admin_id = ?');
  const upsertState = db.prepare(`INSERT INTO live_state
      (event_id, admin_id, version, worship_item_id, worship_step, projector_follows, lead_mode, team_mode,
        background_override, projector_item_id, projector_step, projector_source, translation_lang, started_at, updated_at,
        video_media_id, video_item_id, video_local_name, video_state, video_position_s, video_volume, video_seq, video_updated_at,
        worship_ended, projector_ended, show_clock, clock_position, clock_scale, handover_by, handover_at, screen_ids)
    VALUES (@eventId, @adminId, @version, @itemId, @step, @follows, @mode, @teamMode,
        @backgroundOverride, @projectorItemId, @projectorStep, @source, @translationLang, @startedAt, @now,
        @videoMediaId, @videoItemId, @videoLocalName, @videoState, @videoPosition, @videoVolume, @videoSeq, @videoUpdatedAt,
        @worshipEnded, @projectorEnded, @showClock, @clockPosition, @clockScale, @handoverBy, @handoverAt, @screenIds)
    ON CONFLICT (event_id) DO UPDATE SET version = @version, worship_item_id = @itemId,
      worship_step = @step, worship_ended = @worshipEnded, projector_ended = @projectorEnded,
      show_clock = @showClock, clock_position = @clockPosition, clock_scale = @clockScale,
      handover_by = @handoverBy, handover_at = @handoverAt, screen_ids = @screenIds,
      projector_follows = @follows, lead_mode = @mode, team_mode = @teamMode,
      background_override = @backgroundOverride,
      projector_item_id = @projectorItemId,
      projector_step = @projectorStep, projector_source = @source, translation_lang = @translationLang, started_at = @startedAt, updated_at = @now,
      video_media_id = @videoMediaId, video_item_id = @videoItemId, video_local_name = @videoLocalName,
      video_state = @videoState, video_position_s = @videoPosition, video_volume = @videoVolume,
      video_seq = @videoSeq, video_updated_at = @videoUpdatedAt`);
  const selectBackground = db.prepare(`SELECT id FROM media WHERE id = ? AND admin_id = ? AND kind IN ('image', 'loop')`);
  const selectMedia = db.prepare(`SELECT id FROM media WHERE id = ? AND admin_id = ? AND kind IN ('upload', 'url')`);
  const otherLive = db.prepare("SELECT id FROM events WHERE admin_id = ? AND status = 'live' AND id <> ? LIMIT 1");
  const setStatus = db.prepare('UPDATE events SET status = ?, updated_at = ? WHERE id = ? AND admin_id = ?');
  const liveEvents = db.prepare("SELECT id FROM events WHERE admin_id = ? AND status = 'live'");
  const clearHandoverRows = db.prepare('UPDATE live_state SET handover_by = NULL, handover_at = NULL WHERE handover_by IS NOT NULL');
  const liveEventsWithSong = db.prepare(`SELECT DISTINCT e.id FROM events e
    JOIN setlist_items i ON i.event_id = e.id AND i.admin_id = e.admin_id
    WHERE e.admin_id = ? AND e.status = 'live' AND i.song_id = ?`);

  // The event row if this role may see it (same rules as GET /api/events/:id), else null.
  function visibleEvent(adminId, eventId, role) {
    const row = selectEvent.get(eventId, adminId);
    if (!row) return null;
    if (!EVENT_ROLES.includes(role) && row.is_template) return null; // the team never sees templates
    return row;
  }

  // scope 'shared': the setlist the team sees (worship); 'all': with projector-only items.
  // t labels the arrangement's sections (a reader's language).
  function items(adminId, eventId, scope = 'shared', t = undefined) {
    const found = events.get(adminId, eventId, { scope, t });
    return found ? found.items : [];
  }

  // Worship moves over the shared setlist, the projector over all items.
  function layouts(adminId, eventId) {
    const all = items(adminId, eventId, 'all');
    return { shared: layoutOf(all.filter((it) => it.scope === 'shared')), all: layoutOf(all) };
  }

  // The corner clock of this event: the row's values, else the church defaults (an event
  // that never went live shows what it would start with).
  function clockOf(adminId, row) {
    return row ? normalizeClock({ show: row.show_clock === 1, position: row.clock_position, scale: row.clock_scale }) : settings.clock(adminId);
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
      // together | split, and whether team phones follow the main position.
      mode: row ? row.lead_mode : 'together',
      teamMode: row ? row.team_mode : 'follow',
      // The live background override: a media id, 'none' (black) or null (lib/backgrounds.js).
      backgroundOverride: row && row.background_override ? parseOverride(row.background_override) : null,
      // The main position (team phones; the projector too, together).
      // ended: "■ Sfârșit" was pressed on this item (the projector shows the logo / black).
      worship: { itemId: row ? row.worship_item_id : null, step: row ? row.worship_step : 0, ended: Boolean(row && row.worship_ended) },
      // The projector position, used in split mode ('follows' tells the shared frame code
      // which position to show: 'operator' = the projector's own, split).
      projector: {
        follows: row && row.lead_mode === 'split' ? 'operator' : 'worship',
        itemId: row ? row.projector_item_id : null,
        step: row ? row.projector_step : 0,
        ended: Boolean(row && row.projector_ended),
        source: row ? row.projector_source : 'content',
        // The picked translation language (SV -> worship), meaningful only when source is
        // 'translation'; the translated text streams over the bridge, not through the snapshot.
        translationLang: row ? (row.translation_lang || null) : null,
      },
      video: videoOf(row),
      // The corner clock (public/clock.js), with the church timezone and time format every
      // clock (the screens', the live pages') formats in.
      clock: { ...clockOf(adminId, row), timeZone: settings.timezone(adminId), format: settings.timeFormat(adminId) },
      // The leader's pending request to take the projector (split -> together), or null.
      handover: handoverOf(row, Date.now()),
      // Which screens show the projection: null = every screen, else their ids (migration 040).
      screens: screensOf(row),
    };
  }

  // Runs change(context) in a transaction and stores the result with version + 1.
  // context: { event, row, mode, position, projector, video, clock, handover, layout }; change returns
  // { position?, projector? ({ itemId?, step? }), mode?, teamMode?, status?, start?, source?,
  // video? (the whole next video state), clock? (the whole next clock), handover? (the next
  // pending request: { by, at } or null; left out: kept, but a mode change clears it),
  // screens? (null = every screen, or ids; left out: kept),
  // notice? / handoverEvent? (passed back to the caller) },
  // or { noop: true } to leave everything (version included) as it is,
  // or throws LiveError. expectedVersion (optional) must match the stored version.
  const apply = db.transaction((adminId, eventId, expectedVersion, change, now = Date.now()) => {
    const event = selectEvent.get(eventId, adminId);
    if (!event) throw new LiveError('notFound');
    const row = selectState.get(eventId, adminId);
    const version = row ? row.version : 0;
    if (expectedVersion !== undefined && expectedVersion !== null && expectedVersion !== version) {
      throw new LiveError('stale');
    }
    const position = { itemId: row ? row.worship_item_id : null, step: row ? row.worship_step : 0, ended: Boolean(row && row.worship_ended) };
    const projector = {
      itemId: row ? row.projector_item_id : null,
      step: row ? row.projector_step : 0,
      ended: Boolean(row && row.projector_ended),
    };
    const mode = row ? row.lead_mode : 'together';
    const video = videoOf(row);
    const clock = clockOf(adminId, row);
    const handover = handoverOf(row, now);
    const lay = layouts(adminId, eventId);
    const result = change({ event, row, mode, position, projector, video, clock, handover, layout: lay.shared, projectorLayout: lay.all });
    if (result.noop) return { version, changed: false, handoverEvent: result.handoverEvent || null }; // e.g. "next" on the last step
    // A new position is not ended unless it says so (every move clears "Sfârșit").
    const next = result.position ? { ended: false, ...result.position } : position;
    const proj = result.projector ? { ...projector, ended: false, ...result.projector } : projector;
    const nextMode = result.mode || mode;
    const v = result.video || video;
    const c = normalizeClock(result.clock || clock);
    // A pending request is kept unless the change says otherwise; a mode change or the end
    // of the event settles it.
    let h = result.handover !== undefined ? result.handover : (handover ? { by: handover.requestedBy, at: handover.requestedAt } : null);
    if (result.mode && result.mode !== mode) h = result.handover !== undefined ? result.handover : null;
    if (result.status && result.status !== 'live') h = null;
    const scr = result.screens !== undefined ? result.screens : screensOf(row);
    upsertState.run({
      eventId, adminId, version: version + 1, itemId: next.itemId, step: next.step,
      follows: nextMode === 'split' ? 'operator' : 'worship', mode: nextMode,
      teamMode: result.teamMode || (row ? row.team_mode : 'follow'),
      backgroundOverride: result.backgroundOverride !== undefined
        ? (result.backgroundOverride === null ? null : String(result.backgroundOverride))
        : (row ? row.background_override : null),
      projectorItemId: proj.itemId, projectorStep: proj.step,
      source: result.source || (row ? row.projector_source : 'content'),
      translationLang: result.translationLang !== undefined ? result.translationLang : (row ? row.translation_lang : null),
      startedAt: result.start ? now : (row ? row.started_at : null), now,
      videoMediaId: v.mediaId, videoItemId: v.itemId, videoLocalName: v.localName, videoState: v.state,
      videoPosition: v.position, videoVolume: v.volume, videoSeq: v.seq,
      videoUpdatedAt: result.video ? now : (row ? row.video_updated_at : null),
      worshipEnded: next.ended ? 1 : 0,
      projectorEnded: proj.ended ? 1 : 0,
      showClock: c.show ? 1 : 0, clockPosition: c.position, clockScale: c.scale,
      handoverBy: h ? h.by : null, handoverAt: h ? h.at : null,
      screenIds: scr === null ? null : JSON.stringify(scr),
    });
    if (result.status && result.status !== event.status) setStatus.run(result.status, now, eventId, adminId);
    return { version: version + 1, changed: true, notice: result.notice || null, handoverEvent: result.handoverEvent || null, itemId: result.itemId || null };
  });

  // Live commands. role: the sender's role (checked against the live mode, in the same
  // transaction); none for the server's own events. context (optional): { userId, hasApprovers
  // (an owner / operator page is in the room: a leader's take-over needs their consent),
  // now }. Returns { version, changed, notice, handoverEvent } (notice: { type: 'itemAdded',
  // title, target } for an addition; handoverEvent: { type: 'requested' | 'accepted' |
  // 'refused' | 'cancelled', ... } for the room); throws LiveError.
  function command(adminId, eventId, cmd, expectedVersion, role, context = {}) {
    const now = context.now || Date.now();
    return apply(adminId, eventId, expectedVersion, ({ event, row, mode, position, projector, video, clock, handover, layout: lay, projectorLayout }) => {
      const refused = permission(role, cmd.type, mode);
      if (refused) throw new LiveError(refused);
      if (cmd.type.startsWith('handover.')) {
        if (event.status !== 'live') throw new LiveError('notLive');
        return handoverCommand(cmd, handover, mode, position, role, context);
      }
      // The corner clock (event roles): { show?, position?, scale? }; the scale is clamped.
      if (cmd.type === 'clock.set') {
        if (event.status !== 'live') throw new LiveError('notLive');
        const patch = parseClockPatch(cmd);
        if (!patch) throw new LiveError('badCommand');
        const next = { ...clock, ...patch };
        return next.show === clock.show && next.position === clock.position && next.scale === clock.scale ? { noop: true } : { clock: next };
      }
      if (PROJECTOR_COMMANDS.includes(cmd.type)) {
        if (event.status !== 'live') throw new LiveError('notLive');
        return projectorCommand(cmd, position, projector, projectorLayout);
      }
      // "Pe ce ecrane" (event roles, any mode): { screenIds: null } = every screen of the
      // church, or the ids of the screens that show the projection (the others idle).
      if (cmd.type === 'projector.screens') {
        if (event.status !== 'live') throw new LiveError('notLive');
        const next = screenTargets(adminId, cmd.screenIds);
        return sameScreens(next, screensOf(row)) ? { noop: true } : { screens: next };
      }
      if (cmd.type === 'operator.addItem') {
        if (event.status !== 'live') throw new LiveError('notLive');
        return addItem(adminId, eventId, cmd, mode, position, projector);
      }
      if (cmd.type === 'live.mode') {
        if (event.status !== 'live') throw new LiveError('notLive');
        if (!LIVE_MODES.includes(cmd.mode)) throw new LiveError('badCommand');
        if (cmd.mode === mode) return { noop: true };
        // Entering split: the projector starts where the main position is. Leaving it: the
        // projector shows the main position again at once - for a LEADER only with the
        // operator's (or the owner's) consent while one of them is in the room: the switch
        // becomes a pending request instead (auto-accepted when nobody can answer).
        if (cmd.mode === 'split') return { mode: 'split', projector: { itemId: position.itemId, step: position.step, ended: position.ended } };
        if (REQUESTING_ROLES.includes(role) && context.hasApprovers) {
          if (handover) return { noop: true, handoverEvent: { type: 'requested', byUserId: handover.requestedBy, expiresAt: handover.expiresAt, again: true } };
          const at = now;
          return { handover: { by: context.userId || null, at }, handoverEvent: { type: 'requested', byUserId: context.userId || null, expiresAt: at + HANDOVER_TTL_MS } };
        }
        return { mode: 'together', projector: {}, handover: null, handoverEvent: handover ? { type: 'accepted', byUserId: context.userId || null, direct: true } : null };
      }
      // The live background override (event roles): a background of this admin, 'none'
      // (black behind the text) or null ("Implicit": back to what the setlist says).
      if (cmd.type === 'background.set') {
        if (event.status !== 'live') throw new LiveError('notLive');
        const value = cmd.background;
        if (value !== null && value !== 'none' && !(Number.isInteger(value) && selectBackground.get(value, adminId))) {
          throw new LiveError('backgroundNotFound');
        }
        const current = row && row.background_override ? parseOverride(row.background_override) : null;
        return current === value ? { noop: true } : { backgroundOverride: value };
      }
      if (cmd.type === 'team.mode') {
        if (event.status !== 'live') throw new LiveError('notLive');
        if (!TEAM_MODES.includes(cmd.mode)) throw new LiveError('badCommand');
        return cmd.mode === (row ? row.team_mode : 'follow') ? { noop: true } : { teamMode: cmd.mode };
      }
      if (cmd.type.startsWith('video.')) {
        if (event.status !== 'live') throw new LiveError('notLive');
        return videoCommand(adminId, eventId, cmd, video, (row && row.projector_source) || 'content');
      }
      if (cmd.type === 'worship.endItem') {
        if (event.status !== 'live') throw new LiveError('notLive');
        return endItem(cmd, mode, position, projector);
      }
      if (event.is_template) throw new LiveError('notFound');
      switch (cmd.type) {
        case 'event.start':
          if (event.status === 'live') throw new LiveError('alreadyLive');
          if (event.status === 'finished') throw new LiveError('finished');
          // One live event per admin: the projector shows only one.
          if (otherLive.get(adminId, eventId)) throw new LiveError('anotherLive');
          // The clock starts from the church defaults (Settings), whatever an earlier run set.
          return {
            status: 'live', start: true, position: firstPosition(lay), source: 'content', translationLang: null, mode: 'together', teamMode: 'follow', backgroundOverride: null,
            projector: { itemId: null, step: 0 }, video: { ...NO_VIDEO, seq: video.seq }, clock: settings.clock(adminId), screens: null,
          };
        case 'event.end':
          if (event.status !== 'live') throw new LiveError('notLive');
          return { status: 'finished' };
        case 'worship.next':
        case 'worship.prev':
        case 'worship.goto': {
          if (event.status !== 'live') throw new LiveError('notLive');
          const target = movePosition(lay, position, cmd.type.slice('worship.'.length), cmd.itemId, cmd.step);
          if (!target) throw new LiveError('badPosition');
          if (samePosition(target, position) && !position.ended) return { noop: true };
          if (samePosition(target, position) && cmd.type === 'worship.next') return { noop: true }; // ended on the last item
          // After "Sfârșit" a move puts the content back on screen - the projector's source only
          // when the projector shows this position (together).
          return position.ended && mode !== 'split' ? { position: target, source: 'content' } : { position: target };
        }
        case 'projector.source': {
          if (event.status !== 'live') throw new LiveError('notLive');
          const currentSource = (row && row.projector_source) || 'content';
          // The translation source (SV -> worship) carries the target language; the operator /
          // leader picks it explicitly. The translated text streams over the bridge; the
          // projector shows nothing translated until it arrives (graceful when the bridge drops).
          if (cmd.source === 'translation') {
            const lang = typeof cmd.lang === 'string' ? cmd.lang.trim().toLowerCase() : '';
            if (!TRANSLATION_LANG_RE.test(lang)) throw new LiveError('badCommand');
            return currentSource === 'translation' && (row && row.translation_lang) === lang
              ? { noop: true } : { source: 'translation', translationLang: lang };
          }
          if (!LEADER_SOURCES.includes(cmd.source)) throw new LiveError('badCommand');
          return cmd.source === currentSource ? { noop: true } : { source: cmd.source };
        }
        default:
          throw new LiveError('badCommand');
      }
    }, now);
  }

  // The screens a projector.screens command names: null (every screen) or the sorted, distinct
  // ids of existing screens of this admin; an unknown one -> screenNotFound.
  function screenTargets(adminId, ids) {
    if (ids === null || ids === undefined) return null;
    if (!Array.isArray(ids) || !ids.every((id) => Number.isInteger(id) && id > 0)) throw new LiveError('badCommand');
    const distinct = [...new Set(ids)].sort((a, b) => a - b);
    if (distinct.some((id) => !screens.get(adminId, id))) throw new LiveError('screenNotFound');
    return distinct;
  }

  // The handover request (see HANDOVER_TTL_MS). accept (owner / operator): together, the
  // projector shows the main position; refuse: nothing changes; cancel (any event role, the
  // requester foremost): withdrawn. Each answers the pending request, else noHandover.
  function handoverCommand(cmd, handover, mode, position, role, context) {
    if (!['handover.accept', 'handover.refuse', 'handover.cancel'].includes(cmd.type)) throw new LiveError('badCommand');
    if (!handover) throw new LiveError('noHandover');
    const byUserId = context.userId || null;
    if (cmd.type === 'handover.accept') {
      if (mode !== 'split') return { handover: null, handoverEvent: { type: 'accepted', byUserId } };
      return { mode: 'together', projector: {}, handover: null, handoverEvent: { type: 'accepted', byUserId } };
    }
    return { handover: null, handoverEvent: { type: cmd.type === 'handover.refuse' ? 'refused' : 'cancelled', byUserId, requestedBy: handover.requestedBy } };
  }

  // "■ Sfârșit" (event roles): the current item is ended - the position stays on it (the team
  // still sees where the service is) and the projector shows the logo, or black without one,
  // until the next move (public/frames.js). The main position, or with target 'projector'
  // (split mode only) the projector's. Never moves by itself; the last item is no special case.
  function endItem(cmd, mode, worship, projector) {
    const onProjector = cmd.target === 'projector';
    if (cmd.target !== undefined && cmd.target !== 'projector') throw new LiveError('badCommand');
    if (onProjector && mode !== 'split') throw new LiveError('notSplitMode');
    const pos = onProjector ? projector : worship;
    if (pos.itemId === null) throw new LiveError('badPosition');
    if (pos.ended) return { noop: true };
    return onProjector
      ? { projector: { itemId: pos.itemId, step: pos.step, ended: true } }
      : { position: { itemId: pos.itemId, step: pos.step, ended: true } };
  }


  // The projector position in split mode. Main-position commands never move it; together,
  // the projector shows the main position.
  function projectorCommand(cmd, worship, projector, lay) {
    const pos = { itemId: projector.itemId, step: projector.step, ended: projector.ended };
    let target;
    if (cmd.type === 'projector.syncToWorship') target = { itemId: worship.itemId, step: worship.step };
    else if (['projector.next', 'projector.prev', 'projector.goto'].includes(cmd.type)) target = movePosition(lay, pos, cmd.type.slice('projector.'.length), cmd.itemId, cmd.step);
    else throw new LiveError('badCommand');
    if (!target) throw new LiveError('badPosition');
    if (samePosition(target, pos) && (!pos.ended || cmd.type === 'projector.next')) return { noop: true };
    const out = { projector: { itemId: target.itemId, step: target.step } };
    return pos.ended ? { ...out, source: 'content' } : out;
  }

  // An addition during live, where the sender chooses: target 'projector' -> a projector-only
  // item right after what the projector shows; 'setlist' -> a shared item right after the
  // main position (team phones reload the setlist). No approval. Positions stay where they
  // are (items are followed by id).
  function addItem(adminId, eventId, cmd, mode, worship, projector) {
    const it = cmd.item && typeof cmd.item === 'object' ? cmd.item : {};
    if (!ADD_TARGETS.includes(cmd.target)) throw new LiveError('badCommand');
    if (!OPERATOR_ITEM_TYPES.includes(it.type)) throw new LiveError('badItem');
    const { error, value } = validateItems([{
      type: it.type, songId: it.songId, reference: it.reference, title: it.title, body: it.body,
    }], (key) => key, (songId) => events.findSong(adminId, songId));
    if (error) throw new LiveError('badItem');
    const item = value[0];
    // position 'end' (a proposal added "la sfârșit"): after the last shared item; default:
    // right after the main position.
    const atEnd = cmd.position === 'end';
    let itemId;
    if (cmd.target === 'setlist') {
      itemId = events.addOperatorItem(adminId, eventId, item, atEnd ? null : worship.itemId, 'shared');
    } else {
      itemId = events.addOperatorItem(adminId, eventId, item, mode === 'split' ? projector.itemId : worship.itemId, 'projector');
    }
    const song = item.type === 'song' ? events.findSong(adminId, item.songId) : null;
    const title = (song && song.title) || item.title || item.reference || '';
    return { notice: { type: 'itemAdded', title, target: cmd.target }, itemId };
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
          const item = items(adminId, eventId, 'all').find((it) => it.id === cmd.itemId);
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

  // The setlist of a live event changed (before = its layouts() before the change): clamp
  // both positions, each on its own (worship over the shared items, the projector over all).
  // Returns { version, changed }, or null when the event is not live.
  function setlistChanged(adminId, eventId, before) {
    const event = selectEvent.get(eventId, adminId);
    if (!event || event.status !== 'live') return null;
    return apply(adminId, eventId, null, ({ position, projector, layout: lay, projectorLayout }) => {
      const proj = projector.itemId === null ? projector : clampPosition(before.all, projectorLayout, projector);
      const pos = clampPosition(before.shared, lay, position);
      // "Sfârșit" stays while the same item is there (the projector never changes on its own).
      return {
        position: { ...pos, ended: position.ended && pos.itemId === position.itemId },
        projector: { itemId: proj.itemId, step: proj.step, ended: projector.ended && proj.itemId === projector.itemId },
      };
    });
  }

  // A restart forgets every pending handover request (the pages that asked are gone too).
  function clearHandovers() {
    return clearHandoverRows.run().changes;
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

  return { visibleEvent, layouts, items, snapshot, command, setlistChanged, liveEventId, liveEventsWithSongId, clearHandovers };
}

module.exports = {
  PROJECTOR_COMMANDS,
  HANDOVER_TTL_MS,
  HANDOVER_ANSWER_ROLES,
  LIVE_MODES,
  TEAM_MODES,
  permission,
  LiveError,
  layoutOf,
  firstPosition,
  nextPosition,
  prevPosition,
  nextItemPosition,
  gotoPosition,
  clampPosition,
  samePosition,
  setlistKey,
  createLiveStore,
};
