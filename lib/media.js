'use strict';

// Media library: videos for the projector.
// - Uploads: MP4 or WebM, decided by magic bytes (never by name or Content-Type), streamed
//   to DATA_DIR/uploads/admin-<id>/media/<random>.<ext>. Size limits come from config.
// - URLs: https only; a direct .mp4 / .webm file, YouTube (kept as its video id, played
//   through youtube-nocookie.com) or Vimeo (player.vimeo.com). Anything else is refused.
// - Screens cannot send headers from <video src>: they get signed file URLs
//   (?exp=&sig=, HMAC with a secret kept in DATA_DIR/media-secret).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TITLE_MAX = 120;
const URL_MAX = 500;
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const FILE_RE = /^[0-9a-f]{24}\.(mp4|webm)$/;
const SIGNED_TTL_MS = 12 * 60 * 60 * 1000;

// 'video/mp4' | 'video/webm' from the first bytes of a file, or null.
function sniffVideo(head) {
  if (!Buffer.isBuffer(head) || head.length < 12) return null;
  if (head.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4';
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    // EBML (Matroska family): only the "webm" document type is accepted.
    return head.subarray(0, 64).includes(Buffer.from('webm')) ? 'video/webm' : null;
  }
  return null;
}

// An https video link -> { kind: 'file', url } | { kind: 'youtube', id } | { kind: 'vimeo', id },
// or null when it is not one of those.
function parseVideoUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch (err) {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || String(value).length > URL_MAX) return null;
  const host = url.hostname.toLowerCase().replace(/^www\.|^m\./, '');
  const parts = url.pathname.split('/').filter(Boolean);
  if (['youtube.com', 'youtube-nocookie.com'].includes(host)) {
    const id = parts[0] === 'watch' ? url.searchParams.get('v') : ['embed', 'shorts', 'live'].includes(parts[0]) ? parts[1] : null;
    return YOUTUBE_ID_RE.test(id || '') ? { kind: 'youtube', id } : null;
  }
  if (host === 'youtu.be') return YOUTUBE_ID_RE.test(parts[0] || '') ? { kind: 'youtube', id: parts[0] } : null;
  if (host === 'vimeo.com' && /^\d{1,12}$/.test(parts[0] || '')) return { kind: 'vimeo', id: parts[0] };
  if (host === 'player.vimeo.com' && parts[0] === 'video' && /^\d{1,12}$/.test(parts[1] || '')) return { kind: 'vimeo', id: parts[1] };
  if (/\.(mp4|webm)$/i.test(url.pathname)) return { kind: 'file', url: url.href };
  return null;
}

// Stored form of a parsed link (media.url).
function storedUrl(parsed) {
  return parsed.kind === 'file' ? parsed.url : `${parsed.kind}:${parsed.id}`;
}

// How a media row is played: { type: 'upload' | 'file' | 'youtube' | 'vimeo', ... }.
function sourceOf(row) {
  if (row.kind === 'upload') return { type: 'upload', mime: row.mime };
  const m = /^(youtube|vimeo):(.+)$/.exec(row.url || '');
  return m ? { type: m[1], id: m[2] } : { type: 'file', url: row.url };
}

function toMedia(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    durationS: row.duration_s,
    source: sourceOf(row),
    createdAt: row.created_at,
  };
}

function validateTitle(title, t) {
  const value = typeof title === 'string' ? title.trim() : '';
  if (!value || value.length > TITLE_MAX) return { error: t('errors.mediaTitleInvalid', { max: TITLE_MAX }) };
  return { value };
}

