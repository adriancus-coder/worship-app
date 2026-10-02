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
const createBackupRouter = require('./routes/backup');
const { createHomeRouter } = require('./routes/home');
const { createTeamRouter } = require('./routes/team');
const { createPositionsRouter } = require('./routes/positions');
const { createAssignmentsRouter } = require('./routes/assignments');
const { createUnavailabilityRouter } = require('./routes/unavailability');
const { createPushRouter } = require('./routes/push');
const { createPush } = require('./lib/push');
const { createNotifications } = require('./lib/notifications');
const { createNotificationsRouter } = require('./routes/notifications');
const { createProposalsRouter } = require('./routes/proposals');
const { createPlatformRouter } = require('./routes/platform');
const { createPwaRouter } = require('./routes/pwa');
const { createLiveHub } = require('./socket/live');
const { createScreensHub } = require('./socket/screens');
const { createBridge } = require('./lib/bridge');
const { createBridgeRouter } = require('./routes/bridge');
const { createStorageGuard } = require('./lib/storage');
const { createEmail } = require('./lib/email');
const { createInviteService } = require('./lib/invites');
const { createInvitesRouter } = require('./routes/invites');
const { createShutdown } = require('./lib/shutdown');

const db = openDb(config.DATA_DIR);
const applied = runMigrations(db);
if (applied.length > 0) {
  logger.info(`Applied migrations: ${applied.join(', ')}`);
} else {
  logger.info('Database schema up to date');
}
logger.info(`Database: ${config.DATA_DIR}/worship.db`);

// Disk usage of DATA_DIR, now and after every upload / delete (lib/storage.js).
const storage = createStorageGuard({ dataDir: config.DATA_DIR, minFreePct: config.DISK_MIN_FREE_PCT, logger });
const usage = storage.refresh();
logger.info(`Storage: data ${usage.dataBytes} bytes, disk free ${usage.freeBytes} of ${usage.diskBytes} bytes (uploads keep ${config.DISK_MIN_FREE_PCT} % free)`);

const auth = createAuth({ db, config });
// Outgoing email (Resend); disabled without RESEND_API_KEY + EMAIL_FROM (lib/email.js).
const email = createEmail({ config, logger });
const { createPexels } = require('./lib/pexels');
const pexels = createPexels({ config, logger });
logger.info(email.enabled ? `Email: enabled, from ${config.EMAIL_FROM}` : 'Email: disabled (RESEND_API_KEY / EMAIL_FROM not set)');
const invites = createInviteService({ db, config, logger, email }); // invitation / reset links
const SESSION_CLEANUP_MS = 60 * 60 * 1000;
function cleanupSessions() {
  const removed = auth.deleteExpiredSessions();
  if (removed > 0) logger.info(`Deleted ${removed} expired session(s)`);
}
cleanupSessions();
setInterval(cleanupSessions, SESSION_CLEANUP_MS).unref();

// Live rooms and projector screens: routes notify the hubs; they attach to socket.io below.
const screensHub = createScreensHub({ db, logger, config });
const liveHooks = {}; // filled by the notifications module below
const live = createLiveHub({ db, auth, logger, screensHub, hooks: liveHooks });

