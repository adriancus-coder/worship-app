'use strict';

// An event's note shows on its card in Evenimente and on Acasă (the top event and the
// coming ones), two lines at most. RO 375.

const { layoutAudit } = require('./harness');

module.exports = {
  name: 'events-note',
  timeout: 120000,
  async run({ app, signIn, check }) {
    const owner = app.cookies.owner;
    const top = (await app.api(owner, 'GET', `/api/events/${app.seed.eventId}`)).body.event;
    await app.api(owner, 'PUT', `/api/events/${top.id}`, { name: top.name, eventDate: top.eventDate, startTime: top.startTime, notes: 'Agapă după serviciu' });
    const p = await signIn('leader', { width: 375, lang: 'ro' });
    await p.goto(`${app.url}/events`);
    await p.waitForSelector('.event-card');
    const card = p.locator('.event-card', { hasText: top.name }).first();
    check(/Agapă după serviciu/.test(await card.locator('.event-note').textContent()), 'Evenimente: the note on the card');
    const a = await layoutAudit(p, 'main');
    check(!a.overflow, 'no overflow', a);
    await p.goto(`${app.url}/app`);
    await p.waitForSelector('#now-title');
    check(/Agapă după serviciu/.test(await p.textContent('.now-note')), 'Acasă: the note under the top event');
    await app.api(owner, 'PUT', `/api/events/${top.id}`, { name: top.name, eventDate: top.eventDate, startTime: top.startTime, notes: '' });
    await p.context().close();
  },
};