function createMediaStore(db, dataDir) {
  const insert = db.prepare(`INSERT INTO media (admin_id, kind, title, file, mime, size_bytes, url, duration_s, created_by, created_at)
    VALUES (@adminId, @kind, @title, @file, @mime, @size, @url, NULL, @userId, @now)`);
  const selectOne = db.prepare('SELECT * FROM media WHERE id = ? AND admin_id = ?');
  const selectAll = db.prepare('SELECT * FROM media WHERE admin_id = ? ORDER BY title COLLATE NOCASE, id');
  const usedBytes = db.prepare("SELECT COALESCE(SUM(size_bytes), 0) FROM media WHERE admin_id = ? AND kind = 'upload'").pluck();
  const rename = db.prepare('UPDATE media SET title = ? WHERE id = ? AND admin_id = ?');
  const remove = db.prepare('DELETE FROM media WHERE id = ? AND admin_id = ?');

  const dirOf = (adminId) => path.join(dataDir, 'uploads', `admin-${adminId}`, 'media');

  function get(adminId, id) {
    const row = selectOne.get(id, adminId);
    return row ? toMedia(row) : null;
  }

  // Absolute path of an uploaded file, or null.
  function filePath(adminId, id) {
    const row = selectOne.get(id, adminId);
    if (!row || row.kind !== 'upload' || !FILE_RE.test(row.file || '')) return null;
    return { path: path.join(dirOf(adminId), row.file), mime: row.mime, size: row.size_bytes };
  }

  // A temp file in the admin's media folder for an upload in progress.
  function tempPath(adminId) {
    const dir = dirOf(adminId);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `.upload-${crypto.randomBytes(8).toString('hex')}`);
  }

  // Moves a verified temp file into place and records it.
  function addUpload(adminId, userId, { title, temp, mime, size }) {
    const file = `${crypto.randomBytes(12).toString('hex')}.${mime === 'video/webm' ? 'webm' : 'mp4'}`;
    fs.renameSync(temp, path.join(dirOf(adminId), file));
    const id = Number(insert.run({ adminId, kind: 'upload', title, file, mime, size, url: null, userId, now: Date.now() }).lastInsertRowid);
    return get(adminId, id);
  }

  function addUrl(adminId, userId, title, parsed) {
    const id = Number(insert.run({ adminId, kind: 'url', title, file: null, mime: null, size: null, url: storedUrl(parsed), userId, now: Date.now() }).lastInsertRowid);
    return get(adminId, id);
  }

  function removeMedia(adminId, id) {
    const row = selectOne.get(id, adminId);
    if (!row) return false;
    remove.run(id, adminId);
    if (row.kind === 'upload' && FILE_RE.test(row.file || '')) fs.rm(path.join(dirOf(adminId), row.file), { force: true }, () => {});
    return true;
  }

  return {
    get,
    list: (adminId) => selectAll.all(adminId).map(toMedia),
    usedBytes: (adminId) => usedBytes.get(adminId),
    filePath,
    tempPath,
    addUpload,
    addUrl,
    rename: (adminId, id, title) => rename.run(title, id, adminId).changes > 0,
    remove: removeMedia,
  };
}

// Signed file URLs for screens (a <video> element cannot send the screen token).
function createMediaSigner(dataDir) {
  const secretFile = path.join(dataDir, 'media-secret');
  let secret;
  try {
    secret = fs.readFileSync(secretFile, 'utf8').trim();
  } catch (err) {
    secret = '';
  }
  if (!/^[0-9a-f]{64}$/.test(secret)) {
    secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  }
  const mac = (adminId, id, exp) => crypto.createHmac('sha256', secret).update(`${adminId}:${id}:${exp}`).digest('hex');

  return {
    // Valid 12-13 h; the expiry is rounded to the hour so a frame stays the same meanwhile.
    url(adminId, id, now = Date.now()) {
      const exp = Math.ceil((now + SIGNED_TTL_MS) / 3600000) * 3600000;
      return `/api/media/${id}/file?exp=${exp}&sig=${mac(adminId, id, exp)}`;
    },
    verify(adminId, id, exp, sig) {
      if (!/^\d{1,15}$/.test(String(exp)) || Number(exp) < Date.now() || typeof sig !== 'string' || !/^[0-9a-f]{64}$/.test(sig)) return false;
      return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(mac(adminId, id, Number(exp)), 'hex'));
    },
  };
}

// How a video is played on the screens: { type: 'upload', src, mime } | { type: 'file', src }
// | { type: 'youtube', id } | { type: 'vimeo', id } (+ title). signedUrl(id) signs uploads.
function playable(mediaRow, signedUrl) {
  const source = sourceOf(mediaRow);
  const title = mediaRow.title;
  if (source.type === 'upload') return { type: 'upload', src: signedUrl(mediaRow.id), mime: source.mime, title };
  if (source.type === 'file') return { type: 'file', src: source.url, title };
  return { type: source.type, id: source.id, title };
}

module.exports = { TITLE_MAX, sniffVideo, parseVideoUrl, sourceOf, playable, validateTitle, createMediaStore, createMediaSigner };