// The bridge to Sanctuary Voice (stage 8): server-to-server only. socket.io-client is the
// server-side socket to SV's /bridge namespace; global fetch handles the REST handshake.
const { io: ioClient } = require('socket.io-client');
const bridge = createBridge({ db, config, logger, ioClient, screensHub });
// The projector's translation source reads its live text from the bridge (SV -> worship).
screensHub.setTranslationSource((adminId, eventId, lang) => bridge.translationFor(adminId, eventId, lang));

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
// A clean stop (SIGTERM / SIGINT): 503 for anything arriving meanwhile (lib/shutdown.js).
app.use((req, res, next) => shutdown.middleware(req, res, next));
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
app.use(createBridgeRouter({ db, auth, logger, bridge }));
app.use(createHomeRouter({ db, auth }));
app.use(createTeamRouter({ db, auth, config, logger, live, email, invites }));
app.use(createPositionsRouter({ db, auth, logger }));
const assignmentHooks = {}; // filled by the notifications module (stage 7)
app.use(createAssignmentsRouter({ db, auth, logger, hooks: assignmentHooks }));
app.use(createUnavailabilityRouter({ db, auth, logger }));
const push = createPush({ db, config, logger });
logger.info(push.enabled ? 'Push: enabled (VAPID keys set)' : 'Push: disabled (no VAPID keys; npm run vapid, docs/PUSH.md)');
app.use(createPushRouter({ auth, logger, push }));
// The notifications centre: rows + pushes for the team events; the hooks of the live hub and
// the assignments router; a minute tick for the day-before reminders (idempotent).
const notifications = createNotifications({ db, logger, push });
liveHooks.onLiveStarted = (adminId, eventId) => notifications.onLiveStarted(adminId, eventId);
liveHooks.onSetlistChanged = (adminId, eventId) => { notifications.onSetlistChanged(adminId, eventId); bridge.onSetlistChanged(adminId, eventId); };
// The bridge sends the current song section to Sanctuary Voice on every main-position change.
liveHooks.onLiveChanged = (adminId, eventId) => bridge.onLiveChanged(adminId, eventId);
assignmentHooks.onDeclined = ({ req, event, row }) => notifications.onDeclined(req.adminId, event, row).catch((err) => logger.error('declined notification failed', err));
// "Trimite programarea": a notification (+ push) to every pending person not yet told; those
// without push get an email with the same text and the event link when email is enabled.
assignmentHooks.onSent = async ({ req, event, rows }) => {
  const out = await notifications.onAssigned(req.adminId, event, rows, req.user.name);
  const result = { sent: out.sent, withoutPush: out.withoutPush, emailed: 0 };
  if (!email.enabled || !out.withoutPush) return result;
  const baseUrl = config.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  const selectUser = db.prepare('SELECT id, name, email, locale FROM users WHERE id = ? AND admin_id = ? AND active = 1');
  for (const userId of out.userIds) {
    if (push.enabled && push.hasSubscription(req.adminId, userId)) continue;
    const user = selectUser.get(userId, req.adminId);
    if (!user) continue;
    const lang = user.locale === 'en' ? 'en' : 'ro';
    const positions = rows.filter((r) => r.userId === userId).map((r) => r.positionName).join(', ');
    const message = email.templates.schedule(lang, { appName: config.APP_NAME, churchName: req.admin.name, url: `${baseUrl}/events/${event.id}`, name: event.name, date: event.eventDate, time: event.startTime || '', positions, by: req.user.name, email: user.email });
    try {
      await email.send(req.adminId, { ...message, to: user.email, kind: 'schedule', userId });
      result.emailed += 1;
    } catch (err) {
      logger.warn(`Schedule email to user #${userId} not sent: ${err.code || err.message}`);
    }
  }
  return result;
};
app.use(createNotificationsRouter({ auth, config, notifications }));
app.use(createProposalsRouter({ db, auth, logger, live, notifications }));
setInterval(() => notifications.tick().catch((err) => logger.error('reminder tick failed', err)), 60 * 1000).unref();
app.use(createPlatformRouter({ db, auth, config, logger, live, screensHub, storage, email, invites }));
app.use(createInvitesRouter({ db, auth, config, logger, live, email, invites }));
app.use(createScreensRouter({ db, auth, config, logger, screensHub }));
app.use(createSettingsRouter({ db, auth, config, logger, screensHub, live, storage, email, pexels }));
app.use(createMediaRouter({ db, auth, config, logger, live, storage, pexels }));
app.use(createBackupRouter({ db, auth, config, logger, storage }));
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
const shutdown = createShutdown({ server, io, db, logger, t });
shutdown.listen();

server.listen(config.PORT, () => {
  logger.info(`${config.APP_NAME} v${config.VERSION} (${config.SHORT_COMMIT || 'commit unknown'}) listening on port ${config.PORT} (${config.NODE_ENV})`);
  // Reopen any stored bridge connections after a restart (SV sockets; no-op without any).
  try { bridge.resume(); } catch (err) { logger.error('bridge resume failed', err); }
});
