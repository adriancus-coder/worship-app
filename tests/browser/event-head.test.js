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
    // nothing to save: no bar at the bottom, the Program has the screen; "Șterge evenimentul"
    // sits in the "⋯" menu, no delete card in the Program
    const clean = await p.evaluate(() => ({ bar: document.getElementById('save-bar').hidden, inTools: Boolean(document.querySelector('#event-tools #delete-button')), card: Boolean(document.querySelector('.setlist-scroll .delete-area')), more: !document.getElementById('event-more').hidden, deleteVisible: document.getElementById('delete-button').getBoundingClientRect().width > 0 }));
    check(clean.bar && clean.inTools && !clean.card && clean.more && !clean.deleteVisible, 'clean: no save bar; "Șterge evenimentul" waits in the "⋯" menu', clean);
    await p.click('#event-more');
    await p.waitForSelector('#event-tools.open');
    check(await p.evaluate(() => document.getElementById('delete-button').getBoundingClientRect().width > 0), 'the "⋯" menu shows "Șterge evenimentul"');
    await p.keyboard.press('Escape');
    // a change: the pill with the state and "Salvează" floats at the bottom
    await p.click('#items li:nth-child(1) .item-grip');
    await p.focus('#items li:nth-child(1) .item-grip');
    await p.keyboard.press('ArrowDown');
    await p.waitForSelector('#save-bar:not([hidden])');
    const bar = await p.evaluate(() => { const r = document.getElementById('save-bar').getBoundingClientRect(); const shell = document.getElementById('app-shell'); return { dirty: document.getElementById('save-bar').classList.contains('dirty'), state: document.getElementById('save-state').textContent, fixed: getComputedStyle(document.getElementById('save-bar')).position === 'fixed', bottomOnScreen: r.bottom <= window.innerHeight, aboveShell: shell ? r.bottom <= shell.getBoundingClientRect().top + 1 : true, room: document.body.classList.contains('save-bar-shown') }; });
    check(bar.dirty && /nesalvate/i.test(bar.state) && bar.fixed && bar.bottomOnScreen && bar.aboveShell && bar.room, 'unsaved: the pill floats above the bottom bar with the state and "Salvează"', bar);
    const b = await layoutAudit(p, '#save-bar');
    check(!b.overflow && !b.small.length, 'the pill 375: no overflow, targets >= 44 px', b);
    await p.click('#save-button');
    await p.waitForFunction(() => /Salvat/.test(document.getElementById('save-state').textContent));
    await p.waitForFunction(() => document.getElementById('save-bar').hidden, null, { timeout: 6000 });
    check(true, '"Salvat." shows, then the pill goes');
    await p.context().close();
  },
};
