'use strict';

// The event page's "▶ Pornește live" (today / tomorrow, the 'screens' right) starts the event
// right there and opens the live page already live: one step, no second "Pornește live". With
// another event live, a confirmation names it and ends it first. The leader (no 'screens')
// keeps a plain link to the live page. RO 375 / EN 1024.

module.exports = {
  name: 'event-start',
  timeout: 120000,
  async run({ app, signIn, check }) {
    const owner = app.cookies.owner;
    const E = app.seed.eventId; // planned, today
    const today = app.seed.today;
    const other = (await app.api(owner, 'POST', '/api/events', { name: 'Repetiție', eventDate: today, startTime: '18:00' })).body.event.id;

    // the owner (RO 375): a button, not a link; one tap -> the live page, the event live
    const p = await signIn('owner', { width: 375, lang: 'ro' });
    await p.goto(`${app.url}/events/${E}`);
    await p.waitForSelector('#event-actions #event-start');
    const action = await p.evaluate(() => { const b = document.getElementById('event-start'); return { tag: b.tagName, text: b.textContent.trim(), primary: b.classList.contains('primary-action'), href: b.getAttribute('href') }; });
    check(action.tag === 'A' && action.text === 'Pornește live' && action.primary && /\/live$/.test(action.href), 'owner: "Pornește live" is the primary action (a link that starts the event)', action);
    await p.click('#event-start');
    await p.waitForURL(`**/events/${E}/live**`);
    await p.waitForSelector('#live:not([hidden])');
    await p.waitForFunction(() => document.getElementById('event-status').textContent === 'Live');
    check((await app.api(owner, 'GET', `/api/events/${E}`)).body.event.status === 'live' && await p.isHidden('#start-button') && !(await p.isHidden('#end-button')), 'one tap: the live page opens with the event live (no second "Pornește live")');

    // another event's page while this one is live: the confirmation, then the switch
    await p.goto(`${app.url}/events/${other}`);
    await p.waitForSelector('#event-actions #event-start');
    await p.click('#event-start');
    await p.waitForSelector('#switch-dialog[open]');
    check(/Serviciu duminică/.test(await p.textContent('#switch-heading')), 'another event live: the confirmation names it', await p.textContent('#switch-heading'));
    await p.click('#switch-cancel');
    check(!(await p.locator('#switch-dialog[open]').count()) && (await app.api(owner, 'GET', `/api/events/${E}`)).body.event.status === 'live', '"Anulează": nothing changes');
    await p.click('#event-start');
    await p.waitForSelector('#switch-dialog[open]');
    await p.click('#switch-yes');
    await p.waitForURL(`**/events/${other}/live**`);
    const after = await Promise.all([E, other].map((id) => app.api(owner, 'GET', `/api/events/${id}`).then((r) => r.body.event.status)));
    check(after[0] === 'finished' && after[1] === 'live', 'the first event ended, the other live', after);
    await app.command({ type: 'event.end', eventId: other }).catch(() => {});

    // the leader (EN 1024): no 'screens' right -> a link to the live page, no start button
    const l = await signIn('leader', { width: 1024, lang: 'en' });
    await l.goto(`${app.url}/events/${E}`);
    await l.waitForSelector('#event-actions .button');
    check(!(await l.locator('#event-start').count()) && (await l.locator('#event-actions a[href*="/live"]').count()) >= 1, 'leader: no start button, a link to the live page');
  },
};
