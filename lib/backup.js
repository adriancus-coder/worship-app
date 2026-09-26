'use strict';

// A full backup of ONE admin (church), downloaded by its owner as a .zip laid out like
// DATA_DIR, so restoring is "unzip into DATA_DIR" (docs/RESTORE.md):
//   worship.db                    a consistent copy (VACUUM INTO, never a raw copy of the
//                                 live file) holding only this admin: every other admin and
//                                 its data (users and password hashes included) removed,
//                                 no sessions and no pending screen pairings, then VACUUMed
//                                 so nothing deleted survives in free pages
//   uploads/admin-<id>/...        the admin's files (media, logo); temp uploads skipped
//   meta.json                     app, version, date, schema version, counts
// The last download (date, size) is kept in admin_settings (backup_last_at / _bytes);
// createBackupLog also decides the owner's home reminder (none for 30 days, or never).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { planZip } = require('./zip');

const REMIND_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

// The backup bookkeeping of each admin: last download, and the home reminder.
function createBackupLog(db) {
  const upsert = db.prepare(`INSERT INTO admin_settings (admin_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT (admin_id, key) DO UPDATE SET value = excluded.value`);
  const select = db.prepare(`SELECT key, value FROM admin_settings WHERE admin_id = ?
    AND key IN ('backup_last_at', 'backup_last_bytes', 'backup_reminder_dismissed_at')`);
  const values = (adminId) => Object.fromEntries(select.all(adminId).map((r) => [r.key, Number(r.value) || null]));

  function recordDownload(adminId, bytes, at = Date.now()) {
    upsert.run(adminId, 'backup_last_at', String(at));
    upsert.run(adminId, 'backup_last_bytes', String(bytes));
  }

  // { lastAt, lastBytes } (null when never downloaded).
  function lastBackup(adminId) {
    const v = values(adminId);
    return { lastAt: v.backup_last_at || null, lastBytes: v.backup_last_bytes || null };
  }

  // The owner's home card: { lastAt } (null = never) when the last backup is older than
  // 30 days or missing, unless dismissed in the last 30 days; else null.
  function reminder(adminId, now = Date.now()) {
    const v = values(adminId);
    const lastAt = v.backup_last_at || null;
    if (lastAt && now - lastAt < REMIND_AFTER_MS) return null;
    const dismissed = v.backup_reminder_dismissed_at;
    if (dismissed && now - dismissed < REMIND_AFTER_MS && (!lastAt || dismissed > lastAt)) return null;
    return { lastAt };
  }

  function dismissReminder(adminId, now = Date.now()) {
    upsert.run(adminId, 'backup_reminder_dismissed_at', String(now));
  }

  return { recordDownload, lastBackup, reminder, dismissReminder };
}

const COUNTED = { users: 'users', songs: 'songs', sections: 'song_sections', events: 'events', setlistItems: 'setlist_items', media: 'media', screens: 'screens' };

// The files under dir (recursively), as paths relative to base; dot files skipped.
function filesUnder(dir, base) {
  let out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(filesUnder(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

function createBackupService({ db, dataDir, config }) {
  const log = createBackupLog(db);

  // A copy of the database reduced to one admin; returns { file, counts, schemaVersion, adminName }.
  function adminDatabase(adminId, tmpDir) {
    const file = path.join(tmpDir, 'worship.db');
    db.prepare('VACUUM INTO ?').run(file);
    const copy = new Database(file);
    try {
      copy.pragma('journal_mode = DELETE');
      copy.pragma('foreign_keys = ON');
      copy.transaction(() => {
        copy.prepare('DELETE FROM sessions').run();
        copy.prepare('DELETE FROM screen_pairings').run();
        copy.prepare('DELETE FROM admins WHERE id <> ?').run(adminId);
        // Belt and braces: any table with an admin_id keeps this admin's rows only.
        for (const { name } of copy.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) {
          if (copy.pragma(`table_info(${name})`).some((c) => c.name === 'admin_id')) {
            copy.prepare(`DELETE FROM "${name}" WHERE admin_id <> ?`).run(adminId);
          }
        }
      })();
      if (copy.pragma('foreign_key_check').length) throw new Error('backup: broken foreign keys');
      copy.exec('VACUUM');
      const counts = {};
      for (const [key, table] of Object.entries(COUNTED)) counts[key] = copy.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get();
      const schemaVersion = copy.prepare('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1').pluck().get() || null;
      const adminName = copy.prepare('SELECT name FROM admins WHERE id = ?').pluck().get(adminId);
      return { file, counts, schemaVersion, adminName };
    } finally {
      copy.close();
    }
  }

  // Prepares the archive; returns { zip, filename, cleanup() }.
  async function prepare(adminId, now = new Date()) {
    const tmpDir = path.join(dataDir, `.backup-${crypto.randomBytes(6).toString('hex')}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const cleanup = () => fs.rmSync(tmpDir, { recursive: true, force: true });
    try {
      const { file, counts, schemaVersion, adminName } = adminDatabase(adminId, tmpDir);
      const uploads = filesUnder(path.join(dataDir, 'uploads', `admin-${adminId}`), dataDir);
      const meta = {
        app: config.APP_NAME,
        version: config.VERSION,
        createdAt: now.toISOString(),
        schemaVersion,
        adminId,
        adminName,
        counts: { ...counts, files: uploads.length },
        restore: 'Stop the service, unzip into DATA_DIR, start it again (docs/RESTORE.md).',
      };
      const zip = await planZip([
        { name: 'meta.json', data: Buffer.from(`${JSON.stringify(meta, null, 2)}\n`) },
        { name: 'worship.db', path: file },
        ...uploads.map((rel) => ({ name: rel, path: path.join(dataDir, rel) })),
      ], now);
      const day = now.toISOString().slice(0, 10);
      return { zip, meta, filename: `worship-backup-${day}.zip`, cleanup };
    } catch (err) {
      cleanup();
      throw err;
    }
  }

  return { prepare, recordDownload: log.recordDownload, lastBackup: log.lastBackup };
}

module.exports = { REMIND_AFTER_MS, createBackupLog, createBackupService, filesUnder };
