'use strict';

// Consent before the leader takes the projector: in split mode with an operator connected,
// the leader's "Control comun" shows "Cerere trimisă… N s" with "Anulează" (still split); the
// console gets a toast "Lider cere controlul proiectorului" (Acceptă / Refuză, Enter accepts
// when focused) and a badge on the switch; refuse -> "Operatorul a refuzat", still split;
// accept -> together on both ("ce schimbi aici apare pe proiector" on the leader page);
// cancel; the big lyrics show the state; the owner asks like the leader; the operator direct
// both ways ("Control comun" hands over: the leader is told); no operator -> taken at once, the
// leader is told; expiry after 60 s. RO / EN; 375 / 1024 / 1440.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'handover',
  timeout: 300000,
  async run({ app, signIn, check }) {
    const { eventId: E } = app.seed;
    check((await app.command({ type: 'event.start' })).ok, 'the event is live');
    const mode = async () => (await app.state()).mode;
    const lp = await signIn('leader', { width: 1024 });
    await lp.goto(`${app.url}/events/${E}/live?view=full`); // the leader lands in the big lyrics otherwise
    await lp.waitForSelector('#live:not([hidden])');
    const op = await signIn('operator', { width: 1440 });
    await op.goto(`${app.url}/events/${E}/operator`);
    await op.waitForSelector('#console:not([hidden])');
    await op.click('#mode-controls [data-value="split"]');
    await op.waitForFunction(() => document.getElementById('mode-banner').dataset.mode === 'split');
    await lp.waitForFunction(() => document.querySelector('#mode-controls [data-value="split"]').getAttribute('aria-pressed') === 'true');
    check(/operatorului.*accepte/.test(await lp.textContent('#mode-controls .mode-hint')), 'leader, split: "Proiectorul e al operatorului; el trebuie să accepte"');
    check(/al tău.*predă/.test(await op.textContent('#mode-controls .mode-hint')), 'console, split: "Proiectorul e al tău … Control comun îl predă"');
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
    check(await mode() === 'together' && await op.isHidden('.handover-toast'), 'Enter accepts: together on both, nothing pending');
    check(/acceptat.*apare pe proiector/.test(await lp.textContent('#mode-controls .handover-line')) && /apare pe proiector/.test(await lp.textContent('#mode-controls .mode-hint')), 'the leader is told: "Operatorul a acceptat: ce schimbi aici apare pe proiector"', await lp.textContent('#mode-controls .handover-line'));
    check(/predat.*îl mută și ei/.test(await op.textContent('#mode-controls .mode-hint')), 'console, together: "Proiectorul e predat …"');
    const noticeGone = await lp.waitForFunction(() => document.querySelector('#mode-controls .handover-line').hidden, null, { timeout: 10000 }).then(() => true, () => false);
    check(noticeGone, 'the notice disappears after 8 s');
    // cancel
    await op.click('#mode-controls [data-value="split"]');
    await lp.waitForFunction(() => document.querySelector('#mode-controls [data-value="split"]').getAttribute('aria-pressed') === 'true');
    await lp.click('#mode-controls [data-value="together"]');
    await op.waitForSelector('.handover-toast:not([hidden])');
    await lp.click('#mode-controls .handover-line button');
    await op.waitForFunction(() => document.querySelector('.handover-toast').hidden, null, { timeout: 3000 });
    await lp.waitForFunction(() => document.querySelector('#mode-controls .handover-line').hidden, null, { timeout: 3000 }).catch(() => {});
    const afterCancel = { mode: await mode(), lineHidden: await lp.isHidden('#mode-controls .handover-line'), handover: (await app.state()).handover, line: await lp.textContent('#mode-controls .handover-line') };
    check(afterCancel.mode === 'split' && afterCancel.lineHidden && afterCancel.handover === null, 'the leader cancels: the toast goes, still split, nothing pending', afterCancel);
    // the operator switches directly, both ways; "Control comun" hands the projector over: the leader is told
    await op.click('#mode-controls [data-value="together"]');
    await op.waitForFunction(() => document.getElementById('mode-banner').dataset.mode === 'together');
    await lp.waitForSelector('#mode-controls .handover-line:not([hidden])', { timeout: 3000 }).catch(() => {});
    check(/Operator a predat proiectorul.*apare pe proiector/.test(await lp.textContent('#mode-controls .handover-line')), 'the operator hands over: "Operator a predat proiectorul: ce schimbi aici apare pe proiector" on the leader page', await lp.textContent('#mode-controls .handover-line'));
    await op.click('#mode-controls [data-value="split"]');
    await op.waitForFunction(() => document.getElementById('mode-banner').dataset.mode === 'split');
    await lp.waitForFunction(() => document.querySelector('#mode-controls [data-value="split"]').getAttribute('aria-pressed') === 'true');
    check(await op.isHidden('.handover-toast') && await op.isHidden('#mode-controls .handover-line'), 'the operator switches directly, both ways, no line on the console');
    // the owner asks like the leader; the console answers
    const own = await signIn('owner', { width: 1024 });
    await own.goto(`${app.url}/events/${E}/live`);
    await own.waitForSelector('#live:not([hidden])');
    await own.waitForFunction(() => document.querySelector('#mode-controls [data-value="split"]').getAttribute('aria-pressed') === 'true');
    await own.click('#mode-controls [data-value="together"]');
    await own.waitForSelector('#mode-controls .handover-line:not([hidden])');
    await op.waitForSelector('.handover-toast:not([hidden])');
    check(await mode() === 'split' && /Cerere trimisă/.test(await own.textContent('#mode-controls .handover-line')) && /Ana cere controlul/.test(await op.textContent('.handover-toast p')), 'the owner asks too: "Cerere trimisă", the console gets "Ana cere controlul proiectorului"');
    check(await own.isHidden('.handover-toast'), 'the owner never gets the approver\'s toast');
    await op.click('.handover-toast button:has-text("Acceptă")');
    await own.waitForFunction(() => document.querySelector('#mode-controls [data-value="together"]').getAttribute('aria-pressed') === 'true', null, { timeout: 3000 });
    check(await mode() === 'together' && /acceptat.*apare pe proiector/.test(await own.textContent('#mode-controls .handover-line')), 'accepted: together, the owner is told what it means');
    await own.context().close();
    await op.click('#mode-controls [data-value="split"]');
    await op.waitForFunction(() => document.getElementById('mode-banner').dataset.mode === 'split');
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
    // the console's own tick hides the toast within a second of the leader's line
    const toastGone = await op.waitForFunction(() => document.querySelector('.handover-toast').hidden, null, { timeout: 3000 }).then(() => true, () => false);
    check(expired && toastGone && await mode() === 'split' && (await app.state()).handover === null, 'expiry after 60 s: silent, still split', { expired, toastGone });
    // no operator connected: taken at once, and the leader is told what that means
    await op.context().close();
    await wait(500);
    await lp.click('#mode-controls [data-value="together"]');
    await lp.waitForFunction(() => document.querySelector('#mode-controls [data-value="together"]').getAttribute('aria-pressed') === 'true', null, { timeout: 3000 });
    await lp.waitForSelector('#mode-controls .handover-line:not([hidden])', { timeout: 3000 }).catch(() => {});
    check(await mode() === 'together' && /nu e conectat.*ai preluat proiectorul.*apare pe proiector/.test(await lp.textContent('#mode-controls .handover-line')), 'no operator connected: the switch applies at once, "Operatorul nu e conectat — ai preluat proiectorul"', await lp.textContent('#mode-controls .handover-line'));
    await lp.context().close();
    // English
    await app.command({ type: 'live.mode', mode: 'split' });
    const en = await signIn('leader', { width: 1024, lang: 'en' });
    await en.goto(`${app.url}/events/${E}/live?view=full`); // the leader lands in the big lyrics otherwise
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
