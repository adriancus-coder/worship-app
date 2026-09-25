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
const createHealthRouter = require('./routes/health');
const createSetupRouter = require('./routes/setup');

const db = openDb(config.DATA_DIR);
const applied = runMigrations(db);
if (applied.length > 0) {
  logger.info(`Applied migrations: ${applied.join(', ')}`);
} else {
  logger.info('Database schema up to date');
}
logger.info(`Database: ${config.DATA_DIR}/worship.db`);

const app = express();
app.disable('x-powered-by');
if (config.IS_PRODUCTION) app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: { upgradeInsecureRequests: config.IS_PRODUCTION ? [] : null },
  },
  strictTransportSecurity: config.IS_PRODUCTION,
}));
app.use(compression());
app.use(express.json({ limit: '100kb' }));

// Pages are served only through their routes, never as raw .html files.
app.use((req, res, next) => (req.path.endsWith('.html') ? res.status(404).end() : next()));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.use(createHealthRouter({ config }));
app.use(createSetupRouter({ db, config, logger }));

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(err.status || 400).json({ error: 'Cerere invalidă.' });
  }
  logger.error('Unhandled error on', req.method, req.path, err);
  res.status(500).json({ error: 'Eroare internă.' });
});

const server = http.createServer(app);
const io = new SocketServer(server);

io.on('connection', (socket) => {
  logger.debug('socket connected', socket.id);
});

server.listen(config.PORT, () => {
  logger.info(`${config.APP_NAME} v${config.VERSION} listening on port ${config.PORT} (${config.NODE_ENV})`);
});
