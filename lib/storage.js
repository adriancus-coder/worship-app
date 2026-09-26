'use strict';

// Keeps the data disk from filling (DATA_DIR on Render is a small persistent disk).
//   refreshSoon()    the same a moment later (deletes remove their files asynchronously)
//   refresh()        walks DATA_DIR (database + uploads) and reads the disk (statfs); run at
//                    start and after every upload / delete. Logs a warning when the app's
//                    data passes WARN_PCT of the disk.
//   room()           bytes that may still be written while keeping DISK_MIN_FREE_PCT of the
//                    disk free (read live, so every upload sees the current disk).
//   usage()          { dataBytes, dbBytes, uploadsBytes, diskBytes, freeBytes, minFreePct }
// Uploads check room() on top of the per-admin quota (routes/media.js, routes/settings.js).

const fs = require('fs');
const path = require('path');

const WARN_PCT = 70;

function sizeUnder(dir) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) total += sizeUnder(full);
      else if (entry.isFile()) total += fs.statSync(full).size;
    } catch (err) {
      // removed meanwhile
    }
  }
  return total;
}

function createStorageGuard({ dataDir, minFreePct, logger, statfs = (dir) => fs.statfsSync(dir), warnPct = WARN_PCT }) {
  let last = null;
  let warned = false;

  function disk() {
    const s = statfs(dataDir);
    return { diskBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize };
  }

  function refresh() {
    let dbBytes = 0;
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        dbBytes += fs.statSync(path.join(dataDir, `worship.db${suffix}`)).size;
      } catch (err) {
        // not there
      }
    }
    const uploadsBytes = sizeUnder(path.join(dataDir, 'uploads'));
    const dataBytes = sizeUnder(dataDir);
    last = { dataBytes, dbBytes, uploadsBytes, ...disk(), minFreePct };
    const pct = last.diskBytes ? ((dbBytes + uploadsBytes) / last.diskBytes) * 100 : 0;
    if (pct > warnPct) {
      if (!warned && logger) logger.warn(`Storage: database + uploads use ${pct.toFixed(1)} % of the disk (over ${warnPct} %): ${dbBytes + uploadsBytes} of ${last.diskBytes} bytes`);
      warned = true;
    } else warned = false;
    return last;
  }

  function room() {
    const { diskBytes, freeBytes } = disk();
    return Math.max(0, Math.floor(freeBytes - (diskBytes * minFreePct) / 100));
  }

  function usage() {
    return { ...(last || refresh()), ...disk() };
  }

  let timer = null;
  function refreshSoon(ms = 500) {
    clearTimeout(timer);
    timer = setTimeout(refresh, ms);
    if (timer.unref) timer.unref();
  }

  return { refresh, refreshSoon, room, usage };
}

module.exports = { WARN_PCT, sizeUnder, createStorageGuard };
