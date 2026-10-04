'use strict';

// The invitation email answers without the app: the leader sends the invitation (fake
// Resend; nobody has push, so everyone gets an email) with "Vin" / "Poate" / "Nu pot"
// buttons; the member's "Poate" link opens /answer/<token>?a=maybe with "Poate" chosen and
// no sign-in; opening the link alone answers nothing; "Trimite răspunsul" saves it (+ a
// note), the leader is told; the answer can change on the page; a made-up token gets a clear
// message. RO 375.

const fs = require('fs');
const path = require('path');
const { FIXTURES, layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'answer-email',
  timeout: 180000,
  app: {
    preload: [path.join(FIXTURES, 'mock-resend.js')],
    env: { RESEND_API_KEY: 're_test_key', EMAIL_FROM: 'Worship <w@test.ro>' },
  },
  async run({ app, check, browser }) {
    const E = app.seed.eventId;
    const sent = await app.api(app.cookies.leader, 'POST', `/api/events/${E}/attendance/send`, {});
    check(sent.status === 200 && sent.body.invited.emailed >= 1, 'the invitation went out by email', sent.body.invited);
    const outbox = path.join(app.dataDir, 'outbox.jsonl');
    const mail = fs.readFileSync(outbox, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((m) => m.to === 'm@x.ro');
    const links = Object.fromEntries([...mail.html.matchAll(/href="([^"]+\/answer\/[0-9a-f]{64}\?a=(accepted|maybe|declined))"/g)].map((x) => [x[2], x[1].replace(/&amp;/g, '&')]));
    check(Object.keys(links).length === 3 && /Vin: http/.test(mail.text) && /Poate: http/.test(mail.text) && />Nu pot</.test(mail.html), 'the email: three answer buttons (Vin / Poate / Nu pot), the links in the text too', Object.keys(links));

    // no session at all (a fresh browser context)
    const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, locale: 'ro-RO' });
    const p = await ctx.newPage();
    await p.goto(`${app.url}${new URL(links.maybe).pathname}${new URL(links.maybe).search}`);
    await p.waitForSelector('#answer-form:not([hidden])');
    const ev = (await app.api(app.cookies.owner, 'GET', `/api/events/${E}`)).body.event;
    check((await p.textContent('#heading')) === ev.name && await p.getAttribute('[data-answer="maybe"]', 'aria-pressed') === 'true' && /Trimite răspunsul: Poate/.test(await p.textContent('#send')), 'the page: the event, "Poate" chosen, "Trimite răspunsul: Poate"; no sign-in');
    let mine = (await app.api(app.cookies.member, 'GET', `/api/events/${E}/assignments`)).body.attendance.me;
    check(mine.status === 'pending', 'opening the link alone answers nothing (mail scanners)', mine);
    const a = await layoutAudit(p, 'main');
    check(!a.overflow && !a.small.length, 'the page 375: no overflow, targets >= 44 px', a);
    await p.fill('#note', 'Ajung la 11');
    await p.click('#send');
    await p.waitForFunction(() => /Mulțumim/.test(document.getElementById('message').textContent));
    mine = (await app.api(app.cookies.member, 'GET', `/api/events/${E}/assignments`)).body.attendance.me;
    check(mine.status === 'maybe' && mine.note === 'Ajung la 11', 'saved: "Poate" with the note', mine);
    await wait(300);
    const told = (await app.api(app.cookies.leader, 'GET', '/api/notifications')).body.notifications.find((n) => n.kind === 'attendance' && n.eventId === E);
    check(told && /Membru: Poate/.test(told.title), 'the leader is told', told && told.title);
    // change it on the page
    await p.click('[data-answer="accepted"]');
    await p.click('#send');
    await p.waitForFunction(() => /Vin/.test(document.getElementById('message').textContent) && /Mulțumim/.test(document.getElementById('message').textContent));
    check((await app.api(app.cookies.member, 'GET', `/api/events/${E}/assignments`)).body.attendance.me.status === 'accepted', 'changed to "Vin"');
    // a made-up token
    await p.goto(`${app.url}/answer/${'0'.repeat(64)}?a=accepted`);
    await p.waitForSelector('#problem:not([hidden])');
    check(await p.isHidden('#answer-form'), 'a made-up link: a clear message, no form');
    await ctx.close();
  },
};
