'use strict';

// Ghiduri (migration 046): how-to guides for the team and the volunteers - "Pornirea
// sunetului", "PC-ul de la proiector", "Transmisiunea live". A guide has a title, an emoji, a
// short summary and the positions it is for (Sunet, Operator, ...); then ordered items:
//   step     what to do, in order (numbered on the page)
//   problem  "Dacă nu merge": a symptom ("Nu se aude microfonul") and its fix
// each with optional text and one photo. Everyone signed in reads them; the 'guides' right
// (lib/roles.js) writes them. Photos are resized to at most 1600 px and stored as WebP under
// DATA_DIR/uploads/admin-<id>/guides/ (inside the backup, gone with the church).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KINDS = ['step', 'problem'];
const MAX_GUIDES = 100;
const MAX_ITEMS = 60;
const MAX_TITLE = 80;
const MAX_SUMMARY = 300;
const MAX_ITEM_TITLE = 120;
const MAX_BODY = 4000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // a phone photo as taken
const IMAGE_EDGE = 1600;
const FILE_RE = /^g-[0-9a-f]{16}\.webp$/;

const clean = (value, max) => (typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim().slice(0, max) : '');

// { value } or { error }: title required; summary, emoji optional; positionIds a list of ids.
function validateGuide(body, t, { partial = false } = {}) {
  const b = body || {};
  const out = {};
  if (!partial || b.title !== undefined) {
    const title = clean(b.title, MAX_TITLE + 1).replace(/\s+/g, ' ');
    if (!title || title.length > MAX_TITLE) return { error: t('errors.guideTitleInvalid', { max: MAX_TITLE }) };
    out.title = title;
  }
  if (!partial || b.summary !== undefined) out.summary = clean(b.summary, MAX_SUMMARY);
  if (b.positionIds !== undefined) {
    if (!Array.isArray(b.positionIds) || !b.positionIds.every((id) => Number.isInteger(id))) return { error: t('errors.badRequest') };
    out.positionIds = [...new Set(b.positionIds)];
  }
  return { value: out };
}

function validateItem(body, t, { partial = false } = {}) {
  const b = body || {};
  const out = {};
  if (!partial) {
    if (!KINDS.includes(b.kind)) return { error: t('errors.badRequest') };
    out.kind = b.kind;
  }
  if (!partial || b.title !== undefined) {
    const title = clean(b.title, MAX_ITEM_TITLE + 1).replace(/\s+/g, ' ');
    if (!title || title.length > MAX_ITEM_TITLE) return { error: t('errors.guideItemTitleInvalid', { max: MAX_ITEM_TITLE }) };
    out.title = title;
  }
  if (!partial || b.body !== undefined) {
    if (typeof b.body === 'string' && b.body.length > MAX_BODY) return { error: t('errors.guideBodyTooLong', { max: MAX_BODY }) };
    out.body = clean(b.body, MAX_BODY);
  }
  return { value: out };
}

const isImageFile = (name) => typeof name === 'string' && FILE_RE.test(name);

