'use strict';

// Stage 7, web push plumbing with a generated VAPID pair and a fake push service
// (fixtures/mock-push.js): the Notificări page explains and shows the state; a subscription
// registered through the API (headless Chromium has no push service) gets the test push,
// which decrypts with the browser-side keys; unsubscribe removes the row; an expired endpoint
// (410) is cleaned up. RO 375 / EN 1024.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FIXTURES, layoutAudit } = require('./harness');
const P = require('../../lib/push');

const keys = P.generateVapidKeys();

module.exports = {
  name: 'push',
  timeout: 180000,
  app: { preload: [path.join(FIXTURES, 'mock-push.js')], env: { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:test@x.ro' } },
  async run({ app, browser, signIn, check }) {
    app.browser = browser;
    const outbox = () => { const f = path.join(app.dataDir, 'push-outbox.jsonl'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; };
    const member = app.cookies.member;
    check((await app.api(member, 'GET', '/api/push/config')).body.enabled === true, 'config: push enabled with the VAPID pair');
    // a browser-side subscription (keys as a browser would make them)
    const client = crypto.createECDH('prime256v1');
    client.generateKeys();
    const auth = crypto.randomBytes(16).toString('base64url');
    const sub = (endpoint) => ({ endpoint, keys: { p256dh: client.getPublicKey().toString('base64url'), auth } });
    const created = await app.api(member, 'POST', '/api/push/subscriptions', { subscription: sub('https://push.test/send/member-1') });
    check(created.status === 201 && created.body.subscriptions.length === 1, 'a subscription is saved');
    check((await app.api(member, 'POST', '/api/push/subscriptions', { subscription: { endpoint: 'https://push.test/x', keys: { p256dh: 'bad', auth } } })).status === 400, 'a bad subscription is refused (400)');
    // the test push: delivered to the fake service, small payload, decrypts with the browser keys
    const test = await app.api(member, 'POST', '/api/push/test');
    check(test.body.sent === 1, 'POST /api/push/test: one delivery', test.body);
    const mail = outbox().slice(-1)[0];
    const payload = JSON.parse(P.decrypt(Buffer.from(mail.body, 'base64'), client.getPrivateKey(), auth));
    check(mail.headers['Content-Encoding'] === 'aes128gcm' && /^vapid t=.+, k=/.test(mail.headers.Authorization) && payload.title === 'Notificare de test' && payload.url === '/notifications' && JSON.stringify(payload).length < 300, 'the push: VAPID header, aes128gcm, a small { title, body, url, tag }', payload);
    // an expired endpoint: the service answers 410 -> the row goes
    await app.api(member, 'POST', '/api/push/subscriptions', { subscription: sub('https://push.test/send/gone') });
    const again = await app.api(member, 'POST', '/api/push/test');
    check(again.body.sent === 1 && again.body.removed === 1 && again.body.subscriptions.length === 1, 'an expired endpoint (410) is deleted, the live one still gets the push', again.body);
    // unsubscribe removes the row
    const del = await app.api(member, 'DELETE', '/api/push/subscriptions', { endpoint: 'https://push.test/send/member-1' });
    check(del.body.removed === true && del.body.subscriptions.length === 0, 'DELETE removes the row');

    // the page
    for (const [lang, width] of [['ro', 375], ['en', 1024]]) {
      const tag = `[${lang} ${width}]`;
      const p = await signIn('member', { width, lang });
      await p.context().grantPermissions(['notifications']);
      await p.goto(`${app.url}/notifications`);
      await p.waitForFunction(() => /\S/.test(document.getElementById('push-state').textContent));
      const state = await p.evaluate(() => ({ text: document.getElementById('push-state').textContent, state: document.getElementById('push-state').dataset.state, on: !document.getElementById('push-on').hidden, ios: !document.getElementById('push-ios').hidden, intro: document.querySelector('#push-card .hint').textContent.length > 80 }));
      // Headless Chromium reports the permission as denied (no push service): the page says so
      // and hides the switch; a browser that allows it shows "not on" with the enable button.
      check((state.state === 'off' && state.on) || (state.state === 'denied' && !state.on && /(blocat|blocked)/.test(state.text)), `${tag} Notificări: a clear explanation and the state of this device (${state.state})`, state);
      check(state.intro && !state.ios, `${tag} the intro text, no iPhone hint on a desktop browser`);
      const a = await layoutAudit(p, '#push-card');
      check(!a.overflow && !a.small.length, `${tag} push card: no overflow, targets >= 44 px`, a);
      if (state.on) {
        await p.click('#push-on');
        await p.waitForFunction(() => /\S/.test(document.getElementById('push-message').textContent), null, { timeout: 15000 }).catch(() => {});
        const after = await p.evaluate(() => ({ message: document.getElementById('push-message').textContent, state: document.getElementById('push-state').dataset.state }));
        check(after.state === 'on' ? /activate|on for this device/i.test(after.message) : /(nu a reușit|failed|refuzat|refused)/i.test(after.message), `${tag} the switch reports its outcome (${after.state})`, after);
      }
      await p.context().close();
    }
    // iPhone in the browser (not installed): the "install first" hint
    const ios = await (await app.browser.newContext({ viewport: { width: 375, height: 667 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', isMobile: true, hasTouch: true })).newPage();
    await ios.goto(`${app.url}/login`);
    await ios.fill('[name=email]', 'm@x.ro');
    await ios.fill('[name=password]', 'parola-lunga-1');
    await ios.click('button[type=submit]');
    await ios.waitForURL('**/app');
    await ios.goto(`${app.url}/notifications`);
    await ios.waitForFunction(() => /\S/.test(document.getElementById('push-state').textContent));
    check(!(await ios.isHidden('#push-ios')) && await ios.isHidden('#push-on'), 'iPhone in Safari (not installed): the "install first" hint, no switch');
    await ios.context().close();
  },
};
