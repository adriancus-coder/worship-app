'use strict';

// "Cine" on a sermon / prayer / other item: the leader (RO 375) adds a Rugăciune with a title
// and a person, saves; the Program line shows the person, the saved item carries it; the
// event page (reading) shows "Cine". (The projector frame: scripts/test-lib.js.)

module.exports = {
  name: 'item-who',
  timeout: 180000,
  async run({ app, signIn, check }) {
    const E = app.seed.eventId;
    const p = await signIn('leader', { width: 375, lang: 'ro' });
    await p.goto(`${app.url}/events/${E}/edit`);
    await p.waitForSelector('#add-more-button');
    await p.click('#add-more-button'); // the other types are in the "+ Altele" menu
    await p.click('[data-add="prayer"]');
    await p.waitForSelector('#it-who');
    const labels = await p.$$eval('#it-type option', (os) => os.map((o) => o.textContent));
    check(labels.join('|') === 'Predică|Rugăciune|Altceva', 'the type picker: Predică · Rugăciune · Altceva', labels);
    check(!(await p.$('#it-title')) && !(await p.$('#it-body')) && !(await p.$('#it-duration')), 'a prayer has only "Cine" (no title, text or duration)');
    await p.fill('#it-who', 'Fratele Ion');
    await p.click('#save-button');
    await p.waitForFunction(() => /Salvat/.test(document.querySelector('#save-bar .save-state').textContent));
    const items = (await app.api(app.cookies.owner, 'GET', `/api/events/${E}`)).body.items;
    const mine = items.find((it) => it.type === 'prayer');
    check(mine && mine.title === null && mine.who === 'Fratele Ion', 'saved with "Cine"', mine);
    const line = await p.evaluate(() => [...document.querySelectorAll('#items .item-title')].map((s) => s.textContent).join('|'));
    check(/Fratele Ion/.test(line), 'the person is the Program line\'s title', line);
    // "Cine cântă" on a song: the team's names offered, saved, under the song in the Program
    await p.click('#items li:nth-child(1) .item-main');
    await p.waitForSelector('#it-who[list="who-people"]');
    await p.waitForSelector('datalist#who-people option', { state: 'attached' });
    const offered = await p.$$eval('datalist#who-people option', (os) => os.map((o) => o.value));
    check(offered.includes('Membru') && offered.includes('Lider'), 'a song: "Cine cântă" with the team\'s names offered', offered);
    await p.fill('#it-who', 'Membru');
    await p.click('#save-button');
    await p.waitForFunction(() => /Salvat/.test(document.querySelector('#save-bar .save-state').textContent));
    const first = (await app.api(app.cookies.owner, 'GET', `/api/events/${E}`)).body.items[0];
    check(first.type === 'song' && first.who === 'Membru', 'saved on the song', first);
    check(/Membru/.test(await p.textContent('#items li:nth-child(1) .item-sub, #items li:nth-child(1) .item-meta')), 'the Program line says who sings it');
    await p.context().close();
    // the live page and the console: the singer under the song
    const l = await signIn('leader', { width: 1024, lang: 'ro' });
    await l.goto(`${app.url}/events/${E}/live?view=compact`);
    await l.waitForSelector('#setlist .live-item');
    check(/Membru/.test(await l.textContent('#setlist li:nth-child(1)')), 'the live Program: the singer under the song');
    await l.context().close();

    // reading the event (a member, 1024): "Cine" under the item
    const m = await signIn('member', { width: 1024, lang: 'ro' });
    await m.goto(`${app.url}/events/${E}`);
    await m.waitForSelector('#items .item-main');
    await m.waitForSelector('#items .item-main:has-text("Fratele Ion")');
    check(/Fratele Ion/.test(await m.textContent('#items .item-main:has-text("Fratele Ion") .item-title')), 'reading the event: the person as the title');
    await m.context().close();
  },
};
