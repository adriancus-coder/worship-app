'use strict';

const express = require('express');
const { requirePerm, can } = require('../lib/roles');
const { validatePositionEmoji } = require('../lib/positions');
const { KINDS, MAX_IMAGE_BYTES, validateGuide, validateItem, createGuideStore, toWebp } = require('../lib/guides');

// Ghiduri (lib/guides.js): everyone signed in reads; the 'guides' right writes.
//   GET    /api/guides                         { guides, canEdit }
//   GET    /api/guides/:id                     { guide, items, canEdit }
//   POST   /api/guides                         { title, emoji?, summary?, positionIds? }
//   PUT    /api/guides/:id                     any of those
//   DELETE /api/guides/:id                     with its items and photos
//   POST   /api/guides/:id/items               { kind: step|problem, title, body? }
//   PUT    /api/guides/:id/items/:itemId       { title?, body? }
//   DELETE /api/guides/:id/items/:itemId
//   PUT    /api/guides/:id/order               { kind, ids }: the new order of that kind
//   PUT    /api/guides/:id/items/:itemId/image the photo as the raw body (resized to WebP)
//   DELETE /api/guides/:id/items/:itemId/image
//   GET    /api/guides/image/:file             a photo, to the users of its church
function createGuidesRouter({ db, auth, config, logger, storage }) {
  const router = express.Router();
  const guides = createGuideStore(db, config.DATA_DIR);
  const canWrite = requirePerm('guides');
  const rawImage = express.raw({ type: () => true, limit: MAX_IMAGE_BYTES });
  const idOf = (value) => (/^\d{1,15}$/.test(value) ? Number(value) : null);
  const notFound = (req, res) => res.status(404).json({ error: req.t('errors.notFound') });
  const audit = (req, what) => logger.info(`Guides: ${what} by user #${req.user.id} (admin #${req.adminId})`);

  // a photo is served before the JSON guard (no Cache-Control: no-store on it)
  router.get('/api/guides/image/:file', auth.requireUser, (req, res) => {
    const found = guides.findImage(req.params.file);
    if (!found || found.adminId !== req.adminId) return notFound(req, res);
    res.set('Cache-Control', 'private, max-age=604800');
    res.type('image/webp');
    res.sendFile(found.path, (err) => { if (err && !res.headersSent) notFound(req, res); });
  });

  router.use('/api/guides', auth.requireUser, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // { value } with the emoji checked, or { error }
  function guideInput(req, partial) {
    const out = validateGuide(req.body, req.t, { partial });
    if (out.error) return out;
    const body = req.body || {};
    if (!partial || body.emoji !== undefined) {
      const emoji = validatePositionEmoji(body.emoji, req.t);
      if (emoji.error) return emoji;
      out.value.emoji = emoji.value;
    }
    return out;
  }

  router.get('/api/guides', (req, res) => {
    res.json({ guides: guides.list(req.adminId), canEdit: can(req.user, 'guides') });
  });

  router.get('/api/guides/:id', (req, res) => {
    const found = idOf(req.params.id) && guides.get(req.adminId, idOf(req.params.id));
    if (!found) return notFound(req, res);
    res.json({ ...found, canEdit: can(req.user, 'guides') });
  });

  router.post('/api/guides', canWrite, (req, res) => {
    const input = guideInput(req, false);
    if (input.error) return res.status(400).json({ error: input.error });
    const made = guides.create(req.adminId, req.user.id, input.value);
    if (!made) return res.status(400).json({ error: req.t('errors.guidesTooMany') });
    audit(req, `created guide #${made.guide.id} "${made.guide.title}"`);
    res.status(201).json({ ...made, canEdit: true });
  });

  router.put('/api/guides/:id', canWrite, (req, res) => {
    const input = guideInput(req, true);
    if (input.error) return res.status(400).json({ error: input.error });
    const out = idOf(req.params.id) && guides.update(req.adminId, idOf(req.params.id), input.value);
    if (!out) return notFound(req, res);
    res.json({ ...out, canEdit: true });
  });

  router.delete('/api/guides/:id', canWrite, (req, res) => {
    const id = idOf(req.params.id);
    if (!id || !guides.destroy(req.adminId, id)) return notFound(req, res);
    storage.refreshSoon();
    audit(req, `deleted guide #${id}`);
    res.json({ ok: true });
  });

  router.post('/api/guides/:id/items', canWrite, (req, res) => {
    const input = validateItem(req.body, req.t);
    if (input.error) return res.status(400).json({ error: input.error });
    const id = idOf(req.params.id);
    const item = id && guides.addItem(req.adminId, id, input.value);
    if (item === false) return res.status(400).json({ error: req.t('errors.guideItemsTooMany') });
    if (!item) return notFound(req, res);
    res.status(201).json({ item, ...guides.get(req.adminId, id), canEdit: true });
  });

  router.put('/api/guides/:id/order', canWrite, (req, res) => {
    const id = idOf(req.params.id);
    const { kind, ids } = req.body || {};
    if (!id || !KINDS.includes(kind) || !Array.isArray(ids) || !ids.every((x) => Number.isInteger(x)) || !guides.reorder(req.adminId, id, kind, ids)) {
      return res.status(400).json({ error: req.t('errors.badRequest') });
    }
    res.json({ ...guides.get(req.adminId, id), canEdit: true });
  });

  router.put('/api/guides/:id/items/:itemId', canWrite, (req, res) => {
    const input = validateItem(req.body, req.t, { partial: true });
    if (input.error) return res.status(400).json({ error: input.error });
    const id = idOf(req.params.id);
    const item = id && idOf(req.params.itemId) && guides.changeItem(req.adminId, id, idOf(req.params.itemId), input.value);
    if (!item) return notFound(req, res);
    res.json({ item, ...guides.get(req.adminId, id), canEdit: true });
  });

  router.delete('/api/guides/:id/items/:itemId', canWrite, (req, res) => {
    const id = idOf(req.params.id);
    if (!id || !idOf(req.params.itemId) || !guides.removeItem(req.adminId, id, idOf(req.params.itemId))) return notFound(req, res);
    storage.refreshSoon();
    res.json({ ...guides.get(req.adminId, id), canEdit: true });
  });

  // The photo as the raw body (the browser sends the File as is); any image sharp reads.
  router.put('/api/guides/:id/items/:itemId/image', canWrite, (req, res, next) => {
    rawImage(req, res, (err) => { storeImage(req, res, err).catch(next); });
  });

  async function storeImage(req, res, err) {
    if (err && err.type === 'entity.too.large') return res.status(400).json({ error: req.t('errors.guideImageTooLarge', { max: '12 MB' }) });
    if (err) throw err;
    const id = idOf(req.params.id);
    const itemId = idOf(req.params.itemId);
    if (!id || !itemId || !guides.get(req.adminId, id)) return notFound(req, res);
    let webp;
    try {
      webp = await toWebp(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
    } catch (e) {
      return res.status(400).json({ error: req.t('errors.guideImageInvalid') });
    }
    const room = storage.room();
    if (webp.length > room) return res.status(507).json({ error: req.t('errors.diskFull', { free: `${Math.floor(room / (1024 * 1024))} MB`, pct: config.DISK_MIN_FREE_PCT }) });
    const item = guides.saveImage(req.adminId, id, itemId, webp);
    if (!item) return notFound(req, res);
    storage.refresh();
    audit(req, `photo on guide #${id} item #${itemId} (${webp.length} bytes)`);
    return res.json({ item, ...guides.get(req.adminId, id), canEdit: true });
  }

  router.delete('/api/guides/:id/items/:itemId/image', canWrite, (req, res) => {
    const id = idOf(req.params.id);
    const item = id && idOf(req.params.itemId) && guides.clearImage(req.adminId, id, idOf(req.params.itemId));
    if (!item) return notFound(req, res);
    storage.refreshSoon();
    res.json({ item, ...guides.get(req.adminId, id), canEdit: true });
  });

  return router;
}

module.exports = { createGuidesRouter };
