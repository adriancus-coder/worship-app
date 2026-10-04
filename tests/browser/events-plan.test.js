'use strict';

// "Planifică" on Evenimente: a month calendar; the leader (RO 375) goes to next month, taps
// "DU" (every Sunday chosen: filled and checked), clears one, adds a note, creates them; the
// list reloads with the new events and their note; reopening shows a dot on those days. The
// API: members cannot, bad dates are refused, a template gives its name and time.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'events-plan',
  timeout: 180000,
  async run({ app, signIn, check }) {
    const [ty, tm] = app.seed.today.split('-').map(Number);
    const ny = tm === 12 ? ty + 1 : ty;
    const nm = tm === 12 ? 1 : tm + 1;
    const sundays = [];
    for (let d = 1; d <= new Date(Date.UTC(ny, nm, 0)).getUTCDate(); d++) {
      const date = `${ny}-${String(nm).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (new Date(`${date}T12:00:00Z`).getUTCDay() === 0) sundays.push(date);
    }

    const p = await signIn('leader', { width: 375, lang: 'ro' });
    await p.goto(`${app.url}/events`);
    await p.waitForSelector('#plan-events:not([hidden])');
    await p.click('#plan-events');
    await p.waitForSelector('#plan-dialog[open] .plan-day');
    check(await p.isDisabled('#plan-create') && /Nicio zi/.test(await p.textContent('#plan-count')), 'opens on this month, nothing chosen, "Creează" off');
    await p.click('#plan-next');
    await p.click('.plan-wd[data-weekday="6"]');
    const pressed = await p.$$eval('.plan-day[aria-pressed="true"]', (bs) => bs.map((b) => b.dataset.date));
    check(JSON.stringify(pressed) === JSON.stringify(sundays), `"DU": every Sunday of next month chosen (${sundays.length})`, pressed);
    await p.click(`.plan-day[data-date="${sundays[1]}"]`);
    check(await p.getAttribute(`.plan-day[data-date="${sundays[1]}"]`, 'aria-pressed') === 'false' && (await p.textContent('#plan-create')) === `Creează ${sundays.length - 1} evenimente`, 'one cleared; the button counts');
    const a = await layoutAudit(p, '#plan-dialog');
    check(!a.overflow && !a.small.length, 'the planner 375: no overflow, targets >= 44 px', a);
    await p.fill('#plan-notes', 'Cina Domnului');
    await p.click('#plan-create');
    await p.waitForSelector('#plan-dialog', { state: 'hidden' });
    await p.waitForSelector('#plan-done:not([hidden])');
    check(new RegExp(`Am creat ${sundays.length - 1} evenimente`).test(await p.textContent('#plan-done')), 'done: how many');
    await wait(300);
    const cards = await p.$$eval('.event-card', (cs) => cs.map((c) => c.textContent));
    check(cards.filter((c) => /Serviciu de duminică/.test(c) && /Cina Domnului/.test(c)).length === sundays.length - 1, 'the list: the new events with their note', cards.length);
    await p.click('#plan-events');
    await p.waitForSelector('#plan-dialog[open] .plan-day');
    await p.click('#plan-next');
    check(await p.locator(`.plan-day[data-date="${sundays[0]}"] .plan-dot`).count() === 1 && await p.locator(`.plan-day[data-date="${sundays[1]}"] .plan-dot`).count() === 0, 'reopened: a dot on the days with an event');
    await p.context().close();

    // the API
    check((await app.api(app.cookies.member, 'POST', '/api/events/plan', { dates: [sundays[1]] })).status === 403, 'a member cannot plan');
    check((await app.api(app.cookies.leader, 'POST', '/api/events/plan', { dates: ['2026-13-40'] })).status === 400 && (await app.api(app.cookies.leader, 'POST', '/api/events/plan', { dates: [] })).status === 400, 'bad or no dates: 400');
    const tpl = (await app.api(app.cookies.leader, 'POST', '/api/events', { name: 'Seară de rugăciune', eventDate: app.seed.today, startTime: '19:00' })).body.event;
    await app.api(app.cookies.leader, 'POST', `/api/events/${tpl.id}/save-as-template`, { name: 'Seară de rugăciune' });
    const templates = (await app.api(app.cookies.leader, 'GET', '/api/events?when=templates')).body.events;
    const t1 = templates.find((x) => x.name === 'Seară de rugăciune');
    const made = await app.api(app.cookies.leader, 'POST', '/api/events/plan', { dates: [sundays[1]], templateId: t1 && t1.id });
    const ev = made.status === 201 && (await app.api(app.cookies.leader, 'GET', `/api/events/${made.body.events[0].id}`)).body.event;
    check(t1 && ev && ev.name === 'Seară de rugăciune' && ev.startTime === '19:00' && ev.eventDate === sundays[1], 'a template: its name and time', { t1, ev });
  },
};
