'use strict';

// "+ Eveniment nou": one button on /events (full width on phones, no "Cu opțiuni"); the
// editor opens with "Detalii" open: name, date, time, notes and "Program de la" (Șablon /
// Copie a evenimentului / Gol). Switching the template replaces the items; a copy of a past
// event copies its items with new ids; "Gol" empties after a confirmation; the row reopens
// from the header. Home's quick action does the same. RO 375 / EN 1024.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'event-new',
  timeout: 240000,
  async run({ app, signIn, check }) {
    const { eventId: E, event2Id: E2, today } = app.seed;
    const owner = app.cookies.owner;
    const tpl = (await app.api(owner, 'POST', `/api/events/${E}/save-as-template`, { name: 'Șablon duminică' })).body.event;
    const tpl2 = (await app.api(owner, 'POST', `/api/events/${E2}/save-as-template`, { name: 'Șablon seară' })).body.event;
    // A past event with 2 items (finished last week).
    const lastWeek = new Date(`${today}T12:00:00Z`);
    lastWeek.setUTCDate(lastWeek.getUTCDate() - 7);
    const past = (await app.api(owner, 'POST', '/api/events', { name: 'Trecut', eventDate: lastWeek.toISOString().slice(0, 10) })).body.event;
    await app.api(owner, 'PUT', `/api/events/${past.id}/items`, { items: [{ type: 'song', songId: app.seed.songs.T3 }, { type: 'announcement', title: 'Anunț vechi', body: 'x' }] });
    await app.api(owner, 'POST', `/api/events/${past.id}/start`, {});
    await app.api(owner, 'POST', `/api/events/${past.id}/end`, {});
    const pastItems = (await app.api(owner, 'GET', `/api/events/${past.id}`)).body.items.map((it) => it.id);
    const items = async (id) => (await app.api(owner, 'GET', `/api/events/${id}`)).body.items;

    for (const [lang, width, role] of [['ro', 375, 'presenter'], ['en', 1024, 'owner']]) {
      const tag = `[${lang} ${width}]`;
      const p = await signIn(role, { width, lang });
      await p.goto(`${app.url}/events`);
      await p.waitForSelector('#new-event:not([hidden])');
      const head = await p.evaluate(() => ({
        buttons: [...document.querySelectorAll('.page-head-actions button')].map((b) => b.textContent.trim()),
        width: document.getElementById('new-event').getBoundingClientRect().width,
        main: document.querySelector('main').getBoundingClientRect().width,
        dialog: Boolean(document.getElementById('create-dialog')),
      }));
      check(head.buttons.length === 1 && !head.dialog && (width > 600 || head.width > head.main * 0.8), `${tag} /events: only "+ Eveniment nou"${width < 600 ? ', full width' : ''}`, head);
      await p.click('#new-event');
      await p.waitForURL(/\/events\/\d+\/edit$/);
      await p.waitForSelector('#quick-details[open]:not([hidden])');
      const id = Number(new URL(p.url()).pathname.split('/')[2]);
      await p.waitForFunction(() => document.querySelectorAll('#q-template option').length > 1);
      const sources = await p.evaluate(() => [...document.querySelectorAll('#quick-details [data-source]')].map((b) => `${b.dataset.source}:${b.getAttribute('aria-pressed')}`));
      check(sources.join(',') === 'template:true,copy:false,empty:false' && !(await p.isHidden('#q-template-field')) && await p.isHidden('#q-copy-field'), `${tag} Detalii open: "Program de la" with Șablon selected (the last used) and its picker`, sources);
      check([String(tpl.id), String(tpl2.id)].includes(await p.inputValue('#q-template')), `${tag} the template picker shows the last used template`, await p.inputValue('#q-template'));
      const fields = await p.evaluate(() => ['q-name', 'q-date', 'q-time', 'q-notes'].map((i) => Boolean(document.getElementById(i))));
      check(fields.every(Boolean), `${tag} name, date, time and notes on the card`);
      const a = await layoutAudit(p, '#quick-details');
      check(!a.overflow && !a.small.length, `${tag} the card: no overflow, targets >= 44 px`, a);
      // template switch: the items are replaced (E2's template has 1 item, E's 5)
      const current = await p.inputValue('#q-template');
      const other = current === String(tpl.id) ? tpl2 : tpl;
      const expectedCount = other.id === tpl.id ? 5 : 1;
      await p.selectOption('#q-template', String(other.id));
      await p.waitForFunction((n) => document.querySelectorAll('#items li').length === n, expectedCount, { timeout: 5000 });
      check((await items(id)).length === expectedCount && /(șablon|template)/i.test(await p.textContent('#quick-message')), `${tag} switching the template replaces the Program (${expectedCount} items)`);
      // copy of a past event: the same items with new ids
      await p.click('#quick-details [data-source="copy"]');
      await p.waitForSelector('#q-copy-field:not([hidden])');
      const options = await p.evaluate(() => [...document.querySelectorAll('#q-copy option')].map((o) => o.textContent));
      check(options.some((o) => /Trecut/.test(o)) && !options.some((o) => /Șablon/.test(o)), `${tag} "Copie a evenimentului": the past events, no templates`, options);
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
      // an edited Program: the template switch asks first
      await p.click('#quick-details [data-source="template"]');
      await p.click('[data-add="verse"]');
      await p.waitForSelector('#items li');
      await p.selectOption('#q-template', String(tpl.id));
      await p.waitForSelector('#replace-dialog[open]');
      check(/(Înlocuiești|Replace)/.test(await p.textContent('#replace-heading')), `${tag} an edited Program: the template switch asks first`);
      await p.click('#replace-yes');
      await p.waitForFunction(() => document.querySelectorAll('#items li').length === 5, null, { timeout: 5000 });
      check((await items(id)).length === 5, `${tag} confirmed: the template's 5 items`);
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
      await p.context().close();
    }

    // Home's quick action: the same one tap.
    const o = await signIn('owner', { width: 1024 });
    await o.waitForSelector('#quick-section a[href="/events?new=1"]');
    await o.click('#quick-section a[href="/events?new=1"]');
    await o.waitForURL(/\/events\/\d+\/edit$/, { timeout: 8000 });
    await o.waitForSelector('#quick-details[open]:not([hidden])');
    check(true, 'home "+ Eveniment nou": the editor with Detalii open');
    // the API: apply-copy refuses templates / itself / another admin; clear works
    const nid = Number(new URL(o.url()).pathname.split('/')[2]);
    check((await app.api(owner, 'POST', `/api/events/${nid}/apply-copy`, { fromEventId: tpl.id })).status === 400, 'apply-copy: a template is refused');
    check((await app.api(owner, 'POST', `/api/events/${nid}/apply-copy`, { fromEventId: nid })).status === 400, 'apply-copy: itself is refused');
    check((await app.api(app.cookies.member, 'POST', `/api/events/${nid}/clear`, {})).status === 403, 'clear: members 403');
  },
};
