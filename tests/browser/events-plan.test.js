'use strict';

// "Planifică" on Evenimente: a month calendar; the leader (RO 375) goes to next month, taps
// "DU" (every Sunday chosen: filled and checked), clears one, adds a note, creates them; the
// list reloads with the new events and their note; reopening shows a dot on those days. The
// API: members cannot, bad dates are refused, a name and a time apply to every day.

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
    // "Anulează" closes the dialog; opened again for the rest
    await p.click('#plan-cancel');
    await p.waitForSelector('#plan-dialog[open]', { state: 'detached' }).catch(() => null);
    check(!(await p.locator('#plan-dialog[open]').count()), '"Anulează" closes the dialog');
    await p.click('#plan-events');
    await p.waitForSelector('#plan-dialog[open] .plan-day');
    // the same fields as "+ Eveniment nou": the time from a list (the usual time preset), the
    // starting programme with its theme, the note
    const defaults = (await app.api(app.cookies.owner, 'GET', '/api/events/quick-defaults')).body;
    const form = await p.evaluate(() => ({
      timeTag: document.getElementById('plan-time').tagName, time: document.getElementById('plan-time').value, times: document.querySelectorAll('#plan-time option').length,
      programme: document.querySelector('#plan-programme [aria-pressed="true"]').dataset.programme, theme: !document.getElementById('plan-theme-field').hidden, copy: document.getElementById('plan-copy-field').hidden,
    }));
    check(form.timeTag === 'SELECT' && form.time === defaults.startTime && form.times > 40 && form.programme === 'random' && form.theme && form.copy, 'the time list (usual time preset), "10 la întâmplare" pressed with the theme field, no copy field', form);
    await p.click('#plan-programme [data-programme="empty"]');
    check(await p.isHidden('#plan-theme-field') && await p.isHidden('#plan-copy-field'), '"Gol": no theme, no copy picker');
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
    const planned = (await app.api(app.cookies.owner, 'GET', '/api/events?when=upcoming')).body.events.filter((e) => sundays.includes(e.eventDate));
    const counts = await Promise.all(planned.map((e) => app.api(app.cookies.owner, 'GET', `/api/events/${e.id}`).then((r) => r.body.items.length)));
    check(counts.length === sundays.length - 1 && counts.every((n) => n === 0), '"Gol": the events start empty', counts);
    await p.click('#plan-events');
    await p.waitForSelector('#plan-dialog[open] .plan-day');
    await p.click('#plan-next');
    check(await p.locator(`.plan-day[data-date="${sundays[0]}"] .plan-dot`).count() === 1 && await p.locator(`.plan-day[data-date="${sundays[1]}"] .plan-dot`).count() === 0, 'reopened: a dot on the days with an event');
    await p.context().close();

    // the API
    check((await app.api(app.cookies.member, 'POST', '/api/events/plan', { dates: [sundays[1]] })).status === 403, 'a member cannot plan');
    check((await app.api(app.cookies.leader, 'POST', '/api/events/plan', { dates: ['2026-13-40'] })).status === 400 && (await app.api(app.cookies.leader, 'POST', '/api/events/plan', { dates: [] })).status === 400, 'bad or no dates: 400');
    const made = await app.api(app.cookies.leader, 'POST', '/api/events/plan', { dates: [sundays[1]], name: 'Seară de rugăciune', startTime: '19:00' });
    const ev = made.status === 201 && (await app.api(app.cookies.leader, 'GET', `/api/events/${made.body.events[0].id}`)).body.event;
    check(ev && ev.name === 'Seară de rugăciune' && ev.startTime === '19:00' && ev.eventDate === sundays[1], 'a given name and time apply', { ev });
    // random songs come from the library minus the recent events' songs: a few new ones first
    for (let i = 1; i <= 3; i += 1) await app.api(app.cookies.owner, 'POST', '/api/songs', { title: `Nouă ${i}`, song_key: 'G', sections: [{ type: 'verse', content: `Rând ${i}` }] });
    // days well past the planned Sundays (a month may have only four)
    const far = (w) => { const d = new Date(`${sundays[0]}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 7 * w); return d.toISOString().slice(0, 10); };
    const randomly = await app.api(app.cookies.leader, 'POST', '/api/events/plan', { dates: [far(8)] });
    check(randomly.status === 201 && (await app.api(app.cookies.leader, 'GET', `/api/events/${randomly.body.events[0].id}`)).body.items.length >= 1, 'the default programme: random songs');
    // a copy of the seed event: its items on every planned day; a theme narrows the random songs
    const copies = await app.api(app.cookies.leader, 'POST', '/api/events/plan', { dates: [far(9), far(10)], programme: 'copy', fromEventId: app.seed.eventId });
    const copied = copies.status === 201 ? await Promise.all(copies.body.events.map((e) => app.api(app.cookies.leader, 'GET', `/api/events/${e.id}`).then((r) => r.body.items.map((it) => it.type).join()))) : [];
    check(copied.length === 2 && copied.every((x) => x === 'song,verse,song,announcement,song'), 'a copy: the past event\'s items on each day', copied);
    check((await app.api(app.cookies.leader, 'POST', '/api/events/plan', { dates: [far(11)], programme: 'copy' })).status === 400, 'a copy without an event: 400');
    // a song of a theme, new (so no recent event excludes it)
    const prayer = (await app.api(app.cookies.owner, 'POST', '/api/songs', { title: 'Cu temă', song_key: 'D', themes: ['Rugăciune'], sections: [{ type: 'verse', content: 'x' }] })).body.song;
    // several themes: the songs of any of them (planned first, on a later day: an earlier
    // themed event would count as recent and keep its song out)
    const carol = (await app.api(app.cookies.owner, 'POST', '/api/songs', { title: 'Cu altă temă', song_key: 'E', themes: ['Crăciun'], sections: [{ type: 'verse', content: 'x' }] })).body.song;
    const two = await app.api(app.cookies.leader, 'POST', '/api/events/plan', { dates: [far(13)], programme: 'random', themes: ['Rugăciune', 'Crăciun'] });
    const twoItems = two.status === 201 ? (await app.api(app.cookies.leader, 'GET', `/api/events/${two.body.events[0].id}`)).body.items : [];
    check(twoItems.length === 2 && twoItems.map((it) => it.songId).sort().join() === [prayer.id, carol.id].sort().join(), 'two themes: the songs of either', twoItems.map((it) => it.title));
    const themed = await app.api(app.cookies.leader, 'POST', '/api/events/plan', { dates: [far(12)], programme: 'random', theme: 'Rugăciune' });
    const themedItems = themed.status === 201 ? (await app.api(app.cookies.leader, 'GET', `/api/events/${themed.body.events[0].id}`)).body.items : [];
    check(themedItems.length === 1 && themedItems[0].songId === prayer.id, 'a theme: only its songs', themedItems.map((it) => it.title));

  },
};
