'use strict';

// The "Acum" home: what matters for this admin right now.
//   live      the live event, if any, with startedAt (a card hint after 24 h: "live de ieri")
//   next      the next planned event today or later (everyone sees every event); never a
//             finished one, whatever its date
//   upcoming  up to 3 more after it
// Templates and finished events never appear.

const { EVENT_ROLES, createEventStore } = require('./events');
const MORE = 3;

function createHome(db) {
  const events = createEventStore(db);
  const selectLive = db.prepare("SELECT id FROM events WHERE admin_id = ? AND status = 'live' AND is_template = 0 ORDER BY id LIMIT 1");
  const selectStarted = db.prepare('SELECT started_at FROM live_state WHERE event_id = ? AND admin_id = ?').pluck();

  function home(adminId, role, today) {
    const editor = EVENT_ROLES.includes(role);
    const liveId = selectLive.pluck().get(adminId);
    const live = liveId === undefined ? null : { ...events.get(adminId, liveId).event, startedAt: selectStarted.get(liveId, adminId) || null };
    const coming = events.list(adminId, { when: 'upcoming', today, teamOnly: !editor })
      .filter((e) => e.status === 'planned');
    return { today, live, next: coming[0] || null, upcoming: coming.slice(1, 1 + MORE) };
  }

  return { home };
}

module.exports = { createHome };
