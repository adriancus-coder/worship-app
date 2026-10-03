'use strict';

const path = require('path');

require('dotenv').config({ quiet: true });

const pkg = require('../package.json');
const { buildIdentity } = require('./version');

// The git commit this server runs from (Render: RENDER_GIT_COMMIT), see lib/version.js.
const build = buildIdentity({ version: pkg.version });

const NODE_ENV = process.env.NODE_ENV || 'development';
const port = Number.parseInt(process.env.PORT, 10);
const MB = 1024 * 1024;
const positiveNumber = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback);
// 0..90; unset or not a number -> fallback.
const percent = (value, fallback) => (value !== undefined && value !== '' && Number.isFinite(Number(value))
  ? Math.min(90, Math.max(0, Number(value)))
  : fallback);

const config = Object.freeze({
  APP_NAME: process.env.APP_NAME || 'Worship App',
  VERSION: pkg.version,
  COMMIT: build.commit, // full sha or null
  SHORT_COMMIT: build.shortCommit,
  BUILD_LABEL: build.label, // "0.1.0+569a1ad": the base of the PWA cache version
  PORT: Number.isInteger(port) && port > 0 ? port : 3000,
  DATA_DIR: path.resolve(process.env.DATA_DIR || './data'),
  NODE_ENV,
  IS_PRODUCTION: NODE_ENV === 'production',
  SETUP_TOKEN: process.env.SETUP_TOKEN || '',
  PUBLIC_BASE_URL: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '') || null,
  // Video uploads (media library): per file and per admin (church).
  MEDIA_MAX_FILE_BYTES: Math.round(positiveNumber(process.env.MEDIA_MAX_FILE_MB, 150) * MB),
  // 500 MB by default so a 1 GB disk keeps room for the database, backups' temp copy
  // and the free-space margin below.
  MEDIA_MAX_ADMIN_BYTES: Math.round(positiveNumber(process.env.MEDIA_MAX_ADMIN_MB, 500) * MB),
  // Backgrounds: images (JPEG / PNG / WebP) and silent loops (MP4 / WebM).
  MEDIA_MAX_IMAGE_BYTES: Math.round(positiveNumber(process.env.MEDIA_MAX_IMAGE_MB, 8) * MB),
  MEDIA_MAX_LOOP_BYTES: Math.round(positiveNumber(process.env.MEDIA_MAX_LOOP_MB, 50) * MB),
  // Uploads are refused when they would leave less than this share of the disk free
  // (lib/storage.js), whatever the per-admin quota says. 0 turns the check off.
  DISK_MIN_FREE_PCT: percent(process.env.DISK_MIN_FREE_PCT, 15),
  // Lyrics auto-fit (public/lyrics-fit.js): below this share of the maximum size the lines may
  // wrap (balanced rows, never a tail under 3 words). 30..100, 60 by default.
  LYRICS_FIT_MIN_PCT: (() => { const n = Number(process.env.LYRICS_FIT_MIN_PCT); return Number.isFinite(n) && n >= 30 && n <= 100 ? Math.round(n) : 60; })(),
  // The admin that runs the platform (its owner creates churches, /platform). Unset: the one
  // marked platform_owner in the database (the first-run setup's admin). A safety override.
  PLATFORM_ADMIN_ID: /^\d{1,15}$/.test(process.env.PLATFORM_ADMIN_ID || '') ? Number(process.env.PLATFORM_ADMIN_ID) : null,
  // Outgoing email through Resend (lib/email.js). Both required, else email is disabled and
  // the app runs without it. EMAIL_FROM: "Worship App <worship@example.org>" (a verified domain).
  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
  EMAIL_FROM: process.env.EMAIL_FROM || '',
  EMAIL_REPLY_TO: process.env.EMAIL_REPLY_TO || '',
  EMAIL_API_URL: process.env.EMAIL_API_URL || '', // tests point it at a local stand-in
  // Web push (lib/push.js): a VAPID key pair (`npm run vapid`, docs/PUSH.md) and the contact
  // (mailto: or https:). Without the keys push is disabled and the app runs without it.
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY || '',
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || '',
  VAPID_SUBJECT: process.env.VAPID_SUBJECT || '',
  // Pexels backgrounds (lib/pexels.js, docs/BACKGROUNDS.md). Unset: the tab is hidden.
  PEXELS_API_KEY: process.env.PEXELS_API_KEY || '',
  PEXELS_API_URL: process.env.PEXELS_API_URL || '', // tests point it at a local stand-in
  // AI for the Ghiduri (lib/ai.js): drafts a guide from a description + photos, answers a
  // volunteer's question from a guide. Unset: the AI buttons are hidden, nothing else changes.
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  AI_MODEL: process.env.AI_MODEL || 'claude-opus-5-5',
  AI_MONTHLY_CALLS: Math.max(0, Number.parseInt(process.env.AI_MONTHLY_CALLS || '300', 10) || 0), // per church
  AI_API_URL: process.env.AI_API_URL || '', // tests point it at a local stand-in
});

module.exports = config;
