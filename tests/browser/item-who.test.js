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
    await p.waitForSelector('[data-add="prayer"]');
    await p.click('[data-add="prayer"]');
    await p.waitForSelector('#it-who');
    const labels = await p.$$eval('#it-type option', (os) => os.map((o) => o.textContent));
    check(labels.join('|') === 'Predică|Rugăciune|Altceva', 'the type picker: Predică · Rugăciune · Altceva', labels);
    check(!(await p.$('#it-title')) && !(await p.$('#it-body')) && !(await p.$('#it-duration')), 'a prayer has only "Cine" (no title, text or duration)');
    await p.fill('#it-who', 'Fratele Ion');
    await p.click('#save-bar button:not([disabled])');
    await p.waitForFunction(() => /Salvat/.test(document.querySelector('#save-bar .save-state').textContent));
    const items = (await app.api(app.cookies.owner, 'GET', `/api/events/${E}`)).body.items;
    const mine = items.find((it) => it.type === 'prayer');
    check(mine && mine.title === null && mine.who === 'Fratele Ion', 'saved with "Cine"', mine);
    const line = await p.evaluate(() => [...document.querySelectorAll('#items .item-title')].map((s) => s.textContent).join('|'));
    check(/Fratele Ion/.test(line), 'the person is the Program line\'s title', line);
    await p.context().close();

    // reading the event (a member, 1024): "Cine" under the item
    const m = await signIn('member', { width: 1024, lang: 'ro' });
    await m.goto(`${app.url}/events/${E}`);
    await m.waitForSelector('#items .item-main');
    await m.waitForSelector('#items .item-main:has-text("Fratele Ion")');
    check(/Fratele Ion/.test(await m.textContent('#items .item-main:has-text("Fratele Ion") .item-title')), 'reading the event: the person as the title');
    await m.context().close();
  },
};
