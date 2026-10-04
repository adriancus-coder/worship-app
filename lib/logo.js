'use strict';

// The church logo, shown by the projector: PNG, JPEG or WebP up to 2 MB (never SVG: it
// can carry scripts). The type is decided by the file's magic bytes, not its name or the
// Content-Type header. Files live under DATA_DIR/uploads/admin-<id>/logo-<random>.<ext>;
// the admin setting "logo" holds the current file name.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};
const FILE_RE = /^logo-[0-9a-f]{16}\.(png|jpg|webp)$/;

// 'png' | 'jpg' | 'webp' from the first bytes, or null.
function sniff(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function isLogoFile(name) {
  return typeof name === 'string' && FILE_RE.test(name);
}

function createLogoStore(db, dataDir) {
  const selectLogo = db.prepare("SELECT value FROM admin_settings WHERE admin_id = ? AND key = 'logo'").pluck();
  const selectOwner = db.prepare("SELECT admin_id FROM admin_settings WHERE key = 'logo' AND value = ?").pluck();
  const upsert = db.prepare(`INSERT INTO admin_settings (admin_id, key, value) VALUES (?, 'logo', ?)
    ON CONFLICT (admin_id, key) DO UPDATE SET value = excluded.value`);
  const remove = db.prepare("DELETE FROM admin_settings WHERE admin_id = ? AND key = 'logo'");

  const dirOf = (adminId) => path.join(dataDir, 'uploads', `admin-${adminId}`);

  function current(adminId) {
    const file = selectLogo.get(adminId);
    return isLogoFile(file) ? file : null;
  }

  function deleteFile(adminId, file) {
    if (!isLogoFile(file)) return;
    fs.rm(path.join(dirOf(adminId), file), { force: true }, () => {});
  }

  // Stores a validated image and replaces the previous one. Returns the new file name.
  function save(adminId, buffer, ext) {
    const dir = dirOf(adminId);
    fs.mkdirSync(dir, { recursive: true });
    const file = `logo-${crypto.randomBytes(8).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(dir, file), buffer);
    const previous = current(adminId);
    upsert.run(adminId, file);
    if (previous && previous !== file) deleteFile(adminId, previous);
    return file;
  }

  function clear(adminId) {
    const previous = current(adminId);
    remove.run(adminId);
    if (previous) deleteFile(adminId, previous);
    return Boolean(previous);
  }

  // { adminId, path, type } for a logo file that is some admin's current logo, else null.
  function find(file) {
    if (!isLogoFile(file)) return null;
    const adminId = selectOwner.get(file);
    if (adminId === undefined) return null;
    return { adminId, path: path.join(dirOf(adminId), file), type: TYPES[file.split('.').pop()] };
  }

  return { current, save, clear, find };
}

module.exports = { MAX_BYTES, TYPES, sniff, isLogoFile, createLogoStore };
