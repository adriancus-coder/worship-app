'use strict';

// Passkeys (lib/passkeys.js, routes/passkeys.js): a Chromium virtual authenticator (CDP WebAuthn)
// stands in for Face ID. The owner adds a passkey from "Profilul meu", signs out and comes back
// with "Intră cu Face ID sau amprentă"; a person with a temporary password takes the passkey
// instead of a new password; an invitation is accepted with a passkey and no password (the
// temporary one stops working); a key that is removed no longer signs in. The pages run on
// localhost (WebAuthn needs a domain, not an IP).

const path = require('path');
const { FIXTURES, PASSWORD, USERS, layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'passkeys',
  timeout: 180000,
  app: { preload: [path.join(FIXTURES, 'mock-resend.js')], env: { RESEND_API_KEY: 're_test_key', EMAIL_FROM: 'Worship <w@test.ro>' } },
  async run({ app, browser, check }) {
    const base = app.url.replace('127.0.0.1', 'localhost');
    async function device(width = 390) {
      const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 820 }, hasTouch: width < 600, isMobile: width < 600 });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('WebAuthn.enable');
      const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
      page.cdp = cdp;
      page.authenticatorId = authenticatorId;
      return page;
    }
    const credentials = (p) => p.cdp.send('WebAuthn.getCredentials', { authenticatorId: p.authenticatorId }).then((r) => r.credentials);
    const me = async (p) => { const r = await p.request.get(`${base}/api/auth/me`); return r.ok() ? r.json() : null; };
    const logout = (p) => p.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }).then(() => true)); // in the page: the cookie goes
    // The login page offers the passkey in the email field (conditional mediation): the virtual
    // authenticator answers it at once, so the page signs in by itself. To exercise the button,
    // presence is withheld until it is pressed.
    const presence = (p, on) => p.cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId: p.authenticatorId, enabled: on });
    async function loginWithButton(p) {
      await presence(p, false);
      await p.goto(`${base}/login`);
      await p.waitForSelector('#passkey-row:not([hidden])');
      await p.click('#passkey-button');
      await presence(p, true);
      await p.waitForURL('**/app', { timeout: 10000 });
    }

    // --- the owner's phone: add the passkey from the profile, sign out, sign in with it -------
    const p = await device();
    await p.goto(`${base}/login`);
    await p.waitForSelector('#passkey-row:not([hidden])');
    check(await p.isVisible('#passkey-button') && (await p.getAttribute('[name=email]', 'autocomplete')) === 'username webauthn', 'the login page: "Intră cu Face ID sau amprentă" above the form, the email field offers passkeys');
    await p.fill('[name=email]', USERS.owner);
    await p.fill('[name=password]', PASSWORD);
    await p.click('#login-form button[type=submit]');
    await p.waitForURL('**/app');
    await p.goto(`${base}/profile`);
    await p.waitForSelector('#passkeys:not([hidden])');
    check(await p.isVisible('#passkey-add') && !(await p.isHidden('#passkey-empty')), 'the profile: "Face ID / amprentă" with "Adaugă pe acest dispozitiv", no device yet');
    await p.click('#passkey-add');
    await p.waitForSelector('#passkey-list .passkey-item');
    const item = await p.textContent('#passkey-list .passkey-item');
    check(/adăugat/.test(item) && (await credentials(p)).length === 1 && /de acum intri cu Face ID/.test(await p.textContent('#passkey-message')), 'added: the device is listed, the authenticator holds one key', item);
    const list = (await app.api(app.cookies.owner, 'GET', '/api/me/passkeys')).body.passkeys;
    check(list.length === 1 && list[0].name === 'other' && list[0].lastUsedAt === null, 'GET /api/me/passkeys: one key, not used yet', list);
    const a = await layoutAudit(p, '#passkeys');
    check(!a.overflow && !a.small.length, 'the profile section 390: no overflow, targets >= 44 px', a);
    await logout(p);
    await loginWithButton(p);
    const who = await me(p);
    check(who && who.user.email === USERS.owner, 'the login page: "Intră cu Face ID" signs the owner in without a password');
    await logout(p);
    await p.goto(`${base}/login`).catch(() => null); // the page leaves for /app on its own (ERR_ABORTED)
    await p.waitForURL('**/app', { timeout: 10000 });
    await p.waitForLoadState('load').catch(() => null);
    let auto = null;
    for (let i = 0; i < 20 && !auto; i += 1) { auto = await me(p); if (!auto) await wait(100); }
    check(auto && auto.user.email === USERS.owner, 'the passkey offered in the email field (autofill) signs in as soon as it is picked');
    const used = (await app.api(app.cookies.owner, 'GET', '/api/me/passkeys')).body.passkeys[0];
    check(used.lastUsedAt > 0, 'the key records its last use');
    await p.goto(`${base}/profile`);
    await p.waitForSelector('#passkey-list .passkey-item');
    check(/folosit/.test(await p.textContent('#passkey-list .passkey-item')), 'the profile shows "folosit …"');

    // --- a temporary password: the passkey instead of a new password ------------------------
    const made = await app.api(app.cookies.owner, 'POST', '/api/team', { name: 'Vali Temp', email: 'vali@x.ro', role: 'member' });
    check(made.status === 201 && made.body.temporaryPassword, 'a person with a temporary password');
    const v = await device(390);
    await v.goto(`${base}/login`);
    await v.fill('[name=email]', 'vali@x.ro');
    await v.fill('[name=password]', made.body.temporaryPassword);
    await v.click('#login-form button[type=submit]');
    await v.waitForURL('**/change-password');
    await v.waitForSelector('#passkey-pending:not([hidden])');
    await v.click('#passkey-pending-button');
    await v.waitForURL('**/app', { timeout: 10000 });
    const vali = await me(v);
    check(vali && vali.user.email === 'vali@x.ro' && !vali.user.mustChangePassword, 'the temporary password page: "Sau intră de acum cu Face ID" adds the key and lets the person in');
    await logout(v);
    await loginWithButton(v);
    check((await me(v)).user.email === 'vali@x.ro', 'Vali signs in again with the passkey');

    // --- the invitation without a password ---------------------------------------------------
    const invited = await app.api(app.cookies.owner, 'POST', '/api/team', { name: 'Ina Nouă', email: 'ina@x.ro', role: 'member', invite: true });
    const sent = invited.status === 201 ? await app.api(app.cookies.owner, 'POST', `/api/team/${invited.body.user.id}/invite`) : null;
    const fs = require('fs');
    const outbox = fs.readFileSync(path.join(app.dataDir, 'outbox.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const mail = outbox.reverse().find((m) => m.to === 'ina@x.ro');
    const link = mail && (new RegExp(`${app.url}/invite/[0-9a-f]{64}`).exec(mail.text) || [null])[0];
    check(Boolean(link), 'the invitation email has the link', { status: invited.status, sent: sent && sent.status });
    const i = await device(390);
    await i.goto(link.replace('127.0.0.1', 'localhost'));
    await i.waitForSelector('#token-form:not([hidden])');
    check(await i.isVisible('#passkey-submit') && await i.isHidden('#password') && await i.isHidden('#submit'), 'the invitation on a device with Face ID: the name and "Continuă cu Face ID sau amprentă", no password fields');
    await i.click('#use-password');
    check(await i.isVisible('#password') && await i.isHidden('#passkey-submit'), '"Aleg o parolă în loc" shows the password fields');
    await i.reload();
    await i.waitForSelector('#passkey-submit');
    await i.fill('#name', 'Ina');
    await i.click('#passkey-submit');
    await i.waitForURL('**/app', { timeout: 10000 });
    const ina = await me(i);
    check(ina && ina.user.email === 'ina@x.ro' && ina.user.name === 'Ina' && !ina.user.mustChangePassword, 'the invitation accepted with a passkey: signed in, the name saved, nothing to change');
    const tempLogin = await app.api(null, 'POST', '/api/auth/login', { email: 'ina@x.ro', password: invited.body.temporaryPassword });
    check(tempLogin.status === 401, 'the temporary password no longer works (replaced by one nobody knows)');
    const spent = await app.api(null, 'GET', link.replace(`${app.url}/invite/`, '/api/invite/'));
    check(spent.status === 410, 'the invitation link is spent');

    // --- a removed key no longer signs in; an unknown key gets a clear message ---------------
    await p.goto(`${base}/profile`);
    await p.waitForSelector('#passkey-list .passkey-remove');
    await p.click('#passkey-list .passkey-remove');
    check(/Sigur/.test(await p.textContent('#passkey-list .passkey-remove')), 'Șterge asks first');
    await p.click('#passkey-list .passkey-remove');
    await p.waitForSelector('#passkey-empty:not([hidden])');
    check((await app.api(app.cookies.owner, 'GET', '/api/me/passkeys')).body.passkeys.length === 0, 'removed from the server');
    await logout(p);
    await presence(p, false);
    await p.goto(`${base}/login`);
    await p.waitForSelector('#passkey-row:not([hidden])');
    await p.click('#passkey-button');
    await presence(p, true);
    await p.waitForFunction(() => /\S/.test(document.getElementById('passkey-message').textContent), null, { timeout: 10000 });
    check(/nu are o cheie|Intră cu parola/.test(await p.textContent('#passkey-message')) && /\/login/.test(p.url()), 'the authenticator still holds the key, the server does not: a clear message, still on the login page');
    await wait(100);
    for (const page of [p, v, i]) await page.context().close();
  },
};
