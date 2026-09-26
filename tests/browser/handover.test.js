'use strict';

// Consent before the leader takes the projector: in split mode with an operator connected,
// the leader's "Împreună" shows "Cerere trimisă… N s" with "Anulează" (still split); the
// console gets a toast "Lider cere controlul proiectorului" (Acceptă / Refuză, Enter accepts
// when focused) and a badge on the switch; refuse -> "Operatorul a refuzat", still split;
// accept -> together on both; cancel; the big lyrics show the state; no operator ->
// immediate; the owner immediate; the operator direct both ways; expiry after 60 s. RO / EN;
// 375 / 1024 / 1440.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'handover',
  timeout: 300000,
  async run({ app, signIn, check }) {
    const { eventId: E } = app.seed;
    check((await app.command({ type: 'event.start' })).ok, 'the event is live');
    const mode = async () => (await app.state()).mode;
    const lp = await signIn('leader', { width: 1024 });
    await lp.goto(`${app.url}/events/${E}/live`);
    await lp.waitForSelector('#live:not([hidden])');
    const op = await signIn('operator', { width: 1440 });
    await op.goto(`${app.url}/events/${E}/operator`);
    await op.waitForSelector('#console:not([hidden])');
    await op.click('#mode-controls [data-value="split"]');
    await op.waitForFunction(() => document.getElementById('mode-banner').dataset.mode === 'split');
    await lp.waitForFunction(() => document.querySelector('#mode-controls [data-value="split"]').getAttribute('aria-pressed') === 'true');
    check(/operator/.test(await lp.textContent('#mode-controls .mode-hint')), 'leader, split: "Proiectorul e la operator; el trebuie să accepte"');
    // the request
    await lp.click('#mode-controls [data-value="together"]');
    await lp.waitForSelector('#mode-controls .handover-line:not([hidden])');
    const line = await lp.textContent('#mode-controls .handover-line p');
    check(/Cerere trimisă… (5\d|60) s/.test(line) && await mode() === 'split', `leader: "${line}", still split`);
    const toast = await op.waitForSelector('.handover-toast:not([hidden])', { timeout: 3000 }).then(() => true, () => false);
    check(toast && /Lider cere controlul proiectorului/.test(await op.textContent('.handover-toast p')) && !(await op.isHidden('#mode-controls .handover-badge')), 'console: the toast and the badge on the switch');
    check(await op.evaluate(() => document.activeElement.textContent === 'Acceptă'), 'console: "Acceptă" has the focus (Enter accepts)');
    const gridFree = await op.evaluate(() => {
      const t = document.querySelector('.handover-toast').getBoundingClientRect();
      const g = document.getElementById('op-steps').getBoundingClientRect();
      return t.right < g.left || t.left > g.right || t.bottom < g.top || t.top > g.bottom;
    });
    check(gridFree, 'the toast never covers the step grid');
    const a = await layoutAudit(op, '.handover-toast');
    check(!a.overflow && !a.small.length, 'toast: no overflow, targets >= 44 px', a);
    await wait(1100);
    check(Number(/(\d+) s/.exec(await lp.textContent('#mode-controls .handover-line p'))[1]) < Number(/(\d+) s/.exec(line)[1]), 'the countdown runs');
    // refuse
    await op.click('.handover-toast button:has-text("Refuză")');
    await lp.waitForFunction(() => /refuzat/.test(document.querySelector('#mode-controls .handover-line').textContent));
    check(await mode() === 'split' && await op.isHidden('.handover-toast') && await op.isHidden('#mode-controls .handover-badge'), 'refuse: "Operatorul a refuzat" on the leader page, still split, the toast is gone');
    const gone = await lp.waitForFunction(() => document.querySelector('#mode-controls .handover-line').hidden, null, { timeout: 7000 }).then(() => true, () => false);
    check(gone, 'the refusal disappears after 5 s');
    // request again, big lyrics show it, Enter accepts
    await lp.click('#mode-controls [data-value="together"]');
    await lp.waitForSelector('#mode-controls .handover-line:not([hidden])');
    await lp.keyboard.press('f');
    await lp.waitForSelector('dialog.big-lyrics[open]');
    check(/Cerere trimisă/.test(await lp.textContent('dialog.big-lyrics .big-status')), 'big lyrics: the pending request in the status line');
    await lp.keyboard.press('Escape');
    await op.waitForSelector('.handover-toast:not([hidden])');
    await op.focus('.handover-toast button:has-text("Acceptă")');
    await op.keyboard.press('Enter');
    await lp.waitForFunction(() => document.querySelector('#mode-controls [data-value="together"]').getAttribute('aria-pressed') === 'true', null, { timeout: 3000 });
    check(await mode() === 'together' && await lp.isHidden('#mode-controls .handover-line') && await op.isHidden('.handover-toast'), 'Enter accepts: together on both, nothing pending');
    // cancel
    await op.click('#mode-controls [data-value="split"]');
    await lp.waitForFunction(() => document.querySelector('#mode-controls [data-value="split"]').getAttribute('aria-pressed') === 'true');
    await lp.click('#mode-controls [data-value="together"]');
    await op.waitForSelector('.handover-toast:not([hidden])');
    await lp.click('#mode-controls .handover-line button');
    await op.waitForFunction(() => document.querySelector('.handover-toast').hidden, null, { timeout: 3000 });
    check(await mode() === 'split' && await lp.isHidden('#mode-controls .handover-line') && (await app.state()).handover === null, 'the leader cancels: the toast goes, still split, nothing pending');
    // the operator switches directly, both ways
    await op.click('#mode-controls [data-value="together"]');
    await op.waitForFunction(() => document.getElementById('mode-banner').dataset.mode === 'together');
    await op.click('#mode-controls [data-value="split"]');
    await op.waitForFunction(() => document.getElementById('mode-banner').dataset.mode === 'split');
    check(await op.isHidden('.handover-toast') && await lp.isHidden('#mode-controls .handover-line'), 'the operator switches directly, both ways');
    // the owner: immediate
    const own = await signIn('owner', { width: 1024 });
    await own.goto(`${app.url}/events/${E}/live`);
    await own.waitForSelector('#live:not([hidden])');
    await own.click('#mode-controls [data-value="together"]');
    await own.waitForFunction(() => document.querySelector('#mode-controls [data-value="together"]').getAttribute('aria-pressed') === 'true');
    check(await mode() === 'together' && await own.isHidden('#mode-controls .handover-line') && await op.isHidden('.handover-toast'), 'the owner: immediate');
    await own.context().close();
    // 375 / 1440: the leader's line
    await op.click('#mode-controls [data-value="split"]');
    await lp.waitForFunction(() => document.querySelector('#mode-controls [data-value="split"]').getAttribute('aria-pressed') === 'true');
    for (const width of [375, 1440]) {
      await lp.setViewportSize({ width, height: width < 600 ? 740 : 900 });
      await lp.click('#mode-controls [data-value="together"]');
      await lp.waitForSelector('#mode-controls .handover-line:not([hidden])');
      const b = await layoutAudit(lp, '#mode-controls');
      check(!b.overflow && !b.small.length, `${width}: the request line, no overflow, targets >= 44 px`, b);
      await lp.click('#mode-controls .handover-line button');
      await lp.waitForFunction(() => document.querySelector('#mode-controls .handover-line').hidden);
    }
    // expiry: after 60 s the request is gone on both sides, silently, still split
    await lp.click('#mode-controls [data-value="together"]');
    await op.waitForSelector('.handover-toast:not([hidden])');
    const expired = await lp.waitForFunction(() => document.querySelector('#mode-controls .handover-line').hidden, null, { timeout: 65000 }).then(() => true, () => false);
    check(expired && await op.isHidden('.handover-toast') && await mode() === 'split' && (await app.state()).handover === null, 'expiry after 60 s: silent, still split');
    // no operator / owner connected: immediate
    await op.context().close();
    await wait(500);
    await lp.click('#mode-controls [data-value="together"]');
    await lp.waitForFunction(() => document.querySelector('#mode-controls [data-value="together"]').getAttribute('aria-pressed') === 'true', null, { timeout: 3000 });
    check(await mode() === 'together' && await lp.isHidden('#mode-controls .handover-line'), 'no operator connected: the switch applies at once');
    await lp.context().close();
    // English
    await app.command({ type: 'live.mode', mode: 'split' });
    const en = await signIn('leader', { width: 1024, lang: 'en' });
    await en.goto(`${app.url}/events/${E}/live`);
    await en.waitForSelector('#live:not([hidden])');
    const opEn = await signIn('operator', { width: 1024, lang: 'en' });
    await opEn.goto(`${app.url}/events/${E}/operator`);
    await opEn.waitForSelector('#console:not([hidden])');
    check(/operator’s/.test(await en.textContent('#mode-controls .mode-hint')), 'EN: the explanation under the switch');
    await en.click('#mode-controls [data-value="together"]');
    await en.waitForSelector('#mode-controls .handover-line:not([hidden])');
    await opEn.waitForSelector('.handover-toast:not([hidden])');
    check(/Request sent…/.test(await en.textContent('#mode-controls .handover-line p')) && /asks for control/.test(await opEn.textContent('.handover-toast p')), 'EN: request and toast');
    await opEn.click('.handover-toast button:has-text("Refuse")');
    await en.waitForFunction(() => /refused/.test(document.querySelector('#mode-controls .handover-line').textContent));
    check(true, 'EN: "The operator refused"');
  },
};
