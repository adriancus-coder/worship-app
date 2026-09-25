'use strict';

const path = require('path');

require('dotenv').config({ quiet: true });

const pkg = require('../package.json');

const NODE_ENV = process.env.NODE_ENV || 'development';
const port = Number.parseInt(process.env.PORT, 10);

const config = Object.freeze({
  APP_NAME: process.env.APP_NAME || 'Worship App',
  VERSION: pkg.version,
  PORT: Number.isInteger(port) && port > 0 ? port : 3000,
  DATA_DIR: path.resolve(process.env.DATA_DIR || './data'),
  NODE_ENV,
  IS_PRODUCTION: NODE_ENV === 'production',
  SETUP_TOKEN: process.env.SETUP_TOKEN || '',
  PUBLIC_BASE_URL: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '') || null,
});

module.exports = config;
