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

  // The card's Program: every shared item with, for songs, the key as sung at this event.
  function programOf(adminId, eventId) {
    const found = events.get(adminId, eventId);
    return (found ? found.items : []).map((it) => ({
      id: it.id, type: it.type, title: it.title, who: it.who || null, reference: it.reference || null,
      songId: it.songId, key: it.displayKey || null, songKey: it.song ? it.song.key || null : null, transpose: it.transpose || 0,
    }));
  }

  // The card's team: everyone assigned to a position or invited, one row each, with their
  // answer: the invitation's (Vin / Poate / Nu pot) when given, else the position's, else
  // pending. Sorted by name. [{ userId, name, status, positions: [{ name, emoji }] }]
  function teamOf(adminId, eventId) {
    const people = new Map();
    const touch = (userId, name) => {
      if (!people.has(userId)) people.set(userId, { userId, name, status: 'pending', positions: [] });
      return people.get(userId);
    };
    for (const a of assignments.list(adminId, eventId)) {
      const p = touch(a.userId, a.userName);
      p.positions.push({ name: a.positionName, emoji: a.positionEmoji || null });
      if (p.status === 'pending' && a.status !== 'pending') p.status = a.status;
    }
    for (const r of attendance.list(adminId, eventId)) {
      if (!r.invitedAt && r.status === 'pending' && !people.has(r.userId)) continue;
      const p = touch(r.userId, r.userName);
      if (r.status !== 'pending') p.status = r.status; // the invitation's answer wins
    }
    return [...people.values()].sort((a, b) => a.name.localeCompare(b.name, 'ro'));
  }

  // userId: the card also carries this person's assignments on the top event ("Ești programat:
  // Chitară" with Vin / Nu pot), their answer to the invitation (Vin / Poate / Nu pot) and, for
  // the event roles, the team summary. program / team: the top event's Program with the keys
  // and its people with their answers (the card, for everyone).
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
    return {
      today, live, next: coming[0] || null, upcoming: coming.slice(1, 1 + MORE), assignments: mine, attendance: invited, teamSummary: summary, proposalsOpen,
      program: top ? programOf(adminId, top.id) : [], team: top ? teamOf(adminId, top.id) : [],
    };
  }

  return { home };
}

module.exports = { createHome };
