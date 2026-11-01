'use strict';

// A raw upload (the request body is the file) streamed to a temp file, never held in
// memory, stopped as soon as it passes the limit; the first bytes come back for sniffing.
//
//   receiveUpload(req, res, { temp, limit, tooLarge, t, logger, onShutdown })
//     -> Promise<{ size, head } | null>   null: a refusal was already sent (the temp file is gone)
//
// limit: the most bytes accepted (the file limit, the church's quota and the disk's room,
// whichever is smallest); tooLarge(bytes) -> [status, message] names which one. The same
// rules as routes/media.js, for the files that belong to a song (its backing track).

const fs = require('fs');

function receiveUpload(req, res, { temp, limit, tooLarge, t, logger }) {
  return new Promise((resolve) => {
    const declared = Number(req.get('content-length'));
    if (Number.isFinite(declared) && declared > limit) {
      res.set('Connection', 'close');
      const [status, error] = tooLarge(declared);
      res.status(status).json({ error });
      return resolve(null);
    }
    const out = fs.createWriteStream(temp, { flags: 'wx' });
    let size = 0;
    let failed = false;
    const fail = (status, error, code = null) => {
      if (failed) return;
      failed = true;
      req.unpipe(out);
      out.destroy();
      fs.rm(temp, { force: true }, () => {});
      if (!res.headersSent) {
        res.set('Connection', 'close');
        res.status(status).json(code ? { code, error } : { error });
      }
      req.resume();
      resolve(null);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) fail(...tooLarge(size));
    });
    req.on('aborted', () => fail(400, t('errors.badRequest')));
    req.once('wa:shutdown', ({ code, error }) => fail(503, error, code)); // the server is stopping (lib/shutdown.js)
    out.on('error', (err) => {
      if (failed) return;
      if (logger) logger.error('upload write failed', err);
      fail(500, t('errors.internal'));
    });
    out.on('finish', () => {
      if (failed) return;
      const head = Buffer.alloc(64);
      let read = 0;
      try {
        const fd = fs.openSync(temp, 'r');
        read = fs.readSync(fd, head, 0, 64, 0);
        fs.closeSync(fd);
      } catch (err) {
        return fail(500, t('errors.internal'));
      }
      return resolve({ size, head: head.subarray(0, read) });
    });
    req.pipe(out);
  });
}

module.exports = { receiveUpload };
