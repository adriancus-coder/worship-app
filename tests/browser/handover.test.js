'use strict';

// The projector has a holder; anyone else asks for it, the holder hands it over. With the
// operator holding it (console open) the leader's "Cere controlul proiectorului" shows "Cerere
// trimisă… N s" with "Anulează"; the console gets a toast "Lider cere controlul proiectorului"
// (Acceptă / Refuză, Enter accepts when focused) and a badge; refuse -> "Operator a refuzat";
// accept -> the leader holds it (together), told "ai proiectorul. Ce schimbi aici apare pe
// proiector"; the operator asks it back the same way; cancel; "Predă controlul proiectorului"
// lists the people connected; the owner asks like anyone else; the big lyrics show the state;
// expiry after 60 s; the holder away -> taken at once. RO / EN; 375 / 1024 / 1440.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'handover',
  timeout: 300000,
  async run({ app, signIn, check }) {
    const { eventId: E } = app.seed;
    check((await app.command({ type: 'event.start' })).ok, 'the event is live');
    const holder = async () => { const s = await app.state(); return s.holder ? s.holder.role : null; };
    const lp = await signIn('leader', { width: 1024 });
    await lp.goto(`${app.url}/events/${E}/live?view=full`); // the leader lands in the big lyrics otherwise
    await lp.waitForSelector('#live:not([hidden])');
    const op = await signIn('operator', { width: 1440 });
    await op.goto(`${app.url}/events/${E}/operator`);
    await op.waitForSelector('#console:not([hidden])');
    // the owner started it from a socket that is gone: the operator takes it at once
    await op.click('#projector-action');
    await op.waitForFunction(() => document.getElementById('mode-banner').dataset.mode === 'split');
    await lp.waitForFunction(() => /Operator/.test(document.getElementById('holder-text').textContent));
    check(await holder() === 'operator' && /Operator \(Operator\)/.test(await lp.textContent('#holder-text')), 'the operator takes the projector (the owner is away): "Proiectorul: Operator (Operator)" on the leader page');
    check(/la Operator.*consolă/.test(await lp.textContent('#mode-controls .mode-hint')) && (await lp.textContent('#projector-action')).trim() === 'Cere controlul proiectorului', 'leader: the hint says the operator moves it from the console; the action is "Cere controlul proiectorului"');
    check(/Proiectorul e al tău/.test(await op.textContent('#mode-title')) && (await op.textContent('#projector-action')).trim() === 'Predă controlul proiectorului', 'console: "Proiectorul e al tău", the action is "Predă controlul proiectorului"');
    // the request
    await lp.click('#projector-action');
    await lp.waitForSelector('#mode-controls .handover-line:not([hidden])');
    const line = await lp.textContent('#mode-controls .handover-line p');
    check(/Cerere trimisă… (5\d|60) s/.test(line) && await holder() === 'operator', `leader: "${line}", the operator still holds it`);
    const toast = await op.waitForSelector('.handover-toast:not([hidden])', { timeout: 3000 }).then(() => true, () => false);
    check(toast && /Lider cere controlul proiectorului/.test(await op.textContent('.handover-toast p')) && !(await op.isHidden('#mode-controls .handover-badge')), 'console: the toast and the badge on the row');
    check(await op.evaluate(() => document.activeElement.textContent === 'Acceptă'), 'console: "Acceptă" has the focus (Enter accepts)');
    const gridFree = await op.evaluate(() => {
      const t = document.querySelector('.handover-toast').getBoundingClientRect();
      const g = document.getElementById('op-steps').getBoundingClientRect();
      return t.right < g.left || t.left > g.right || t.bottom < g.top || t.top > g.bottom;
    });
    check(gridFree, 'the toast never covers the step grid');
    const a = await layoutAudit(op, '.handover-toast');
    check(!a.overflow && !a.small.length, 'toast: no overflow, targets >= 44 px', a);
    await wait(2100); // the first tick lands within a second; ceil keeps 60 for a moment
    const later = await lp.textContent('#mode-controls .handover-line p');
    check(Number(/(\d+) s/.exec(later)[1]) < Number(/(\d+) s/.exec(line)[1]), 'the countdown runs', { line, later });
    // refuse
    await op.click('.handover-toast button:has-text("Refuză")');
    await lp.waitForFunction(() => /refuzat/.test(document.querySelector('#mode-controls .handover-line').textContent));
    check(await holder() === 'operator' && /Operator a refuzat/.test(await lp.textContent('#mode-controls .handover-line')) && await op.isHidden('.handover-toast') && await op.isHidden('#mode-controls .handover-badge'), 'refuse: "Operator a refuzat" on the leader page, the operator keeps it, the toast is gone');
    const gone = await lp.waitForFunction(() => document.querySelector('#mode-controls .handover-line').hidden, null, { timeout: 7000 }).then(() => true, () => false);
    check(gone, 'the refusal disappears after 5 s');
    // request again, big lyrics show it, Enter accepts
    await lp.click('#projector-action');
    await lp.waitForSelector('#mode-controls .handover-line:not([hidden])');
    await lp.keyboard.press('f');
    await lp.waitForSelector('dialog.big-lyrics[open]');
    check(/Cerere trimisă/.test(await lp.textContent('dialog.big-lyrics .big-status')), 'big lyrics: the pending request in the status line');
    await lp.keyboard.press('Escape');
    await op.waitForSelector('.handover-toast:not([hidden])');
    await op.focus('.handover-toast button:has-text("Acceptă")');
    await op.keyboard.press('Enter');
    await lp.waitForFunction(() => /Lider \(Lider\)/.test(document.getElementById('holder-text').textContent), null, { timeout: 3000 });
    check(await holder() === 'leader' && await op.isHidden('.handover-toast'), 'Enter accepts: the leader holds the projector, nothing pending');
    check(/Operator a acceptat: ai proiectorul.*apare pe proiector/.test(await lp.textContent('#mode-controls .handover-line')) && /e al tău.*apare pe proiector/.test(await lp.textContent('#mode-controls .mode-hint')), 'the leader is told: "Operator a acceptat: ai proiectorul. Ce schimbi aici apare pe proiector"', await lp.textContent('#mode-controls .handover-line'));
    check(/Proiectorul e la Lider/.test(await op.textContent('#mode-title')) && await op.$eval('#mode-banner', (b) => b.dataset.mode) === 'together', 'console: banner "Proiectorul e la Lider (Lider)", one position');
    const noticeGone = await lp.waitForFunction(() => document.querySelector('#mode-controls .handover-line').hidden, null, { timeout: 10000 }).then(() => true, () => false);
    check(noticeGone, 'the notice disappears after 8 s');
    // the operator asks it back the same way; the leader's page answers
    await op.click('#projector-action');
    await lp.waitForSelector('.handover-toast:not([hidden])', { timeout: 3000 });
    check(/Operator cere controlul proiectorului/.test(await lp.textContent('.handover-toast p')), 'the operator asks: the leader page gets "Operator cere controlul proiectorului"');
    await lp.click('.handover-toast button:has-text("Acceptă")');
    await op.waitForFunction(() => document.getElementById('mode-banner').dataset.mode === 'split');
    check(await holder() === 'operator' && await lp.isHidden('.handover-toast'), 'accepted: the operator holds it again');
    // cancel
    await lp.click('#projector-action');
    await op.waitForSelector('.handover-toast:not([hidden])');
    await lp.click('#mode-controls .handover-line button');
    await op.waitForFunction(() => document.querySelector('.handover-toast').hidden, null, { timeout: 3000 });
    await lp.waitForFunction(() => document.querySelector('#mode-controls .handover-line').hidden, null, { timeout: 3000 }).catch(() => {});
    const afterCancel = { holder: await holder(), lineHidden: await lp.isHidden('#mode-controls .handover-line'), handover: (await app.state()).handover };
    check(afterCancel.holder === 'operator' && afterCancel.lineHidden && afterCancel.handover === null, 'the leader cancels: the toast goes, the operator keeps it, nothing pending', afterCancel);
    // "Predă controlul proiectorului": the console lists the people connected, the leader is told
    await op.click('#projector-action');
    await op.waitForSelector('.handover-pick:not([hidden])');
    check(/Predă lui Lider \(Lider\)/.test(await op.textContent('.handover-pick')), '"Predă controlul proiectorului" lists "Predă lui Lider (Lider)"', await op.textContent('.handover-pick'));
    await op.click('.handover-pick button:has-text("Lider")');
    await lp.waitForFunction(() => /Lider \(Lider\)/.test(document.getElementById('holder-text').textContent), null, { timeout: 3000 });
    await lp.waitForSelector('#mode-controls .handover-line:not([hidden])', { timeout: 3000 }).catch(() => {});
    check(await holder() === 'leader' && /Operator ți-a predat proiectorul.*apare pe proiector/.test(await lp.textContent('#mode-controls .handover-line')), 'handed over: the leader holds it and is told "Operator ți-a predat proiectorul: ce schimbi aici apare pe proiector"', await lp.textContent('#mode-controls .handover-line'));
    check(await op.isHidden('.handover-pick') && await op.isHidden('#mode-controls .handover-line'), 'console: the list closes, no line there');
    // the owner asks like anyone else; the holder (the leader) answers
    const own = await signIn('owner', { width: 1024 });
    await own.goto(`${app.url}/events/${E}/live`);
    await own.waitForSelector('#live:not([hidden])');
    await own.waitForFunction(() => /Lider/.test(document.getElementById('holder-text').textContent));
    await own.click('#projector-action');
    await own.waitForSelector('#mode-controls .handover-line:not([hidden])');
    await lp.waitForSelector('.handover-toast:not([hidden])', { timeout: 3000 });
    check(await holder() === 'leader' && /Cerere trimisă/.test(await own.textContent('#mode-controls .handover-line')) && /Ana cere controlul/.test(await lp.textContent('.handover-toast p')), 'the owner asks too: "Cerere trimisă", the leader gets "Ana cere controlul proiectorului"');
    check(await own.isHidden('.handover-toast') && await op.isHidden('.handover-toast'), 'nobody but the holder gets the toast');
    await lp.click('.handover-toast button:has-text("Acceptă")');
    await own.waitForFunction(() => /Ana \(Proprietar\)/.test(document.getElementById('holder-text').textContent), null, { timeout: 3000 });
    check(await holder() === 'owner' && /Lider a acceptat: ai proiectorul/.test(await own.textContent('#mode-controls .handover-line')), 'accepted: the owner holds it and is told what it means');
    await op.waitForSelector('#mode-controls .handover-line:not([hidden])', { timeout: 3000 }).catch(() => {});
    check(/Ana are acum proiectorul/.test(await op.textContent('#mode-controls .handover-line')), 'the others see "Ana are acum proiectorul"', await op.textContent('#mode-controls .handover-line'));
    // 375 / 1440: the leader's request line (the owner holds it, connected)
    for (const width of [375, 1440]) {
      await lp.setViewportSize({ width, height: width < 600 ? 740 : 900 });
      await lp.click('#projector-action');
      await lp.waitForSelector('#mode-controls .handover-line:not([hidden])');
      const b = await layoutAudit(lp, '#mode-controls');
      check(!b.overflow && !b.small.length, `${width}: the request line, no overflow, targets >= 44 px`, b);
      await lp.click('#mode-controls .handover-line button');
      await lp.waitForFunction(() => document.querySelector('#mode-controls .handover-line').hidden);
    }
    await own.context().close();
    await wait(500);
    // the operator takes it (the owner is away): at once
    await op.click('#projector-action');
    await op.waitForFunction(() => document.getElementById('mode-banner').dataset.mode === 'split', null, { timeout: 3000 });
    check(await holder() === 'operator', 'the owner gone: the operator takes it at once');
    // expiry: after 60 s the request is gone on both sides, silently, the operator keeps it
    await lp.click('#projector-action');
    await op.waitForSelector('.handover-toast:not([hidden])');
    const expired = await lp.waitForFunction(() => document.querySelector('#mode-controls .handover-line').hidden, null, { timeout: 65000 }).then(() => true, () => false);
    const toastGone = await op.waitForFunction(() => document.querySelector('.handover-toast').hidden, null, { timeout: 3000 }).then(() => true, () => false);
    check(expired && toastGone && await holder() === 'operator' && (await app.state()).handover === null, 'expiry after 60 s: silent, the operator keeps it', { expired, toastGone });
    // the holder away: taken at once, and the leader is told what that means
    await op.context().close();
    await wait(500);
    await lp.click('#projector-action');
    await lp.waitForFunction(() => /Lider \(Lider\)/.test(document.getElementById('holder-text').textContent), null, { timeout: 3000 });
    await lp.waitForSelector('#mode-controls .handover-line:not([hidden])', { timeout: 3000 }).catch(() => {});
    check(await holder() === 'leader' && /nu era conectat.*ai preluat proiectorul.*apare pe proiector/.test(await lp.textContent('#mode-controls .handover-line')), 'the holder not connected: taken at once, "Deținătorul nu era conectat — ai preluat proiectorul"', await lp.textContent('#mode-controls .handover-line'));
    await lp.context().close();
    // English
    const en = await signIn('leader', { width: 1024, lang: 'en' });
    await en.goto(`${app.url}/events/${E}/live?view=full`); // the leader lands in the big lyrics otherwise
    await en.waitForSelector('#live:not([hidden])');
    const opEn = await signIn('operator', { width: 1024, lang: 'en' });
    await opEn.goto(`${app.url}/events/${E}/operator`);
    await opEn.waitForSelector('#console:not([hidden])');
    await app.takeProjector('operator');
    await en.waitForFunction(() => /Operator/.test(document.getElementById('holder-text').textContent));
    check(/with Operator.*console/.test(await en.textContent('#mode-controls .mode-hint')) && (await en.textContent('#projector-action')).trim() === 'Ask for control of the projector', 'EN: the explanation and the action');
    await en.click('#projector-action');
    await en.waitForSelector('#mode-controls .handover-line:not([hidden])');
    await opEn.waitForSelector('.handover-toast:not([hidden])');
    check(/Request sent…/.test(await en.textContent('#mode-controls .handover-line p')) && /asks for control/.test(await opEn.textContent('.handover-toast p')), 'EN: request and toast');
    await opEn.click('.handover-toast button:has-text("Refuse")');
    await en.waitForFunction(() => /refused/.test(document.querySelector('#mode-controls .handover-line').textContent));
    check(true, 'EN: "Operator refused"');
  },
};
