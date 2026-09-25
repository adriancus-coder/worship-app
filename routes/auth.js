'use strict';

const express = require('express');
const { DUMMY_HASH, verifyPassword } = require('../lib/auth');
const { createFailureLimiter } = require('../lib/rate-limit');

const INVALID_LOGIN = 'Email sau parolă incorecte.';

function createAuthRouter({ db, auth, logger }) {
  const router = express.Router();
  const limiter = createFailureLimiter({ maxFailures: 5, windowMs: 15 * 60 * 1000 });

  const findUser = db.prepare(`SELECT u.id, u.admin_id, u.name, u.email, u.role, u.password_hash,
      a.name AS admin_name
    FROM users u JOIN admins a ON a.id = u.admin_id
    WHERE u.email = ? AND u.active = 1`);

  router.post('/api/auth/login', async (req, res) => {
    const ip = req.ip;
    const retryAfter = limiter.retryAfterSeconds(ip);
    if (retryAfter > 0) {
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Prea multe încercări eșuate. Încearcă din nou mai târziu.' });
    }

    const body = req.body || {};
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const remember = body.remember === true;

    const user = email ? findUser.get(email) : undefined;
    const valid = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !valid) {
      limiter.recordFailure(ip);
      logger.info(`Failed login from ${ip}`);
      return res.status(401).json({ error: INVALID_LOGIN });
    }

    limiter.reset(ip);
    const previous = auth.getSessionId(req);
    if (previous) auth.deleteSession(previous);

    const session = auth.createSession(user, remember);
    auth.setSessionCookie(res, session.id, session.maxAgeMs);
    logger.info(`User #${user.id} logged in (admin #${user.admin_id})`);
    res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      admin: { id: user.admin_id, name: user.admin_name },
    });
  });

  router.post('/api/auth/logout', (req, res) => {
    const sessionId = auth.getSessionId(req);
    if (sessionId) auth.deleteSession(sessionId);
    auth.clearSessionCookie(res);
    res.json({ ok: true });
  });

  router.get('/api/auth/me', auth.requireUser, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ user: req.user, admin: req.admin });
  });

  return router;
}

module.exports = createAuthRouter;
