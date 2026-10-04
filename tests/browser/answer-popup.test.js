'use strict';

// The invitations pop-up: the leader sends the invitation; the member (RO 375) opens the app
// and the pop-up asks at once ("Invitație" · the event · Vin / Poate / Nu pot); "Poate" saves
// it, the pop-up closes and the home card shows the answer; a reload asks nothing. Scheduled
// on a position (sent): "Ești programat" with Vin / Nu pot; "Mai târziu" hides it for the
// session. Never on the follow page. EN 1024 for the texts.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'answer-popup',
  timeout: 180000,
  async run({ app, signIn, check }) {
    const E = app.seed.eventId;
    const ev = (await app.api(app.cookies.owner, 'GET', `/api/events/${E}`)).body.event;
    check((await app.api(app.cookies.leader, 'POST', `/api/events/${E}/attendance/send`, {})).status === 200, 'the invitation is sent');

    const m = await signIn('member', { width: 375, lang: 'ro' });
    await m.goto(`${app.url}/app`);
    await m.waitForSelector('#answer-popup[open]');
    const text = await m.textContent('#answer-popup');
    check(/Invitație/.test(text) && text.includes(ev.name) && await m.locator('#answer-popup [data-answer]').count() === 3, 'the app opens with the pop-up: "Invitație", the event, Vin / Poate / Nu pot', text);
    const a = await layoutAudit(m, '#answer-popup');
    check(!a.overflow && !a.small.length, 'the pop-up 375: no overflow, targets >= 44 px', a);
    await m.fill('#answer-popup-note', 'Ajung mai târziu');
    await m.click('#answer-popup [data-answer="maybe"]');
    await m.waitForSelector('#answer-popup', { state: 'hidden' });
    await m.waitForSelector('.now-attend [data-answer="maybe"][aria-pressed="true"]');
    const mine = (await app.api(app.cookies.member, 'GET', `/api/events/${E}/assignments`)).body.attendance.me;
    check(mine.status === 'maybe' && mine.note === 'Ajung mai târziu', '"Poate" with the note saved; the home card shows it', mine);
    await m.reload();
    await wait(1500);
    check(!(await m.isVisible('#answer-popup')), 'answered: no pop-up any more');

    // a position, sent: "Ești programat"; "Mai târziu" hides it for this session
    const voce = (await app.api(app.cookies.owner, 'GET', '/api/positions')).body.positions.find((p) => p.name === 'Voce').id;
    const memberId = (await app.api(app.cookies.owner, 'GET', '/api/team')).body.users.find((u) => u.email === 'm@x.ro').id;
    await app.api(app.cookies.leader, 'PUT', `/api/events/${E}/assignments`, { assignments: [{ userId: memberId, positionId: voce }] });
    await app.api(app.cookies.leader, 'POST', `/api/events/${E}/assignments/send`, {});
    await m.reload();
    await m.waitForSelector('#answer-popup[open]');
    check(/Ești programat/.test(await m.textContent('#answer-popup')) && /Voce/.test(await m.textContent('#answer-popup')) && await m.locator('#answer-popup [data-answer]').count() === 2, 'a position: "Ești programat · Voce" with Vin / Nu pot');
    await m.click('#answer-popup-later');
    await m.reload();
    await wait(1500);
    check(!(await m.isVisible('#answer-popup')), '"Mai târziu": not again in this session');
    await m.goto(`${app.url}/events/${E}/follow`);
    await wait(1500);
    check(await m.locator('#answer-popup').count() === 0, 'never on the follow page');
    await m.context().close();

    // a new session, English: it asks again
    const e = await signIn('member', { width: 1024, lang: 'en' });
    await e.goto(`${app.url}/app`);
    await e.waitForSelector('#answer-popup[open]');
    check(/You are scheduled/.test(await e.textContent('#answer-popup')), 'a new session asks again (EN)');
    await e.click('#answer-popup [data-answer="accepted"]');
    await e.waitForSelector('#answer-popup', { state: 'hidden' });
    check((await app.api(app.cookies.member, 'GET', `/api/events/${E}/assignments`)).body.me[0].status === 'accepted', '"I’m in" saved the position');
    await e.context().close();
  },
};
