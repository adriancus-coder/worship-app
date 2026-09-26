'use strict';

const express = require('express');
const asyncRoute = require('../lib/async-route');
const { requireRole } = require('../lib/auth');
const { createRequestLimiter } = require('../lib/rate-limit');
const { validateSong, createSongStore, DuplicateTitleError } = require('../lib/songs');
const { EVENT_ROLES } = require('../lib/events');
const resurse = require('../lib/resurse');

const RATE_LIMIT = { maxRequests: 30, windowMs: 10 * 60 * 1000 };

// ResurseError code -> [HTTP status, i18n key]
const ERRORS = {
  invalid_url: [400, 'errors.resurseInvalidUrl'],
  query_too_short: [400, 'errors.resurseQueryTooShort'],
  not_found: [404, 'errors.resurseNotFound'],
  timeout: [504, 'errors.resurseTimeout'],
  unreachable: [502, 'errors.resurseUnreachable'],
  upstream_error: [502, 'errors.resurseUnreachable'],
  blocked_host: [502, 'errors.resurseBadResponse'],
  too_large: [502, 'errors.resurseBadResponse'],
  bad_response: [502, 'errors.resurseBadResponse'],
};

// Search, preview and import from resursecrestine.ro: the event roles (owner, leader,
// operator), so a song can be brought in while preparing or during the service. Writing
// songs by hand (/api/songs) stays with owner and leader. Rate limited per user.
function createResurseRouter({ db, auth, logger }) {
  const router = express.Router();
  const songs = createSongStore(db);
  const limiter = createRequestLimiter(RATE_LIMIT);

  router.use('/api/resurse', auth.requireUser, requireRole(...EVENT_ROLES), (req, res, next) => {
    const retryAfter = limiter.take(`user:${req.user.id}`);
    if (retryAfter > 0) {
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: req.t('errors.resurseRateLimited') });
    }
    res.set('Cache-Control', 'no-store');
    next();
  });

  function fail(req, res, err) {
    const mapped = err instanceof resurse.ResurseError && ERRORS[err.code];
    if (!mapped) throw err;
    if (mapped[0] >= 500) logger.warn(`resursecrestine: ${err.code} (${err.message})`);
    res.status(mapped[0]).json({ error: req.t(mapped[1]) });
  }

  function source(body) {
    const input = body || {};
    return { url: typeof input.url === 'string' ? input.url.trim() : undefined, id: input.id };
  }

  // Parsed song -> the body POST /api/songs accepts.
  function toSongBody(parsed) {
    return {
      title: parsed.title,
      author: parsed.author || '',
      song_key: parsed.key || '',
      sections: parsed.sections.map(({ type, label, content }) => ({ type, label: label || '', content })),
    };
  }

  // Each result says whether a song with the same (normalized) title is already in the library.
  router.post('/api/resurse/search', asyncRoute(async (req, res) => {
    try {
      const results = await resurse.searchResurseCrestineSongs((req.body || {}).query);
      res.json(results.map((item) => ({ ...item, existingId: songs.findIdByTitle(req.adminId, item.title) })));
    } catch (err) {
      fail(req, res, err);
    }
  }));

  router.post('/api/resurse/preview', asyncRoute(async (req, res) => {
    let parsed;
    try {
      parsed = await resurse.importFromUrl(source(req.body));
    } catch (err) {
      return fail(req, res, err);
    }
    const { error } = validateSong(toSongBody(parsed), req.t);
    res.json({
      song: parsed,
      existingId: songs.findIdByTitle(req.adminId, parsed.title),
      invalid: error || null,
    });
  }));

  router.post('/api/resurse/import', asyncRoute(async (req, res) => {
    let parsed;
    try {
      parsed = await resurse.importFromUrl(source(req.body));
    } catch (err) {
      return fail(req, res, err);
    }
    const { error, value } = validateSong(toSongBody(parsed), req.t);
    if (error) return res.status(400).json({ error });
    try {
      const id = songs.create(req.adminId, req.user.id, value, {
        sourceProvider: parsed.sourceProvider,
        sourceUrl: parsed.sourceUrl,
        presentation: parsed.presentation,
      });
      logger.info(`Song #${id} imported from ${parsed.sourceUrl} by user #${req.user.id} (admin #${req.adminId})`);
      res.status(201).json({ song: songs.get(req.adminId, id) });
    } catch (err) {
      if (err instanceof DuplicateTitleError) {
        return res.status(409).json({ error: req.t('errors.songDuplicate'), existingId: err.existingId });
      }
      throw err;
    }
  }));

  return router;
}

module.exports = createResurseRouter;
