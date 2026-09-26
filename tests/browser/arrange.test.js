'use strict';

// The arrange sheet: in the editor (long press on a song, or "Aranjează cântarea") add a
// section, move it, change the key, Aplică marks the editor dirty and Salvează stores it;
// tabs below 900 px, columns from 900 px; during live "Aranjează" saves at once and the team
// sees the new order; the team's read-only "Toată cântarea".

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'arrange',
  timeout: 240000,
  async run({ app, signIn, check }) {
    const { eventId: E } = app.seed;
    const codes = () => app.api(app.cookies.owner, 'GET', `/api/events/${E}`).then((r) => r.body.items[0].arrangementResolved.map((x) => x.code).join(' '));
    for (const width of [375, 1280]) {
      const tag = `[${width}]`;
      const p = await signIn('owner', { width });
      await p.goto(`${app.url}/events/${E}/edit`);
      await p.waitForSelector('#items .item-main');
      await p.locator('#items .item-main').first().click();
      await p.click('#opt-arrange');
      await p.waitForSelector('dialog.arrange-sheet[open]');
      const layout = await p.evaluate(() => ({ tabs: getComputedStyle(document.querySelector('.arrange-tabs')).display !== 'none', panels: [...document.querySelectorAll('.arrange-panel')].filter((x) => x.getClientRects().length && !x.hidden).length }));
      check(width < 900 ? layout.tabs : !layout.tabs && layout.panels >= 2, `${tag} ${width < 900 ? 'tabs (Ordinea · Cântarea · Cum va curge)' : 'columns side by side'}`, layout);
      if (width < 900) await p.click('#arrange-tab-song');
      await p.click('.arrange-add >> nth=1'); // + Adaugă the chorus
      if (width < 900) await p.click('#arrange-tab-order');
      const order = await p.$$eval('.arrange-row .step-code', (l) => l.map((x) => x.textContent).join(' '));
      check(order === 'V1 C C', `${tag} "+ Adaugă" appends the chorus`, order);
      await p.click('#arrange-key-up');
      const a = await layoutAudit(p, 'dialog.arrange-sheet');
      check(!a.overflow && !a.small.length, `${tag} the sheet: no overflow, targets >= 44 px`, a);
      await p.click('#arrange-apply');
      await p.waitForSelector('dialog.arrange-sheet', { state: 'detached' }).catch(() => {});
      check(await p.$eval('#save-bar', (x) => x.classList.contains('dirty')), `${tag} Aplică marks the editor unsaved`);
      await p.click('#save-button');
      await p.waitForFunction(() => document.getElementById('save-state').textContent === 'Salvat.');
      const saved = (await app.api(app.cookies.owner, 'GET', `/api/events/${E}`)).body.items[0];
      check(saved.arrangementResolved.length === 3 && saved.transpose === 1, `${tag} saved: 3 steps, key +1`, { codes: saved.arrangementResolved.map((x) => x.code), transpose: saved.transpose });
      // back to the default for the next width (the song is still selected after the save)
      if (await p.getAttribute('#items .item-main >> nth=0', 'aria-expanded') !== 'true') await p.locator('#items .item-main').first().click();
      await p.click('#opt-arrange');
      await p.click('#arrange-reset');
      await p.click('#arrange-key-down');
      await p.click('#arrange-apply');
      await p.click('#save-button');
      await p.waitForFunction(() => document.getElementById('save-state').textContent === 'Salvat.');
      check(await codes() === 'V1 C', `${tag} "Resetează la implicit" + save: the default order again`, await codes());
      await p.context().close();
    }

    // During live: the leader arranges, the change is saved at once and reaches the team.
    check((await app.command({ type: 'event.start' })).ok, 'the event is live');
    const lp = await signIn('leader', { width: 1280 });
    const mp = await signIn('member', { width: 375 });
    await mp.goto(`${app.url}/events/${E}/follow`);
    await mp.waitForSelector('#follow:not([hidden])');
    await lp.goto(`${app.url}/events/${E}/live`);
    await lp.waitForSelector('#setlist .item-arrange');
    await lp.click('#setlist .item-arrange >> nth=0');
    await lp.waitForSelector('dialog.arrange-sheet[open]');
    await lp.click('.arrange-add >> nth=1');
    await lp.click('#arrange-apply');
    // "Aranjamentul a fost salvat.", replaced by "Ordinea s-a schimbat · ești la …" once the order arrives
    check(await lp.waitForFunction(() => /salvat|Ordinea s-a schimbat/i.test(document.getElementById('live-message').textContent), null, { timeout: 4000 }).then(() => true, () => false), 'live: saved ("Aranjamentul a fost salvat." / "Ordinea s-a schimbat")');
    check(await codes() === 'V1 C C', 'live: saved on the server at once', await codes());
    await wait(500);
    await mp.click('#whole-song');
    await mp.waitForSelector('dialog.arrange-sheet.read-only[open]');
    const flow = await mp.$$eval('dialog.arrange-sheet .song-section', (l) => l.length);
    check(flow === 3, 'the team\'s "Toată cântarea": the song in the new order, read-only', flow);
    check(await mp.locator('dialog.arrange-sheet #arrange-apply').count() === 0, 'read-only: no Aplică');
  },
};
