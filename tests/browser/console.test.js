'use strict';

// The operator console: together (moves the one position, the banner says so) and separate
// (moves the projector; "Echipa e la …", W brings the projector to the team), keys → ← B L W,
// additions "Doar pe proiector" / "În setlist" from the library search, the layouts at
// 1440 / 1024 / 375, a member sent away.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'console',
  async run({ app, signIn, check }) {
    const { eventId: E } = app.seed;
    const p = await signIn('operator', { width: 1440 });
    await p.goto(`${app.url}/events/${E}`);
    await p.waitForSelector('#event:not([hidden])');
    await p.goto(`${app.url}/events/${E}/operator`);
    await p.waitForSelector('#console:not([hidden])');
    check(await p.$eval('#mode-banner', (b) => b.dataset.mode) === 'notLive', 'before the start: "Evenimentul nu este live"');
    await p.click('#start-button');
    await p.waitForFunction(() => document.getElementById('mode-banner').dataset.mode === 'together');
    check(true, 'started from the console: banner "Împreună"');
    const s = () => app.state();
    await p.keyboard.press('ArrowRight');
    await wait(300);
    check((await s()).worship.step === 1, 'together: → moves the one main position');
    await p.keyboard.press('b');
    await wait(300);
    check((await s()).projector.source === 'black', 'B: black');
    await p.keyboard.press('b');
    await p.keyboard.press('l');
    await wait(300);
    check((await s()).projector.source === 'logo', 'B again, then L: logo');
    await p.keyboard.press('l');
    await p.click('#mode-controls [data-value="split"]');
    await p.waitForFunction(() => document.getElementById('mode-banner').dataset.mode === 'split');
    check(!(await p.isHidden('#cross')), 'split: "Echipa e la …" with "Sari acolo"');
    await p.keyboard.press('ArrowRight');
    await p.keyboard.press('ArrowRight');
    await wait(400);
    let st = await s();
    check(st.projector.itemId !== st.worship.itemId || st.projector.step !== st.worship.step, 'split: → moves only the projector', { projector: st.projector, worship: st.worship });
    await p.keyboard.press('w');
    await wait(400);
    st = await s();
    check(st.projector.itemId === st.worship.itemId && st.projector.step === st.worship.step, 'W: the projector goes to the team');
    await p.click('#mode-controls [data-value="together"]');
    await p.waitForFunction(() => document.getElementById('mode-banner').dataset.mode === 'together');

    // Additions from the library search
    await p.fill('#add-q', 'mare');
    await p.waitForSelector('#add-songs li');
    await p.click('#add-songs li >> nth=0 >> button:has-text("Doar pe proiector")');
    await p.waitForFunction(() => /proiector/.test(document.getElementById('op-message').textContent + (document.querySelector('#add-songs .row-state') || {}).textContent), null, { timeout: 4000 }).catch(() => {});
    await wait(400);
    check(await p.locator('.op-item.projector-only').count() === 1, '"Doar pe proiector": a projector-only item in the console list');
    const team = (await app.api(app.cookies.member, 'GET', `/api/events/${E}`)).body.items.length;
    check(team === 5, 'the team does not see it', team);
    await p.fill('#add-q', 'sfant');
    await p.waitForSelector('#add-songs li');
    await p.click('#add-songs li >> nth=0 >> button:has-text("În setlist")');
    await wait(600);
    check((await app.api(app.cookies.member, 'GET', `/api/events/${E}`)).body.items.length === 6, '"În setlist": the team sees it at once');
    for (const [w, h] of [[1440, 900], [1024, 768], [375, 800]]) {
      await p.setViewportSize({ width: w, height: h });
      await wait(300);
      const a = await layoutAudit(p, '#console');
      check(!a.overflow && !a.small.length, `${w}px: no overflow, targets >= 44 px`, a);
    }
    const m = await signIn('member', { width: 375 });
    await m.goto(`${app.url}/events/${E}/operator`);
    check(!new URL(m.url()).pathname.endsWith('/operator'), `a member is sent away (${new URL(m.url()).pathname})`);
  },
};
