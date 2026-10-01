'use strict';

const fs = require('fs');
const express = require('express');
const { requireRole } = require('../lib/auth');
const { VARIANTS, sniffVideo, sniffImage, parseVideoUrl, validateTitle, createMediaStore, createMediaSigner } = require('../lib/media');
const { createScreenStore } = require('../lib/screens');
const { screenCredential } = require('./screens');
const { parseReadability, createBackgroundStore } = require('../lib/backgrounds');
const { createMediaQuota } = require('../lib/platform');

const { EDITOR_ROLES } = require('../lib/events');
const { MediaFetchError, fetchToTemp } = require('../lib/media-fetch');
const { PexelsError } = require('../lib/pexels');
const asyncRoute = require('../lib/async-route');

// Media library (videos and backgrounds for the projector), scoped to req.adminId.
//   GET    /api/media                  list (owner, leader, operator), with the church's
//                                      default backgrounds (what "Implicit" means in pickers)
//   POST   /api/media/upload?title=…&as=video|background
//                                      raw body, streamed to disk: a video (MP4 / WebM), or a
//                                      background: an image (JPEG / PNG / WebP, max 8 MB) or a
//                                      silent loop (MP4 / WebM, max 50 MB)
//   POST   /api/media/url {title,url}  https .mp4/.webm, YouTube or Vimeo
//   PUT    /api/media/:id {title?, dim?, blur?, shadow?}
//                                      rename; a background's readability (dim 0-80 %, blur
//                                      0-20 px, text shadow on / off)
//   DELETE /api/media/:id              delete (and its file)
//   GET    /api/media/:id/file[?v=display|thumb]
//                                      the uploaded file with Range support (images: the
//          projector version or the thumbnail), for that admin's users (session), its
//          screens (X-Screen-Token / X-Screen-Key) or a signed URL (screens).
// "cdn.example.org/sky.jpg" -> "sky" (the title of a background fetched from a link).
function titleFromUrl(url) {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '').replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
    return last || u.hostname;
  } catch (err) {
    return 'Fundal';
  }
}

