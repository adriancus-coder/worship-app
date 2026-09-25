'use strict';

// The "Acum" home: what matters for this admin right now.
//   live      the live event, if any
//   next      the next event today or later: published (the team sees it) or, for the
//             event roles (owner, leader, operator), also a draft (its status says so)
//   upcoming  up to 3 more after it
// Templates and finished events never appear.

const { EVENT_ROLES, createEventStore } = require('./events');
const MORE = 3;

function createHome(db) {
  const events = createEventStore(db);
  const selectLive = db.prepare("SELECT id FROM events WHERE admin_id = ? AND status = 'live' AND is_template = 0 ORDER BY id LIMIT 1");

  function home(adminId, role, today) {
    const editor = EVENT_ROLES.includes(role);
    const liveId = selectLive.pluck().get(adminId);
    const live = liveId === undefined ? null : events.get(adminId, liveId).event;
    const wanted = editor ? ['published', 'draft'] : ['published'];
    const coming = events.list(adminId, { when: 'upcoming', today, teamOnly: !editor })
      .filter((e) => wanted.includes(e.status));
    return { today, live, next: coming[0] || null, upcoming: coming.slice(1, 1 + MORE) };
  }

  return { home };
}

module.exports = { createHome };