function createGuideStore(db, dataDir) {
  const listRows = db.prepare(`SELECT g.*,
      (SELECT COUNT(*) FROM guide_items i WHERE i.guide_id = g.id AND i.kind = 'step') AS steps,
      (SELECT COUNT(*) FROM guide_items i WHERE i.guide_id = g.id AND i.kind = 'problem') AS problems
    FROM guides g WHERE g.admin_id = ? ORDER BY g.title COLLATE NOCASE, g.id`);
  const selectOne = db.prepare('SELECT * FROM guides WHERE id = ? AND admin_id = ?');
  const countGuides = db.prepare('SELECT COUNT(*) FROM guides WHERE admin_id = ?').pluck();
  const insertGuide = db.prepare('INSERT INTO guides (admin_id, title, emoji, summary, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const updateGuide = db.prepare('UPDATE guides SET title = ?, emoji = ?, summary = ?, updated_at = ? WHERE id = ? AND admin_id = ?');
  const touch = db.prepare('UPDATE guides SET updated_at = ? WHERE id = ? AND admin_id = ?');
  const deleteGuide = db.prepare('DELETE FROM guides WHERE id = ? AND admin_id = ?');
  const positionsOf = db.prepare(`SELECT gp.position_id FROM guide_positions gp JOIN positions p ON p.id = gp.position_id
    WHERE gp.guide_id = ? AND gp.admin_id = ? ORDER BY p.sort, p.id`).pluck();
  const allPositions = db.prepare('SELECT guide_id, position_id FROM guide_positions WHERE admin_id = ?');
  const clearPositions = db.prepare('DELETE FROM guide_positions WHERE guide_id = ? AND admin_id = ?');
  const addPosition = db.prepare('INSERT OR IGNORE INTO guide_positions (guide_id, position_id, admin_id) VALUES (?, ?, ?)');
  const positionOk = db.prepare('SELECT 1 FROM positions WHERE id = ? AND admin_id = ?').pluck();
  const itemsOf = db.prepare('SELECT * FROM guide_items WHERE guide_id = ? AND admin_id = ? ORDER BY kind DESC, sort, id');
  const selectItem = db.prepare('SELECT * FROM guide_items WHERE id = ? AND guide_id = ? AND admin_id = ?');
  const countItems = db.prepare('SELECT COUNT(*) FROM guide_items WHERE guide_id = ? AND admin_id = ?').pluck();
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort), -1) FROM guide_items WHERE guide_id = ? AND admin_id = ? AND kind = ?').pluck();
  const insertItem = db.prepare('INSERT INTO guide_items (guide_id, admin_id, kind, sort, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const updateItem = db.prepare('UPDATE guide_items SET title = ?, body = ? WHERE id = ? AND guide_id = ? AND admin_id = ?');
  const setImage = db.prepare('UPDATE guide_items SET image = ? WHERE id = ? AND guide_id = ? AND admin_id = ?');
  const setSort = db.prepare('UPDATE guide_items SET sort = ? WHERE id = ? AND guide_id = ? AND admin_id = ?');
  const deleteItem = db.prepare('DELETE FROM guide_items WHERE id = ? AND guide_id = ? AND admin_id = ?');
  const imagesOf = db.prepare('SELECT image FROM guide_items WHERE guide_id = ? AND admin_id = ? AND image IS NOT NULL').pluck();
  const imageOwner = db.prepare('SELECT admin_id FROM guide_items WHERE image = ?').pluck();

  const dirOf = (adminId) => path.join(dataDir, 'uploads', `admin-${adminId}`, 'guides');
  const imageUrl = (file) => (file ? `/api/guides/image/${file}` : null);
  const removeFile = (adminId, file) => { if (isImageFile(file)) fs.rm(path.join(dirOf(adminId), file), { force: true }, () => {}); };

  const toGuide = (row, positionIds, counts) => ({
    id: row.id, title: row.title, emoji: row.emoji || null, summary: row.summary || '', positionIds,
    updatedAt: row.updated_at, ...(counts ? { steps: counts.steps, problems: counts.problems } : {}),
  });
  const toItem = (r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body || '', image: imageUrl(r.image) });

  function list(adminId) {
    const byGuide = new Map();
    for (const r of allPositions.all(adminId)) byGuide.set(r.guide_id, [...(byGuide.get(r.guide_id) || []), r.position_id]);
    return listRows.all(adminId).map((r) => toGuide(r, byGuide.get(r.id) || [], { steps: r.steps, problems: r.problems }));
  }

  // { guide, items } or null
  function get(adminId, id) {
    const row = selectOne.get(id, adminId);
    if (!row) return null;
    return { guide: toGuide(row, positionsOf.all(id, adminId)), items: itemsOf.all(id, adminId).map(toItem) };
  }

  const writePositions = (adminId, id, ids) => {
    clearPositions.run(id, adminId);
    for (const pid of ids) if (positionOk.get(pid, adminId)) addPosition.run(id, pid, adminId);
  };

  const create = db.transaction((adminId, userId, { title, emoji = null, summary = '', positionIds = [] }) => {
    if (countGuides.get(adminId) >= MAX_GUIDES) return null;
    const now = Date.now();
    const id = Number(insertGuide.run(adminId, title, emoji, summary, userId, now, now).lastInsertRowid);
    writePositions(adminId, id, positionIds);
    return get(adminId, id);
  });

  const update = db.transaction((adminId, id, patch) => {
    const row = selectOne.get(id, adminId);
    if (!row) return null;
    updateGuide.run(patch.title !== undefined ? patch.title : row.title, patch.emoji !== undefined ? patch.emoji : row.emoji,
      patch.summary !== undefined ? patch.summary : row.summary, Date.now(), id, adminId);
    if (patch.positionIds !== undefined) writePositions(adminId, id, patch.positionIds);
    return get(adminId, id);
  });

  // The guide, its items and their photos.
  function destroy(adminId, id) {
    if (!selectOne.get(id, adminId)) return false;
    const files = imagesOf.all(id, adminId);
    deleteGuide.run(id, adminId);
    for (const file of files) removeFile(adminId, file);
    return true;
  }

  // -> the item, null (no guide), or false (too many items)
  function addItem(adminId, guideId, { kind, title, body = '' }) {
    if (!selectOne.get(guideId, adminId)) return null;
    if (countItems.get(guideId, adminId) >= MAX_ITEMS) return false;
    const id = Number(insertItem.run(guideId, adminId, kind, maxSort.get(guideId, adminId, kind) + 1, title, body, Date.now()).lastInsertRowid);
    touch.run(Date.now(), guideId, adminId);
    return toItem(selectItem.get(id, guideId, adminId));
  }

  function changeItem(adminId, guideId, itemId, patch) {
    const row = selectItem.get(itemId, guideId, adminId);
    if (!row) return null;
    updateItem.run(patch.title !== undefined ? patch.title : row.title, patch.body !== undefined ? patch.body : row.body, itemId, guideId, adminId);
    touch.run(Date.now(), guideId, adminId);
    return toItem(selectItem.get(itemId, guideId, adminId));
  }

  function removeItem(adminId, guideId, itemId) {
    const row = selectItem.get(itemId, guideId, adminId);
    if (!row) return false;
    deleteItem.run(itemId, guideId, adminId);
    removeFile(adminId, row.image);
    touch.run(Date.now(), guideId, adminId);
    return true;
  }

  // The new order of one kind's items: every id of that kind, once. -> boolean
  const reorder = db.transaction((adminId, guideId, kind, ids) => {
    const current = itemsOf.all(guideId, adminId).filter((r) => r.kind === kind).map((r) => r.id);
    if (ids.length !== current.length || new Set(ids).size !== ids.length || ids.some((id) => !current.includes(id))) return false;
    ids.forEach((id, i) => setSort.run(i, id, guideId, adminId));
    touch.run(Date.now(), guideId, adminId);
    return true;
  });

  // A photo (already resized, WebP bytes) for an item; the previous one is removed.
  function saveImage(adminId, guideId, itemId, webp) {
    const row = selectItem.get(itemId, guideId, adminId);
    if (!row) return null;
    const dir = dirOf(adminId);
    fs.mkdirSync(dir, { recursive: true });
    const file = `g-${crypto.randomBytes(8).toString('hex')}.webp`;
    fs.writeFileSync(path.join(dir, file), webp);
    setImage.run(file, itemId, guideId, adminId);
    removeFile(adminId, row.image);
    touch.run(Date.now(), guideId, adminId);
    return toItem(selectItem.get(itemId, guideId, adminId));
  }

  function clearImage(adminId, guideId, itemId) {
    const row = selectItem.get(itemId, guideId, adminId);
    if (!row) return null;
    setImage.run(null, itemId, guideId, adminId);
    removeFile(adminId, row.image);
    return toItem(selectItem.get(itemId, guideId, adminId));
  }

  // { adminId, path } for a stored photo, else null.
  function findImage(file) {
    if (!isImageFile(file)) return null;
    const adminId = imageOwner.get(file);
    return adminId === undefined ? null : { adminId, path: path.join(dirOf(adminId), file) };
  }

  return { list, get, create, update, destroy, addItem, changeItem, removeItem, reorder, saveImage, clearImage, findImage };
}

// Any photo (JPEG, PNG, WebP, HEIC where sharp reads it) -> WebP, at most IMAGE_EDGE px, the
// phone's rotation applied. Rejects what sharp cannot read.
async function toWebp(buffer) {
  const sharp = require('sharp');
  return sharp(buffer, { failOn: 'error' }).rotate().resize({ width: IMAGE_EDGE, height: IMAGE_EDGE, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
}

module.exports = {
  KINDS, MAX_GUIDES, MAX_ITEMS, MAX_TITLE, MAX_BODY, MAX_IMAGE_BYTES,
  validateGuide, validateItem, isImageFile, createGuideStore, toWebp,
};
