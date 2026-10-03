'use strict';

const express = require('express');
const { requirePerm, can } = require('../lib/roles');
const { validatePositionEmoji } = require('../lib/positions');
const { KINDS, MAX_ITEMS, MAX_IMAGE_BYTES, validateGuide, validateItem, createGuideStore, toWebp } = require('../lib/guides');
const { createPositionStore } = require('../lib/positions');
const { createRequestLimiter } = require('../lib/rate-limit');
const { MAX_QUESTION } = require('../lib/ai');

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
//   POST   /api/guides/ai/draft                the guides right, with AI on (lib/ai.js):
//                                               { title, description?, positionIds?, images? (up to
//                                               5 data URLs) } -> { draft: { summary, steps, problems } }
//                                               (nothing is stored: "Creează ghidul" posts it with items)
//   POST   /api/guides/:id/ask                 everyone, with AI on: { question } -> { answer, covered }
function createGuidesRouter({ db, auth, config, logger, storage, ai = null }) {
  const router = express.Router();
  const guides = createGuideStore(db, config.DATA_DIR);
  const canWrite = requirePerm('guides');
  const positions = createPositionStore(db);
  const aiOn = () => Boolean(ai && ai.enabled);
  const draftBody = express.json({ limit: '12mb' }); // up to 5 photos, resized in the browser
  const askLimiter = createRequestLimiter({ maxRequests: 30, windowMs: 60 * 60 * 1000 }); // per person
  const AI_STATUS = { aiDisabled: 503, aiLimit: 429, aiBusy: 503, aiOffline: 503, aiKey: 503, aiRefused: 422, aiFailed: 502 };
  const aiError = (req, res, err) => {
    const code = err && AI_STATUS[err.code] ? err.code : 'aiFailed';
    return res.status(AI_STATUS[code]).json({ code, error: req.t(`errors.${code}`) });
  };
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
    res.json({ guides: guides.list(req.adminId), canEdit: can(req.user, 'guides'), ai: aiOn() });
  });

  router.get('/api/guides/:id', (req, res) => {
    const found = idOf(req.params.id) && guides.get(req.adminId, idOf(req.params.id));
    if (!found) return notFound(req, res);
    res.json({ ...found, canEdit: can(req.user, 'guides'), ai: aiOn() });
  });

  router.post('/api/guides', canWrite, (req, res) => {
    const input = guideInput(req, false);
    if (input.error) return res.status(400).json({ error: input.error });
    // items (optional): the steps / problems of an AI draft, reviewed in the dialog
    const raw = (req.body || {}).items;
    if (raw !== undefined && (!Array.isArray(raw) || raw.length > MAX_ITEMS)) return res.status(400).json({ error: req.t('errors.badRequest') });
    const items = [];
    for (const one of raw || []) {
      const item = validateItem(one, req.t);
      if (item.error) return res.status(400).json({ error: item.error });
      items.push(item.value);
    }
    const made = guides.create(req.adminId, req.user.id, input.value);
    if (!made) return res.status(400).json({ error: req.t('errors.guidesTooMany') });
    for (const item of items) guides.addItem(req.adminId, made.guide.id, item);
    audit(req, `created guide #${made.guide.id} "${made.guide.title}"${items.length ? ` with ${items.length} items` : ''}`);
    res.status(201).json({ ...guides.get(req.adminId, made.guide.id), canEdit: true });
  });

  // ✨ "Scrie pașii cu AI": a draft from a description and photos; the dialog shows it first.
  router.post('/api/guides/ai/draft', canWrite, (req, res, next) => {
    draftBody(req, res, (err) => { draft(req, res, err).catch(next); });
  });

  async function draft(req, res, err) {
    if (err && err.type === 'entity.too.large') return res.status(400).json({ error: req.t('errors.guideImageTooLarge', { max: '12 MB' }) });
    if (err) throw err;
    if (!aiOn()) return aiError(req, res, { code: 'aiDisabled' });
    const input = validateGuide(req.body, req.t, { partial: false });
    if (input.error) return res.status(400).json({ error: input.error });
    const body = req.body || {};
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 2000) : '';
    const list = Array.isArray(body.images) ? body.images.slice(0, 5) : [];
    const images = [];
    for (const url of list) {
      const m = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/.exec(String(url || ''));
      if (!m) return res.status(400).json({ error: req.t('errors.guideImageInvalid') });
      try {
        const jpeg = await require('sharp')(Buffer.from(m[1], 'base64'), { failOn: 'error' }).rotate()
          .resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
        images.push({ mediaType: 'image/jpeg', data: jpeg.toString('base64') });
      } catch (e) {
        return res.status(400).json({ error: req.t('errors.guideImageInvalid') });
      }
    }
    const names = (input.value.positionIds || []).map((id) => (positions.get(req.adminId, id) || {}).name).filter(Boolean);
    try {
      const out = await ai.draftGuide(req.adminId, { lang: req.lang, title: input.value.title, description, positions: names, images });
      audit(req, `AI draft "${input.value.title}" (${out.steps.length} steps, ${out.problems.length} problems, ${images.length} photos)`);
      return res.json({ draft: out, ai: ai.status(req.adminId) });
    } catch (e) {
      return aiError(req, res, e);
    }
  }

  // ✨ "Întreabă ghidul": an answer from this guide only.
  router.post('/api/guides/:id/ask', asyncAsk);
  async function asyncAskInner(req, res) {
    if (!aiOn()) return aiError(req, res, { code: 'aiDisabled' });
    const id = idOf(req.params.id);
    const found = id && guides.get(req.adminId, id);
    if (!found) return notFound(req, res);
    const question = typeof (req.body || {}).question === 'string' ? req.body.question.trim() : '';
    if (question.length < 2 || question.length > MAX_QUESTION) return res.status(400).json({ error: req.t('errors.aiQuestionInvalid', { max: MAX_QUESTION }) });
    const wait = askLimiter.take(`user:${req.user.id}`);
    if (wait > 0) return res.status(429).json({ code: 'aiLimit', error: req.t('errors.aiAskTooMany') });
    try {
      const out = await ai.askGuide(req.adminId, { lang: req.lang, guide: found.guide, items: found.items, question });
      return res.json(out);
    } catch (e) {
      return aiError(req, res, e);
    }
  }
  function asyncAsk(req, res, next) { asyncAskInner(req, res).catch(next); }

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
