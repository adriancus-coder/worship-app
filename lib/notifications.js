'use strict';

// The notifications centre (migration 033): every team event writes a row for the person (in
// their language) and, when they are subscribed, sends a small push (lib/push.js). Kinds:
//   assigned         the leader sent the schedule (routes/assignments.js "send")
//   reminder         the day before an event, at 18:00 church time, to accepted / pending
//   setlist_changed  the Program of an event one is assigned to changed (max one per 10 min)
//   declined         to the owner and the leaders when someone says "Nu pot"
//   live_started     to the assigned people when the event goes live
// Each kind can be switched off per person (notification_prefs; all on by default). The
// reminder scheduler is a minute tick, idempotent per event and person (the row itself is the
// record), so restarts never send twice.

const { t } = require('./i18n');
const { todayIn, nowTimeIn } = require('./dates');
const { createAdminSettings } = require('./admin-settings');
const { createAssignmentStore } = require('./assignments');

const KINDS = ['assigned', 'reminder', 'setlist_changed', 'declined', 'live_started'];
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
  const leaders = db.prepare("SELECT id FROM users WHERE admin_id = ? AND active = 1 AND role IN ('owner', 'leader')").pluck();
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
    const title = t(`notifKinds.${kind}.title`, vars, lang);
    const body = t(`notifKinds.${kind}.body`, vars, lang);
    insert.run(adminId, userId, kind, title, body, url || null, eventId, Date.now());
    let pushed = 0;
    if (push && push.enabled && push.hasSubscription(adminId, userId)) {
      const out = await push.sendToUser(adminId, userId, { title, body, url: url || '/notifications', tag: tag || `${kind}-${eventId || 0}` });
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

  // "Nu pot": the owner and the leaders (not the person who declined, if they are one).
  async function onDeclined(adminId, event, row) {
    for (const userId of leaders.all(adminId)) {
      if (userId === row.userId) continue;
      await notify(adminId, userId, { kind: 'declined', eventId: event.id, url: `/events/${event.id}/edit`, tag: `declined-${event.id}`, vars: { ...eventVars(event), who: row.userName, position: row.positionName, note: row.note ? ` · ${row.note}` : '' } });
    }
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

  return { KINDS, REMINDER_TIME, SETLIST_THROTTLE_MS, notify, onAssigned, onDeclined, onSetlistChanged, onLiveStarted, tick, list, unread, markRead, prefs, setPrefs, assignments };
}

module.exports = { KINDS, REMINDER_TIME, SETLIST_THROTTLE_MS, createNotifications };
