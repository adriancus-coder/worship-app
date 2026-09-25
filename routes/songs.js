'use strict';

const express = require('express');
const { requireRole } = require('../lib/auth');
const { LIMITS, SORT_MODES, DuplicateTitleError, validateSong, createSongStore } = require('../lib/songs');

// All routes are scoped to req.adminId from the session. A song of another admin
// simply does not exist here: 404, never 403.
function createSongsRouter({ db, auth, config, logger }) {
  const router = express.Router();
  const songs = createSongStore(db);
  const canEdit = requireRole('owner', 'leader');

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
    res.json({ songs: songs.list(req.adminId, { q, sort }) });
  });

  // Registered before /api/songs/:id.
  router.get('/api/songs/export', canEdit, (req, res) => {
    const payload = songs.exportLibrary(req.adminId, config.APP_NAME);
    const filename = `worship-app-library-${payload.exportedAt.slice(0, 10)}.json`;
    logger.info(`Library exported by user #${req.user.id} (admin #${req.adminId}, ${payload.count} songs)`);
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(payload, null, 2));
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
    const { error, value } = validateSong(req.body, req.t);
    if (error) return res.status(400).json({ error });
    try {
      if (!songs.update(req.adminId, id, value)) return notFound(req, res);
      res.json({ song: songs.get(req.adminId, id) });
    } catch (err) {
      if (err instanceof DuplicateTitleError) return duplicate(req, res, err);
      throw err;
    }
  });

  router.delete('/api/songs/:id', canEdit, (req, res) => {
    const id = songId(req);
    if (!id || !songs.remove(req.adminId, id)) return notFound(req, res);
    logger.info(`Song #${id} deleted by user #${req.user.id} (admin #${req.adminId})`);
    res.json({ ok: true });
  });

  return router;
}

module.exports = createSongsRouter;
