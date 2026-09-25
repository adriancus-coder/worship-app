'use strict';

const http = require('http');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const { Server: SocketServer } = require('socket.io');

const config = require('./lib/config');
const logger = require('./lib/logger');
const { openDb, runMigrations } = require('./lib/db');
const { createAuth } = require('./lib/auth');
const { createPageRenderer } = require('./lib/pages');
const { createThemeResolver } = require('./lib/theme');
const { t, createI18nMiddleware } = require('./lib/i18n');
const createHealthRouter = require('./routes/health');
const createSetupRouter = require('./routes/setup');
const createAuthRouter = require('./routes/auth');
const createMeRouter = require('./routes/me');
const createSongsRouter = require('./routes/songs');
const createResurseRouter = require('./routes/resurse');
const createEventsRouter = require('./routes/events');
const createPagesRouter = require('./routes/pages');
const { createScreensRouter } = require('./routes/screens');
const createSettingsRouter = require('./routes/settings');
const createMediaRouter = require('./routes/media');
const { createHomeRouter } = require('./routes/home');
const { createTeamRouter } = require('./routes/team');
const { createPwaRouter } = require('./routes/pwa');
const { createLiveHub } = require('./socket/live');
const { createScreensHub } = require('./socket/screens');

const db = openDb(config.DATA_DIR);
const applied = runMigrations(db);
if (applied.length > 0) {
  logger.info(`Applied migrations: ${applied.join(', ')}`);
} else {
  logger.info('Database schema up to date');
}
logger.info(`Database: ${config.DATA_DIR}/worship.db`);

const auth = createAuth({ db, config });
const SESSION_CLEANUP_MS = 60 * 60 * 1000;
function cleanupSessions() {
  const removed = auth.deleteExpiredSessions();
  if (removed > 0) logger.info(`Deleted ${removed} expired session(s)`);
}
cleanupSessions();
setInterval(cleanupSessions, SESSION_CLEANUP_MS).unref();

// Live rooms and projector screens: routes notify the hubs; they attach to socket.io below.
const screensHub = createScreensHub({ db, logger, config });
const live = createLiveHub({ db, auth, logger, screensHub });

const app = express();
app.disable('x-powered-by');
if (config.IS_PRODUCTION) app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      upgradeInsecureRequests: config.IS_PRODUCTION ? [] : null,
      // Projector video: YouTube / Vimeo players in iframes (controlled with postMessage, no
      // vendor scripts); uploads, local files (blob:) and direct https .mp4 / .webm links.
      frameSrc: ["'self'", 'https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
      mediaSrc: ["'self'", 'blob:', 'https:'],
    },
  },
  strictTransportSecurity: config.IS_PRODUCTION,
}));
app.use(compression());
app.use(createI18nMiddleware());
const jsonBody = express.json({ limit: '100kb' });
// The library import route parses its own, larger body (routes/songs.js).
app.use((req, res, next) => (req.path === '/api/songs/import' ? next() : jsonBody(req, res, next)));

// Pages are served only through their routes, never as raw .html files.
app.use((req, res, next) => (req.path.endsWith('.html') ? res.status(404).end() : next()));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.use(createHealthRouter({ config }));
const { themeOf } = createThemeResolver({ db, auth });
const sendPage = createPageRenderer({ config, themeOf });
app.use(createPwaRouter({ config, logger, sendPage, themeOf }));

app.use(createSetupRouter({ db, config, logger, sendPage }));
app.use(createAuthRouter({ db, auth, config, logger, live }));
app.use(createMeRouter({ db, auth, config, logger, live }));
app.use(createSongsRouter({ db, auth, config, logger, live }));
app.use(createResurseRouter({ db, auth, logger }));
app.use(createEventsRouter({ db, auth, logger, live }));
app.use(createHomeRouter({ db, auth }));
app.use(createTeamRouter({ db, auth, config, logger, live }));
app.use(createScreensRouter({ db, auth, logger, screensHub }));
app.use(createSettingsRouter({ db, auth, config, logger, screensHub, live }));
app.use(createMediaRouter({ db, auth, config, logger, live }));
app.use(createPagesRouter({ db, auth, sendPage }));

app.use('/api', (req, res) => {
  res.status(404).json({ error: req.t('errors.notFound') });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: (req.t || t)('errors.bodyTooLarge') });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(err.status || 400).json({ error: (req.t || t)('errors.badRequest') });
  }
  logger.error('Unhandled error on', req.method, req.path, err);
  res.status(500).json({ error: (req.t || t)('errors.internal') });
});

const server = http.createServer(app);
const io = new SocketServer(server);
live.attach(io);
screensHub.attach(io);

server.listen(config.PORT, () => {
  logger.info(`${config.APP_NAME} v${config.VERSION} listening on port ${config.PORT} (${config.NODE_ENV})`);
});
