'use strict';

const express = require('express');
const asyncRoute = require('../lib/async-route');
const { requireRole } = require('../lib/auth');
const { createRequestLimiter } = require('../lib/rate-limit');
const { createBackupLog, createBackupService } = require('../lib/backup');

const RATE_LIMIT = { maxRequests: 3, windowMs: 60 * 60 * 1000 };

// GET /api/backup (owner only, 3 per hour per user): the admin's full backup as a .zip
// streamed to the browser (lib/backup.js). Restore is manual: docs/RESTORE.md.
// POST /api/backup/reminder/dismiss (owner): hides the home reminder for 30 days.
function createBackupRouter({ db, auth, config, logger, storage }) {
  const router = express.Router();
  const backups = createBackupService({ db, dataDir: config.DATA_DIR, config });
  const limiter = createRequestLimiter(RATE_LIMIT);
  const log = createBackupLog(db);
  const swept = backups.sweepTemp();
  if (swept) logger.info(`Removed ${swept} leftover backup temp folder(s)`);

  router.post('/api/backup/reminder/dismiss', auth.requireUser, requireRole('owner'), (req, res) => {
    log.dismissReminder(req.adminId);
    res.json({ ok: true });
  });

  router.get('/api/backup', auth.requireUser, requireRole('owner'), asyncRoute(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const retryAfter = limiter.take(`user:${req.user.id}`);
    if (retryAfter > 0) {
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: req.t('errors.backupRateLimited') });
    }
    // The temporary database copy needs room too (it is removed right after).
    if (storage.room() < storage.usage().dbBytes) return res.status(507).json({ error: req.t('errors.backupNoRoom') });
    const { zip, filename, meta, cleanup } = await backups.prepare(req.adminId);
    // The temp copy goes once, before the response finishes: after the archive is fully
    // written (the client never sees a complete body while the copy still exists), or on
    // an abort / error. Never left behind (a startup sweep covers a crash: lib/backup.js).
    let cleaned = false;
    const removeTemp = () => {
      if (cleaned) return;
      cleaned = true;
      try {
        cleanup();
      } catch (err) {
        logger.error('Backup temp cleanup failed', err);
      }
    };
    let done = false;
    res.on('close', () => {
      removeTemp();
      if (!done) logger.info(`Backup for admin #${req.adminId} not completed (connection closed)`);
    });
    res.on('error', removeTemp);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Length': String(zip.size),
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    try {
      await zip.writeTo(res);
      done = true;
      removeTemp(); // every byte has been handed to the socket
      await new Promise((resolve) => res.end(resolve));
      backups.recordDownload(req.adminId, zip.size);
      logger.info(`Backup downloaded by user #${req.user.id} (admin #${req.adminId}, ${zip.size} bytes, ${meta.counts.files} files)`);
    } catch (err) {
      removeTemp();
      logger.error('Backup failed', err);
      res.destroy(err);
    }
  }));

  return router;
}

module.exports = createBackupRouter;
