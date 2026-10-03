'use strict';

// The operator console: started from the console the operator holds the projector ("Proiectorul
// e al tău": moves the projector; "Echipa e la …", W brings the projector to the team); handed
// to the owner the console moves the one position (the banner says whose the projector is);
// keys → ← B L W, additions "Doar pe proiector" / "În setlist" from the library search, the
// layouts at 1440 / 1024 / 375, a member sent away.

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
    await p.waitForFunction(() => document.getElementById('mode-banner').dataset.mode === 'split');
    check(/Proiectorul e al tău/.test(await p.textContent('#mode-title')), 'started from the console: the operator holds the projector, banner "Proiectorul e al tău"');
    const s = () => app.state();
    check((await s()).holder.role === 'operator', 'the state names the operator as the holder');
    // handed to the owner (connected through the test socket): the console moves the one position
    const own = await signIn('owner', { width: 1024 });
    await own.goto(`${app.url}/events/${E}/live`);
    await own.waitForSelector('#live:not([hidden])');
    await p.waitForFunction(() => !document.getElementById('projector-action').disabled, null, { timeout: 5000 });
    await p.click('#projector-action');
    await p.waitForSelector('.handover-pick:not([hidden])');
    check(/Predă lui Ana \(Proprietar\)/.test(await p.textContent('.handover-pick')), '"Predă controlul proiectorului" lists the owner connected', await p.textContent('.handover-pick'));
    await p.click('.handover-pick button');
    await p.waitForFunction(() => document.getElementById('mode-banner').dataset.mode === 'together');
    check(/Proiectorul e la Ana/.test(await p.textContent('#mode-title')), 'handed over: banner "Proiectorul e la Ana (Proprietar)"', await p.textContent('#mode-title'));
    await own.waitForSelector('#mode-controls .handover-line:not([hidden])', { timeout: 3000 }).catch(() => {});
    check(/Operator ți-a predat proiectorul.*apare pe proiector/.test(await own.textContent('#mode-controls .handover-line')), 'the owner is told: "Operator ți-a predat proiectorul: ce schimbi aici apare pe proiector"', await own.textContent('#mode-controls .handover-line'));
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
    // the operator asks for it back; the owner accepts
    await p.click('#projector-action');
    await own.waitForSelector('.handover-toast:not([hidden])', { timeout: 3000 });
    check(/Operator cere controlul proiectorului/.test(await own.textContent('.handover-toast p')), 'the owner gets "Operator cere controlul proiectorului"');
    await own.click('.handover-toast button:has-text("Acceptă")');
    await p.waitForFunction(() => document.getElementById('mode-banner').dataset.mode === 'split');
    check(!(await p.isHidden('#cross')), 'accepted: the projector is the operator\'s again, "Echipa e la …" with "Sari acolo"');
    await p.keyboard.press('ArrowRight');
    await p.keyboard.press('ArrowRight');
    await wait(400);
    let st = await s();
    check(st.projector.itemId !== st.worship.itemId || st.projector.step !== st.worship.step, 'split: → moves only the projector', { projector: st.projector, worship: st.worship });
    await p.keyboard.press('w');
    await wait(400);
    st = await s();
    check(st.projector.itemId === st.worship.itemId && st.projector.step === st.worship.step, 'W: the projector goes to the team');
    await own.context().close();
    await app.takeProjector('owner'); // the console moves the one position again
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
