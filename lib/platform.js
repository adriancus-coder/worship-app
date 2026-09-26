'use strict';

// Churches (admins) as the platform owner sees them (routes/platform.js): the list with
// usage figures, creating a church with its owner, deactivating / reactivating it, a new
// temporary password for its owner, its media quota, and its permanent deletion in two
// steps (scheduled 7 days ahead on a deactivated church; a sweep purges it, final backup
// first). The only module that reads across admins; nothing here is reachable by an
// ordinary church.

const fs = require('fs');
const path = require('path');
const { DEFAULTS, createAdminSettings } = require('./admin-settings');
const { createBackupLog, createBackupService } = require('./backup');
const { sizeUnder } = require('./storage');

const MAX_ADMIN_NAME = 100;
const MB = 1024 * 1024;
const MAX_QUOTA_MB = 1024 * 1024; // 1 TB: a typo guard, not a policy
const DAY_MS = 24 * 60 * 60 * 1000;
const DELETE_DELAY_MS = 7 * DAY_MS; // between scheduling and the purge
const DELETED_KEEP_MS = 30 * DAY_MS; // final backups of purged churches
const DELETED_DIR = 'deleted'; // under DATA_DIR

function validateAdminName(value, t) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > MAX_ADMIN_NAME) return { error: t('errors.platformNameInvalid', { max: MAX_ADMIN_NAME }) };
  return { value: name };
}

// mediaMaxMb: a whole number of MB, or null (back to the server default).
function validateQuota(value, t) {
  if (value === null || value === '') return { value: null };
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_QUOTA_MB) return { error: t('errors.platformQuotaInvalid', { max: MAX_QUOTA_MB }) };
  return { value: n * MB };
}

