'use strict';

const path = require('path');

require('dotenv').config({ quiet: true });

const pkg = require('../package.json');

const NODE_ENV = process.env.NODE_ENV || 'development';
const port = Number.parseInt(process.env.PORT, 10);
const MB = 1024 * 1024;
const positiveNumber = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback);

const config = Object.freeze({
  APP_NAME: process.env.APP_NAME || 'Worship App',
  VERSION: pkg.version,
  PORT: Number.isInteger(port) && port > 0 ? port : 3000,
  DATA_DIR: path.resolve(process.env.DATA_DIR || './data'),
  NODE_ENV,
  IS_PRODUCTION: NODE_ENV === 'production',
  SETUP_TOKEN: process.env.SETUP_TOKEN || '',
  PUBLIC_BASE_URL: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '') || null,
  // Video uploads (media library): per file and per admin (church).
  MEDIA_MAX_FILE_BYTES: Math.round(positiveNumber(process.env.MEDIA_MAX_FILE_MB, 150) * MB),
  MEDIA_MAX_ADMIN_BYTES: Math.round(positiveNumber(process.env.MEDIA_MAX_ADMIN_MB, 800) * MB),
  // Backgrounds: images (JPEG / PNG / WebP) and silent loops (MP4 / WebM).
  MEDIA_MAX_IMAGE_BYTES: Math.round(positiveNumber(process.env.MEDIA_MAX_IMAGE_MB, 8) * MB),
  MEDIA_MAX_LOOP_BYTES: Math.round(positiveNumber(process.env.MEDIA_MAX_LOOP_MB, 50) * MB),
});

module.exports = config;
