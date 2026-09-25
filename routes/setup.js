'use strict';

const path = require('path');
const express = require('express');
const asyncRoute = require('../lib/async-route');
const { safeEqual, hashPassword } = require('../lib/auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 10;
const MAX_NAME_LENGTH = 100;

class SetupConflict extends Error {}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validate(body) {
  const adminName = cleanText(body.adminName);
  const ownerName = cleanText(body.ownerName);
  const ownerEmail = cleanText(body.ownerEmail).toLowerCase();
  const ownerPassword = typeof body.ownerPassword === 'string' ? body.ownerPassword : '';

  if (!adminName || adminName.length > MAX_NAME_LENGTH) {
    return { error: 'Numele bisericii / echipei este obligatoriu (max. 100 de caractere).' };
  }
  if (!ownerName || ownerName.length > MAX_NAME_LENGTH) {
    return { error: 'Numele tău este obligatoriu (max. 100 de caractere).' };
  }
  if (ownerEmail.length > 254 || !EMAIL_RE.test(ownerEmail)) {
    return { error: 'Adresa de email nu este validă.' };
  }
  if (ownerPassword.length < MIN_PASSWORD_LENGTH) {
    return { error: `Parola trebuie să aibă cel puțin ${MIN_PASSWORD_LENGTH} caractere.` };
  }
  return { value: { adminName, ownerName, ownerEmail, ownerPassword } };
}

function createSetupRouter({ db, config, logger }) {
  const router = express.Router();

  const countAdmins = db.prepare('SELECT COUNT(*) FROM admins').pluck();
  const insertAdmin = db.prepare('INSERT INTO admins (name, created_at) VALUES (?, ?)');
  const insertUser = db.prepare(`INSERT INTO users
    (admin_id, email, name, password_hash, role, active, created_at)
    VALUES (?, ?, ?, ?, 'owner', 1, ?)`);

  const createAdminAndOwner = db.transaction((input, passwordHash) => {
    if (countAdmins.get() > 0) throw new SetupConflict();
    const now = Date.now();
    const adminId = Number(insertAdmin.run(input.adminName, now).lastInsertRowid);
    const userId = Number(insertUser.run(adminId, input.ownerEmail, input.ownerName, passwordHash, now).lastInsertRowid);
    return { adminId, userId };
  });

  if (!config.SETUP_TOKEN && countAdmins.get() === 0) {
    logger.warn('No admin account exists and SETUP_TOKEN is not set: set SETUP_TOKEN to enable first-run setup at /setup');
  }

  router.get('/setup', (req, res) => {
    if (countAdmins.get() > 0) return res.redirect('/');
    res.sendFile(path.join(__dirname, '..', 'public', 'setup.html'));
  });

  router.post('/api/setup', asyncRoute(async (req, res) => {
    const body = req.body || {};

    if (!config.SETUP_TOKEN) {
      logger.warn('Setup attempt rejected: SETUP_TOKEN is not set, first-run setup is disabled');
      return res.status(403).json({ error: 'Configurarea inițială este dezactivată.' });
    }
    if (typeof body.setupToken !== 'string' || !safeEqual(body.setupToken, config.SETUP_TOKEN)) {
      logger.warn(`Setup attempt rejected: invalid setup token from ${req.ip}`);
      return res.status(403).json({ error: 'Cod de configurare invalid.' });
    }
    if (countAdmins.get() > 0) {
      return res.status(409).json({ error: 'Aplicația este deja configurată.' });
    }

    const { error, value } = validate(body);
    if (error) return res.status(400).json({ error });

    const passwordHash = await hashPassword(value.ownerPassword);
    try {
      const { adminId, userId } = createAdminAndOwner(value, passwordHash);
      logger.info(`First-run setup complete: admin #${adminId}, owner user #${userId}`);
      return res.json({ ok: true });
    } catch (err) {
      if (err instanceof SetupConflict) {
        return res.status(409).json({ error: 'Aplicația este deja configurată.' });
      }
      throw err;
    }
  }));

  return router;
}

module.exports = createSetupRouter;