function createPlatformStore(db, { dataDir, defaultMediaMaxBytes }) {
  const listRows = db.prepare(`SELECT a.id, a.name, a.created_at, a.active, a.deactivated_at, a.media_max_bytes, a.delete_at,
      (SELECT COUNT(*) FROM users u WHERE u.admin_id = a.id) AS users,
      (SELECT COUNT(*) FROM songs s WHERE s.admin_id = a.id) AS songs,
      (SELECT COUNT(*) FROM events e WHERE e.admin_id = a.id AND e.is_template = 0) AS events,
      MAX(COALESCE((SELECT MAX(last_login_at) FROM users u WHERE u.admin_id = a.id), 0),
          COALESCE((SELECT MAX(updated_at) FROM songs s WHERE s.admin_id = a.id), 0),
          COALESCE((SELECT MAX(updated_at) FROM events e WHERE e.admin_id = a.id), 0),
          COALESCE((SELECT MAX(created_at) FROM sessions x WHERE x.admin_id = a.id), 0)) AS last_activity,
      (SELECT id FROM users u WHERE u.admin_id = a.id AND u.role = 'owner' ORDER BY id LIMIT 1) AS owner_id,
      (SELECT email FROM users u WHERE u.admin_id = a.id AND u.role = 'owner' ORDER BY id LIMIT 1) AS owner_email
    FROM admins a ORDER BY a.id`);
  const selectAdmin = db.prepare('SELECT id, name, active, media_max_bytes, delete_at FROM admins WHERE id = ?');
  const emailTaken = db.prepare('SELECT 1 FROM users WHERE email = ?').pluck();
  const insertAdmin = db.prepare('INSERT INTO admins (name, created_at) VALUES (?, ?)');
  const insertSetting = db.prepare('INSERT INTO admin_settings (admin_id, key, value) VALUES (?, ?, ?)');
  const insertOwner = db.prepare(`INSERT INTO users
    (admin_id, email, name, password_hash, role, active, must_change_password, created_by, created_at)
    VALUES (?, ?, ?, ?, 'owner', 1, 1, ?, ?)`);
  const setActive = db.prepare('UPDATE admins SET active = ?, deactivated_at = ? WHERE id = ?');
  const setDeleteAt = db.prepare('UPDATE admins SET delete_at = ? WHERE id = ?');
  const dueRows = db.prepare('SELECT id, name, delete_at FROM admins WHERE delete_at IS NOT NULL AND delete_at <= ? AND active = 0 ORDER BY id');
  const deleteAdminRow = db.prepare('DELETE FROM admins WHERE id = ?');
  const deleteSessions = db.prepare('DELETE FROM sessions WHERE admin_id = ?');
  const selectOwner = db.prepare("SELECT id, email, name FROM users WHERE admin_id = ? AND role = 'owner' ORDER BY id LIMIT 1");
  const setOwnerPassword = db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ? AND admin_id = ?');
  const deleteUserSessions = db.prepare('DELETE FROM sessions WHERE user_id = ? AND admin_id = ?');
  const setQuotaStmt = db.prepare('UPDATE admins SET media_max_bytes = ? WHERE id = ?');

  const quotaOf = (row) => row.media_max_bytes || defaultMediaMaxBytes;

  // The detail page: counts and health, never content (no song, event or media names).
  const settings = createAdminSettings(db);
  const backupLog = createBackupLog(db);
  const usersByRole = db.prepare('SELECT role, COUNT(*) AS n FROM users WHERE admin_id = ? GROUP BY role');
  const activeUsers = db.prepare('SELECT COUNT(*) FROM users WHERE admin_id = ? AND active = 1').pluck();
  const eventsByStatus = db.prepare('SELECT status, COUNT(*) AS n FROM events WHERE admin_id = ? AND is_template = 0 GROUP BY status');
  const templates = db.prepare('SELECT COUNT(*) FROM events WHERE admin_id = ? AND is_template = 1').pluck();
  const mediaCount = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes), 0) AS bytes FROM media WHERE admin_id = ? AND kind IN ('upload', 'image', 'loop')");
  const mediaLinks = db.prepare("SELECT COUNT(*) FROM media WHERE admin_id = ? AND kind = 'url'").pluck();
  const screenCount = db.prepare("SELECT COUNT(*) FROM screens WHERE admin_id = ? AND revoked_at IS NULL AND token_hash NOT LIKE 'pending:%'").pluck();

  // onlineScreens: how many of its screens are connected now (socket/screens.js).
  function detail(id, platformAdminId, onlineScreens = 0) {
    const row = list(platformAdminId).find((a) => a.id === id);
    if (!row) return null;
    const media = mediaCount.get(id);
    return {
      ...row,
      usage: {
        usersByRole: Object.fromEntries(['owner', 'leader', 'operator', 'member'].map((r) => [r, 0]).concat(usersByRole.all(id).map((r) => [r.role, r.n]))),
        usersActive: activeUsers.get(id),
        songs: row.songs,
        eventsByStatus: Object.fromEntries(['planned', 'live', 'finished'].map((st) => [st, 0]).concat(eventsByStatus.all(id).map((r) => [r.status, r.n]))),
        templates: templates.get(id),
        mediaFiles: media.n,
        mediaLinks: mediaLinks.get(id),
        mediaBytes: media.bytes,
        screens: screenCount.get(id),
        screensOnline: onlineScreens,
      },
      settings: {
        timezone: settings.timezone(id),
        service: settings.service(id),
        themeDefault: settings.themeDefault(id),
        chordNotationDefault: settings.chordNotationDefault(id),
      },
      backup: backupLog.lastBackup(id),
    };
  }

  // platformAdminId: marks that church's row.
  function list(platformAdminId) {
    return listRows.all().map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      active: Boolean(row.active),
      deactivatedAt: row.deactivated_at,
      deleteAt: row.delete_at, // permanent deletion scheduled for then (null: none)
      platform: row.id === platformAdminId,
      ownerEmail: row.owner_email || null,
      users: row.users,
      songs: row.songs,
      events: row.events,
      storageBytes: sizeUnder(path.join(dataDir, 'uploads', `admin-${row.id}`)),
      mediaMaxBytes: quotaOf(row),
      mediaMaxOverride: row.media_max_bytes !== null,
      lastActivityAt: row.last_activity || null,
    }));
  }

  function get(id) {
    return selectAdmin.get(id) || null;
  }

  function isEmailTaken(email) {
    return emailTaken.get(email) !== undefined;
  }

  // A church with the default settings and its owner (temporary password, to be changed at
  // the first login). Returns { adminId, userId }.
  const create = db.transaction(({ name, ownerName, ownerEmail }, passwordHash, createdBy) => {
    const now = Date.now();
    const adminId = Number(insertAdmin.run(name, now).lastInsertRowid);
    for (const key of ['timezone', 'chord_notation_default', 'theme_default']) insertSetting.run(adminId, key, DEFAULTS[key]);
    const userId = Number(insertOwner.run(adminId, ownerEmail, ownerName, passwordHash, createdBy, now).lastInsertRowid);
    return { adminId, userId };
  });

  // Deactivated: its sessions end (its users get 401 at once) and no login works.
  const deactivate = db.transaction((id) => {
    setActive.run(0, Date.now(), id);
    deleteSessions.run(id);
  });

  // Reactivating also drops a scheduled deletion (only a deactivated church is purged).
  const reactivate = db.transaction((id) => {
    setActive.run(1, null, id);
    setDeleteAt.run(null, id);
  });

  // --- permanent deletion ---------------------------------------------------------------

  // Step one: allowed on a deactivated church whose name is typed exactly. Returns
  // { deleteAt } or { error: 'active' | 'name' }.
  function scheduleDelete(id, confirmName, now = Date.now()) {
    const admin = selectAdmin.get(id);
    if (!admin || admin.active) return { error: 'active' };
    if (typeof confirmName !== 'string' || confirmName !== admin.name) return { error: 'name' };
    const deleteAt = now + DELETE_DELAY_MS;
    setDeleteAt.run(deleteAt, id);
    return { deleteAt };
  }

  // Returns false when nothing was scheduled.
  function cancelDelete(id) {
    const admin = selectAdmin.get(id);
    if (!admin || admin.delete_at === null) return false;
    setDeleteAt.run(null, id);
    return true;
  }

  // Deactivated churches whose delete_at has passed: [{ id, name, deleteAt }].
  function dueForDeletion(now = Date.now()) {
    return dueRows.all(now).map((r) => ({ id: r.id, name: r.name, deleteAt: r.delete_at }));
  }

  // Every table holding admin data (any table with an admin_id column), read once.
  const adminTables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all()
    .filter((name) => db.pragma(`table_info(${name})`).some((c) => c.name === 'admin_id'));
  const deleteRows = Object.fromEntries(adminTables.map((name) => [name, db.prepare(`DELETE FROM "${name}" WHERE admin_id = ?`)]));

  // Step two, the rows: ONE transaction removes every row of the church (users, sessions,
  // songs, sections, events, items, live state, media, screens, pairings, settings with the
  // backup metadata) and the church itself. Returns the rows removed per table.
  const purgeRows = db.transaction((id) => {
    const removed = {};
    for (const name of adminTables) removed[name] = deleteRows[name].run(id).changes;
    removed.admins = deleteAdminRow.run(id).changes;
    return removed;
  });

  // Rows, then the upload folder. Never the platform's own church.
  function purge(id) {
    const removed = purgeRows(id);
    fs.rmSync(path.join(dataDir, 'uploads', `admin-${id}`), { recursive: true, force: true });
    return removed;
  }

  // The church's owner gets a new temporary password; their sessions end. -> the owner row
  const resetOwnerPassword = db.transaction((id, passwordHash) => {
    const owner = selectOwner.get(id);
    if (!owner) return null;
    setOwnerPassword.run(passwordHash, owner.id, id);
    deleteUserSessions.run(owner.id, id);
    return owner;
  });

  function setQuota(id, bytes) {
    setQuotaStmt.run(bytes, id);
  }

  return { list, get, detail, isEmailTaken, create, deactivate, reactivate, resetOwnerPassword, setQuota, scheduleDelete, cancelDelete, dueForDeletion, purge, adminTables };
}

