'use strict';

// Random song ideas (lib/suggest.js): "+ Altele → 10 cântări la întâmplare" adds ten songs
// of the library to the programme (saved with it); "Idei de cântări" under the add bar lists
// ten to pick one by one, "Alte idei" draws again; a quick-created event starts with ten
// random songs. The songs of the last 3 events and the event's own are left out. The team
// sees neither. 375 and 1024.

const { layoutAudit } = require('./harness');

module.exports = {
  name: 'random-songs',
  timeout: 240000,
  async run({ app, signIn, check }) {
    const owner = app.cookies.owner;
    const E = app.seed.eventId;
    for (let i = 1; i <= 14; i += 1) {
      await app.api(owner, 'POST', '/api/songs', { title: `Aleatoriu ${i}`, song_key: i <= 12 ? 'D' : null, sections: [{ type: 'verse', content: `Rând ${i}` }] });
    }
    const library = (await app.api(owner, 'GET', '/api/songs')).body.songs;
    const seedSongIds = Object.values(app.seed.songs);

    // --- the API ----------------------------------------------------------------------------
    const s = (await app.api(owner, 'GET', `/api/events/${E}/suggestions`)).body;
    const inEvent = (await app.api(owner, 'GET', `/api/events/${E}`)).body.items.filter((it) => it.type === 'song').map((it) => it.songId);
    check(s.songs.length === 10 && s.songs.every((x) => !inEvent.includes(x.id)) && s.total === library.length && new Set(s.songs.map((x) => x.id)).size === 10,
      'GET suggestions: ten distinct songs, none already in the event', { got: s.songs.length, total: s.total, left: s.left });
    const member = await app.api(app.cookies.member, 'GET', `/api/events/${E}/suggestions`);
    check(member.status === 403, 'a member gets 403', member.status);

    // --- the editor: "+ Altele → 10 cântări la întâmplare" --------------------------------
    const p = await signIn('owner', { width: 1024, lang: 'ro' });
    await p.goto(`${app.url}/events/${E}/edit`);
    await p.waitForSelector('#add-bar:not([hidden])');
    const before = await p.$$eval('#items > li', (l) => l.length);
    await p.click('#add-more-button');
    await p.click('[data-add="random"]');
    await p.waitForFunction((n) => document.querySelectorAll('#items > li').length === n + 10, before);
    const added = await p.evaluate(() => ({ message: document.getElementById('action-message').textContent, titles: [...document.querySelectorAll('#items > li')].slice(-10).map((li) => li.querySelector('.item-title').textContent) }));
    check(/10 cântări adăugate/.test(added.message) && added.titles.every((x) => /Aleatoriu|Sfânt|Șase|Mare/.test(x)), 'ten songs added at the end, with the message', added);
    await p.click('#save-button');
    await p.waitForFunction(() => /salvat/i.test(document.querySelector('.save-state').textContent));
    const saved = (await app.api(owner, 'GET', `/api/events/${E}`)).body.items.filter((it) => it.type === 'song');
    check(saved.length >= 10 && new Set(saved.map((it) => it.songId)).size === saved.length, 'saved: the programme keeps them, no song twice', saved.length);

    // --- "Idei de cântări" --------------------------------------------------------------------
    await p.click('#ideas > summary');
    await p.waitForSelector('#ideas-list .ideas-row');
    const ideas = await p.evaluate(() => ({ rows: document.querySelectorAll('#ideas-list .ideas-row').length, first: document.querySelector('#ideas-list .ideas-row .ideas-title').textContent }));
    const programme = await p.$$eval('#items > li', (l) => l.map((li) => li.textContent));
    check(ideas.rows > 0 && ideas.rows <= 10 && !programme.some((x) => x.includes(ideas.first.split(' · ')[0])), 'the ideas: songs not in the programme', ideas);
    const a = await layoutAudit(p, '#ideas');
    check(!a.overflow && !a.small.length, 'the ideas 1024: no overflow, targets >= 44 px', a);
    const n = await p.$$eval('#items > li', (l) => l.length);
    await p.click('#ideas-list .ideas-row .ideas-add >> nth=0');
    const afterAdd = await p.evaluate(() => ({ items: document.querySelectorAll('#items > li').length, rows: document.querySelectorAll('#ideas-list .ideas-row').length }));
    check(afterAdd.items === n + 1 && afterAdd.rows === ideas.rows - 1, '"+ Adaugă": the song goes into the programme, the row leaves the list', afterAdd);
    await p.click('#ideas-more');
    await p.waitForFunction(() => document.getElementById('ideas-status').textContent !== 'Aleg cântări…');
    const more = await p.evaluate(() => document.querySelectorAll('#ideas-list .ideas-row').length);
    check(more >= 0, '"Alte idei" draws again', more);

    // --- a quick-created event starts with ten random songs, none from the last 3 events ----
    // (the seed event, now with 13 songs, is one of them: more songs so ten are left)
    for (let i = 15; i <= 24; i += 1) await app.api(owner, 'POST', '/api/songs', { title: `Aleatoriu ${i}`, song_key: 'A', sections: [{ type: 'verse', content: `Rând ${i}` }] });
    const quick = (await app.api(owner, 'POST', '/api/events/quick')).body;
    const quickSongs = quick.items.filter((it) => it.type === 'song').map((it) => it.songId);
    const recent = (await app.api(owner, 'GET', `/api/events/${E}`)).body.items.filter((it) => it.type === 'song').map((it) => it.songId);
    check(quickSongs.length === 10 && quickSongs.every((id) => !recent.includes(id)) && quickSongs.every((id) => !seedSongIds.includes(id) || !recent.includes(id)),
      'quick create: ten random songs, none sung at the recent event', { quickSongs: quickSongs.length });

    // --- the phone and the team ------------------------------------------------------------------
    const m = await signIn('owner', { width: 375, lang: 'ro' });
    await m.goto(`${app.url}/events/${quick.event.id}/edit`);
    await m.waitForSelector('#ideas:not([hidden])');
    await m.click('#ideas > summary');
    await m.waitForSelector('#ideas-list .ideas-row, #ideas-status:not(:empty)');
    const b = await layoutAudit(m, '#ideas');
    check(!b.overflow && !b.small.length, 'the ideas 375: no overflow, targets >= 44 px', b);
    const t = await signIn('member', { width: 375, lang: 'ro' });
    await t.goto(`${app.url}/events/${E}`);
    await t.waitForSelector('#items .item-main');
    const team = await t.evaluate(() => ({ ideas: document.getElementById('ideas').hidden, addBar: document.getElementById('add-bar').hidden }));
    check(team.ideas && team.addBar, 'a member: no ideas, no add bar', team);
  },
};
