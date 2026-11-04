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
    const LONG = 'Predica: Nelu Gaju\nÎndemn: Beniamin Cusniriuc și Ioan Popescu\nAgapă după serviciu, în sala mică, pentru toată biserica și musafiri';
    await app.api(owner, 'PUT', `/api/events/${top.id}`, { name: top.name, eventDate: top.eventDate, startTime: top.startTime, notes: LONG });
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
    // the home card shows the whole note (the events list keeps two lines): every line visible
    const note = await p.$eval('.now-note', (n) => ({ fits: n.scrollHeight <= n.clientHeight + 1, height: n.clientHeight, lines: Math.round(n.clientHeight / parseFloat(getComputedStyle(n).lineHeight)), size: parseFloat(getComputedStyle(n).fontSize) }));
    check(note.fits && note.lines >= 4 && note.size >= 16, 'Acasă: the whole note, not clamped, 16 px', note);
    await app.api(owner, 'PUT', `/api/events/${top.id}`, { name: top.name, eventDate: top.eventDate, startTime: top.startTime, notes: '' });
    await p.context().close();
  },
};
