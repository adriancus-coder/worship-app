'use strict';

// The event head on phones: an event named after its day ("Duminica") does not say the day
// twice: the date line is the title ("Duminică, 18 octombrie · 15:00") and the name is left
// out; status · count · the team's answers · the note share one row. An event with a name
// of its own keeps the name as the title and the date under it.

const { layoutAudit } = require('./harness');

module.exports = {
  name: 'event-head',
  async run({ app, signIn, check }) {
    const owner = app.cookies.owner;
    const d = new Date(`${app.seed.today}T00:00:00Z`);
    do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() !== 0);
    const sunday = d.toISOString().slice(0, 10);
    const id = (await app.api(owner, 'POST', '/api/events', { name: 'Duminica', eventDate: sunday, startTime: '15:00', notes: 'Predica: Ovidiu Haidemak' })).body.event.id;
    await app.api(owner, 'PUT', `/api/events/${id}/items`, { items: [{ type: 'prayer', who: 'Daniel Iorga' }, { type: 'sermon', title: 'Predica', who: 'Ovidiu Haidemak' }] });
    const positions = (await app.api(owner, 'GET', '/api/positions')).body.positions;
    const users = (await app.api(owner, 'GET', '/api/team')).body.users;
    await app.api(owner, 'PUT', `/api/events/${id}/assignments`, { assignments: [{ userId: users.find((u) => u.email === 'm@x.ro').id, positionId: positions[0].id }] });

    const p = await signIn('owner', { width: 375, lang: 'ro' });
    await p.goto(`${app.url}/events/${id}/edit`);
    await p.waitForSelector('#team-summary:not([hidden])');
    const head = await p.evaluate(() => {
      const rect = (s) => document.querySelector(s).getBoundingClientRect();
      const top = (s) => Math.round(rect(s).top);
      return { title: document.getElementById('event-name').textContent, whenHidden: document.getElementById('event-when').hidden, sameRow: Math.abs(top('#event-status') - top('#event-notes')) < 8, summaryBelow: top('#team-summary') > top('#event-status'), listTop: Math.round(rect('.setlist-scroll').top) };
    });
    check(/^Duminică, \d+ \S+ · 15:00$/.test(head.title) && head.whenHidden, 'named after its day: the date line is the title, the name is not repeated', head);
    check(head.sameRow && head.summaryBelow, 'status · count · the note share one row, the team\'s answers under it', head);
    check(head.listTop < 330, 'the Program starts in the upper half of the phone screen', head);
    await p.screenshot({ path: process.env.WA_SHOT || '/dev/null' }).catch(() => {});
    const a = await layoutAudit(p, '.event-head');
    check(!a.overflow && !a.small.length, 'the head 375: no overflow, targets >= 44 px', a);

    await p.goto(`${app.url}/events/${app.seed.eventId}/edit`);
    await p.waitForSelector('#event-actions .button');
    const own = await p.evaluate(() => ({ title: document.getElementById('event-name').textContent, when: document.getElementById('event-when').hidden ? null : document.getElementById('event-when').textContent }));
    check(own.title === 'Serviciu duminică' && /^\S+, \d+ \S+ · 10:00$/.test(own.when), 'a name of its own: the name is the title, the date under it', own);
    // one bar at the bottom: "Șterge evenimentul" left, "Salvează" right; no delete card in the Program
    const bar = await p.evaluate(() => {
      const top = (s) => Math.round(document.querySelector(s).getBoundingClientRect().top);
      const state = document.getElementById('save-state').getBoundingClientRect();
      return { sameRow: Math.abs(top('#delete-button') - top('#save-button')) < 8, inBar: Boolean(document.querySelector('#save-bar #delete-button')), card: Boolean(document.querySelector('.setlist-scroll .delete-area')), stateHidden: state.width <= 1 };
    });
    check(bar.sameRow && bar.inBar && !bar.card && bar.stateHidden, '"Șterge evenimentul" and "Salvează" share the bottom bar; no second card; the state text out of the way on the phone', bar);
    const b = await layoutAudit(p, '#save-bar');
    check(!b.overflow && !b.small.length, 'the bar 375: no overflow, targets >= 44 px', b);
    await p.context().close();
  },
};
