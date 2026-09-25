'use strict';

// Live state of an event (stage 4): the worship position the team follows, plus the
// projector fields stage 5 will use. Rows live in live_state; an event that never went
// live has no row and reads as version 0 with no position.

const { VISIBLE_TO_TEAM } = require('./events');

const EDITOR_ROLES = ['owner', 'leader'];

function createLiveStore(db) {
  const selectEvent = db.prepare('SELECT id, status, is_template FROM events WHERE id = ? AND admin_id = ?');
  const selectState = db.prepare('SELECT * FROM live_state WHERE event_id = ? AND admin_id = ?');

  // The event row if this role may see it (same rules as GET /api/events/:id), else null.
  function visibleEvent(adminId, eventId, role) {
    const row = selectEvent.get(eventId, adminId);
    if (!row) return null;
    if (!EDITOR_ROLES.includes(role) && (row.is_template || !VISIBLE_TO_TEAM.includes(row.status))) return null;
    return row;
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
      worship: { itemId: row ? row.worship_item_id : null, step: row ? row.worship_step : 0 },
      projector: {
        follows: row ? row.projector_follows : 'worship',
        itemId: row ? row.projector_item_id : null,
        step: row ? row.projector_step : 0,
        source: row ? row.projector_source : 'content',
      },
    };
  }

  return { visibleEvent, snapshot };
}

module.exports = { EDITOR_ROLES, createLiveStore };
