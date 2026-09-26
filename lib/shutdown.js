'use strict';

// Clean stop on SIGTERM / SIGINT (Render sends SIGTERM on every deploy and restart):
//   1) stop accepting new connections; requests still arriving on open keep-alive
//      connections get 503 "restarting"
//   2) uploads still receiving their body get a clean 503 (req 'wa:shutdown' lets a route
//      clean up after itself first, e.g. the media upload's temp file)
//   3) every socket gets `live:restart` (pages show "Se reconectează…" at once), then
//      socket.io closes
//   4) the HTTP server closes: in-flight requests may finish, at most timeoutMs in total,
//      then the remaining connections are cut
//   5) the database closes after a WAL checkpoint, and the process exits 0
// Each step is logged.

const DEFAULT_TIMEOUT_MS = 10 * 1000;
const RESTART_FLUSH_MS = 100; // lets `live:restart` reach the sockets before they close

function createShutdown({ server, io, db, logger, t, timeoutMs = DEFAULT_TIMEOUT_MS, exit = (code) => process.exit(code) }) {
  let stopping = false;
  const inFlight = new Set();

  const restartingBody = (req) => ({ code: 'restarting', error: (req.t || t)('errors.restarting') });

  // 503 once stopping; tracks the requests in progress so their uploads can be answered.
  function middleware(req, res, next) {
    if (stopping) {
      res.set('Connection', 'close');
      return res.status(503).json(restartingBody(req));
    }
    inFlight.add(req);
    res.on('close', () => inFlight.delete(req));
    next();
  }

  function answerUploads() {
    let count = 0;
    for (const req of inFlight) {
      if (req.complete) continue; // the body has arrived: let the request finish
      count += 1;
      const { res } = req;
      if (req.listenerCount('wa:shutdown') > 0) {
        req.emit('wa:shutdown', restartingBody(req));
      } else if (!res.headersSent) {
        res.set('Connection', 'close');
        res.status(503).json(restartingBody(req));
        req.resume(); // drain whatever is still coming
      }
    }
    return count;
  }

  function closeHttp() {
    return new Promise((resolve) => {
      let done = false;
      const finish = (timedOut) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (timedOut) {
          logger.warn(`Shutdown: HTTP connections still open after ${timeoutMs} ms, closing them`);
          server.closeAllConnections();
        }
        resolve();
      };
      const timer = setTimeout(() => finish(true), timeoutMs);
      server.close(() => finish(false));
      server.closeIdleConnections();
    });
  }

  async function stop(signal) {
    if (stopping) return;
    stopping = true;
    const started = Date.now();
    logger.info(`Shutdown (${signal}): no new connections`);
    // server.close() stops listening now; its callback runs once every connection is gone.
    const httpClosed = closeHttp();
    const uploads = answerUploads();
    if (uploads) logger.info(`Shutdown: answered ${uploads} upload(s) in progress with 503`);
    io.emit('live:restart', {});
    logger.info(`Shutdown: told ${io.engine.clientsCount} socket(s) the server is restarting`);
    await new Promise((resolve) => setTimeout(resolve, RESTART_FLUSH_MS));
    await new Promise((resolve) => io.close(() => resolve()));
    logger.info('Shutdown: socket.io closed');
    await httpClosed;
    logger.info(`Shutdown: HTTP server closed (${Date.now() - started} ms)`);
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
      logger.info('Shutdown: database checkpointed and closed');
    } catch (err) {
      logger.error('Shutdown: closing the database failed', err);
      return exit(1);
    }
    logger.info(`Shutdown complete in ${Date.now() - started} ms`);
    exit(0);
  }

  function listen() {
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => stop(signal));
  }

  return { middleware, stop, listen, get stopping() { return stopping; } };
}

module.exports = { createShutdown, DEFAULT_TIMEOUT_MS };
