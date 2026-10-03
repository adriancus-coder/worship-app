'use strict';

// Echipa: tapping a name opens the person's card - role, positions, the unavailable periods
// with their reason, the coming events they are scheduled for (with the position and the
// answer). The team (a member, RO 375) sees no email / phone; the owner (EN 1024) does.

const { layoutAudit } = require('./harness');

module.exports = {
  name: 'person-card',
  timeout: 180000,
  async run({ app, signIn, check }) {
    const owner = app.cookies.owner;
    const E = app.seed.event2Id;
    const ev = (await app.api(owner, 'GET', `/api/events/${E}`)).body.event;
    const team = (await app.api(owner, 'GET', '/api/team')).body.users;
    const op = team.find((u) => u.email === 'op@x.ro');
    const positions = (await app.api(owner, 'GET', '/api/positions')).body.positions;
    // the operator: away around the event, with a reason, and scheduled on it
    await app.api(app.cookies.operator, 'POST', '/api/me/unavailability', { dateFrom: ev.eventDate, dateTo: ev.eventDate, note: 'La nunta fratelui' });
    await app.api(app.cookies.leader, 'PUT', `/api/events/${E}/assignments`, { assignments: [{ userId: op.id, positionId: positions[0].id }] });

    // a member (RO 375): the directory row shows the reason; the card says it all
    const m = await signIn('member', { width: 375, lang: 'ro' });
    await m.goto(`${app.url}/team`);
    await m.waitForSelector('#directory .person-open');
    const row = m.locator('#directory .directory-row', { hasText: 'Operator' }).first();
    check(/La nunta fratelui/.test(await row.locator('.unavail-pill').first().textContent()), 'the directory: the unavailable period carries its reason');
    await row.locator('.person-open').click();
    await m.waitForSelector('#person-dialog[open]');
    const card = await m.textContent('#person-dialog');
    check(/Operator/.test(await m.textContent('#person-heading')) && /La nunta fratelui/.test(card) && new RegExp(ev.name).test(card) && /așteaptă răspuns/.test(card), 'the card: the reason, the coming event with the answer', card);
    check(!/@/.test(card), 'the team sees no email');
    const a = await layoutAudit(m, '#person-dialog');
    check(!a.overflow && !a.small.length, 'the card 375: no overflow, targets >= 44 px', a);
    await m.click('#person-close');
    check(!(await m.evaluate(() => document.getElementById('person-dialog').open)), 'Închide closes it');
    await m.context().close();

    // the owner (EN 1024): the same card plus the email
    const o = await signIn('owner', { width: 1024, lang: 'en' });
    await o.goto(`${app.url}/team`);
    await o.waitForSelector('#team .person-open');
    await o.locator('#team .team-row', { hasText: 'op@x.ro' }).locator('.person-open').click();
    await o.waitForSelector('#person-dialog[open]');
    const oc = await o.textContent('#person-dialog');
    check(/op@x\.ro/.test(oc) && /Scheduled for/.test(oc) && /La nunta fratelui/.test(oc), 'the owner: the email too, in English', oc);
    await o.context().close();
  },
};
