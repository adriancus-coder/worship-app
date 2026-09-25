'use strict';

// Media library: videos and backgrounds for the projector.
// - Uploads: MP4 or WebM videos, and backgrounds (JPEG / PNG / WebP images, MP4 / WebM
//   silent loops), decided by magic bytes (never by name or Content-Type), streamed to
//   DATA_DIR/uploads/admin-<id>/media/<random>.<ext>. Size limits come from config.
// - Images are kept as uploaded plus a projector-size WebP (max 1920x1080, EXIF rotation
//   applied) and a small WebP thumbnail, made with sharp (libvips) on upload.
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
const FILE_RE = /^[0-9a-f]{24}(\.display|\.thumb)?\.(mp4|webm|jpg|png|webp)$/;
// Kinds: videos ('upload' file, 'url' link) and backgrounds ('image', 'loop').
const VIDEO_KINDS = ['upload', 'url'];
const BACKGROUND_KINDS = ['image', 'loop'];
const UPLOAD_KINDS = ['upload', 'image', 'loop'];
const IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const DISPLAY_MAX = { width: 1920, height: 1080 };
const THUMB = { width: 320, height: 180 };
// Files served per media item: the original, the projector version, the thumbnail.
const VARIANTS = ['original', 'display', 'thumb'];
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

// 'image/jpeg' | 'image/png' | 'image/webp' from the first bytes, or null.
function sniffImage(head) {
  if (!Buffer.isBuffer(head) || head.length < 12) return null;
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
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
  if (row.kind === 'image') return { type: 'image', mime: row.mime };
  if (row.kind === 'upload' || row.kind === 'loop') return { type: 'upload', mime: row.mime };
  const m = /^(youtube|vimeo):(.+)$/.exec(row.url || '');
  return m ? { type: m[1], id: m[2] } : { type: 'file', url: row.url };
}

