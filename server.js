'use strict';

const http = require('http');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const { Server: SocketServer } = require('socket.io');

const config = require('./lib/config');
const logger = require('./lib/logger');
const createHealthRouter = require('./routes/health');

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

app.use(createHealthRouter({ config }));

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
