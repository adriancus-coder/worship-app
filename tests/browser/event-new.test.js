'use strict';

// "+ Eveniment nou": one button on /events (sharing the row with "Planifică" on phones); the
// form first (public/event-new.js, tested in quick-create), then the editor; "Detalii" from
// the header: name, date, time, notes and "Program de la" (Copie a evenimentului / Gol),
// nothing selected until a choice is made. A copy of a past event
// copies its items with new ids; "Gol" empties after a confirmation; an edited Program asks
// before a copy replaces it; the row reopens from the header. Home's quick action does the
// same. No template picker anywhere. RO 375 / EN 1024.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'event-new',
  timeout: 240000,
  async run({ app, signIn, check }) {
    const { today } = app.seed;
    const owner = app.cookies.owner;
    // A past event with 2 items (finished last week).
    const lastWeek = new Date(`${today}T12:00:00Z`);
    lastWeek.setUTCDate(lastWeek.getUTCDate() - 7);
    const past = (await app.api(owner, 'POST', '/api/events', { name: 'Trecut', eventDate: lastWeek.toISOString().slice(0, 10) })).body.event;
    await app.api(owner, 'PUT', `/api/events/${past.id}/items`, { items: [{ type: 'song', songId: app.seed.songs.T3 }, { type: 'announcement', title: 'Anunț vechi', body: 'x' }] });
    await app.api(owner, 'POST', `/api/events/${past.id}/start`, {});
    await app.api(owner, 'POST', `/api/events/${past.id}/end`, {});
    const pastItems = (await app.api(owner, 'GET', `/api/events/${past.id}`)).body.items.map((it) => it.id);
    // songs the random ideas can draw from (the seed's three are all in recent events)
    for (let i = 1; i <= 4; i += 1) await app.api(owner, 'POST', '/api/songs', { title: `Nouă ${i}`, song_key: 'G', sections: [{ type: 'verse', content: `Rând ${i}` }] });
    const items = async (id) => (await app.api(owner, 'GET', `/api/events/${id}`)).body.items;

    for (const [lang, width, role] of [['ro', 375, 'presenter'], ['en', 1024, 'owner']]) {
      const tag = `[${lang} ${width}]`;
      const p = await signIn(role, { width, lang });
      await p.goto(`${app.url}/events`);
      await p.waitForSelector('#new-event:not([hidden])');
      const head = await p.evaluate(() => ({
        buttons: [...document.querySelectorAll('.page-head-actions button:not(.secondary)')].map((b) => b.textContent.trim()),
        plan: Boolean(document.querySelector('.page-head-actions #plan-events.secondary:not([hidden])')),
        width: document.getElementById('new-event').getBoundingClientRect().width,
        main: document.querySelector('main').getBoundingClientRect().width,
        dialog: Boolean(document.getElementById('create-dialog')),
        tabs: [...document.querySelectorAll('[role="tab"]')].map((b) => b.id),
      }));
      // phones: "+ Eveniment nou" shares the row with the secondary "Planifică" (about half each)
      check(head.buttons.length === 1 && head.plan && !head.dialog && (width > 600 || head.width > head.main * 0.45) && head.tabs.join() === 'tab-upcoming,tab-past',
        `${tag} /events: one primary "+ Eveniment nou" (+ the secondary "Planifică"), two tabs, no templates`, head);
      await p.click('#new-event');
      await p.waitForSelector('#new-dialog[open] .plan-day[aria-pressed="true"]');
      await p.click('#new-create');
      await p.waitForURL(/\/events\/\d+\/edit$/);
      await p.waitForSelector('#items .item-main, #setlist-empty:not([hidden])');
      if (width < 600) { await p.click('#event-more'); await wait(150); }
      await p.click('#details-button');
      await p.waitForSelector('#quick-details[open]:not([hidden])');
      const id = Number(new URL(p.url()).pathname.split('/')[2]);
      await p.waitForFunction(() => document.querySelectorAll('#q-copy option').length > 1);
      const sources = await p.evaluate(() => [...document.querySelectorAll('#quick-details [data-source]')].map((b) => `${b.dataset.source}:${b.getAttribute('aria-pressed')}`));
      check(sources.join(',') === 'copy:false,empty:false' && await p.isHidden('#q-copy-field') && !(await p.locator('#q-template').count()),
        `${tag} Detalii open: "Program de la" with Copie / Gol, nothing selected, no template picker`, sources);
      const fields = await p.evaluate(() => ['q-name', 'q-date', 'q-time', 'q-notes'].map((i) => Boolean(document.getElementById(i))));
      check(fields.every(Boolean), `${tag} name, date, time and notes on the card`);
      const a = await layoutAudit(p, '#quick-details');
      check(!a.overflow && !a.small.length, `${tag} the card: no overflow, targets >= 44 px`, a);
      // the date and time inputs stay in their own columns (an iPad: the card is half the page)
      const cols = await p.evaluate(() => {
        const r = (i) => document.getElementById(i).getBoundingClientRect();
        const [d, t, n] = [r('q-date'), r('q-time'), r('q-notes')];
        return { dateEnd: Math.round(d.right), timeStart: Math.round(t.left), timeEnd: Math.round(t.right), notesStart: Math.round(n.left), sameRow: Math.abs(d.top - t.top) < 4 };
      });
      check(cols.sameRow && cols.dateEnd <= cols.timeStart && (cols.notesStart >= cols.timeEnd || cols.notesStart <= cols.dateEnd - 1), `${tag} date and time side by side, never overlapping`, cols);
      // the new event starts with random songs; a copy of a past event replaces them (after asking) with new ids
      const start = (await items(id)).length;
      check(start >= 1 && (await items(id)).every((it) => it.type === 'song'), `${tag} the new event starts with ${start} random songs`);
      await p.click('#quick-details [data-source="copy"]');
      await p.waitForSelector('#q-copy-field:not([hidden])');
      const options = await p.evaluate(() => [...document.querySelectorAll('#q-copy option')].map((o) => o.textContent));
      check(options.some((o) => /Trecut/.test(o)), `${tag} "Copie a evenimentului": the past events`, options);
      await p.selectOption('#q-copy', String(past.id));
      await p.waitForFunction(() => document.querySelectorAll('#items li').length === 2, null, { timeout: 5000 });
      const copied = await items(id);
      check(copied.length === 2 && copied.map((it) => it.type).join(',') === 'song,announcement' && copied.every((it) => !pastItems.includes(it.id)) && /Trecut/.test(await p.textContent('#quick-message')), `${tag} the copy has the past event's items with new ids`, copied.map((it) => it.id));
      check((await items(past.id)).length === 2, `${tag} the past event keeps its own items`);
      // Gol: a confirmation, then empty
      await p.click('#quick-details [data-source="empty"]');
      await p.waitForSelector('#replace-dialog[open]');
      check(/(Golești|Empty)/.test(await p.textContent('#replace-heading')), `${tag} "Gol" asks first`, await p.textContent('#replace-heading'));
      await p.click('#replace-dialog [data-close]');
      await wait(200);
      check((await items(id)).length === 2 && (await p.getAttribute('#quick-details [data-source="copy"]', 'aria-pressed')) === 'true', `${tag} "Renunță" keeps the Program`);
      await p.click('#quick-details [data-source="empty"]');
      await p.waitForSelector('#replace-dialog[open]');
      await p.click('#replace-yes');
      await p.waitForFunction(() => document.querySelectorAll('#items li').length === 0, null, { timeout: 5000 });
      check((await items(id)).length === 0 && (await p.getAttribute('#quick-details [data-source="empty"]', 'aria-pressed')) === 'true' && !(await p.isHidden('#setlist-empty')), `${tag} "Gol" empties the Program after the confirmation`);
      // an edited Program: a copy asks first
      await p.click('[data-add="verse"]');
      await p.waitForSelector('#items li');
      await p.click('#quick-details [data-source="copy"]');
      await p.waitForSelector('#q-copy-field:not([hidden])');
      await p.selectOption('#q-copy', String(past.id));
      await p.waitForSelector('#replace-dialog[open]');
      check(/(Înlocuiești|Replace)/.test(await p.textContent('#replace-heading')), `${tag} an edited Program: the copy asks first`);
      await p.click('#replace-yes');
      await p.waitForFunction(() => document.querySelectorAll('#items li').length === 2, null, { timeout: 5000 });
      check((await items(id)).length === 2, `${tag} confirmed: the past event's 2 items`);
      // notes save inline; the row reopens from the header
      await p.fill('#q-notes', `Note ${lang}`);
      await p.press('#q-notes', 'Tab');
      await p.waitForFunction(() => /Salvat|Saved/.test(document.getElementById('quick-message').textContent), null, { timeout: 4000 });
      check((await app.api(owner, 'GET', `/api/events/${id}`)).body.event.notes === `Note ${lang}`, `${tag} notes save inline`);
      await p.evaluate(() => { document.getElementById('quick-details').open = false; });
      if (width < 600) { await p.click('#event-more'); await wait(150); }
      await p.click('#details-button');
      await wait(300);
      check(await p.evaluate(() => document.getElementById('quick-details').open) && !(await p.locator('#details-dialog').count()), `${tag} "Detalii" in the header reopens the card (no separate dialog)`);
      check(await p.evaluate(() => !document.getElementById('template-button') && !document.getElementById('template-dialog')), `${tag} no "Salvează ca șablon", no template dialog`);
      await p.context().close();
    }

    // Home's quick action: the same one tap.
    const o = await signIn('owner', { width: 1024 });
    await o.waitForSelector('#quick-section a[href="/events?new=1"]');
    await o.click('#quick-section a[href="/events?new=1"]');
    await o.waitForSelector('#new-dialog[open]', { timeout: 8000 });
    await o.click('#new-create');
    await o.waitForURL(/\/events\/\d+\/edit$/, { timeout: 8000 });
    check(true, 'home "+ Eveniment nou": the form, then the editor');
    // the API: apply-copy refuses itself; clear works; the template routes are gone
    const nid = Number(new URL(o.url()).pathname.split('/')[2]);
    check((await app.api(owner, 'POST', `/api/events/${nid}/apply-copy`, { fromEventId: nid })).status === 400, 'apply-copy: itself is refused');
    check((await app.api(app.cookies.member, 'POST', `/api/events/${nid}/clear`, {})).status === 403, 'clear: members 403');
    const gone = [(await app.api(owner, 'POST', `/api/events/${nid}/save-as-template`, { name: 'X' })).status, (await app.api(owner, 'POST', `/api/events/${nid}/apply-template`, { templateId: past.id })).status];
    check(gone.every((s) => s === 404), 'save-as-template and apply-template no longer exist', gone);
  },
};
