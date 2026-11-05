'use strict';

// "+ Eveniment nou": the form first (public/event-new.js): the name prefilled, the next usual
// service day pressed on the calendar (days with an event dotted), the usual time in the
// list, the starting programme (random songs from any / one theme, a copy, empty), a note;
// nothing exists until "Creează evenimentul", which opens the editor with everything set.
// Date and time are chosen, never typed. A member sees the new event at once; the church's
// usual day and time in the settings. RO 375 / EN 1024.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'quick-create',
  async run({ app, signIn, check }) {
    const owner = app.cookies.owner;
    const nextSunday = (today) => {
      const d = new Date(`${today}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7));
      return d.toISOString().slice(0, 10);
    };
    for (const [lang, width] of [['ro', 375], ['en', 1024]]) {
      const tag = `[${lang} ${width}]`;
      // songs the random ideas can draw from (the seed's three, and the previous round's, are in recent events)
      for (let i = 1; i <= 4; i += 1) await app.api(owner, 'POST', '/api/songs', { title: `Nouă ${lang} ${i}`, song_key: 'G', sections: [{ type: 'verse', content: `Rând ${i}` }] });
      await app.api(owner, 'POST', '/api/songs', { title: `Cu temă ${lang}`, song_key: 'G', themes: ['Rugăciune'], sections: [{ type: 'verse', content: 'x' }] }); // one per round: the other round's is recent by then
      const m = await signIn('member', { width: 375, lang });
      await m.goto(`${app.url}/events`);
      await m.waitForSelector('#events li');
      const before = await m.locator('#events li').count();
      const p = await signIn('leader', { width, lang });
      await p.goto(`${app.url}/events`);
      await p.waitForSelector('#new-event:not([hidden])');
      const eventsBefore = (await app.api(owner, 'GET', '/api/events?when=upcoming')).body.events.length;
      await p.click('#new-event');
      await p.waitForSelector('#new-dialog[open] .plan-day[aria-pressed="true"]');
      const defaults = (await app.api(owner, 'GET', '/api/events/quick-defaults')).body;
      const form = await p.evaluate(() => ({
        name: document.getElementById('new-name').value,
        date: document.querySelector('#new-grid .plan-day[aria-pressed="true"]').dataset.date,
        dateText: document.getElementById('new-date-text').textContent,
        time: document.getElementById('new-time').value,
        times: document.querySelectorAll('#new-time option').length,
        programme: document.querySelector('#new-programme [aria-pressed="true"]').dataset.programme,
        themes: [...document.querySelectorAll('#new-theme .theme-pick')].map((b) => b.dataset.theme),
        noTyping: document.getElementById('new-grid').querySelectorAll('input').length === 0 && document.getElementById('new-time').tagName === 'SELECT',
      }));
      // the default day is the next usual service (today until 2 h after the service time, else the next Sunday)
      check((lang === 'ro' ? form.name === defaults.name : /Sunday service/.test(form.name)) && form.date === defaults.eventDate && new Date(`${form.date}T12:00:00Z`).getUTCDay() === 0 && form.date >= defaults.today && form.dateText.length > 5 && form.time === defaults.startTime && form.times > 40 && form.programme === 'random' && form.themes.includes('Rugăciune') && form.noTyping,
        `${tag} the form: the name, next Sunday pressed on the calendar, the usual time in the list, "10 la întâmplare", the themes; nothing typed for date / time`, form);
      check((await app.api(owner, 'GET', '/api/events?when=upcoming')).body.events.length === eventsBefore, `${tag} nothing created yet`);
      const a = await layoutAudit(p, '#new-dialog');
      check(!a.overflow && !a.small.length, `${tag} the form: no overflow, targets >= 44 px`, a);
      // another day (the next enabled one after the preselected), another time, a theme, a note
      const picked = await p.evaluate(() => {
        const days = [...document.querySelectorAll('#new-grid .plan-day:not(:disabled)')];
        const current = days.findIndex((b) => b.getAttribute('aria-pressed') === 'true');
        const next = days[current + 1] || days[current - 1];
        next.click();
        return next.dataset.date;
      });
      await p.selectOption('#new-time', '18:00');
      await p.click('#new-theme .theme-pick[data-theme="Rugăciune"]');
      await p.fill('#new-notes', `Notă ${lang}`);
      await p.fill('#new-name', `Seară ${lang}`);
      await p.click('#new-create');
      await p.waitForURL(/\/events\/\d+\/edit$/);
      const id = Number(new URL(p.url()).pathname.split('/')[2]);
      const ev = (await app.api(owner, 'GET', `/api/events/${id}`)).body;
      check(ev.event.name === `Seară ${lang}` && ev.event.eventDate === picked && ev.event.startTime === '18:00' && ev.event.notes === `Notă ${lang}` && ev.items.length === 1 && ev.items[0].title === `Cu temă ${lang}`,
        `${tag} created with what was chosen: name, the picked day, 18:00, the note, the songs of the theme (one)`, { event: ev.event, items: ev.items.map((it) => it.title) });
      check(await p.isHidden('#quick-details'), `${tag} the editor opens with nothing to fix (Detalii closed)`);
      await m.reload();
      await m.waitForSelector('#events li');
      check(await m.locator('#events li').count() === before + 1, `${tag} the member sees the new event at once`);
      await p.context().close();
      await m.context().close();
    }
    // "Gol" and a copy from the form; the API alone keeps its defaults
    const o = await signIn('owner', { width: 1024, lang: 'ro' });
    await o.goto(`${app.url}/events?new=1`);
    await o.waitForSelector('#new-dialog[open] .plan-day[aria-pressed="true"]');
    await o.click('#new-programme [data-programme="empty"]');
    check(await o.isHidden('#new-theme-field') && await o.isHidden('#new-copy-field'), '"Gol": no theme, no copy picker');
    await o.click('#new-create');
    await o.waitForURL(/\/events\/\d+\/edit$/);
    const empty = Number(new URL(o.url()).pathname.split('/')[2]);
    check((await app.api(owner, 'GET', `/api/events/${empty}`)).body.items.length === 0, '"Gol": an empty programme');
    const copyRes = await app.api(owner, 'POST', '/api/events/quick', { programme: 'copy', fromEventId: app.seed.eventId });
    check(copyRes.status === 201 && copyRes.body.items.length === (await app.api(owner, 'GET', `/api/events/${app.seed.eventId}`)).body.items.length, 'a copy: the past event\'s items', copyRes.body.items && copyRes.body.items.length);
    check((await app.api(owner, 'POST', '/api/events/quick', { programme: 'copy' })).status === 400, 'a copy without an event: 400');
    const plain = await app.api(owner, 'POST', '/api/events/quick');
    const d0 = (await app.api(owner, 'GET', '/api/events/quick-defaults')).body;
    check(plain.status === 201 && plain.body.event.eventDate === d0.eventDate && plain.body.event.name === d0.name && plain.body.event.startTime === d0.startTime, 'the API without a body: the defaults');

    // The church's usual day and time
    await o.goto(`${app.url}/settings`);
    await o.waitForSelector('#service-day option', { state: 'attached' });
    await o.selectOption('#service-day', '3');
    await o.waitForFunction(() => /salvat/i.test(document.getElementById('service-message').textContent), null, { timeout: 4000 });
    await o.fill('#service-time', '18:30');
    await o.press('#service-time', 'Tab');
    await wait(500);
    check(JSON.stringify((await app.api(owner, 'GET', '/api/settings')).body.service) === '{"weekday":3,"time":"18:30"}', 'settings: the usual service day and time are saved');
    const wed = (await app.api(owner, 'GET', '/api/events/quick-defaults')).body;
    check(new Date(`${wed.eventDate}T12:00:00Z`).getUTCDay() === 3 && wed.startTime === '18:30' && /miercuri/.test(wed.name), 'the form\'s defaults follow the settings', wed);
  },
};
