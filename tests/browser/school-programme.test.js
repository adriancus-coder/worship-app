'use strict';

// The Sunday school adds its songs to a programme (the 'school' right, routes/events.js):
// on the event page (viewing) "+ Cântare de la școala duminicală" opens the picker on the
// school library only; each song goes in at once, marked "Școala duminicală" under the
// title (the event page, the operator console, the leader's live list); the school takes
// its own songs out with ✕; nothing else of the programme can be touched. API: a church
// song is refused (400), a member has no right (403), a finished event says so (409).
// 375 RO and 1024.

const path = require('path');
const Database = require('better-sqlite3');
const { layoutAudit, PASSWORD, wait } = require('./harness');

module.exports = {
  name: 'school-programme',
  timeout: 240000,
  async run({ app, signIn, check, browser }) {
    const owner = app.cookies.owner;
    const E = app.seed.event2Id; // planned next week
    const role = (await app.api(owner, 'POST', '/api/roles', { name: 'Școala duminicală', emoji: '🎒', base: 'member', perms: ['school'] })).body.role;
    const maria = (await app.api(owner, 'POST', '/api/team', { name: 'Maria', email: 'maria@x.ro', role: `custom:${role.id}` })).body.user;
    const db = new Database(path.join(app.dataDir, 'worship.db'));
    db.prepare("UPDATE users SET password_hash = (SELECT password_hash FROM users WHERE email = 'ana@example.ro'), must_change_password = 0 WHERE id = ?").run(maria.id);
    db.close();
    const school = await app.login('maria@x.ro');
    const kids1 = (await app.api(school, 'POST', '/api/songs', { title: 'Isus mă iubește', sections: [{ type: 'verse', content: 'Isus mă iubește, Biblia îmi spune' }] })).body.song;
    const kids2 = (await app.api(school, 'POST', '/api/songs', { title: 'Ai grijă gură mică', sections: [{ type: 'verse', content: 'Ai grijă gură mică ce vorbești' }] })).body.song;

    // --- the API -------------------------------------------------------------------------
    const church = await app.api(school, 'POST', `/api/events/${E}/items/school`, { songId: app.seed.songs.G });
    check(church.status === 400 && /școlii/.test(church.body.error), 'a church song: 400', church.body);
    check((await app.api(app.cookies.member, 'POST', `/api/events/${E}/items/school`, { songId: kids1.id })).status === 403, 'a member: 403');
    const added = await app.api(school, 'POST', `/api/events/${E}/items/school`, { songId: kids1.id });
    const item = added.body.items.find((it) => it.id === added.body.itemId);
    check(added.status === 201 && item && item.type === 'song' && item.who === 'Școala duminicală' && item.position === added.body.items.length - 1, 'added at the end, marked "Școala duminicală"', item);
    check((await app.api(school, 'PUT', `/api/events/${E}/items`, { items: [] })).status === 403, 'the whole programme stays out of reach (PUT items: 403)');
    const ownItem = (await app.api(owner, 'GET', `/api/events/${E}`)).body.items.find((it) => it.type === 'verse');
    check((await app.api(school, 'DELETE', `/api/events/${E}/items/${ownItem.id}/school`)).status === 404, 'another item: not the school\'s to take out (404)');
    const gone = await app.api(school, 'DELETE', `/api/events/${E}/items/${added.body.itemId}/school`);
    check(gone.status === 200 && !gone.body.items.some((it) => it.id === added.body.itemId), 'its own song taken out');
    const past = (await app.api(owner, 'POST', '/api/events', { name: 'Trecut', eventDate: '2020-01-05' })).body.event;
    await app.api(owner, 'POST', `/api/events/${past.id}/start`, {});
    await app.api(owner, 'POST', `/api/events/${past.id}/end`, {});
    check((await app.api(school, 'POST', `/api/events/${past.id}/items/school`, { songId: kids1.id })).status === 409, 'a finished event: 409');

    // --- the event page as the school: the button, the picker (school songs only), ✕ ----
    for (const width of [375, 1024]) {
      const tag = `[${width}]`;
      const context = await browser.newContext({ viewport: { width, height: width < 600 ? 700 : 820 }, locale: 'ro-RO', hasTouch: width < 600 });
      const p = await context.newPage();
      await p.goto(`${app.url}/login`);
      await p.fill('[name=email]', 'maria@x.ro');
      await p.fill('[name=password]', PASSWORD);
      await p.click('button[type=submit]');
      await p.waitForURL('**/app');
      await p.goto(`${app.url}/events/${E}`);
      await p.waitForSelector('#school-add:not([hidden])');
      check(await p.isHidden('#add-bar') && !(await p.locator('#event-actions a[href*="/edit"]').count()), `${tag} viewing: no editor bar, no "Editează"; the school's button shown`);
      await p.click('#school-add-button');
      await p.waitForSelector('#song-dialog[open]');
      await p.waitForFunction(() => document.querySelectorAll('#pick-songs li').length >= 2);
      const rows = await p.evaluate(() => [...document.querySelectorAll('#pick-songs li')].map((li) => li.querySelector('.song-title').textContent));
      check(rows.length === 2 && rows.every((r) => /Isus mă iubește|Ai grijă/.test(r)) && await p.isHidden('#pick-online-search'), `${tag} the picker: the school's two songs only, no resurse search`, rows);
      const a = await layoutAudit(p, '#song-dialog');
      check(!a.overflow && !a.small.length, `${tag} the picker: no overflow, targets >= 44 px`, a);
      await p.click(`#pick-songs li:has-text("Ai grijă") button`);
      await p.waitForFunction(() => [...document.querySelectorAll('#items .item-title')].some((x) => /Ai grijă/.test(x.textContent)));
      check(await p.evaluate(() => /Adăugată/.test(document.querySelector('#pick-songs li:nth-child(1) button, #pick-songs li button[disabled]').textContent)), `${tag} the row says "Adăugată"`);
      await p.click('#song-dialog-close');
      await wait(200);
      const row = await p.evaluate(() => { const li = [...document.querySelectorAll('#items li')].find((x) => /Ai grijă/.test(x.textContent)); return { sub: li.querySelector('.item-sub') && li.querySelector('.item-sub').textContent, remove: Boolean(li.querySelector('[data-action="school-remove"]')), others: [...document.querySelectorAll('#items li')].filter((x) => !/Ai grijă/.test(x.textContent)).some((x) => x.querySelector('.item-tools')) }; });
      check(/Școala duminicală/.test(row.sub) && row.remove && !row.others, `${tag} the item: "Școala duminicală" under the title, ✕ on it only`, row);
      const srv = (await app.api(owner, 'GET', `/api/events/${E}`)).body.items;
      check(srv.some((it) => it.songId === kids2.id && it.who === 'Școala duminicală'), `${tag} saved on the server at once`);
      await p.click('[data-action="school-remove"]');
      await p.waitForFunction(() => ![...document.querySelectorAll('#items .item-title')].some((x) => /Ai grijă/.test(x.textContent)));
      check(/scoasă/.test(await p.textContent('#action-message')) && !(await app.api(owner, 'GET', `/api/events/${E}`)).body.items.some((it) => it.songId === kids2.id), `${tag} ✕ takes it out, with a message`);
      await context.close();
    }

    // --- the operator sees the mark in the console; the leader's live list too ------------
    await app.api(school, 'POST', `/api/events/${E}/items/school`, { songId: kids1.id });
    const o = await signIn('operator', { width: 1024 });
    await o.goto(`${app.url}/events/${E}/operator`);
    await o.waitForSelector('#op-list li');
    const op = await o.evaluate(() => [...document.querySelectorAll('#op-list li')].map((li) => li.textContent).find((x) => /Isus mă iubește/.test(x)));
    check(op && /Școala duminicală/.test(op), 'the operator console: "Școala duminicală" under the song', op);
    const l = await signIn('leader', { width: 1024 });
    await l.goto(`${app.url}/events/${E}/live`);
    await l.waitForSelector('#setlist li');
    const lv = await l.evaluate(() => [...document.querySelectorAll('#setlist li')].map((li) => li.textContent).find((x) => /Isus mă iubește/.test(x)));
    check(lv && /Școala duminicală/.test(lv), 'the leader\'s live list: the mark too', lv);
    // the editor still sees it as an ordinary song item with "Cine"
    const e = await signIn('owner', { width: 1024 });
    await e.goto(`${app.url}/events/${E}/edit`);
    await e.waitForSelector('#items li');
    check(!(await e.locator('#school-add:not([hidden])').count()), 'the editor: no school button (the editor adds anything)');
  },
};
