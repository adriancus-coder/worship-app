'use strict';

// Stage 7, "Indisponibil": a member adds a period on Profilul meu; the leader's picker greys
// them out with the reason on an event in that period and warns on an assigned row; the owner
// sees the chip on Echipa; another member sees nothing of it. RO 375 / EN 1024.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'unavailability',
  timeout: 180000,
  async run({ app, signIn, check }) {
    const owner = app.cookies.owner;
    const E2 = app.seed.event2Id; // "Seara", a week from today
    const date = (await app.api(owner, 'GET', `/api/events/${E2}`)).body.event.eventDate;
    // the member (EN 1024): the profile section
    const m = await signIn('member', { width: 1024, lang: 'en' });
    await m.goto(`${app.url}/profile`);
    await m.waitForSelector('#unavail:not([hidden])');
    check(!(await m.isHidden('#unavail-empty')), 'profile: "Unavailable" section, no period yet');
    await m.fill('#u-from', date);
    await m.fill('#u-note', 'Holiday');
    await m.click('#u-add');
    await m.waitForSelector('.unavail-row');
    check(/Holiday/.test(await m.textContent('.unavail-row')) && await m.isHidden('#unavail-empty'), 'a one-day period added with a reason');
    const a = await layoutAudit(m, '#unavail');
    check(!a.overflow && !a.small.length, 'unavailable section: targets >= 44 px', a);
    // the leader (RO 375): the picker
    const l = await signIn('leader', { width: 375, lang: 'ro' });
    await l.goto(`${app.url}/events/${E2}/edit`);
    await l.waitForSelector('#editor-tabs:not([hidden])');
    await l.click('#tab-team');
    await l.waitForSelector('#team-panel .team-position');
    const opt = l.locator('.team-position:has(h3:text-is("Chitară")) option:has-text("Membru")').first();
    check((await opt.getAttribute('disabled')) !== null && /Holiday/.test(await opt.textContent()), 'picker: the member is greyed with the reason on that day', await opt.textContent());
    // assigned via the API anyway (e.g. before the period was added): the row warns
    const positions = (await app.api(owner, 'GET', '/api/positions')).body.positions;
    const memberId = (await app.api(owner, 'GET', '/api/team')).body.users.find((u) => u.email === 'm@x.ro').id;
    await app.api(owner, 'PUT', `/api/events/${E2}/assignments`, { assignments: [{ userId: memberId, positionId: positions[1].id }] });
    await l.reload();
    await l.waitForSelector('#editor-tabs:not([hidden])');
    await l.click('#tab-team');
    await l.waitForSelector('.assign-row.unavailable');
    check(/Indisponibil în ziua evenimentului: Holiday/.test(await l.textContent('.assign-row.unavailable')), 'an assigned row warns "Indisponibil în ziua evenimentului"');
    // the owner: the chip on Echipa; the other event day: no warning
    const o = await signIn('owner', { width: 1024 });
    await o.goto(`${app.url}/team`);
    await o.waitForSelector('#team .team-row');
    check(/Indisponibil/.test(await o.locator('#team .team-row', { hasText: 'Membru' }).locator('.unavail-pill').textContent()), 'Echipa: "Indisponibil: <date>" chip');
    const free = (await app.api(app.cookies.leader, 'GET', `/api/events/${app.seed.eventId}/assignments`)).body.people.find((p) => p.id === memberId);
    check(free.unavailable === null, 'another day: available');
    // another member sees nothing of it
    const other = (await app.api(owner, 'POST', '/api/team', { name: 'Alt', email: 'alt2@x.ro', role: 'member' })).body;
    const cookie = /wa_sid=[0-9a-f]+/.exec((await app.api(null, 'POST', '/api/auth/login', { email: 'alt2@x.ro', password: other.temporaryPassword })).headers.get('set-cookie'))[0];
    check((await app.api(cookie, 'GET', '/api/unavailability')).status === 403 && !JSON.stringify((await app.api(cookie, 'GET', `/api/events/${E2}/assignments`)).body).includes('Holiday'), 'another member: no unavailability of others anywhere');
    // remove it
    await m.click('.unavail-row button');
    await m.waitForFunction(() => !document.querySelector('.unavail-row'));
    check(!(await m.isHidden('#unavail-empty')), 'removed');
  },
};