// The sweep that carries out scheduled deletions: at startup and once a day. For each
// church due: a final backup zip (the owner-backup format, lib/backup.js) written to
// DATA_DIR/deleted/<id>-<date>.zip and kept 30 days, then the purge. A backup that fails
// leaves the church untouched (tried again next time). Returns what it did.
function createDeletionSweep({ db, dataDir, config, logger, platformAdminId = () => null }) {
  const store = createPlatformStore(db, { dataDir, defaultMediaMaxBytes: 0 });
  const backups = createBackupService({ db, dataDir, config });
  const dir = path.join(dataDir, DELETED_DIR);
  let running = null;

  async function finalBackup(id, now) {
    fs.mkdirSync(dir, { recursive: true });
    const { zip, cleanup } = await backups.prepare(id, new Date(now));
    const file = path.join(dir, `${id}-${new Date(now).toISOString().slice(0, 10)}.zip`);
    try {
      const out = fs.createWriteStream(`${file}.part`);
      const closed = new Promise((resolve, reject) => { out.on('finish', resolve); out.on('error', reject); });
      await zip.writeTo(out);
      out.end();
      await closed;
      fs.renameSync(`${file}.part`, file);
      return { file, bytes: zip.size };
    } finally {
      cleanup();
      fs.rmSync(`${file}.part`, { force: true });
    }
  }

  // Final backups older than 30 days go.
  function sweepBackups(now) {
    let removed = 0;
    let entries = [];
    try {
      entries = fs.readdirSync(dir);
    } catch (err) {
      return 0;
    }
    for (const name of entries) {
      if (!name.endsWith('.zip')) continue;
      const full = path.join(dir, name);
      try {
        if (now - fs.statSync(full).mtimeMs > DELETED_KEEP_MS) {
          fs.rmSync(full, { force: true });
          removed += 1;
        }
      } catch (err) {
        // gone meanwhile
      }
    }
    return removed;
  }

  async function run(now = Date.now()) {
    if (running) return running; // one sweep at a time
    running = (async () => {
      const out = { purged: [], failed: [], backupsRemoved: 0 };
      for (const due of store.dueForDeletion(now)) {
        if (due.id === platformAdminId()) continue; // never the platform's own church
        try {
          const backup = await finalBackup(due.id, now);
          const removed = store.purge(due.id);
          const rows = Object.values(removed).reduce((a, b) => a + b, 0);
          logger.info(`Platform: purged church #${due.id} "${due.name}" (scheduled for ${new Date(due.deleteAt).toISOString()}): ${rows} rows, final backup ${path.basename(backup.file)} (${backup.bytes} bytes)`);
          out.purged.push({ id: due.id, backup: backup.file, removed });
        } catch (err) {
          logger.error(`Platform: purging church #${due.id} failed, kept for the next sweep`, err);
          out.failed.push(due.id);
        }
      }
      out.backupsRemoved = sweepBackups(now);
      if (out.backupsRemoved) logger.info(`Platform: removed ${out.backupsRemoved} final backup(s) older than 30 days`);
      return out;
    })();
    try {
      return await running;
    } finally {
      running = null;
    }
  }

  // At startup and every 24 h.
  function start() {
    run().catch((err) => logger.error('Platform: deletion sweep failed', err));
    setInterval(() => run().catch((err) => logger.error('Platform: deletion sweep failed', err)), DAY_MS).unref();
  }

  return { run, start, dir };
}

// The media quota of a church (routes/media.js): its override, else the server default.
function createMediaQuota(db, fallback) {
  const select = db.prepare('SELECT media_max_bytes FROM admins WHERE id = ?').pluck();
  return (adminId) => select.get(adminId) || fallback;
}

module.exports = { MAX_ADMIN_NAME, DELETE_DELAY_MS, DELETED_KEEP_MS, DELETED_DIR, validateAdminName, validateQuota, createPlatformStore, createMediaQuota, createDeletionSweep };
