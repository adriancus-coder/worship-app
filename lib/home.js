'use strict';

// The "Acum" home: what matters for this admin right now.
//   live      the live event, if any, with startedAt (a card hint after 24 h: "live de ieri")
//   next      the next planned event today or later (everyone sees every event); never a
//             finished one, whatever its date
//   upcoming  up to 3 more after it
// Templates and finished events never appear.

const { EVENT_ROLES, createEventStore } = require('./events');
const { createAssignmentStore } = require('./assignments');
const { createAttendanceStore } = require('./attendance');
const { createProposalStore } = require('./proposals');
const MORE = 3;

function createHome(db) {
  const events = createEventStore(db);
  const assignments = createAssignmentStore(db);
  const attendance = createAttendanceStore(db);
  const proposals = createProposalStore(db);
  const selectLive = db.prepare("SELECT id FROM events WHERE admin_id = ? AND status = 'live' AND is_template = 0 ORDER BY id LIMIT 1");
  const selectStarted = db.prepare('SELECT started_at FROM live_state WHERE event_id = ? AND admin_id = ?').pluck();

  // userId: the card also carries this person's assignments on the top event ("Ești programat:
  // Chitară" with Vin / Nu pot), their answer to the invitation (Vin / Poate / Nu pot) and, for
  // the event roles, the team summary.
  // role: a role name, or true / false = sees every event (lib/roles.js seesAllEvents).
  function home(adminId, role, today, userId = null) {
    const editor = typeof role === 'boolean' ? role : EVENT_ROLES.includes(role);
    const liveId = selectLive.pluck().get(adminId);
    const live = liveId === undefined ? null : { ...events.get(adminId, liveId).event, startedAt: selectStarted.get(liveId, adminId) || null };
    const coming = events.list(adminId, { when: 'upcoming', today, teamOnly: !editor })
      .filter((e) => e.status === 'planned');
    const top = live || coming[0] || null;
    const mine = top && userId ? assignments.forUser(adminId, userId, top.id) : [];
    const summary = top && editor ? assignments.summary(assignments.list(adminId, top.id)) : null;
    const invited = top && userId ? attendance.mine(adminId, top.id, userId) : null;
    const proposalsOpen = top && editor ? proposals.openCount(adminId, top.id) : 0;
    return { today, live, next: coming[0] || null, upcoming: coming.slice(1, 1 + MORE), assignments: mine, attendance: invited, teamSummary: summary, proposalsOpen };
  }

  return { home };
}

module.exports = { createHome };
