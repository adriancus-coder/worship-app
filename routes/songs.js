'use strict';

const express = require('express');
const { requirePerm, can } = require('../lib/roles');
const { LIMITS, KEYS, COLLECTIONS, SORT_MODES, DuplicateTitleError, validateSong, validateThemes, createSongStore } = require('../lib/songs');
const { THEME_INDEX } = require('../lib/themes');
const { parseChoice, createBackgroundStore } = require('../lib/backgrounds');
const { createMediaSigner } = require('../lib/media');
const { MAX_SONGS, LibraryFileError, parseLibraryFile, planImport } = require('../lib/library-import');
const { createEventStore } = require('../lib/events');
const { createAdminSettings } = require('../lib/admin-settings');
const { todayIn } = require('../lib/dates');

// The import route parses its own body (the global JSON limit is 100 kB, see server.js).
const IMPORT_BODY_LIMIT = '10mb';

// All routes are scoped to req.adminId from the session. A song of another admin
// simply does not exist here: 404, never 403.
function createSongsRouter({ db, auth, config, logger, live }) {
  const backgrounds = createBackgroundStore(db, createMediaSigner(config.DATA_DIR));
  const router = express.Router();
  const songs = createSongStore(db);
  const events = createEventStore(db);
  const settings = createAdminSettings(db);
  // Writing: the 'library' right (both libraries) or the 'school' right (the Sunday school's
  // library only: a song with collection 'school'). mayWrite says which, per song.
  const canEdit = requirePerm('library', 'school');
  const mayWrite = (req, collection) => can(req.user, 'library') || (can(req.user, 'school') && collection === 'school');
  const forbidden = (req, res) => res.status(403).json({ error: req.t('errors.forbidden') });
  // A school-only writer always writes into the school's library.
  const ownCollection = (req, wanted) => (can(req.user, 'library') ? wanted : 'school');
  const today = (req) => todayIn(settings.timezone(req.adminId));

  function songId(req) {
    return /^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : null;
  }

  function notFound(req, res) {
    res.status(404).json({ error: req.t('errors.songNotFound') });
  }

  function duplicate(req, res, err) {
    res.status(409).json({ error: req.t('errors.songDuplicate'), existingId: err.existingId });
  }

  router.use('/api/songs', auth.requireUser, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/api/songs', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, LIMITS.queryMax) : '';
    const sort = SORT_MODES.includes(req.query.sort) ? req.query.sort : 'az';
    // ?noKey=1: only the songs without a key (the library's "Fără ton" filter); ?theme=<name>:
    // only the songs with that theme.
    const theme = typeof req.query.theme === 'string' ? req.query.theme.slice(0, LIMITS.themeMax) : '';
    // ?collection=main (default) | school | all: which library (migration 060)
    const collection = ['school', 'all'].includes(req.query.collection) ? req.query.collection : 'main';
    const list = songs.list(req.adminId, { q, sort, noKey: req.query.noKey === '1', theme, collection });
    // ?withHistory=1 adds lastSung (the last date it was sung: lib/events.js lastSungMap).
    if (req.query.withHistory === '1') {
      const day = today(req);
      const last = events.lastSungMap(req.adminId, day);
      return res.json({ today: day, songs: list.map((s) => ({ ...s, lastSung: last.get(s.id) || null })) });
    }
    res.json({ songs: list });
  });

  // Library file import. ?dryRun=1 only reports; otherwise mode=skip (default) keeps
  // existing songs, mode=update replaces their sections and metadata. One transaction.
  router.post('/api/songs/import', canEdit, express.json({ limit: IMPORT_BODY_LIMIT }), (req, res) => {
    const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
    const mode = req.query.mode === undefined ? 'skip' : req.query.mode;
    if (!['skip', 'update'].includes(mode)) return res.status(400).json({ error: req.t('errors.importMode') });
    // a school-only writer: everything lands in the school's library, nothing is updated
    const schoolOnly = !can(req.user, 'library');
    if (schoolOnly && mode === 'update') return res.status(400).json({ error: req.t('errors.importMode') });

    let file;
    try {
      file = parseLibraryFile(req.body);
    } catch (err) {
      if (!(err instanceof LibraryFileError)) throw err;
      const key = err.code === 'too_many' ? 'errors.importTooMany' : 'errors.importFormat';
      return res.status(400).json({ error: req.t(key, { max: MAX_SONGS }) });
    }
    const plan = () => planImport(file.entries, {
      t: req.t,
      findIdByTitle: (title) => songs.findIdByTitle(req.adminId, title),
    });

    if (dryRun) {
      const p = plan();
      return res.json({
        format: file.format,
        new: p.add.map((x) => x.value.title),
        existing: p.existing.map((x) => x.value.title),
        invalid: p.invalid,
      });
    }

    const before = mode === 'update' ? live.songBefore(req.adminId) : [];
    const result = db.transaction(() => {
      const p = plan();
      for (const { value, meta } of p.add) songs.create(req.adminId, req.user.id, schoolOnly ? { ...value, collection: 'school' } : value, meta);
      if (mode === 'update') {
        for (const { id, value, meta, keepAuthor } of p.existing) {
          const song = keepAuthor ? { ...value, author: songs.get(req.adminId, id).author } : value;
          songs.update(req.adminId, id, song, meta);
        }
      }
      return {
        added: p.add.length,
        updated: mode === 'update' ? p.existing.length : 0,
        skipped: mode === 'update' ? 0 : p.existing.length,
        invalid: p.invalid.length,
      };
    })();
    live.songChanged(req.adminId, before);
    logger.info(`Library import (${file.format}, mode=${mode}) by user #${req.user.id} (admin #${req.adminId}): `
      + `added=${result.added} updated=${result.updated} skipped=${result.skipped} invalid=${result.invalid}`);
    res.json(result);
  });

  // The library's themes ("tematică"), with how many songs carry each: the library filter,
  // the editor's suggestions, the ideas panel. Registered before /api/songs/:id.
  router.get('/api/songs/themes', (req, res) => {
    res.json({ themes: songs.themes(req.adminId), index: THEME_INDEX });
  });

  // The themes of one song (the song page's "Tematică · Setează"): { themes: [names] }.
  router.put('/api/songs/:id/themes', canEdit, (req, res) => {
    const id = songId(req);
    if (!id) return notFound(req, res);
    const { error, value } = validateThemes((req.body || {}).themes, req.t);
    if (error) return res.status(400).json({ error });
    const existing = songs.get(req.adminId, id);
    if (!existing) return notFound(req, res);
    if (!mayWrite(req, existing.collection)) return forbidden(req, res);
    if (!songs.setThemes(req.adminId, id, value)) return notFound(req, res);
    res.json({ song: songs.get(req.adminId, id) });
  });

  // "Detectează gama la toate" (public/key-suggest.js): the keyless songs with chords and
  // their estimated key; then the keys the user approved, set only where none is set.
  // Registered before /api/songs/:id.
  router.get('/api/songs/key-suggestions', canEdit, (req, res) => {
    const out = songs.keySuggestions(req.adminId);
    if (!can(req.user, 'library')) out.songs = out.songs.filter((s) => (songs.get(req.adminId, s.id) || {}).collection === 'school');
    res.json(out);
  });

  router.put('/api/songs/keys', canEdit, (req, res) => {
    const list = req.body && req.body.keys;
    if (!Array.isArray(list) || list.length > MAX_SONGS) return res.status(400).json({ error: req.t('errors.songKeyInvalid') });
    const keys = [];
    for (const item of list) {
      const id = item && /^\d{1,15}$/.test(String(item.id)) ? Number(item.id) : null;
      const key = item && typeof item.song_key === 'string' ? item.song_key.trim() : null;
      if (!id || !key || !KEYS.includes(key)) return res.status(400).json({ error: req.t('errors.songKeyInvalid') });
      keys.push({ id, songKey: key });
    }
    const allowed = keys.filter((k) => { const song = songs.get(req.adminId, k.id); return song && mayWrite(req, song.collection); });
    const before = live.songBefore(req.adminId);
    const result = songs.setKeys(req.adminId, allowed);
    result.skipped.push(...keys.filter((k) => !allowed.includes(k)).map((k) => k.id));
    if (result.saved.length) live.songChanged(req.adminId, before);
    res.json(result);
  });

  // Registered before /api/songs/:id.
  router.get('/api/songs/export', canEdit, (req, res) => {
    const payload = songs.exportLibrary(req.adminId, config.APP_NAME, can(req.user, 'library') ? (['main', 'school'].includes(req.query.collection) ? req.query.collection : 'all') : 'school');
    const filename = `worship-app-library-${payload.exportedAt.slice(0, 10)}.json`;
    logger.info(`Library exported by user #${req.user.id} (admin #${req.adminId}, ${payload.count} songs)`);
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(payload, null, 2));
  });

  // The events this song is in (not templates), newest first.
  router.get('/api/songs/:id/history', (req, res) => {
    const id = songId(req);
    if (!id || !songs.findTitle(req.adminId, id)) return notFound(req, res);
    const day = today(req);
    const dates = events.songHistory(req.adminId, id);
    const lastSung = dates.find((d) => d.eventDate <= day);
    res.json({ songId: id, today: day, lastSung: lastSung ? lastSung.eventDate : null, dates });
  });

  router.get('/api/songs/:id', (req, res) => {
    const id = songId(req);
    const song = id && songs.get(req.adminId, id);
    if (!song) return notFound(req, res);
    res.json({ song });
  });

  router.post('/api/songs', canEdit, (req, res) => {
    const { error, value } = validateSong(req.body, req.t);
    if (error) return res.status(400).json({ error });
    value.collection = ownCollection(req, value.collection);
    try {
      const id = songs.create(req.adminId, req.user.id, value);
      logger.info(`Song #${id} created by user #${req.user.id} (admin #${req.adminId})`);
      res.status(201).json({ song: songs.get(req.adminId, id) });
    } catch (err) {
      if (err instanceof DuplicateTitleError) return duplicate(req, res, err);
      throw err;
    }
  });

  router.put('/api/songs/:id', canEdit, (req, res) => {
    const id = songId(req);
    if (!id) return notFound(req, res);
    // A body with only song_key sets the original key and nothing else (the arrange sheet).
    const body = req.body || {};
    const existing = songs.get(req.adminId, id);
    if (!existing) return notFound(req, res);
    if (!mayWrite(req, existing.collection)) return forbidden(req, res);
    if (Object.keys(body).length === 1 && 'song_key' in body) {
      const key = typeof body.song_key === 'string' ? body.song_key.trim() : null;
      if (key === null || (key && !KEYS.includes(key))) return res.status(400).json({ error: req.t('errors.songKeyInvalid') });
      const before = live.songBefore(req.adminId, id);
      if (!songs.setKey(req.adminId, id, key)) return notFound(req, res);
      live.songChanged(req.adminId, before);
      return res.json({ song: songs.get(req.adminId, id) });
    }
    const { error, value } = validateSong(req.body, req.t);
    if (error) return res.status(400).json({ error });
    if (body.collection === undefined) value.collection = existing.collection; // not given: the song stays where it is
    else if (!mayWrite(req, value.collection)) return forbidden(req, res);
    try {
      const before = live.songBefore(req.adminId, id);
      if (!songs.update(req.adminId, id, value)) return notFound(req, res);
      live.songChanged(req.adminId, before);
      res.json({ song: songs.get(req.adminId, id) });
    } catch (err) {
      if (err instanceof DuplicateTitleError) return duplicate(req, res, err);
      throw err;
    }
  });

  // The song's default background (lib/backgrounds.js): null (the church default), 'none'
  // or a background from the media library.
  router.put('/api/songs/:id/background', canEdit, (req, res) => {
    const id = songId(req);
    const existing = id ? songs.get(req.adminId, id) : null;
    if (!existing) return notFound(req, res);
    if (!mayWrite(req, existing.collection)) return forbidden(req, res);
    const choice = parseChoice((req.body || {}).background);
    if (choice.error || choice.value === undefined
      || (typeof choice.value === 'number' && !backgrounds.find(req.adminId, choice.value))) {
      return res.status(400).json({ error: req.t('errors.backgroundChoiceInvalid') });
    }
    backgrounds.setSongBackground(req.adminId, id, choice.value);
    live.backgroundsChanged(req.adminId);
    res.json({ song: songs.get(req.adminId, id) });
  });

  router.delete('/api/songs/:id', canEdit, (req, res) => {
    const id = songId(req);
    const existing = id ? songs.get(req.adminId, id) : null;
    if (existing && !mayWrite(req, existing.collection)) return forbidden(req, res);
    const before = id ? live.songBefore(req.adminId, id) : [];
    if (!id || !songs.remove(req.adminId, id)) return notFound(req, res);
    live.songChanged(req.adminId, before);
    logger.info(`Song #${id} deleted by user #${req.user.id} (admin #${req.adminId})`);
    res.json({ ok: true });
  });

  return router;
}

module.exports = createSongsRouter;
