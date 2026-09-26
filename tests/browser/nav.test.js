'use strict';

// Navigation around an event: the event header stays in view while the Program scrolls;
// rehearsal, live, console, follow and a song opened from the event come back to the event;
// ?from=home keeps "← Acasă"; the browser's Back gives the same result (no loop).

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'nav',
  async run({ app, signIn, check }) {
    const { eventId: E } = app.seed;
    // 15 items, so the Program scrolls.
    const items = (await app.api(app.cookies.owner, 'GET', `/api/events/${E}`)).body.items
      .map(({ id, type, songId, reference, body, title }) => ({ id, type, songId, reference, body, title }));
    for (let i = 1; i <= 10; i++) items.push({ type: 'verse', reference: `Psalmul ${i}`, body: 'Domnul este Păstorul meu.' });
    await app.api(app.cookies.owner, 'PUT', `/api/events/${E}/items`, { items });
    check((await app.command({ type: 'event.start' })).ok, 'the event is live');
    const path = (p) => { const u = new URL(p.url()); return u.pathname + u.search; };
    const settle = async (p) => { await p.waitForLoadState('load'); await wait(400); };

    for (const width of [375, 1440]) {
      const tag = `[${width}]`;
      const o = await signIn('owner', { width });
      await o.goto(`${app.url}/events/${E}`);
      await o.waitForSelector('#items .item-main');
      const tops = () => o.evaluate(() => ['#back-link', '#event-name', '#event-actions'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top)));
      const before = await tops();
      await o.evaluate(() => { const pane = document.querySelector('.setlist-scroll'); pane.scrollTop = pane.scrollHeight; });
      await wait(200);
      const scrolled = await o.evaluate(() => document.querySelector('.setlist-scroll').scrollTop);
      const head = await o.evaluate(() => Math.round(document.querySelector('.event-head').getBoundingClientRect().bottom / innerHeight * 100));
      check(scrolled > 0 && JSON.stringify(before) === JSON.stringify(await tops()), `${tag} the Program scrolls (${scrolled}px), the header stays`);
      check(head <= 40, `${tag} the header takes ${head} % of the screen (<= 40 %)`);
      const a = await layoutAudit(o, '.event-head');
      check(!a.overflow && !a.small.length, `${tag} header: no overflow, targets >= 44 px`, a);

      // Rehearsal: back link and browser Back
      await o.goto(`${app.url}/events`); await settle(o);
      await o.goto(`${app.url}/events/${E}`); await o.waitForSelector('#event-actions a');
      await o.click('#event-actions a[href*="/rehearse"]'); await o.waitForURL('**/rehearse**'); await settle(o);
      await o.click('#back-link'); await o.waitForURL(`**/events/${E}`); await settle(o);
      check(path(o) === `/events/${E}`, `${tag} Repetiție -> back link -> the event`, path(o));
      await o.goBack(); await settle(o);
      check(path(o) === '/events', `${tag} then browser Back -> /events (no loop)`, path(o));

      // Live / console / follow: "← Ieși" and browser Back
      for (const [role, sub] of [['leader', 'live'], ['operator', 'operator'], ['member', 'follow']]) {
        const p = await signIn(role, { width });
        await p.goto(`${app.url}/events/${E}`); await p.waitForSelector('#event-actions a');
        await p.goto(`${app.url}/events/${E}/${sub}`); await settle(p);
        await p.click('.shell-exit'); await p.waitForURL(`**/events/${E}`); await settle(p);
        check(path(p) === `/events/${E}`, `${tag} ${sub}: "← Ieși" -> the event`, path(p));
        await p.goto(`${app.url}/events/${E}/${sub}`); await settle(p);
        await p.goBack(); await settle(p);
        check(path(p) === `/events/${E}`, `${tag} ${sub}: browser Back -> the event`, path(p));
        await p.context().close();
      }

      // A song opened from the event comes back to it
      await o.goto(`${app.url}/events/${E}`); await o.waitForSelector('#items .item-main');
      await o.locator('#items .item-main').first().click();
      await o.waitForSelector('#detail a[href*="/songs/"]');
      await o.click('#detail a[href*="/songs/"]'); await o.waitForURL('**/songs/**'); await settle(o);
      await o.click('#song-back'); await o.waitForURL(`**/events/${E}`); await settle(o);
      check(path(o) === `/events/${E}`, `${tag} song from the event -> "← Înapoi la eveniment" -> the event`, path(o));

      // From Acasă: ?from=home keeps "← Acasă"
      await o.goto(`${app.url}/app`); await o.waitForSelector('#now-title a'); await settle(o);
      await o.click('#now-title a'); await o.waitForURL('**/events/**'); await settle(o);
      await o.click('#event-actions a[href*="/rehearse"]'); await o.waitForURL('**/rehearse**'); await settle(o);
      await o.click('#back-link'); await o.waitForURL('**/events/**'); await settle(o);
      check(path(o) === `/events/${E}?from=home`, `${tag} Acasă -> event -> Repetiție -> back -> the event (from home)`, path(o));
      await o.click('#back-link'); await o.waitForURL('**/app'); await settle(o);
      check(path(o) === '/app', `${tag} its "← Acasă" -> /app`, path(o));
      await o.context().close();
    }
  },
};
