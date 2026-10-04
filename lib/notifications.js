'use strict';

// The notifications centre (migration 033): every team event writes a row for the person (in
// their language) and, when they are subscribed, sends a small push (lib/push.js). Kinds:
//   assigned         the leader sent the schedule (routes/assignments.js "send")
//   reminder         the day before an event, at 18:00 church time, to accepted / pending
//   setlist_changed  the Program of an event one is assigned to changed (max one per 10 min)
//   declined         to the owner and the leaders when someone says "Nu pot"
//   live_started     to the assigned people when the event goes live
//   proposal         to the event roles when someone proposes a song (lib/proposals.js)
//   proposal_decided to the proposer when the song was added or declined
//   invited          "Trimite invitația": the whole team is asked whether they come
//   attendance       to the owner and the leaders when someone answers Vin / Poate / Nu pot
// Each kind can be switched off per person (notification_prefs; all on by default). The
// reminder scheduler is a minute tick, idempotent per event and person (the row itself is the
// record), so restarts never send twice.

const { t } = require('./i18n');
const { todayIn, nowTimeIn } = require('./dates');
const { createAdminSettings } = require('./admin-settings');
const { createAssignmentStore } = require('./assignments');

const KINDS = ['assigned', 'unassigned', 'reminder', 'setlist_changed', 'accepted', 'declined', 'unavailable', 'live_started', 'proposal', 'proposal_decided', 'invited', 'attendance'];
const REMINDER_TIME = '18:00';
const SETLIST_THROTTLE_MS = 10 * 60 * 1000;
const LIST_LIMIT = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

