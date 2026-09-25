'use strict';

const express = require('express');
const { requireRole } = require('../lib/auth');
const { todayIn } = require('../lib/dates');
const { createAdminSettings } = require('../lib/admin-settings');
const { validateEventMeta, validateItems, createEventStore } = require('../lib/events');

const EDITOR_ROLES = ['owner', 'leader'];
const WHEN = ['upcoming', 'past', 'templates'];

// Events and setlists, scoped to req.adminId. Writes: owner and leader. The team
// (operator, member) only sees published, live and finished events, never templates.
// Another admin's event does not exist here: 404.
function createEventsRouter({ db, auth, logger }) {
  const router = express.Router();
  const events = createEventStore(db);
  const settings = createAdminSettings(db);
  const canEdit = requireRole(...EDITOR_ROLES);

  const isEditor = (req) => EDITOR_ROLES.includes(req.user.role);
  const today = (req) => todayIn(settings.timezone(req.adminId));

  function eventId(req) {
    return /^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : null;
  }

  function notFound(req, res) {
    res.status(404).json({ error: req.t('errors.eventNotFound') });
  }

  // Loads the event for this request (team roles only see published events) or sends 404.
  function load(req, res) {
    const id = eventId(req);
    const found = id && events.get(req.adminId, id, { teamOnly: !isEditor(req), t: req.t });
    if (!found) notFound(req, res);
    return found || null;
  }

  function respond(req, res, id, status = 200) {
    res.status(status).json({ ...events.get(req.adminId, id, { t: req.t }), today: today(req) });
  }

  router.use('/api/events', auth.requireUser, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/api/events', (req, res) => {
    const when = WHEN.includes(req.query.when) ? req.query.when : 'upcoming';
    if (when === 'templates' && !isEditor(req)) return res.status(403).json({ error: req.t('errors.forbidden') });
    const day = today(req);
    res.json({ today: day, when, events: events.list(req.adminId, { when, today: day, teamOnly: !isEditor(req) }) });
  });

  router.get('/api/events/:id', (req, res) => {
    const found = load(req, res);
    if (found) res.json({ ...found, today: today(req) });
  });

  // A song item ready to render (rehearsal, previews): sections transposed and the
  // arrangement resolved. Same visibility as the event.
  router.get('/api/events/:id/items/:itemId/song', (req, res) => {
    const found = load(req, res);
    if (!found) return;
    const itemId = /^\d{1,15}$/.test(req.params.itemId) ? Number(req.params.itemId) : null;
    const result = itemId && events.itemSong(req.adminId, found.event.id, itemId, req.t);
    if (!result) return res.status(404).json({ error: req.t('errors.songNotFound') });
    res.json(result);
  });

  router.post('/api/events', canEdit, (req, res) => {
    const body = req.body || {};
    const { error, value } = validateEventMeta(body, req.t);
    if (error) return res.status(400).json({ error });

    // Optional source: a previous event or a template of the same admin.
    let sourceId = null;
    const fromEvent = body.fromEventId ?? null;
    const fromTemplate = body.fromTemplateId ?? null;
    if (fromEvent !== null && fromTemplate !== null) return res.status(400).json({ error: req.t('errors.eventSourceInvalid') });
    if (fromEvent !== null || fromTemplate !== null) {
      const raw = String(fromEvent ?? fromTemplate);
      const source = /^\d{1,15}$/.test(raw) ? events.get(req.adminId, Number(raw)) : null;
      if (!source || source.event.isTemplate !== (fromTemplate !== null)) {
        return res.status(400).json({ error: req.t('errors.eventSourceInvalid') });
      }
      sourceId = source.event.id;
    }

    const id = events.create(req.adminId, req.user.id, value, { sourceId });
    logger.info(`Event #${id} created by user #${req.user.id} (admin #${req.adminId})${sourceId ? ` from #${sourceId}` : ''}`);
    respond(req, res, id, 201);
  });

  router.put('/api/events/:id', canEdit, (req, res) => {
    const found = load(req, res);
    if (!found) return;
    const { error, value } = validateEventMeta(req.body, req.t);
    if (error) return res.status(400).json({ error });
    events.updateMeta(req.adminId, found.event.id, value);
    respond(req, res, found.event.id);
  });

  router.delete('/api/events/:id', canEdit, (req, res) => {
    const found = load(req, res);
    if (!found) return;
    events.remove(req.adminId, found.event.id);
    logger.info(`Event #${found.event.id} deleted by user #${req.user.id} (admin #${req.adminId})`);
    res.json({ ok: true });
  });

  router.put('/api/events/:id/items', canEdit, (req, res) => {
    const found = load(req, res);
    if (!found) return;
    const { error, value } = validateItems((req.body || {}).items, req.t, (songId) => events.findSong(req.adminId, songId));
    if (error) return res.status(400).json({ error });
    events.replaceItems(req.adminId, found.event.id, value);
    respond(req, res, found.event.id);
  });

  // published <-> draft only; live and finished are set by live mode (stage 4).
  function changeStatus(from, to) {
    return (req, res) => {
      const found = load(req, res);
      if (!found) return;
      const { event } = found;
      if (event.isTemplate) return res.status(409).json({ error: req.t('errors.eventTemplateStatus') });
      if (event.status !== from && event.status !== to) return res.status(409).json({ error: req.t('errors.eventStatusLocked') });
      if (event.status === from) events.setStatus(req.adminId, event.id, to);
      respond(req, res, event.id);
    };
  }

  router.post('/api/events/:id/publish', canEdit, changeStatus('draft', 'published'));
  router.post('/api/events/:id/unpublish', canEdit, changeStatus('published', 'draft'));

  router.post('/api/events/:id/save-as-template', canEdit, (req, res) => {
    const found = load(req, res);
    if (!found) return;
    const { event } = found;
    const { error, value } = validateEventMeta({
      name: (req.body || {}).name,
      eventDate: event.eventDate,
      startTime: event.startTime || '',
      notes: event.notes || '',
    }, req.t);
    if (error) return res.status(400).json({ error });
    const id = events.create(req.adminId, req.user.id, value, { isTemplate: true, sourceId: event.id });
    logger.info(`Template #${id} saved from event #${event.id} by user #${req.user.id} (admin #${req.adminId})`);
    respond(req, res, id, 201);
  });

  return router;
}

module.exports = createEventsRouter;
