'use strict';

const express = require('express');
const { requirePerm, seesAllEvents } = require('../lib/roles');
const { todayIn, nowTimeIn, nextServiceDate } = require('../lib/dates');
const { createAdminSettings } = require('../lib/admin-settings');
const { validateEventMeta, validateItems, createEventStore, SCHOOL_WHO } = require('../lib/events');
const { validateSections } = require('../lib/songs');
const { createAssignmentStore } = require('../lib/assignments');
const { createSuggestStore } = require('../lib/suggest');

const WHEN = ['upcoming', 'past'];
const PLAN_MAX = 60; // "Planifică": events per request
// "2026-10-11" and a real day of the calendar
const realDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

// Events and setlists, scoped to req.adminId. Writes: the 'events' right; start / end /
// withdraw: the 'live' right (lib/roles.js). Members see every event as soon as it exists.
// Another admin's event does not exist here: 404.
function createEventsRouter({ db, auth, logger, live }) {
  const router = express.Router();
  const events = createEventStore(db);
  const assignments = createAssignmentStore(db); // a copy of an event copies its team (pending)
  const settings = createAdminSettings(db);
  const canEdit = requirePerm('events');
  const suggest = createSuggestStore(db);
  const canLive = requirePerm('live');
  const canStart = requirePerm('screens'); // start / end / withdraw: the operator (and the owner)

  const isEditor = (req) => seesAllEvents(req.user);
  const today = (req) => todayIn(settings.timezone(req.adminId));

  function eventId(req) {
    return /^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : null;
  }

  function notFound(req, res) {
    res.status(404).json({ error: req.t('errors.eventNotFound') });
  }

  // Loads the event for this request or sends 404.
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
    const day = today(req);
    res.json({ today: day, when, events: events.list(req.adminId, { when, today: day, teamOnly: !isEditor(req) }) });
  });

  // "+ Eveniment nou" (public/event-new.js): the form's defaults. Before /api/events/:id.
  router.get('/api/events/quick-defaults', canEdit, (req, res) => {
    res.json(quickDefaults(req));
  });

  router.get('/api/events/:id', (req, res) => {
    const found = load(req, res);
    if (found) res.json({ ...found, today: today(req) });
  });

  // A song item ready to render (the phone pages, previews): sections transposed and the
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

    // Optional source: a previous event of the same admin (its items and team are copied).
    let sourceId = null;
    const fromEvent = body.fromEventId ?? null;
    if (fromEvent !== null) {
      const raw = String(fromEvent);
      const source = /^\d{1,15}$/.test(raw) ? events.get(req.adminId, Number(raw)) : null;
      if (!source) return res.status(400).json({ error: req.t('errors.eventSourceInvalid') });
      sourceId = source.event.id;
    }

    const id = events.create(req.adminId, req.user.id, value, { sourceId });
    if (sourceId !== null) assignments.copyFrom(req.adminId, sourceId, id, req.user.id);
    logger.info(`Event #${id} created by user #${req.user.id} (admin #${req.adminId})${sourceId ? ` from #${sourceId}` : ''}`);
    live.eventChanged(req.adminId, id); // open home pages show it at once
    respond(req, res, id, 201);
  });

  // A new programme ("+ Eveniment nou", "Planifică") starts with 10 random song ideas
  // (lib/suggest.js); the editor keeps, swaps or deletes them. Planned one after another,
  // each counts as recent for the next. Returns how many were added.
  // The defaults of a new event: "Serviciu de duminică" at the church's usual time, on the
  // next usual service day (timezone-aware; today until 2 h after the service time).
  function quickDefaults(req) {
    const tz = settings.timezone(req.adminId);
    const service = settings.service(req.adminId);
    // "Serviciu de duminică" / "Sunday service" (2023-01-01 was a Sunday).
    const weekday = new Intl.DateTimeFormat(req.lang === 'en' ? 'en' : 'ro', { weekday: 'long', timeZone: 'UTC' })
      .format(new Date(Date.UTC(2023, 0, 1 + service.weekday)));
    const day = req.lang === 'en' ? weekday : weekday.toLowerCase();
    return {
      name: req.t('events.quickName', { day }),
      eventDate: nextServiceDate(todayIn(tz), nowTimeIn(tz), service.weekday, service.time),
      startTime: service.time,
      today: today(req),
    };
  }

  // "+ Eveniment nou": the event is created with what the form chose (every field optional:
  // the defaults above), and its programme: ten random songs (programme 'random', the
  // default; theme: from one theme), a copy of a past event ('copy', fromEventId) or nothing
  // ('empty'). Opened in the editor right away.
  router.post('/api/events/quick', canEdit, (req, res) => {
    const body = req.body || {};
    const defaults = quickDefaults(req);
    const given = (key) => (typeof body[key] === 'string' && body[key].trim() ? body[key].trim() : undefined);
    const meta = {
      name: given('name') || defaults.name,
      eventDate: given('eventDate') || defaults.eventDate,
      startTime: body.startTime === '' ? '' : (given('startTime') || defaults.startTime),
      notes: typeof body.notes === 'string' ? body.notes : '',
    };
    const { error, value } = validateEventMeta(meta, req.t);
    if (error) return res.status(400).json({ error });
    const programme = ['random', 'copy', 'empty'].includes(body.programme) ? body.programme : 'random';
    let sourceId = null;
    if (programme === 'copy') {
      const raw = String(body.fromEventId ?? '');
      const source = /^\d{1,15}$/.test(raw) ? events.get(req.adminId, Number(raw)) : null;
      if (!source) return res.status(400).json({ error: req.t('errors.eventSourceInvalid') });
      sourceId = source.event.id;
    }
    const theme = typeof body.theme === 'string' ? body.theme.trim().slice(0, 40) : '';
    const id = events.create(req.adminId, req.user.id, value, { sourceId });
    if (sourceId !== null) assignments.copyFrom(req.adminId, sourceId, id, req.user.id);
    const ideas = programme === 'random' ? events.appendSongs(req.adminId, id, suggest.randomSongs(req.adminId, { eventId: id, today: today(req), theme }).songs) : 0;
    logger.info(`Event #${id} created by user #${req.user.id} (admin #${req.adminId}): ${programme}${sourceId ? ` of #${sourceId}` : ''}${ideas ? `, ${ideas} random songs${theme ? ` (${theme})` : ''}` : ''}`);
    live.eventChanged(req.adminId, id);
    res.status(201).json({ ...events.get(req.adminId, id, { t: req.t }), today: defaults.today });
  });

  // Random song ideas for a programme (lib/suggest.js): the library (or one theme of it,
  // ?theme=) minus the songs of the last 3 events and the event's own songs (saved, plus
  // ?exclude=1,2 the editor has not saved yet); songs with a key first. ?count=10 (1-30).
  router.get('/api/events/:id/suggestions', canEdit, (req, res) => {
    const id = eventId(req);
    if (!id || !events.get(req.adminId, id)) return notFound(req, res);
    const exclude = String(req.query.exclude || '').split(',').filter((x) => /^\d{1,15}$/.test(x)).map(Number);
    const theme = typeof req.query.theme === 'string' ? req.query.theme.slice(0, 40) : ''; // ?theme=Paști: only that theme
    const result = suggest.randomSongs(req.adminId, { eventId: id, count: req.query.count, exclude, today: today(req), theme });
    res.json(result);
  });

  // A song item's lyrics as edited during the service (lib/events.js itemLyrics, the live
  // pages' "Versuri"): GET the sections in the song's original key (the item's own, else the
  // library's); PUT { sections } keeps them for this event only; DELETE goes back to the
  // library's. (Saving to the library is PUT /api/songs/:id; the page then clears the item's
  // own.) The live event refreshes at once (the setlist key changes).
  router.get('/api/events/:id/items/:itemId/lyrics', canEdit, (req, res) => {
    const found = load(req, res);
    if (!found) return;
    const itemId = /^\d{1,15}$/.test(req.params.itemId) ? Number(req.params.itemId) : null;
    const lyrics = itemId && events.itemLyrics(req.adminId, found.event.id, itemId);
    if (!lyrics) return res.status(404).json({ error: req.t('errors.songNotFound') });
    res.json(lyrics);
  });

  const setLyrics = (req, res, sections) => {
    const found = load(req, res);
    if (!found) return;
    const itemId = /^\d{1,15}$/.test(req.params.itemId) ? Number(req.params.itemId) : null;
    const before = live.setlistBefore(req.adminId, found.event.id);
    if (!itemId || !events.setItemLyrics(req.adminId, found.event.id, itemId, sections)) return res.status(404).json({ error: req.t('errors.songNotFound') });
    live.setlistChanged(req.adminId, found.event.id, before);
    logger.info(`Event #${found.event.id} item #${itemId}: lyrics ${sections ? 'edited for this event' : 'back to the library'} by user #${req.user.id} (admin #${req.adminId})`);
    res.json(events.itemLyrics(req.adminId, found.event.id, itemId));
  };
  router.put('/api/events/:id/items/:itemId/lyrics', canEdit, (req, res) => {
    const { error, value } = validateSections((req.body || {}).sections, req.t);
    if (error) return res.status(400).json({ error });
    setLyrics(req, res, value);
  });
  router.delete('/api/events/:id/items/:itemId/lyrics', canEdit, (req, res) => setLyrics(req, res, null));

  // "Planifică": many events at once from the calendar. { dates: ['YYYY-MM-DD', ...] (max
  // PLAN_MAX), name?, startTime?, notes? }: one event per date ("Serviciu de <ziua>" at the
  // church's usual time unless given), each with ten random songs. All or nothing.
  // -> 201 { created, events: [{ id, name, eventDate }] }
  router.post('/api/events/plan', canEdit, (req, res) => {
    const body = req.body || {};
    const dates = Array.isArray(body.dates) ? [...new Set(body.dates)].sort() : [];
    if (!dates.length || dates.length > PLAN_MAX || !dates.every(realDate)) return res.status(400).json({ error: req.t('errors.badRequest') });
    const service = settings.service(req.adminId);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const startTime = typeof body.startTime === 'string' && body.startTime ? body.startTime : null;
    // the starting programme of every event, as "+ Eveniment nou" offers it: random songs
    // (from any or one theme), a copy of a past event (its items and its team), or empty
    const programme = ['random', 'copy', 'empty'].includes(body.programme) ? body.programme : 'random';
    const theme = typeof body.theme === 'string' ? body.theme.trim().slice(0, 40) : '';
    let sourceId = null;
    if (programme === 'copy') {
      const raw = String(body.fromEventId ?? '');
      const source = /^\d{1,15}$/.test(raw) ? events.get(req.adminId, Number(raw)) : null;
      if (!source) return res.status(400).json({ error: req.t('errors.eventSourceInvalid') });
      sourceId = source.event.id;
    }
    const metas = [];
    for (const eventDate of dates) {
      const weekday = new Intl.DateTimeFormat(req.lang === 'en' ? 'en' : 'ro', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${eventDate}T12:00:00Z`));
      const day = req.lang === 'en' ? weekday : weekday.toLowerCase();
      const { error, value } = validateEventMeta({
        name: name || req.t('events.quickName', { day }),
        eventDate,
        startTime: startTime || service.time,
        notes: typeof body.notes === 'string' ? body.notes : '',
      }, req.t);
      if (error) return res.status(400).json({ error });
      metas.push(value);
    }
    const created = db.transaction(() => metas.map((value) => {
      const id = events.create(req.adminId, req.user.id, value, { sourceId });
      if (sourceId !== null) assignments.copyFrom(req.adminId, sourceId, id, req.user.id);
      if (programme === 'random') events.appendSongs(req.adminId, id, suggest.randomSongs(req.adminId, { eventId: id, today: today(req), theme }).songs);
      return { id, name: value.name, eventDate: value.eventDate };
    }))();
    logger.info(`${created.length} event(s) planned by user #${req.user.id} (admin #${req.adminId}): ${programme}${sourceId ? ` of #${sourceId}` : ''}${theme ? ` (${theme})` : ''}`);
    for (const ev of created) live.eventChanged(req.adminId, ev.id);
    res.status(201).json({ created: created.length, events: created });
  });

  // "▶ Pornește live" from Acasă: starts the event in one tap (the page then opens the live
  // page or the console). Another event live: 409 with its name, unless { endOther: true }.
  router.post('/api/events/:id/start', canStart, (req, res) => {
    const found = load(req, res);
    if (!found) return;
    const out = live.startEvent(req.adminId, found.event.id, { role: req.user.liveRole, userId: req.user.id, endOther: (req.body || {}).endOther === true });
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
  router.post('/api/events/:id/end', canStart, (req, res) => {
    const found = load(req, res);
    if (!found) return;
    const out = live.endEvent(req.adminId, found.event.id, { role: req.user.liveRole, userId: req.user.id });
    if (out.ok) return respond(req, res, found.event.id);
    const key = `live.errors.${out.code}`;
    res.status(409).json({ code: out.code, error: req.t(key) === key ? req.t('errors.internal') : req.t(key) });
  });

  // "Retrage din live" (the event page): back to planned without ending it. 409 when not live.
  router.post('/api/events/:id/withdraw', canStart, (req, res) => {
    const found = load(req, res);
    if (!found) return;
    const out = live.endEvent(req.adminId, found.event.id, { role: req.user.liveRole, userId: req.user.id, withdraw: true });
    if (out.ok) return respond(req, res, found.event.id);
    const key = `live.errors.${out.code}`;
    res.status(409).json({ code: out.code, error: req.t(key) === key ? req.t('errors.internal') : req.t(key) });
  });

  // "Detalii · Program de la · Copie a evenimentului": the setlist becomes a copy of another
  // event's (never its own; the items get new ids).
  router.post('/api/events/:id/apply-copy', canEdit, (req, res) => {
    const found = load(req, res);
    if (!found) return;
    const raw = String((req.body || {}).fromEventId ?? '');
    const source = /^\d{1,15}$/.test(raw) ? events.get(req.adminId, Number(raw)) : null;
    if (!source || source.event.id === found.event.id) {
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

  // The Sunday school's songs in a programme (the 'school' right; the event right has the
  // editor). POST { songId } appends a school-library song marked "Școala duminicală";
  // DELETE takes such a song out. Not on a finished event (409). A live event's positions
  // follow (live.setlistChanged).
  router.post('/api/events/:id/items/school', requirePerm('school', 'events'), (req, res) => {
    const found = load(req, res);
    if (!found) return;
    if (found.event.status === 'finished') return res.status(409).json({ code: 'eventFinished', error: req.t('errors.schoolEventClosed') });
    const songId = Number((req.body || {}).songId);
    const song = Number.isInteger(songId) && songId > 0 ? events.findSong(req.adminId, songId) : null;
    if (!song || song.collection !== 'school') return res.status(400).json({ error: req.t('errors.schoolSongOnly') });
    const before = live.setlistBefore(req.adminId, found.event.id);
    const itemId = events.appendSchoolSong(req.adminId, found.event.id, song);
    live.setlistChanged(req.adminId, found.event.id, before);
    logger.info(`School song #${song.id} added to event #${found.event.id} by user #${req.user.id} (admin #${req.adminId})`);
    res.status(201).json({ itemId, who: SCHOOL_WHO, ...events.get(req.adminId, found.event.id, { t: req.t }), today: today(req) });
  });
  router.delete('/api/events/:id/items/:itemId/school', requirePerm('school', 'events'), (req, res) => {
    const found = load(req, res);
    if (!found) return;
    if (found.event.status === 'finished') return res.status(409).json({ code: 'eventFinished', error: req.t('errors.schoolEventClosed') });
    const itemId = /^\d{1,15}$/.test(req.params.itemId) ? Number(req.params.itemId) : null;
    const before = live.setlistBefore(req.adminId, found.event.id);
    if (!itemId || !events.removeSchoolSong(req.adminId, found.event.id, itemId)) return res.status(404).json({ error: req.t('errors.itemNotFound') });
    live.setlistChanged(req.adminId, found.event.id, before);
    respond(req, res, found.event.id);
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

  return router;
}

module.exports = createEventsRouter;
