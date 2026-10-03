'use strict';

const express = require('express');
const { createEventStore } = require('../lib/events');
const { can, seesAllEvents } = require('../lib/roles');
const { createAssignmentStore, MAX_NOTE } = require('../lib/assignments');
const { createPositionStore } = require('../lib/positions');
const { createTeamStore } = require('../lib/team');
const { createUnavailabilityStore } = require('../lib/unavailability');

// The team of an event (lib/assignments.js).
//   GET  /api/events/:id/assignments            everyone of the admin (members: no notes but their own)
//   PUT  /api/events/:id/assignments            owner, leader: the full list [{ userId, positionId }]
//   POST /api/events/:id/assignments/send       owner, leader: notifies the pending rows not yet sent;
//                                               { ids: [aid] }: just these pending rows (sent before too:
//                                               a reminder)
//   POST /api/events/:id/assignments/:aid/respond  the assigned person: { status: accepted|declined, note? }
// hooks (set later by the notifications module): onAccepted(...), onDeclined(...), onRemoved(...), onSent(...).
function createAssignmentsRouter({ db, auth, logger, hooks = {} }) {
  const router = express.Router();
  const events = createEventStore(db);
  const assignments = createAssignmentStore(db);
  const positions = createPositionStore(db);
  const team = createTeamStore(db);
  const unavailability = createUnavailabilityStore(db);

  router.use('/api/events/:id/assignments', auth.requireUser, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const canAssign = (req) => can(req.user, 'schedule');
  const isEditor = (req) => seesAllEvents(req.user) || canAssign(req);

  // The event, as this role may see it (members never see templates), or a 404.
  function load(req, res) {
    const id = /^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : null;
    const found = id && events.get(req.adminId, id, { teamOnly: !isEditor(req), t: req.t });
    if (!found) res.status(404).json({ error: req.t('errors.notFound') });
    return found || null;
  }

  function payload(req, found) {
    const rows = assignments.list(req.adminId, found.event.id);
    const editor = isEditor(req);
    const visible = rows.map((r) => (editor || r.userId === req.user.id ? r : { ...r, note: null, notifiedAt: undefined }));
    const body = {
      assignments: visible,
      summary: assignments.summary(rows),
      me: rows.filter((r) => r.userId === req.user.id),
      canAssign: canAssign(req),
      positions: positions.list(req.adminId),
    };
    if (canAssign(req)) {
      // The picker: every active person with their usual positions (unavailability: commit 3).
      const by = positions.byUser(req.adminId);
      const busy = found.event.isTemplate ? new Map() : unavailability.onDate(req.adminId, found.event.eventDate);
      body.people = team.list(req.adminId).filter((u) => u.active).map((u) => ({
        id: u.id, name: u.name, role: u.role, positionIds: by.get(u.id) || [],
        unavailable: busy.has(u.id) ? { dateFrom: busy.get(u.id).dateFrom, dateTo: busy.get(u.id).dateTo, note: busy.get(u.id).note } : null,
      }));
    }
    return body;
  }

  router.get('/api/events/:id/assignments', (req, res) => {
    const found = load(req, res);
    if (!found) return;
    res.json(payload(req, found));
  });

  router.put('/api/events/:id/assignments', (req, res) => {
    if (!canAssign(req)) return res.status(403).json({ error: req.t('errors.forbidden') });
    const found = load(req, res);
    if (!found) return;
    const wanted = (req.body || {}).assignments;
    if (!Array.isArray(wanted) || wanted.length > 200) return res.status(400).json({ error: req.t('errors.badRequest') });
    const before = assignments.list(req.adminId, found.event.id);
    const out = assignments.replace(req.adminId, found.event.id, wanted, req.user.id);
    if (out.error) return res.status(400).json({ error: req.t(`errors.${out.error === 'badRequest' ? 'badRequest' : 'assignmentInvalid'}`) });
    if (out.added || out.removed) logger.info(`Event #${found.event.id}: team +${out.added} -${out.removed} by user #${req.user.id} (admin #${req.adminId})`);
    // the people taken off a position they had been told about hear it (never one not told yet)
    if (out.removed && hooks.onRemoved && !found.event.isTemplate) {
      const kept = new Set(wanted.map((w) => `${w && w.userId}:${w && w.positionId}`));
      const gone = before.filter((r) => r.notifiedAt && r.status !== 'declined' && !kept.has(`${r.userId}:${r.positionId}`));
      if (gone.length) hooks.onRemoved({ req, event: found.event, rows: gone });
    }
    res.json(payload(req, found));
  });

  // "Trimite programarea": every pending row not yet sent is marked; the hook notifies.
  // { ids }: "Trimite" / "Retrimite" under one name - those pending rows, sent or not.
  router.post('/api/events/:id/assignments/send', async (req, res, next) => {
    try {
      if (!canAssign(req)) return res.status(403).json({ error: req.t('errors.forbidden') });
      const found = load(req, res);
      if (!found) return;
      if (found.event.isTemplate) return res.status(400).json({ error: req.t('errors.badRequest') });
      const ids = (req.body || {}).ids;
      if (ids !== undefined && (!Array.isArray(ids) || !ids.length || !ids.every((id) => Number.isInteger(id)))) return res.status(400).json({ error: req.t('errors.badRequest') });
      const rows = assignments.list(req.adminId, found.event.id)
        .filter((r) => r.status === 'pending' && (ids ? ids.includes(r.id) : !r.notifiedAt));
      if (ids && !rows.length) return res.status(409).json({ code: 'notPending', error: req.t('errors.assignNotPending') });
      const result = hooks.onSent ? await hooks.onSent({ req, event: found.event, rows }) : { sent: rows.length, withoutPush: 0, emailed: 0 };
      assignments.markSent(req.adminId, rows.map((r) => r.id));
      logger.info(`Event #${found.event.id}: schedule sent to ${rows.length} person(s) by user #${req.user.id} (admin #${req.adminId})`);
      res.json({ ...payload(req, found), sent: result });
    } catch (err) {
      next(err);
    }
  });

  router.post('/api/events/:id/assignments/:aid/respond', (req, res) => {
    const found = load(req, res);
    if (!found) return;
    const aid = /^\d{1,15}$/.test(req.params.aid) ? Number(req.params.aid) : null;
    const body = req.body || {};
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, MAX_NOTE) : '';
    if (!['accepted', 'declined'].includes(body.status)) return res.status(400).json({ error: req.t('errors.badRequest') });
    const row = aid && assignments.answer(req.adminId, found.event.id, aid, req.user.id, body.status, note);
    if (!row) return res.status(404).json({ error: req.t('errors.notFound') });
    logger.info(`Event #${found.event.id}: user #${req.user.id} ${body.status} (${row.positionName}) (admin #${req.adminId})`);
    if (body.status === 'declined' && hooks.onDeclined) hooks.onDeclined({ req, event: found.event, row });
    if (body.status === 'accepted' && hooks.onAccepted) hooks.onAccepted({ req, event: found.event, row });
    res.json(payload(req, found));
  });

  return router;
}

module.exports = { createAssignmentsRouter };
