'use strict';

const express = require('express');
const crypto = require('crypto');
const asyncRoute = require('../lib/async-route');
const { hashPassword } = require('../lib/auth');
const { validateName } = require('../lib/team');
const { createFailureLimiter } = require('../lib/rate-limit');
const { isLang, setLangCookie } = require('../lib/i18n');
const { createAdminSettings } = require('../lib/admin-settings');
const { setThemeCookie } = require('../lib/theme');
const passkeys = require('../lib/passkeys');

// Passkeys (lib/passkeys.js): "Intră cu Face ID / amprentă".
//   POST /api/auth/passkey/register/options, POST /api/auth/passkey/register   (signed in; a
//        temporary password too: the passkey replaces changing it)
//   GET  /api/me/passkeys, DELETE /api/me/passkeys/:id                         (signed in)
//   POST /api/auth/passkey/login/options, POST /api/auth/passkey/login         (signed out)
//   POST /api/invite/:token/passkey/options, POST /api/invite/:token/passkey   (the invitation
//        without a password: the name, then the passkey; the token is spent only on success and
//        the temporary password is replaced by a random one nobody knows)
// The site (rpId / origin) comes from PUBLIC_BASE_URL, else from the request's host.
function createPasskeysRouter({ db, auth, config, logger, live, invites }) {
  const router = express.Router();
  const store = passkeys.createPasskeyStore(db);
  const challenges = passkeys.createChallenges();
  const limiter = createFailureLimiter({ maxFailures: 10, windowMs: 15 * 60 * 1000 });
  const settings = createAdminSettings(db);
  const { tokens } = invites;
  const clearPending = db.prepare('UPDATE users SET must_change_password = 0 WHERE id = ? AND admin_id = ?');
  const setPassword = db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ? AND admin_id = ?');
  const setName = db.prepare('UPDATE users SET name = ? WHERE id = ? AND admin_id = ?');
  const touchLogin = db.prepare('UPDATE users SET last_login_at = ? WHERE id = ? AND admin_id = ?');
  const updateLocale = db.prepare('UPDATE users SET locale = ? WHERE id = ? AND admin_id = ?');
  const userSessions = db.prepare('SELECT id FROM sessions WHERE user_id = ? AND admin_id = ?').pluck();
  const deleteSession = db.prepare('DELETE FROM sessions WHERE id = ?');
  const selectUser = db.prepare('SELECT id, admin_id, name, email FROM users WHERE id = ? AND admin_id = ?');

  const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };

  // The relying party: the host people use (PUBLIC_BASE_URL in production).
  function site(req) {
    const base = new URL(config.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`);
    return { rpId: base.hostname, origin: base.origin, rpName: config.APP_NAME };
  }

  const fail = (res, status, code, req) => res.status(status).json({ code, error: req.t(`errors.${code}`) });
  const credentialOf = (body) => {
    const c = body && typeof body === 'object' ? body : {};
    const r = c.response && typeof c.response === 'object' ? c.response : {};
    return { id: typeof c.id === 'string' ? c.id : '', response: r, transports: Array.isArray(r.transports) ? r.transports.filter((x) => typeof x === 'string') : [] };
  };
  const nameOf = (body) => (typeof (body || {}).name === 'string' ? body.name.trim().slice(0, 60) : '');

  function registerFor(req, res, user, kind, extra = {}) {
    const { rpId, rpName } = site(req);
    const challenge = challenges.issue({ kind, userId: user.id, adminId: user.admin_id, ...extra });
    res.json({ publicKey: passkeys.registrationOptions({
      rpId, rpName, challenge,
      user: { id: user.id, name: user.email, displayName: user.name },
      excludeIds: store.listForUser(user.admin_id, user.id).map((p) => p.credentialId),
    }) });
  }

  function verifyAndAdd(req, res, entry, cred, name) {
    const { rpId, origin } = site(req);
    try {
      const verified = passkeys.verifyRegistration({
        clientDataJSON: cred.response.clientDataJSON, attestationObject: cred.response.attestationObject,
        expectedChallenge: entry.challenge, expectedOrigins: [origin], rpId,
      });
      if (store.findByCredentialId(verified.credentialId)) { fail(res, 409, 'passkeyExists', req); return null; }
      store.add(entry.adminId, entry.userId, { ...verified, transports: cred.transports, name });
      return verified;
    } catch (err) {
      if (!(err instanceof passkeys.PasskeyError)) throw err;
      logger.info(`Passkey registration failed for user #${entry.userId}: ${err.code}`);
      fail(res, 400, 'passkeyInvalid', req);
      return null;
    }
  }

  // --- signed in: add a passkey for this device, list them, remove one ---------------------
  router.post('/api/auth/passkey/register/options', noStore, auth.requireUser, (req, res) => {
    registerFor(req, res, { id: req.user.id, admin_id: req.adminId, email: req.user.email, name: req.user.name }, 'register');
  });

  router.post('/api/auth/passkey/register', noStore, auth.requireUser, (req, res) => {
    const cred = credentialOf(req.body && req.body.credential);
    const entry = challenges.take(req.body && req.body.challenge);
    if (!entry || entry.kind !== 'register' || entry.userId !== req.user.id || entry.adminId !== req.adminId) return fail(res, 400, 'passkeyChallenge', req);
    const verified = verifyAndAdd(req, res, { ...entry, challenge: req.body.challenge }, cred, nameOf(req.body));
    if (!verified) return;
    // A temporary password no longer has to be changed: the passkey is the way in.
    if (req.user.mustChangePassword) clearPending.run(req.user.id, req.adminId);
    logger.info(`User #${req.user.id} added a passkey (admin #${req.adminId})`);
    res.status(201).json({ passkeys: store.listForUser(req.adminId, req.user.id) });
  });

  router.get('/api/me/passkeys', noStore, auth.requireUser, (req, res) => {
    res.json({ passkeys: store.listForUser(req.adminId, req.user.id) });
  });

  router.delete('/api/me/passkeys/:id', noStore, auth.requireUser, (req, res) => {
    const id = /^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : null;
    if (!id || !store.remove(req.adminId, req.user.id, id)) return res.status(404).json({ error: req.t('errors.notFound') });
    logger.info(`User #${req.user.id} removed a passkey (admin #${req.adminId})`);
    res.json({ passkeys: store.listForUser(req.adminId, req.user.id) });
  });

  // --- signed out: the login page ---------------------------------------------------------
  router.post('/api/auth/passkey/login/options', noStore, (req, res) => {
    const retryAfter = limiter.retryAfterSeconds(req.ip);
    if (retryAfter > 0) { res.set('Retry-After', String(retryAfter)); return res.status(429).json({ error: req.t('errors.tooManyAttempts') }); }
    const { rpId } = site(req);
    const challenge = challenges.issue({ kind: 'login' });
    res.json({ publicKey: passkeys.authenticationOptions({ rpId, challenge }) });
  });

  function signIn(req, res, user, { remember }) {
    const previous = auth.getSessionId(req);
    if (previous) { auth.deleteSession(previous); live.closeSession(previous); }
    const session = auth.createSession({ id: user.id, admin_id: user.admin_id }, remember);
    auth.setSessionCookie(res, session.id, session.maxAgeMs);
    touchLogin.run(Date.now(), user.id, user.admin_id);
    let locale = user.locale;
    if (!isLang(locale)) { locale = req.lang; updateLocale.run(locale, user.id, user.admin_id); }
    setLangCookie(res, locale, config);
    setThemeCookie(res, user.theme || settings.themeDefault(user.admin_id), config);
    return locale;
  }

  router.post('/api/auth/passkey/login', noStore, (req, res) => {
    const ip = req.ip;
    const retryAfter = limiter.retryAfterSeconds(ip);
    if (retryAfter > 0) { res.set('Retry-After', String(retryAfter)); return res.status(429).json({ error: req.t('errors.tooManyAttempts') }); }
    const cred = credentialOf(req.body && req.body.credential);
    const entry = challenges.take(req.body && req.body.challenge);
    if (!entry || entry.kind !== 'login') return fail(res, 400, 'passkeyChallenge', req);
    const known = cred.id ? store.findByCredentialId(cred.id) : null;
    if (!known) { limiter.recordFailure(ip); logger.info(`Passkey login with an unknown key from ${ip}`); return fail(res, 401, 'passkeyUnknown', req); }
    const { rpId, origin } = site(req);
    let result;
    try {
      result = passkeys.verifyAuthentication({
        clientDataJSON: cred.response.clientDataJSON, authenticatorData: cred.response.authenticatorData, signature: cred.response.signature,
        expectedChallenge: req.body.challenge, expectedOrigins: [origin], rpId, publicKeyJwk: known.publicKeyJwk, alg: known.alg, counter: known.counter,
      });
    } catch (err) {
      if (!(err instanceof passkeys.PasskeyError)) throw err;
      limiter.recordFailure(ip);
      logger.info(`Passkey login failed for user #${known.user_id}: ${err.code}`);
      return fail(res, 401, 'passkeyInvalid', req);
    }
    limiter.reset(ip);
    store.used(known.id, result.counter);
    // Signing in with a passkey means staying signed in on this device (as "Ține-mă minte").
    const locale = signIn(req, res, { id: known.user_id, admin_id: known.admin_id, locale: known.locale, theme: known.theme }, { remember: req.body.remember !== false });
    logger.info(`User #${known.user_id} logged in with a passkey (admin #${known.admin_id})`);
    res.json({ user: { id: known.user_id, name: known.name, email: known.email, role: known.role, locale }, admin: { id: known.admin_id, name: known.admin_name } });
  });

  // --- the invitation without a password ---------------------------------------------------
  const lookupInvite = (req, res) => {
    const found = tokens.find('invite', req.params.token);
    if (!found) { res.status(404).json({ code: 'tokenInvalid', error: req.t('errors.tokenInvalid') }); return null; }
    if (found.state !== 'valid') { res.status(410).json({ code: found.state === 'used' ? 'tokenUsed' : 'tokenExpired', error: req.t(found.state === 'used' ? 'errors.tokenUsed' : 'errors.tokenExpired') }); return null; }
    return found;
  };

  router.post('/api/invite/:token/passkey/options', noStore, (req, res) => {
    const found = lookupInvite(req, res);
    if (!found) return;
    registerFor(req, res, { id: found.user_id, admin_id: found.admin_id, email: found.email, name: found.name }, 'invite', { token: req.params.token });
  });

  router.post('/api/invite/:token/passkey', noStore, asyncRoute(async (req, res) => {
    const found = lookupInvite(req, res);
    if (!found) return;
    const name = validateName((req.body || {}).name, req.t);
    if (name.error) return res.status(400).json({ error: name.error });
    const entry = challenges.take(req.body && req.body.challenge);
    if (!entry || entry.kind !== 'invite' || entry.userId !== found.user_id || entry.token !== req.params.token) return fail(res, 400, 'passkeyChallenge', req);
    const verified = verifyAndAdd(req, res, { ...entry, challenge: req.body.challenge }, credentialOf(req.body && req.body.credential), nameOf(req.body));
    if (!verified) return;
    const row = tokens.consume('invite', req.params.token);
    if (!row) return lookupInvite(req, res) && res.status(410).json({ code: 'tokenUsed', error: req.t('errors.tokenUsed') });
    setName.run(name.value, row.user_id, row.admin_id);
    // the temporary password the owner saw is replaced by one nobody knows: the passkey is the way in
    setPassword.run(await hashPassword(crypto.randomBytes(24).toString('base64url')), row.user_id, row.admin_id);
    for (const id of userSessions.all(row.user_id, row.admin_id)) { deleteSession.run(id); live.closeSession(id); }
    const user = selectUser.get(row.user_id, row.admin_id);
    const locale = signIn(req, res, { id: row.user_id, admin_id: row.admin_id, locale: row.locale, theme: null }, { remember: true });
    logger.info(`User #${row.user_id} accepted the invitation with a passkey (admin #${row.admin_id})`);
    res.json({ ok: true, user: { id: user.id, name: user.name, email: user.email, locale } });
  }));

  return router;
}

module.exports = { createPasskeysRouter };