function toMedia(row) {
  return {
    id: row.id,
    kind: row.kind,
    // 'video' (played as a video) or 'background' (behind the lyrics).
    category: BACKGROUND_KINDS.includes(row.kind) ? 'background' : 'video',
    title: row.title,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    durationS: row.duration_s,
    width: row.width || null,
    height: row.height || null,
    thumb: Boolean(row.file_thumb),
    // Readability behind the text (backgrounds): dim %, blur px, text shadow.
    ...(BACKGROUND_KINDS.includes(row.kind) ? { dim: row.bg_dim, blur: row.bg_blur, shadow: Boolean(row.bg_shadow) } : {}),
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
  const insert = db.prepare(`INSERT INTO media (admin_id, kind, title, file, mime, size_bytes, url, duration_s,
      file_display, file_thumb, width, height, created_by, created_at)
    VALUES (@adminId, @kind, @title, @file, @mime, @size, @url, NULL, @display, @thumb, @width, @height, @userId, @now)`);
  const selectOne = db.prepare('SELECT * FROM media WHERE id = ? AND admin_id = ?');
  const selectAll = db.prepare('SELECT * FROM media WHERE admin_id = ? ORDER BY title COLLATE NOCASE, id');
  // Every stored file counts: videos, loops, images with their projector version and thumbnail.
  const usedBytes = db.prepare("SELECT COALESCE(SUM(size_bytes), 0) FROM media WHERE admin_id = ? AND kind IN ('upload', 'image', 'loop')").pluck();
  const rename = db.prepare('UPDATE media SET title = ? WHERE id = ? AND admin_id = ?');
  const remove = db.prepare('DELETE FROM media WHERE id = ? AND admin_id = ?');

  const dirOf = (adminId) => path.join(dataDir, 'uploads', `admin-${adminId}`, 'media');

  function get(adminId, id) {
    const row = selectOne.get(id, adminId);
    return row ? toMedia(row) : null;
  }

  // Absolute path of an uploaded file (variant: 'original' | 'display' | 'thumb'; images
  // have all three, videos and loops only the original), or null.
  function filePath(adminId, id, variant = 'original') {
    const row = selectOne.get(id, adminId);
    if (!row || !UPLOAD_KINDS.includes(row.kind)) return null;
    const file = variant === 'display' ? row.file_display || (row.kind !== 'image' ? row.file : null)
      : variant === 'thumb' ? row.file_thumb
        : row.file;
    if (!FILE_RE.test(file || '')) return null;
    const mime = file === row.file ? row.mime : 'image/webp';
    return { path: path.join(dirOf(adminId), file), mime };
  }

  // A temp file in the admin's media folder for an upload in progress.
  function tempPath(adminId) {
    const dir = dirOf(adminId);
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `.upload-${crypto.randomBytes(8).toString('hex')}`);
  }

  // Moves a verified temp video file into place and records it (kind 'upload': a video,
  // 'loop': a background played muted and looped).
  function addUpload(adminId, userId, { title, temp, mime, size, kind = 'upload' }) {
    const file = `${crypto.randomBytes(12).toString('hex')}.${mime === 'video/webm' ? 'webm' : 'mp4'}`;
    fs.renameSync(temp, path.join(dirOf(adminId), file));
    const id = Number(insert.run({
      adminId, kind, title, file, mime, size, url: null, display: null, thumb: null, width: null, height: null, userId, now: Date.now(),
    }).lastInsertRowid);
    return get(adminId, id);
  }

  // A verified temp image: kept as uploaded, plus the projector version and the thumbnail.
  // Throws when the file is not a decodable image (the caller answers 400).
  async function addImage(adminId, userId, { title, temp, mime }) {
    const sharp = require('sharp'); // loaded on first use: servers without images never need it
    const base = crypto.randomBytes(12).toString('hex');
    const dir = dirOf(adminId);
    const names = { file: `${base}.${IMAGE_EXT[mime]}`, display: `${base}.display.webp`, thumb: `${base}.thumb.webp` };
    const out = (name) => path.join(dir, name);
    try {
      const meta = await sharp(temp).metadata();
      if (!meta.width || !meta.height) throw new Error('no image size');
      // .rotate() applies the EXIF orientation (phone photos) before resizing.
      await sharp(temp).rotate()
        .resize({ ...DISPLAY_MAX, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(out(names.display));
      await sharp(temp).rotate()
        .resize({ ...THUMB, fit: 'cover' })
        .webp({ quality: 70 })
        .toFile(out(names.thumb));
      fs.renameSync(temp, out(names.file));
      const size = [names.file, names.display, names.thumb].reduce((sum, name) => sum + fs.statSync(out(name)).size, 0);
      const swap = [5, 6, 7, 8].includes(meta.orientation); // rotated a quarter turn
      const id = Number(insert.run({
        adminId, kind: 'image', title, file: names.file, mime, size, url: null, display: names.display, thumb: names.thumb,
        width: swap ? meta.height : meta.width, height: swap ? meta.width : meta.height, userId, now: Date.now(),
      }).lastInsertRowid);
      return get(adminId, id);
    } catch (err) {
      for (const name of Object.values(names)) fs.rm(out(name), { force: true }, () => {});
      fs.rm(temp, { force: true }, () => {});
      throw err;
    }
  }

  function addUrl(adminId, userId, title, parsed) {
    const id = Number(insert.run({
      adminId, kind: 'url', title, file: null, mime: null, size: null, url: storedUrl(parsed),
      display: null, thumb: null, width: null, height: null, userId, now: Date.now(),
    }).lastInsertRowid);
    return get(adminId, id);
  }

  function removeMedia(adminId, id) {
    const row = selectOne.get(id, adminId);
    if (!row) return false;
    remove.run(id, adminId);
    for (const file of [row.file, row.file_display, row.file_thumb]) {
      if (FILE_RE.test(file || '')) fs.rm(path.join(dirOf(adminId), file), { force: true }, () => {});
    }
    return true;
  }

  return {
    get,
    list: (adminId) => selectAll.all(adminId).map(toMedia),
    usedBytes: (adminId) => usedBytes.get(adminId),
    filePath,
    tempPath,
    addUpload,
    addImage,
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
    // variant: 'display' / 'thumb' for the image versions (the same signature: one item).
    url(adminId, id, now = Date.now(), variant = 'original') {
      const exp = Math.ceil((now + SIGNED_TTL_MS) / 3600000) * 3600000;
      return `/api/media/${id}/file?${variant !== 'original' ? `v=${variant}&` : ''}exp=${exp}&sig=${mac(adminId, id, exp)}`;
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

module.exports = {
  TITLE_MAX, VIDEO_KINDS, BACKGROUND_KINDS, VARIANTS, DISPLAY_MAX,
  sniffVideo, sniffImage, parseVideoUrl, sourceOf, playable, validateTitle, createMediaStore, createMediaSigner,
};
