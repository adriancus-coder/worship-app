'use strict';

// The Sunday school library (migration 060, the 'school' right): a second library beside the
// church's. The library page switches between them ("Biblioteca: Biserica / Școala
// duminicală", kept in the URL); the editor says which one a song goes into (a choice for
// the library right, fixed for a school-only writer); a role with only the 'school' right
// writes there and nowhere else (403 on the church's songs); the event picker searches both
// and marks the school's; random ideas never draw from the school's. 375 and 1024.

const path = require('path');
const Database = require('better-sqlite3');
const { layoutAudit, PASSWORD } = require('./harness');

module.exports = {
  name: 'school-library',
  timeout: 240000,
  async run({ app, signIn, check, browser }) {
    const owner = app.cookies.owner;
    const E = app.seed.eventId;
    // the role "Școala duminicală" (base member, the school right) and Maria with it
    const role = (await app.api(owner, 'POST', '/api/roles', { name: 'Școala duminicală', emoji: '🎒', base: 'member', perms: ['school'] })).body.role;
    const maria = (await app.api(owner, 'POST', '/api/team', { name: 'Maria', email: 'maria@x.ro', role: `custom:${role.id}` })).body.user;
    const db = new Database(path.join(app.dataDir, 'worship.db'));
    db.prepare("UPDATE users SET password_hash = (SELECT password_hash FROM users WHERE email = 'ana@example.ro'), must_change_password = 0 WHERE id = ?").run(maria.id);
    db.close();
    const school = await app.login('maria@x.ro');
    const me = (await app.api(school, 'GET', '/api/auth/me')).body;
    check(role && role.perms.join() === 'school' && me.user.perms.join() === 'school', 'a custom role with the school right only', { role: role && role.perms, me: me.user.perms });

    // --- the API: where a song lands, and who may touch what ----------------------------------
    const mine = await app.api(school, 'POST', '/api/songs', { title: 'Isus mă iubește', collection: 'main', sections: [{ type: 'verse', content: 'Isus mă iubește, Biblia îmi spune' }] });
    check(mine.status === 201 && mine.body.song.collection === 'school', 'a school-only writer: the song lands in the school library whatever was asked', mine.body.song && mine.body.song.collection);
    const churchSong = app.seed.songs.G;
    check((await app.api(school, 'PUT', `/api/songs/${churchSong}`, { song_key: 'A' })).status === 403 && (await app.api(school, 'DELETE', `/api/songs/${churchSong}`)).status === 403 && (await app.api(school, 'PUT', `/api/songs/${churchSong}/themes`, { themes: ['Copii'] })).status === 403,
      'the church\'s songs: 403 for the school writer (key, delete, themes)');
    check((await app.api(school, 'PUT', `/api/songs/${mine.body.song.id}`, { song_key: 'C' })).status === 200 && (await app.api(school, 'PUT', `/api/songs/${mine.body.song.id}/themes`, { themes: ['Copii'] })).status === 200, 'its own library: edits allowed');
    const moved = await app.api(school, 'PUT', `/api/songs/${mine.body.song.id}`, { title: 'Isus mă iubește', collection: 'main', sections: [{ type: 'verse', content: 'x' }] });
    check(moved.status === 403, 'moving a song into the church library: 403 for the school writer', moved.status);
    const listMain = (await app.api(owner, 'GET', '/api/songs')).body.songs;
    const listSchool = (await app.api(owner, 'GET', '/api/songs?collection=school')).body.songs;
    const listAll = (await app.api(owner, 'GET', '/api/songs?collection=all')).body.songs;
    check(!listMain.some((s) => s.collection === 'school') && listSchool.length === 1 && listSchool[0].collection === 'school' && listAll.length === listMain.length + 1, 'GET songs: the church library by default, ?collection=school, ?collection=all', { main: listMain.length, school: listSchool.length, all: listAll.length });
    const ownerSchool = await app.api(owner, 'POST', '/api/songs', { title: 'Cântec de copii', collection: 'school', sections: [{ type: 'verse', content: 'La, la' }] });
    check(ownerSchool.status === 201 && ownerSchool.body.song.collection === 'school', 'the library right writes into the school library too');
    check((await app.api(school, 'GET', '/api/songs/export')).status === 403, 'the school writer: no export (the owner\'s)');
    const exported = (await app.api(owner, 'GET', '/api/songs/export?collection=school')).body;
    check(exported.songs.length === 2 && exported.songs.every((s) => s.collection === 'school'), 'the owner exports the school library alone', exported.songs.map((s) => s.title));
    const ideas = (await app.api(owner, 'GET', `/api/events/${E}/suggestions`)).body;
    check(!ideas.songs.some((s) => /copii|iubește/i.test(s.title)), 'random ideas: never the school\'s songs', ideas.songs.map((s) => s.title));

    // --- the owner's library page: the switch, the row, "Cântare nouă" into the shown library --
    const p = await signIn('owner', { width: 375, lang: 'ro' });
    await p.goto(`${app.url}/library`);
    await p.waitForSelector('#songs li');
    const church = await p.evaluate(() => ({ pressed: document.querySelector('#collection-switch [aria-pressed="true"]').dataset.collection, rows: [...document.querySelectorAll('#songs li')].map((li) => li.textContent), href: document.getElementById('new-song').getAttribute('href') }));
    check(church.pressed === 'main' && !church.rows.some((x) => /copii/i.test(x)) && church.href === '/songs/new', 'the library opens on the church\'s: no school songs; "Cântare nouă" plain', church);
    await p.click('#collection-switch [data-collection="school"]');
    await p.waitForFunction(() => document.querySelectorAll('#songs li').length === 2);
    const schoolTab = await p.evaluate(() => ({ url: location.search, rows: [...document.querySelectorAll('#songs li')].map((li) => li.querySelector('.song-title').textContent), href: document.getElementById('new-song').getAttribute('href'), exportHref: document.getElementById('export-library').getAttribute('href') }));
    check(/collection=school/.test(schoolTab.url) && schoolTab.rows.length === 2 && schoolTab.href === '/songs/new?collection=school' && /collection=school/.test(schoolTab.exportHref), 'the school tab: its two songs, the URL, "Cântare nouă" and the export aimed there', schoolTab);
    const a = await layoutAudit(p, '#library-collections');
    check(!a.overflow && !a.small.length, 'the switch 375: no overflow, targets >= 44 px', a);
    // the editor: the choice, preselected from the tab
    await p.click('#new-song');
    await p.waitForSelector('#song-key-collection-label');
    const choice = await p.evaluate(() => ({ shown: !document.querySelector('.editor-collection-field').hidden, pressed: document.querySelector('.editor-collection [aria-pressed="true"]').dataset.collection }));
    check(choice.shown && choice.pressed === 'school', 'the editor (library right): "Biblioteca: Biserica / Școala duminicală", the school preselected from the tab', choice);
    await p.fill('#song-title', 'Cântec nou de școală');
    await p.fill('#sections-editor textarea', 'Rând');
    await p.click('#save');
    await p.waitForURL(/\/songs\/\d+$/);
    const created = Number(new URL(p.url()).pathname.split('/')[2]);
    check((await app.api(owner, 'GET', `/api/songs/${created}`)).body.song.collection === 'school', 'saved into the school library');

    // --- the school writer's pages: the school tab first, no choice in the editor -----------
    const context = await browser.newContext({ viewport: { width: 1024, height: 820 }, locale: 'ro-RO' });
    const s = await context.newPage();
    await s.goto(`${app.url}/login`);
    await s.fill('[name=email]', 'maria@x.ro');
    await s.fill('[name=password]', PASSWORD);
    await s.click('button[type=submit]');
    await s.waitForURL('**/app');
    await s.goto(`${app.url}/library`);
    await s.waitForSelector('#songs li');
    const writer = await s.evaluate(() => ({ pressed: document.querySelector('#collection-switch [aria-pressed="true"]').dataset.collection, newSong: !document.getElementById('new-song').hidden, rows: document.querySelectorAll('#songs li').length }));
    check(writer.pressed === 'school' && writer.newSong && writer.rows === 3, 'the school writer: the library opens on the school\'s, "Cântare nouă" shown', writer);
    await s.click('#collection-switch [data-collection="main"]');
    await s.waitForFunction(() => document.querySelector('#collection-switch [aria-pressed="true"]').dataset.collection === 'main');
    await s.waitForFunction(() => document.getElementById('new-song').hidden);
    check(!(await s.locator('#songs .song-themes-quick').count()), 'on the church tab: no "Cântare nouă", no quick "Tematică" on the rows');
    await s.goto(`${app.url}/songs/${churchSong}`);
    await s.waitForSelector('#song-key-box');
    check(await s.isHidden('#edit-song') && !(await s.locator('#song-key-box .song-key-change').count()), 'a church song page: no "Editează", no key setter for the school writer');
    await s.goto(`${app.url}/songs/${created}/edit`);
    await s.waitForSelector('#song-title');
    check(await s.evaluate(() => document.querySelector('.editor-collection-field').hidden), 'the school writer\'s editor: no library choice (fixed)');
    await context.close();

    // --- the event picker: both libraries, the school's marked ------------------------------
    const o = await signIn('owner', { width: 1024, lang: 'ro' });
    await o.goto(`${app.url}/events/${E}/edit`);
    await o.waitForSelector('#add-bar:not([hidden])');
    await o.click('[data-add="song"]');
    await o.waitForSelector('#song-dialog[open]');
    await o.fill('#pick-q', 'copii');
    await o.waitForFunction(() => [...document.querySelectorAll('#pick-songs li')].some((li) => /Cântec de copii/.test(li.textContent)));
    const row = await o.evaluate(() => [...document.querySelectorAll('#pick-songs li')].find((li) => /Cântec de copii/.test(li.textContent)).textContent);
    check(/Școala duminicală/.test(row), 'the picker finds the school song and marks it', row);
  },
};
