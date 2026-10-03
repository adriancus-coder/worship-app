'use strict';

// Stage 7, "Trimite programarea" with push (fake service) and email (fake Resend): the leader
// assigns two members, one has a push subscription; the button tells everyone once: a
// notification row for both, a push for one, an email (same text + event link) for the other;
// the summary reads "Trimis la 2 persoane · 1 fără notificări (nu au activat) · 1 pe email";
// re-sending reaches only new rows. RO 1024.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FIXTURES, wait } = require('./harness');
const P = require('../../lib/push');

const keys = P.generateVapidKeys();

module.exports = {
  name: 'schedule-send',
  timeout: 180000,
  app: {
    preload: [path.join(FIXTURES, 'mock-push.js'), path.join(FIXTURES, 'mock-resend.js')],
    env: { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:test@x.ro', RESEND_API_KEY: 're_test_key', EMAIL_FROM: 'Worship <w@test.ro>' },
  },
  async run({ app, signIn, check }) {
    const lines = (file) => { const f = path.join(app.dataDir, file); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; };
    const owner = app.cookies.owner;
    const E2 = app.seed.event2Id;
    const positions = (await app.api(owner, 'GET', '/api/positions')).body.positions;
    const users = (await app.api(owner, 'GET', '/api/team')).body.users;
    const uid = (email) => users.find((u) => u.email === email).id;
    // the member has push; the operator has not (gets an email)
    const client = crypto.createECDH('prime256v1');
    client.generateKeys();
    const auth = crypto.randomBytes(16).toString('base64url');
    await app.api(app.cookies.member, 'POST', '/api/push/subscriptions', { subscription: { endpoint: 'https://push.test/send/m', keys: { p256dh: client.getPublicKey().toString('base64url'), auth } } });

    const l = await signIn('leader', { width: 1024, lang: 'ro' });
    await l.goto(`${app.url}/events/${E2}/edit`);
    await l.waitForSelector('#editor-tabs:not([hidden])');
    await l.click('#tab-team');
    await l.waitForSelector('#team-panel .team-position');
    const pick = async (position, name) => {
      const group = l.locator(`.team-position:has(h3:text-matches("(^| )${position}$"))`);
      const value = await group.locator(`option:has-text("${name}")`).first().getAttribute('value');
      await group.locator('select').selectOption(value);
      await group.locator(`.assign-row:has-text("${name}")`).waitFor();
    };
    await pick('Chitară', 'Membru');
    await pick('Operator', 'Operator');
    await l.click('#send-schedule');
    await l.waitForFunction(() => /Trimis la/.test(document.querySelector('#team-panel .assign-message').textContent));
    const message = await l.textContent('#team-panel .assign-message');
    check(/Trimis la 2 persoane · 1 fără notificări \(nu au activat\) · 1 pe email/.test(message), `the summary: "${message}"`);
    await wait(200);
    const pushes = lines('push-outbox.jsonl');
    const mails = lines('outbox.jsonl');
    const payload = pushes.length ? JSON.parse(P.decrypt(Buffer.from(pushes[0].body, 'base64'), client.getPrivateKey(), auth)) : null;
    check(pushes.length === 1 && payload && /Ești programat: Chitară/.test(payload.title) && payload.url === `/events/${E2}`, 'the member got one push with the assignment', payload);
    check(mails.length === 1 && mails[0].to === 'op@x.ro' && /Ești programat: Seara/.test(mails[0].subject) && /Operator/.test(mails[0].text) && mails[0].text.includes(`${app.url}/events/${E2}`) && /Lider/.test(mails[0].text), 'the operator (no push) got an email with the same text and the event link', mails[0] && { to: mails[0].to, subject: mails[0].subject });
    for (const [cookie, who] of [[app.cookies.member, 'member'], [app.cookies.operator, 'operator']]) {
      const n = (await app.api(cookie, 'GET', '/api/notifications')).body.notifications.find((x) => x.kind === 'assigned' && x.eventId === E2);
      check(Boolean(n), `${who}: an "assigned" notification row`);
    }
    check(await l.isDisabled('#send-schedule'), 'nothing left to send: the button rests');
    // a third person: only they are reached
    await pick('Voce', 'Prezentator');
    await l.waitForFunction(() => !document.getElementById('send-schedule').disabled);
    await l.click('#send-schedule');
    await l.waitForFunction(() => /Trimis la 1/.test(document.querySelector('#team-panel .assign-message').textContent));
    await wait(200);
    check(lines('push-outbox.jsonl').length === 1 && lines('outbox.jsonl').length === 2 && lines('outbox.jsonl')[1].to === 'prez@x.ro', 're-sending reaches only the new row (one more email, no new push)');
    check((await app.api(app.cookies.member, 'GET', '/api/notifications')).body.notifications.filter((x) => x.kind === 'assigned' && x.eventId === E2).length === 1, 'the member was not told twice');
  },
};
