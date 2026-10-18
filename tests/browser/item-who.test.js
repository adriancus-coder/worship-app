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
    await p.fill('#it-title', 'Pentru bolnavi');
    await p.fill('#it-who', 'Fratele Ion');
    await p.click('#save-bar button:not([disabled])');
    await p.waitForFunction(() => /Salvat/.test(document.querySelector('#save-bar .save-state').textContent));
    const items = (await app.api(app.cookies.owner, 'GET', `/api/events/${E}`)).body.items;
    const mine = items.find((it) => it.type === 'prayer');
    check(mine && mine.title === 'Pentru bolnavi' && mine.who === 'Fratele Ion', 'saved with "Cine"', mine);
    const line = await p.evaluate(() => [...document.querySelectorAll('#items .item-sub')].map((s) => s.textContent).join('|'));
    check(/Fratele Ion/.test(line), 'the Program line shows the person', line);
    await p.context().close();

    // reading the event (a member, 1024): "Cine" under the item
    const m = await signIn('member', { width: 1024, lang: 'ro' });
    await m.goto(`${app.url}/events/${E}`);
    await m.waitForSelector('#items .item-main');
    await m.click('#items .item-main:has-text("Pentru bolnavi")');
    await m.waitForSelector('#detail:not(.is-empty)');
    check(/Cine/.test(await m.textContent('#detail')) && /Fratele Ion/.test(await m.textContent('#detail')), 'reading the event: "Cine: Fratele Ion"');
    await m.context().close();
  },
};