// mediaFetch: tests hand in a stand-in for fetch (fixtures/mock-cdn.js sets global.fetch).
// pexels: lib/pexels.js (null: the provider is off, /api/media/pexels/* answer 503).
function createMediaRouter({ db, auth, config, logger, live, storage, pexels = null, mediaFetch = (...args) => globalThis.fetch(...args) }) {
  const router = express.Router();
  const media = createMediaStore(db, config.DATA_DIR);
  const quota = createMediaQuota(db, config.MEDIA_MAX_ADMIN_BYTES); // per church (platform page)
  const signer = createMediaSigner(config.DATA_DIR);
  const screens = createScreenStore(db);
  const backgrounds = createBackgroundStore(db, signer);
  const canEdit = requireRole(...EDITOR_ROLES);
  const adminOf = db.prepare('SELECT admin_id FROM media WHERE id = ?').pluck();

  const mediaId = (req) => (/^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : null);
  const notFound = (req, res) => res.status(404).json({ error: req.t('errors.mediaNotFound') });
  const mb = (bytes) => {
    const value = bytes / (1024 * 1024);
    return `${value < 10 ? Number(value.toFixed(1)) : Math.round(value)} MB`;
  };

  // The file route comes first: it has its own access rules (screens have no session).
  router.get('/api/media/:id/file', (req, res) => {
    const id = mediaId(req);
    const owner = id ? adminOf.get(id) : undefined;
    if (owner === undefined) return notFound(req, res);
    const session = auth.getActiveSession(req);
    const found = session ? null : screens.identify(screenCredential(req));
    const screen = found && found.adminActive ? found : null; // a deactivated church's screens get nothing
    const allowed = (session && session.admin.id === owner)
      || (screen && screen.adminId === owner)
      || signer.verify(owner, id, req.query.exp, req.query.sig);
    const variant = VARIANTS.includes(req.query.v) ? req.query.v : 'original';
    const file = allowed && media.filePath(owner, id, variant);
    if (!file) return notFound(req, res);
    res.set('Cache-Control', 'private, max-age=3600');
    // Range requests (seeking, 206) are handled by sendFile.
    res.sendFile(file.path, { headers: { 'Content-Type': file.mime }, acceptRanges: true, cacheControl: false }, (err) => {
      if (err && !res.headersSent) notFound(req, res);
    });
  });

  router.use('/api/media', auth.requireUser, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // The list also for the operator (the video panel on the operator console); changes:
  // owner and leader only.
  router.get('/api/media', requireRole(...EDITOR_ROLES), (req, res) => {
    const used = media.usedBytes(req.adminId);
    res.json({
      media: media.list(req.adminId),
      usedBytes: used,
      maxFileBytes: config.MEDIA_MAX_FILE_BYTES,
      maxImageBytes: config.MEDIA_MAX_IMAGE_BYTES,
      maxLoopBytes: config.MEDIA_MAX_LOOP_BYTES,
      maxAdminBytes: quota(req.adminId),
      backgroundDefaults: backgrounds.defaults(req.adminId),
      pexelsEnabled: Boolean(pexels && pexels.enabled), // the "Caută pe Pexels" tab
    });
  });

  // The body is the video itself. It is written to a temp file as it arrives (never held
  // in memory), stopped as soon as it passes the limits, then checked by its magic bytes.
  router.post('/api/media/upload', canEdit, (req, res) => {
    const title = validateTitle(req.query.title, req.t);
    if (title.error) return res.status(400).json({ error: title.error });
    // A background: an image or a loop; the stream is capped at the loop limit, an image's
    // own limit is checked once its type is known.
    const background = req.query.as === 'background';
    const maxFile = background ? Math.max(config.MEDIA_MAX_LOOP_BYTES, config.MEDIA_MAX_IMAGE_BYTES) : config.MEDIA_MAX_FILE_BYTES;
    const maxAdmin = quota(req.adminId);
    const room = maxAdmin - media.usedBytes(req.adminId);
    // The disk too: never below DISK_MIN_FREE_PCT free, whatever the quota allows.
    const diskRoom = storage.room();
    const limit = Math.min(maxFile, room, diskRoom);
    // The file limit wins the message when the file alone is too big; else the church is full.
    const fileTooLarge = () => (background
      ? req.t('errors.backgroundTooLarge', { image: mb(config.MEDIA_MAX_IMAGE_BYTES), loop: mb(config.MEDIA_MAX_LOOP_BYTES) })
      : req.t('errors.mediaTooLarge', { max: mb(maxFile) }));
    // -> [status, message]: the file limit first, then the church's quota, then the disk.
    const tooLarge = (bytes) => {
      if (bytes > maxFile) return [413, fileTooLarge()];
      if (bytes > room) return [413, req.t('errors.mediaQuotaExceeded', { max: mb(maxAdmin) })];
      return [507, req.t('errors.diskFull', { free: mb(Math.max(0, diskRoom)), pct: config.DISK_MIN_FREE_PCT })];
    };
    const declared = Number(req.get('content-length'));
    if (Number.isFinite(declared) && declared > limit) {
      res.set('Connection', 'close');
      const [status, error] = tooLarge(declared);
      if (status === 507) logger.warn(`Upload refused: disk nearly full (admin #${req.adminId}, ${declared} bytes, room ${diskRoom})`);
      return res.status(status).json({ error });
    }

    const temp = media.tempPath(req.adminId);
    const out = fs.createWriteStream(temp, { flags: 'wx' });
    let size = 0;
    let failed = false;
    const fail = (status, error, code = null) => {
      if (failed) return;
      failed = true;
      req.unpipe(out);
      out.destroy();
      fs.rm(temp, { force: true }, () => {});
      if (!res.headersSent) {
        res.set('Connection', 'close');
        res.status(status).json(code ? { code, error } : { error });
      }
      req.resume(); // drain whatever is still coming
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) fail(...tooLarge(size));
    });
    req.on('aborted', () => fail(400, req.t('errors.badRequest')));
    req.once('wa:shutdown', ({ code, error }) => fail(503, error, code)); // the server is stopping (lib/shutdown.js)
    out.on('error', (err) => {
      if (failed) return; // a write still queued after the upload was stopped
      logger.error('media upload write failed', err);
      fail(500, req.t('errors.internal'));
    });
    out.on('finish', () => {
      if (failed) return;
      const head = Buffer.alloc(64);
      let read = 0;
      try {
        const fd = fs.openSync(temp, 'r');
        read = fs.readSync(fd, head, 0, 64, 0);
        fs.closeSync(fd);
      } catch (err) {
        return fail(500, req.t('errors.internal'));
      }
      const video = sniffVideo(head.subarray(0, read));
      const image = background ? sniffImage(head.subarray(0, read)) : null;
      if (!video && !image) return fail(400, req.t(background ? 'errors.backgroundInvalid' : 'errors.mediaInvalid'));
      const logged = (item, mime) => {
        logger.info(`Media #${item.id} (${item.kind}) uploaded by user #${req.user.id} (admin #${req.adminId}, ${mime}, ${size} bytes)`);
        storage.refresh();
        res.status(201).json({ media: item });
      };
      if (video) {
        if (background && size > config.MEDIA_MAX_LOOP_BYTES) return fail(413, fileTooLarge());
        return logged(media.addUpload(req.adminId, req.user.id, { title: title.value, temp, mime: video, size, kind: background ? 'loop' : 'upload' }), video);
      }
      if (size > config.MEDIA_MAX_IMAGE_BYTES) return fail(413, req.t('errors.imageTooLarge', { max: mb(config.MEDIA_MAX_IMAGE_BYTES) }));
      media.addImage(req.adminId, req.user.id, { title: title.value, temp, mime: image }).then((item) => logged(item, image), (err) => {
        logger.info(`Image upload refused (admin #${req.adminId}): ${err.message}`);
        failed = true;
        if (!res.headersSent) res.status(400).json({ error: req.t('errors.backgroundInvalid') });
      });
    });
    req.pipe(out);
  });

  // A background fetched by the server from a link (Media → "Din link", Pexels): the same
  // size, quota and disk rules as an upload; lib/media-fetch.js does the download (10 s, no
  // private addresses, byte cap); then the magic bytes decide image / video and the file is
  // stored exactly like an upload, with source_url (and a provider's attribution) kept.
  async function fetchAndStore(req, res, { url, title: wantedTitle, attribution = null, what = 'Background from link' }) {
    const maxFile = Math.max(config.MEDIA_MAX_LOOP_BYTES, config.MEDIA_MAX_IMAGE_BYTES);
    const maxAdmin = quota(req.adminId);
    const room = maxAdmin - media.usedBytes(req.adminId);
    const diskRoom = storage.room();
    if (room <= 0) return res.status(413).json({ error: req.t('errors.mediaQuotaExceeded', { max: mb(maxAdmin) }) });
    if (diskRoom <= 0) return res.status(507).json({ error: req.t('errors.diskFull', { free: mb(Math.max(0, diskRoom)), pct: config.DISK_MIN_FREE_PCT }) });
    const limit = Math.min(maxFile, room, diskRoom);
    const tooLarge = () => (limit < maxFile
      ? (room < diskRoom ? [413, req.t('errors.mediaQuotaExceeded', { max: mb(maxAdmin) })] : [507, req.t('errors.diskFull', { free: mb(Math.max(0, diskRoom)), pct: config.DISK_MIN_FREE_PCT })])
      : [413, req.t('errors.backgroundTooLarge', { image: mb(config.MEDIA_MAX_IMAGE_BYTES), loop: mb(config.MEDIA_MAX_LOOP_BYTES) })]);
    const temp = media.tempPath(req.adminId);
    let got;
    try {
      got = await fetchToTemp(url, { temp, maxBytes: limit, fetchImpl: mediaFetch });
    } catch (err) {
      if (!(err instanceof MediaFetchError)) throw err;
      logger.info(`${what} refused (admin #${req.adminId}, ${err.code}): ${String(url).slice(0, 200)}`);
      if (err.code === 'too_large') { const [status, error] = tooLarge(); return res.status(status).json({ error }); }
      const host = (() => { try { return new URL(url).hostname; } catch (e) { return String(url).slice(0, 60); } })();
      const codes = { bad_url: 'mediaFetchHttps', blocked_host: 'mediaFetchHttps', private_address: 'mediaFetchPrivate', timeout: 'mediaFetchTimeout', not_found: 'mediaFetchNotFound' };
      return res.status(400).json({ error: req.t(`errors.${codes[err.code] || 'mediaFetchUnreachable'}`, { host }) });
    }
    const { size, head } = got;
    const video = sniffVideo(head);
    const image = sniffImage(head);
    const drop = () => fs.rm(temp, { force: true }, () => {});
    if (!video && !image) { drop(); return res.status(400).json({ error: req.t('errors.mediaFetchNotMedia') }); }
    const title = validateTitle(typeof wantedTitle === 'string' && wantedTitle.trim() ? wantedTitle : titleFromUrl(got.finalUrl), req.t);
    if (title.error) { drop(); return res.status(400).json({ error: title.error }); }
    const done = (item, mime) => {
      logger.info(`Media #${item.id} (${item.kind}) fetched from ${item.sourceHost} by user #${req.user.id} (admin #${req.adminId}, ${mime}, ${size} bytes)`);
      storage.refresh();
      res.status(201).json({ media: item });
    };
    if (video) {
      if (size > config.MEDIA_MAX_LOOP_BYTES) { drop(); return res.status(413).json({ error: req.t('errors.backgroundTooLarge', { image: mb(config.MEDIA_MAX_IMAGE_BYTES), loop: mb(config.MEDIA_MAX_LOOP_BYTES) }) }); }
      return done(media.addUpload(req.adminId, req.user.id, { title: title.value, temp, mime: video, size, kind: 'loop', sourceUrl: got.finalUrl, attribution }), video);
    }
    if (size > config.MEDIA_MAX_IMAGE_BYTES) { drop(); return res.status(413).json({ error: req.t('errors.imageTooLarge', { max: mb(config.MEDIA_MAX_IMAGE_BYTES) }) }); }
    try {
      done(await media.addImage(req.adminId, req.user.id, { title: title.value, temp, mime: image, sourceUrl: got.finalUrl, attribution }), image);
    } catch (err) {
      logger.info(`Image from link refused (admin #${req.adminId}): ${err.message}`);
      res.status(400).json({ error: req.t('errors.mediaFetchNotMedia') });
    }
    return undefined;
  }

  // A background from a link (https image JPEG / PNG / WebP or video MP4 / WebM).
  router.post('/api/media/from-url', canEdit, asyncRoute(async (req, res) => {
    const body = req.body || {};
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!/^https:\/\//i.test(url)) return res.status(400).json({ error: req.t('errors.mediaFetchHttps') });
    return fetchAndStore(req, res, { url, title: body.title });
  }));

  // Pexels (lib/pexels.js, docs/BACKGROUNDS.md): server-side search (cached, rate limited)
  // and "Adaugă" (the projector-size photo or the SD / HD video, with attribution).
  const pexelsError = (req, res, err) => {
    if (!(err instanceof PexelsError)) throw err;
    if (err.code === 'disabled') return res.status(503).json({ code: 'pexelsDisabled', error: req.t('errors.pexelsDisabled') });
    if (err.code === 'rate_limited') { res.set('Retry-After', String(err.retryAfter)); return res.status(429).json({ error: req.t('errors.pexelsRateLimited') }); }
    if (err.code === 'bad_query') return res.status(400).json({ error: req.t('errors.pexelsQueryTooShort') });
    if (err.code === 'not_found') return res.status(404).json({ error: req.t('errors.pexelsNotFound') });
    logger.warn(`Pexels ${err.code}: ${err.message}`);
    return res.status(502).json({ error: req.t('errors.pexelsUnavailable') });
  };

  router.get('/api/media/pexels/search', canEdit, asyncRoute(async (req, res) => {
    if (!pexels) return res.status(503).json({ code: 'pexelsDisabled', error: req.t('errors.pexelsDisabled') });
    try {
      const out = await pexels.search(req.adminId, { query: req.query.q, kind: req.query.kind });
      res.json({ items: out.items, cached: out.cached, suggestions: pexels.SUGGESTIONS });
    } catch (err) {
      pexelsError(req, res, err);
    }
  }));

  router.post('/api/media/pexels/add', canEdit, asyncRoute(async (req, res) => {
    if (!pexels) return res.status(503).json({ code: 'pexelsDisabled', error: req.t('errors.pexelsDisabled') });
    const body = req.body || {};
    let item;
    try {
      item = await pexels.item(req.adminId, { id: body.id, kind: body.kind });
    } catch (err) {
      return pexelsError(req, res, err);
    }
    const title = item.alt || (item.kind === 'videos' ? `Pexels video ${item.id}` : `Pexels ${item.id}`);
    return fetchAndStore(req, res, {
      url: item.download, title: title.slice(0, 120), what: 'Pexels download',
      attribution: { provider: 'pexels', photographer: item.photographer, photographerUrl: item.photographerUrl, url: item.pageUrl },
    });
  }));

  router.post('/api/media/url', canEdit, (req, res) => {
    const body = req.body || {};
    const title = validateTitle(body.title, req.t);
    if (title.error) return res.status(400).json({ error: title.error });
    const parsed = parseVideoUrl(body.url);
    if (!parsed) return res.status(400).json({ error: req.t('errors.mediaUrlInvalid') });
    res.status(201).json({ media: media.addUrl(req.adminId, req.user.id, title.value, parsed) });
  });

  router.put('/api/media/:id', canEdit, (req, res) => {
    const id = mediaId(req);
    const item = id && media.get(req.adminId, id);
    if (!item) return notFound(req, res);
    const body = req.body || {};
    const title = body.title === undefined ? null : validateTitle(body.title, req.t);
    if (title && title.error) return res.status(400).json({ error: title.error });
    const look = parseReadability(body);
    if (look.error) return res.status(400).json({ error: req.t('errors.backgroundReadabilityInvalid') });
    const changesLook = Object.keys(look.value).length > 0;
    if (changesLook && item.category !== 'background') return res.status(400).json({ error: req.t('errors.backgroundReadabilityInvalid') });
    if (title) media.rename(req.adminId, id, title.value);
    if (changesLook) {
      backgrounds.setReadability(req.adminId, id, look.value);
      live.backgroundsChanged(req.adminId);
    }
    res.json({ media: media.get(req.adminId, id) });
  });

  router.delete('/api/media/:id', canEdit, (req, res) => {
    const id = mediaId(req);
    if (!id || !media.remove(req.adminId, id)) return notFound(req, res);
    live.backgroundsChanged(req.adminId); // a background in use falls back to the next level
    logger.info(`Media #${id} deleted by user #${req.user.id} (admin #${req.adminId})`);
    storage.refreshSoon(); // the files go asynchronously
    res.json({ ok: true });
  });

  return router;
}

module.exports = createMediaRouter;
