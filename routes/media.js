'use strict';

const fs = require('fs');
const express = require('express');
const { requireRole } = require('../lib/auth');
const { VARIANTS, sniffVideo, sniffImage, parseVideoUrl, validateTitle, createMediaStore, createMediaSigner } = require('../lib/media');
const { createScreenStore } = require('../lib/screens');

const EDITOR_ROLES = ['owner', 'leader'];

// Media library (videos and backgrounds for the projector), scoped to req.adminId.
//   GET    /api/media                  list (owner, leader, operator)
//   POST   /api/media/upload?title=…&as=video|background
//                                      raw body, streamed to disk: a video (MP4 / WebM), or a
//                                      background: an image (JPEG / PNG / WebP, max 8 MB) or a
//                                      silent loop (MP4 / WebM, max 50 MB)
//   POST   /api/media/url {title,url}  https .mp4/.webm, YouTube or Vimeo
//   PUT    /api/media/:id {title}      rename
//   DELETE /api/media/:id              delete (and its file)
//   GET    /api/media/:id/file[?v=display|thumb]
//                                      the uploaded file with Range support (images: the
//          projector version or the thumbnail), for that admin's users (session), its
//          screens (X-Screen-Token) or a signed URL (screens).
function createMediaRouter({ db, auth, config, logger }) {
  const router = express.Router();
  const media = createMediaStore(db, config.DATA_DIR);
  const signer = createMediaSigner(config.DATA_DIR);
  const screens = createScreenStore(db);
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
    const screen = session ? null : screens.findByToken(req.get('x-screen-token'));
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
  router.get('/api/media', requireRole(...EDITOR_ROLES, 'operator'), (req, res) => {
    const used = media.usedBytes(req.adminId);
    res.json({
      media: media.list(req.adminId),
      usedBytes: used,
      maxFileBytes: config.MEDIA_MAX_FILE_BYTES,
      maxImageBytes: config.MEDIA_MAX_IMAGE_BYTES,
      maxLoopBytes: config.MEDIA_MAX_LOOP_BYTES,
      maxAdminBytes: config.MEDIA_MAX_ADMIN_BYTES,
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
    const room = config.MEDIA_MAX_ADMIN_BYTES - media.usedBytes(req.adminId);
    const limit = Math.min(maxFile, room);
    // The file limit wins the message when the file alone is too big; else the church is full.
    const tooLarge = (bytes) => (bytes > maxFile
      ? req.t('errors.mediaTooLarge', { max: mb(maxFile) })
      : req.t('errors.mediaQuotaExceeded', { max: mb(config.MEDIA_MAX_ADMIN_BYTES) }));
    const declared = Number(req.get('content-length'));
    if (Number.isFinite(declared) && declared > limit) {
      res.set('Connection', 'close');
      return res.status(413).json({ error: tooLarge(declared) });
    }

    const temp = media.tempPath(req.adminId);
    const out = fs.createWriteStream(temp, { flags: 'wx' });
    let size = 0;
    let failed = false;
    const fail = (status, error) => {
      if (failed) return;
      failed = true;
      req.unpipe(out);
      out.destroy();
      fs.rm(temp, { force: true }, () => {});
      if (!res.headersSent) {
        res.set('Connection', 'close');
        res.status(status).json({ error });
      }
      req.resume(); // drain whatever is still coming
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) fail(413, tooLarge(size));
    });
    req.on('aborted', () => fail(400, req.t('errors.badRequest')));
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
        res.status(201).json({ media: item });
      };
      if (video) {
        if (background && size > config.MEDIA_MAX_LOOP_BYTES) return fail(413, req.t('errors.mediaTooLarge', { max: mb(config.MEDIA_MAX_LOOP_BYTES) }));
        return logged(media.addUpload(req.adminId, req.user.id, { title: title.value, temp, mime: video, size, kind: background ? 'loop' : 'upload' }), video);
      }
      if (size > config.MEDIA_MAX_IMAGE_BYTES) return fail(413, req.t('errors.mediaTooLarge', { max: mb(config.MEDIA_MAX_IMAGE_BYTES) }));
      media.addImage(req.adminId, req.user.id, { title: title.value, temp, mime: image }).then((item) => logged(item, image), (err) => {
        logger.info(`Image upload refused (admin #${req.adminId}): ${err.message}`);
        failed = true;
        if (!res.headersSent) res.status(400).json({ error: req.t('errors.backgroundInvalid') });
      });
    });
    req.pipe(out);
  });

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
    if (!id || !media.get(req.adminId, id)) return notFound(req, res);
    const title = validateTitle((req.body || {}).title, req.t);
    if (title.error) return res.status(400).json({ error: title.error });
    media.rename(req.adminId, id, title.value);
    res.json({ media: media.get(req.adminId, id) });
  });

  router.delete('/api/media/:id', canEdit, (req, res) => {
    const id = mediaId(req);
    if (!id || !media.remove(req.adminId, id)) return notFound(req, res);
    logger.info(`Media #${id} deleted by user #${req.user.id} (admin #${req.adminId})`);
    res.json({ ok: true });
  });

  return router;
}

module.exports = createMediaRouter;