function createNotifications({ db, logger, push }) {
  const settings = createAdminSettings(db);
  const assignments = createAssignmentStore(db);
  const insert = db.prepare(`INSERT INTO notifications (admin_id, user_id, kind, title, body, url, event_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const listRows = db.prepare('SELECT * FROM notifications WHERE admin_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?');
  const unreadCount = db.prepare('SELECT COUNT(*) FROM notifications WHERE admin_id = ? AND user_id = ? AND read_at IS NULL').pluck();
  const readOne = db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND admin_id = ? AND user_id = ? AND read_at IS NULL');
  const readAll = db.prepare('UPDATE notifications SET read_at = ? WHERE admin_id = ? AND user_id = ? AND read_at IS NULL');
  const lastOfKind = db.prepare('SELECT MAX(created_at) FROM notifications WHERE admin_id = ? AND user_id = ? AND event_id = ? AND kind = ?').pluck();
  const prefRows = db.prepare('SELECT kind, enabled FROM notification_prefs WHERE admin_id = ? AND user_id = ?');
  const setPref = db.prepare(`INSERT INTO notification_prefs (user_id, admin_id, kind, enabled) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, kind) DO UPDATE SET enabled = excluded.enabled`);
  const selectUser = db.prepare('SELECT id, name, email, locale, role, active FROM users WHERE id = ? AND admin_id = ?');
  // The people with a right (lib/roles.js): a built-in role's fixed rights, or a custom role's.
  // A built-in role the owner reshaped (role_settings, migration 047) reads its stored rights.
  const has = (col, perms) => perms.map((p) => `(',' || ${col} || ',') LIKE '%,${p},%'`).join(' OR ');
  const withRight = (builtIn, perms) => db.prepare(`SELECT u.id FROM users u
    LEFT JOIN custom_roles r ON r.id = u.custom_role_id AND r.admin_id = u.admin_id
    LEFT JOIN role_settings rs ON rs.admin_id = u.admin_id AND rs.role = u.role
    WHERE u.admin_id = ? AND u.active = 1 AND (u.role = 'owner'
      OR (r.id IS NULL AND rs.perms IS NULL AND u.role IN (${builtIn.map((x) => `'${x}'`).join(', ')}))
      OR (r.id IS NULL AND rs.perms IS NOT NULL AND (${has('rs.perms', perms)}))
      OR (r.id IS NOT NULL AND (${has('r.perms', perms)})))`).pluck();
  const leaders = withRight(['leader'], ['schedule']); // the team's scheduling: declines
  const eventRoles = withRight(['presenter', 'leader', 'operator'], ['events', 'live']); // proposals
  // The person's scheduled events in a range (not declined): named in the "unavailable" notice.
  const assignedInRange = db.prepare(`SELECT DISTINCT e.id, e.name, e.event_date FROM event_assignments a JOIN events e ON e.id = a.event_id
    WHERE a.admin_id = ? AND a.user_id = ? AND a.status <> 'declined' AND e.is_template = 0 AND e.status <> 'finished'
      AND e.event_date BETWEEN ? AND ? ORDER BY e.event_date, e.id`);
  const selectEvent = db.prepare('SELECT id, name, event_date, start_time, status, is_template FROM events WHERE id = ? AND admin_id = ?');
  const eventsOn = db.prepare("SELECT id, admin_id, name, event_date, start_time FROM events WHERE event_date = ? AND status = 'planned' AND is_template = 0");
  const admins = db.prepare('SELECT id FROM admins WHERE active = 1').pluck();
  const assignedFor = db.prepare("SELECT DISTINCT user_id FROM event_assignments WHERE admin_id = ? AND event_id = ? AND status IN ('pending', 'accepted')").pluck();

  const toRow = (r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, url: r.url, eventId: r.event_id, createdAt: r.created_at, readAt: r.read_at });

  function prefs(adminId, userId) {
    const out = Object.fromEntries(KINDS.map((k) => [k, true]));
    for (const row of prefRows.all(adminId, userId)) if (KINDS.includes(row.kind)) out[row.kind] = Boolean(row.enabled);
    return out;
  }

  function setPrefs(adminId, userId, patch) {
    for (const [kind, enabled] of Object.entries(patch)) if (KINDS.includes(kind)) setPref.run(userId, adminId, kind, enabled ? 1 : 0);
    return prefs(adminId, userId);
  }

  // The event's name and date as the texts say them.
  const eventVars = (ev) => ({ name: ev.name, date: ev.event_date || ev.eventDate, time: ev.start_time || ev.startTime || '' });

  // One notification to one person: a row (unless the kind is off for them) and a push.
  // Returns { stored, pushed } ; never throws (push failures are logged by lib/push.js).
  async function notify(adminId, userId, { kind, vars = {}, url, eventId = null, tag }) {
    const user = selectUser.get(userId, adminId);
    if (!user || !user.active) return { stored: false, pushed: 0 };
    if (!prefs(adminId, userId)[kind]) return { stored: false, pushed: 0, off: true };
    const lang = user.locale === 'en' ? 'en' : 'ro';
    // (a var may depend on the language: a function of it)
    const v = Object.fromEntries(Object.entries(vars).map(([k, x]) => [k, typeof x === 'function' ? x(lang) : x]));
    const title = t(`notifKinds.${kind}.title`, v, lang);
    const body = t(`notifKinds.${kind}.body`, v, lang);
    const { lastInsertRowid: id } = insert.run(adminId, userId, kind, title, body, url || null, eventId, Date.now());
    let pushed = 0;
    if (push && push.enabled && push.hasSubscription(adminId, userId)) {
      const out = await push.sendToUser(adminId, userId, { title, body, url: url || '/notifications', tag: tag || `${kind}-${eventId || 0}`, id }); // id: a tap marks it read (service worker)
      pushed = out.sent;
    }
    return { stored: true, pushed };
  }

  // --- the events -----------------------------------------------------------------------

  // "Trimite programarea": every pending row not yet sent -> its person, once per person.
  // -> { sent (people), withPush, withoutPush, userIds }
  async function onAssigned(adminId, event, rows, sentBy) {
    const byUser = new Map();
    for (const r of rows) {
      if (!byUser.has(r.userId)) byUser.set(r.userId, []);
      byUser.get(r.userId).push(r.positionName);
    }
    const out = { sent: 0, withPush: 0, withoutPush: 0, userIds: [] };
    for (const [userId, positions] of byUser) {
      const res = await notify(adminId, userId, { kind: 'assigned', eventId: event.id, url: `/events/${event.id}`, tag: `assigned-${event.id}`, vars: { ...eventVars(event), positions: positions.join(', '), by: sentBy || '' } });
      if (!res.stored) continue;
      out.sent += 1;
      out.userIds.push(userId);
      if (res.pushed) out.withPush += 1;
      else out.withoutPush += 1;
    }
    return out;
  }

  // "Trimite invitația": each person asked. -> { sent, withPush, withoutPush, userIds }
  async function onInvited(adminId, event, userIds, sentBy) {
    const out = { sent: 0, withPush: 0, withoutPush: 0, userIds: [] };
    for (const userId of userIds) {
      const res = await notify(adminId, userId, { kind: 'invited', eventId: event.id, url: `/events/${event.id}`, tag: `invited-${event.id}`, vars: { ...eventVars(event), by: sentBy || '' } });
      if (!res.stored) continue;
      out.sent += 1;
      out.userIds.push(userId);
      if (res.pushed) out.withPush += 1;
      else out.withoutPush += 1;
    }
    return out;
  }

  // Vin / Poate / Nu pot to the invitation: the owner and the leaders (not the person).
  async function onAttendance(adminId, event, who, status, note) {
    for (const userId of leaders.all(adminId)) {
      if (userId === who.id) continue;
      await notify(adminId, userId, { kind: 'attendance', eventId: event.id, url: `/events/${event.id}/edit`, tag: `attendance-${event.id}`, vars: { ...eventVars(event), who: who.name, answer: (lang) => t(`attend.answers.${status}`, {}, lang), note: note ? ` · ${note}` : '' } });
    }
  }

  // Taken off the event's team (after having been told): each person once, all their positions.
  async function onRemoved(adminId, event, rows) {
    const byUser = new Map();
    for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) || []), r.positionName]);
    let count = 0;
    for (const [userId, names] of byUser) {
      const res = await notify(adminId, userId, { kind: 'unassigned', eventId: event.id, url: `/events/${event.id}`, tag: `unassigned-${event.id}`, vars: { ...eventVars(event), positions: names.join(', ') } });
      if (res.stored) count += 1;
    }
    return count;
  }

  // "Vin": the owner and the leaders (not the person who confirmed, if they are one).
  async function onAccepted(adminId, event, row) {
    for (const userId of leaders.all(adminId)) {
      if (userId === row.userId) continue;
      await notify(adminId, userId, { kind: 'accepted', eventId: event.id, url: `/events/${event.id}/edit`, tag: `accepted-${event.id}`, vars: { ...eventVars(event), who: row.userName, position: row.positionName, note: row.note ? ` · ${row.note}` : '' } });
    }
  }

  // "Nu pot": the owner and the leaders (not the person who declined, if they are one).
  async function onDeclined(adminId, event, row) {
    for (const userId of leaders.all(adminId)) {
      if (userId === row.userId) continue;
      await notify(adminId, userId, { kind: 'declined', eventId: event.id, url: `/events/${event.id}/edit`, tag: `declined-${event.id}`, vars: { ...eventVars(event), who: row.userName, position: row.positionName, note: row.note ? ` · ${row.note}` : '' } });
    }
  }

  // "Indisponibil": the schedulers (owner, leaders; not the person) hear about a new range, and
  // which of the person's scheduled events fall in it (the first one opens).
  async function onUnavailable(adminId, user, range) {
    const affected = assignedInRange.all(adminId, user.id, range.dateFrom, range.dateTo);
    let count = 0;
    for (const userId of leaders.all(adminId)) {
      if (userId === user.id) continue;
      const lang = (selectUser.get(userId, adminId) || {}).locale === 'en' ? 'en' : 'ro';
      const day = (d) => d.split('-').reverse().join('.'); // 06.10.2026
      const when = range.dateFrom === range.dateTo ? day(range.dateFrom) : `${day(range.dateFrom)} – ${day(range.dateTo)}`;
      const events = affected.length
        ? t('notifKinds.unavailable.scheduled', { events: affected.map((e) => `${e.name} (${day(e.event_date)})`).join(', ') }, lang)
        : t('notifKinds.unavailable.notScheduled', {}, lang);
      const res = await notify(adminId, userId, {
        kind: 'unavailable', eventId: affected.length ? affected[0].id : null,
        url: affected.length ? `/events/${affected[0].id}/edit` : '/team?tab=unavail', tag: `unavailable-${user.id}`,
        vars: { who: user.name, when, events, note: range.note ? ` · ${range.note}` : '' },
      });
      if (res.stored) count += 1;
    }
    return count;
  }

  // The Program changed: the assigned people (pending / accepted), at most one per 10 minutes.
  async function onSetlistChanged(adminId, eventId) {
    const ev = selectEvent.get(eventId, adminId);
    if (!ev || ev.is_template) return 0;
    let count = 0;
    const now = Date.now();
    for (const userId of assignedFor.all(adminId, eventId)) {
      const last = lastOfKind.get(adminId, userId, eventId, 'setlist_changed');
      if (last && now - last < SETLIST_THROTTLE_MS) continue;
      const res = await notify(adminId, userId, { kind: 'setlist_changed', eventId, url: `/events/${eventId}`, tag: `setlist-${eventId}`, vars: eventVars(ev) });
      if (res.stored) count += 1;
    }
    return count;
  }

  // The event went live: the assigned people.
  async function onLiveStarted(adminId, eventId) {
    const ev = selectEvent.get(eventId, adminId);
    if (!ev) return 0;
    let count = 0;
    for (const userId of assignedFor.all(adminId, eventId)) {
      const res = await notify(adminId, userId, { kind: 'live_started', eventId, url: `/events/${eventId}/follow`, tag: `live-${eventId}`, vars: eventVars(ev) });
      if (res.stored) count += 1;
    }
    return count;
  }

  // A song proposal: the event roles (not the proposer, if they are one).
  async function onProposal(adminId, event, proposal) {
    let count = 0;
    for (const userId of eventRoles.all(adminId)) {
      if (userId === proposal.proposedBy) continue;
      const res = await notify(adminId, userId, { kind: 'proposal', eventId: event.id, url: event.status === 'live' ? `/events/${event.id}/live` : `/events/${event.id}/edit`, tag: `proposal-${event.id}`, vars: { ...eventVars(event), who: proposal.proposerName, title: proposal.songTitle, note: proposal.note ? ` · ${proposal.note}` : '' } });
      if (res.stored) count += 1;
    }
    return count;
  }

  // The decision: the proposer hears whether the song was added (and where) or declined.
  async function onProposalDecided(adminId, event, proposal) {
    const user = selectUser.get(proposal.proposedBy, adminId);
    const lang = user && user.locale === 'en' ? 'en' : 'ro';
    const where = proposal.status === 'added' ? t(proposal.addedTarget === 'projector' ? 'notifKinds.proposal_decided.projector' : 'notifKinds.proposal_decided.setlist', {}, lang) : t('notifKinds.proposal_decided.declined', {}, lang);
    return notify(adminId, proposal.proposedBy, { kind: 'proposal_decided', eventId: event.id, url: `/events/${event.id}`, tag: `proposal-${proposal.id}`, vars: { ...eventVars(event), title: proposal.songTitle, where, note: proposal.decisionNote ? ` · ${proposal.decisionNote}` : '' } });
  }

  // The reminder tick (every minute): for each active church, the events of tomorrow (church
  // time), once the church's clock passed 18:00; every accepted / pending person once (the
  // notification row is the record, so a restart never repeats it).
  async function tick(now = new Date()) {
    let sent = 0;
    for (const adminId of admins.all()) {
      const tz = settings.timezone(adminId);
      if (nowTimeIn(tz, now) < REMINDER_TIME) continue;
      const tomorrow = todayIn(tz, new Date(now.getTime() + DAY_MS));
      for (const ev of eventsOn.all(tomorrow)) {
        if (ev.admin_id !== adminId) continue;
        for (const userId of assignedFor.all(adminId, ev.id)) {
          if (lastOfKind.get(adminId, userId, ev.id, 'reminder')) continue;
          const res = await notify(adminId, userId, { kind: 'reminder', eventId: ev.id, url: `/events/${ev.id}`, tag: `reminder-${ev.id}`, vars: eventVars(ev) });
          if (res.stored) sent += 1;
        }
      }
    }
    if (sent) logger.info(`Reminders sent: ${sent}`);
    return sent;
  }

  // --- reading -------------------------------------------------------------------------------

  const list = (adminId, userId, limit = LIST_LIMIT) => listRows.all(adminId, userId, Math.min(LIST_LIMIT, limit)).map(toRow);
  const unread = (adminId, userId) => unreadCount.get(adminId, userId);
  function markRead(adminId, userId, ids) {
    const now = Date.now();
    if (ids === 'all') return readAll.run(now, adminId, userId).changes;
    let n = 0;
    for (const id of ids) n += readOne.run(now, id, adminId, userId).changes;
    return n;
  }

  return { KINDS, REMINDER_TIME, SETLIST_THROTTLE_MS, notify, onAssigned, onRemoved, onAccepted, onDeclined, onInvited, onAttendance, onUnavailable, onSetlistChanged, onLiveStarted, onProposal, onProposalDecided, tick, list, unread, markRead, prefs, setPrefs, assignments };
}

module.exports = { KINDS, REMINDER_TIME, SETLIST_THROTTLE_MS, createNotifications };
