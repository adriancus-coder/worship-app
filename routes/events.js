'use strict';

const express = require('express');
const { requireRole } = require('../lib/auth');
const { todayIn, nowTimeIn, nextServiceDate } = require('../lib/dates');
const { createAdminSettings } = require('../lib/admin-settings');
const { EVENT_ROLES, validateEventMeta, validateItems, createEventStore } = require('../lib/events');

const WHEN = ['upcoming', 'past', 'templates'];

// Events and setlists, scoped to req.adminId. Writes: the event roles (owner, leader,
// operator). Members see every event as soon as it exists, never templates.
// Another admin's event does not exist here: 404.
function createEventsRouter({ db, auth, logger, live }) {
  const router = express.Router();
  const events = createEventStore(db);
  const settings = createAdminSettings(db);
  const canEdit = requireRole(...EVENT_ROLES);

  const isEditor = (req) => EVENT_ROLES.includes(req.user.role);
  const today = (req) => todayIn(settings.timezone(req.adminId));

  function eventId(req) {
    return /^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : null;
  }

  function notFound(req, res) {
    res.status(404).json({ error: req.t('errors.eventNotFound') });
  }

  // Loads the event for this request (the team never sees templates) or sends 404.
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
    // The projector-only items too, for the event roles; team phones see the shared
    // setlist only.
    const scope = isEditor(req) ? 'all' : 'shared';
    const result = itemId && events.itemSong(req.adminId, found.event.id, itemId, req.t, { scope });
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
    if (fromTemplate !== null) rememberTemplate(req.adminId, sourceId);
    logger.info(`Event #${id} created by user #${req.user.id} (admin #${req.adminId})${sourceId ? ` from #${sourceId}` : ''}`);
    live.eventChanged(req.adminId, id); // open home pages show it at once
    respond(req, res, id, 201);
  });

  // The template "+ Eveniment nou" starts from: the one used last (remembered per church),
  // else the most recently changed one, else none.
  function quickTemplate(adminId) {
    const last = Number(settings.get(adminId, 'last_template_id'));
    const used = Number.isInteger(last) && last > 0 ? events.get(adminId, last) : null;
    if (used && used.event.isTemplate) return used.event;
    const latest = events.latestTemplateId(adminId);
    return latest === null ? null : events.get(adminId, latest).event;
  }

  const rememberTemplate = (adminId, id) => settings.set(adminId, 'last_template_id', String(id));

  // One tap: an event with smart defaults, opened in the editor right away. The template's
  // name, time and items, else "Serviciu de duminică" at the church's usual time; the date
  // is the next usual service day (timezone-aware; today until 2 h after the service time).
  router.post('/api/events/quick', canEdit, (req, res) => {
    const tz = settings.timezone(req.adminId);
    const service = settings.service(req.adminId);
    const template = quickTemplate(req.adminId);
    // "Serviciu de duminică" / "Sunday service" (2023-01-01 was a Sunday).
    const weekday = new Intl.DateTimeFormat(req.lang === 'en' ? 'en' : 'ro', { weekday: 'long', timeZone: 'UTC' })
      .format(new Date(Date.UTC(2023, 0, 1 + service.weekday)));
    const day = req.lang === 'en' ? weekday : weekday.toLowerCase();
    const meta = {
      name: template ? template.name : req.t('events.quickName', { day }),
      eventDate: nextServiceDate(todayIn(tz), nowTimeIn(tz), service.weekday, service.time),
      startTime: (template && template.startTime) || service.time,
      notes: '',
    };
    const { error, value } = validateEventMeta(meta, req.t);
    if (error) return res.status(400).json({ error });
    const id = events.create(req.adminId, req.user.id, value, { sourceId: template ? template.id : null });
    if (template) rememberTemplate(req.adminId, template.id);
    logger.info(`Event #${id} quick-created by user #${req.user.id} (admin #${req.adminId})${template ? ` from template #${template.id}` : ''}`);
    live.eventChanged(req.adminId, id);
    res.status(201).json({ ...events.get(req.adminId, id, { t: req.t }), today: today(req), templateId: template ? template.id : null });
  });

  // "▶ Pornește live" from Acasă: starts the event in one tap (the page then opens the live
  // page or the console). Another event live: 409 with its name, unless { endOther: true }.
  router.post('/api/events/:id/start', canEdit, (req, res) => {
    const found = load(req, res);
    if (!found) return;
    const out = live.startEvent(req.adminId, found.event.id, { role: req.user.role, userId: req.user.id, endOther: (req.body || {}).endOther === true });
    if (out.ok) return respond(req, res, found.event.id);
    if (out.code === 'anotherLive') {
      const other = events.get(req.adminId, out.liveEventId);
      return res.status(409).json({ code: 'anotherLive', error: req.t('live.errors.anotherLive'), live: other ? { id: other.event.id, name: other.event.name } : null });
    }
    const key = `live.errors.${out.code}`;
    res.status(409).json({ code: out.code, error: req.t(key) === key ? req.t('errors.internal') : req.t(key) });
  });

  // "Încheie" on the home card (a live event forgotten since yesterday): ends it. 409 when
  // it is not live.
  router.post('/api/events/:id/end', canEdit, (req, res) => {
    const found = load(req, res);
    if (!found) return;
    const out = live.endEvent(req.adminId, found.event.id, { role: req.user.role, userId: req.user.id });
    if (out.ok) return respond(req, res, found.event.id);
    const key = `live.errors.${out.code}`;
    res.status(409).json({ code: out.code, error: req.t(key) === key ? req.t('errors.internal') : req.t(key) });
  });

  // The editor's "Detalii · Șablon": the setlist becomes the template's (it is remembered
  // for the next "+ Eveniment nou").
  router.post('/api/events/:id/apply-template', canEdit, (req, res) => {
    const found = load(req, res);
    if (!found) return;
    const raw = String((req.body || {}).templateId ?? '');
    const template = /^\d{1,15}$/.test(raw) ? events.get(req.adminId, Number(raw)) : null;
    if (!template || !template.event.isTemplate || found.event.isTemplate) return res.status(400).json({ error: req.t('errors.eventSourceInvalid') });
    const before = live.setlistBefore(req.adminId, found.event.id);
    events.applyTemplate(req.adminId, found.event.id, template.event.id);
    live.setlistChanged(req.adminId, found.event.id, before);
    rememberTemplate(req.adminId, template.event.id);
    respond(req, res, found.event.id);
  });

  // "Detalii · Program de la · Copie a evenimentului": the setlist becomes a copy of another
  // event's (never a template's, never its own; the items get new ids).
  router.post('/api/events/:id/apply-copy', canEdit, (req, res) => {
    const found = load(req, res);
    if (!found) return;
    const raw = String((req.body || {}).fromEventId ?? '');
    const source = /^\d{1,15}$/.test(raw) ? events.get(req.adminId, Number(raw)) : null;
    if (!source || source.event.isTemplate || found.event.isTemplate || source.event.id === found.event.id) {
      return res.status(400).json({ error: req.t('errors.eventSourceInvalid') });
    }
    const before = live.setlistBefore(req.adminId, found.event.id);
    events.applyFrom(req.adminId, found.event.id, source.event.id);
    live.setlistChanged(req.adminId, found.event.id, before);
    logger.info(`Event #${found.event.id}: setlist copied from #${source.event.id} by user #${req.user.id} (admin #${req.adminId})`);
    respond(req, res, found.event.id);
  });

  // "Detalii · Program de la · Gol": the setlist is emptied.
  router.post('/api/events/:id/clear', canEdit, (req, res) => {
    const found = load(req, res);
    if (!found) return;
    const before = live.setlistBefore(req.adminId, found.event.id);
    events.clearItems(req.adminId, found.event.id);
    live.setlistChanged(req.adminId, found.event.id, before);
    logger.info(`Event #${found.event.id}: setlist cleared by user #${req.user.id} (admin #${req.adminId})`);
    respond(req, res, found.event.id);
  });

  router.put('/api/events/:id', canEdit, (req, res) => {
    const found = load(req, res);
    if (!found) return;
    const { error, value } = validateEventMeta(req.body, req.t);
    if (error) return res.status(400).json({ error });
    events.updateMeta(req.adminId, found.event.id, value);
    live.eventChanged(req.adminId, found.event.id);
    respond(req, res, found.event.id);
  });

  router.delete('/api/events/:id', canEdit, (req, res) => {
    const found = load(req, res);
    if (!found) return;
    events.remove(req.adminId, found.event.id);
    live.eventChanged(req.adminId, found.event.id);
    logger.info(`Event #${found.event.id} deleted by user #${req.user.id} (admin #${req.adminId})`);
    res.json({ ok: true });
  });

  router.put('/api/events/:id/items', canEdit, (req, res) => {
    const found = load(req, res);
    if (!found) return;
    const { error, value } = validateItems((req.body || {}).items, req.t,
      (songId) => events.findSong(req.adminId, songId), (mediaId) => events.findMedia(req.adminId, mediaId),
      (mediaId) => events.findBackground(req.adminId, mediaId));
    if (error) return res.status(400).json({ error });
    const before = live.setlistBefore(req.adminId, found.event.id);
    events.replaceItems(req.adminId, found.event.id, value);
    live.setlistChanged(req.adminId, found.event.id, before);
    respond(req, res, found.event.id);
  });

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
