'use strict';

// The time and the elapsed time on the live pages (public/live-clock.js): "HH:MM · Live de
// hh:mm" on the leader page, the console and in the big lyrics; a tap switches to "pe
// elementul curent de mm:ss" (reset when the item changes); ticks every second without
// re-rendering the page; RO / EN; the 12 h setting changes every clock, the projector's too;
// 375 / 1024 / 1440 without overflow, 44 px targets.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'live-clock',
  timeout: 180000,
  async run({ app, browser, signIn, check }) {
    const { eventId: E, items } = app.seed;
    check((await app.command({ type: 'event.start' })).ok, 'the event is live');
    const sp = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    await sp.goto(`${app.url}/screen`);
    await sp.waitForFunction(() => /\d{3} \d{3}/.test(document.getElementById('pairing-code').textContent));
    await app.api(app.cookies.owner, 'POST', '/api/screens/claim', { code: (await sp.textContent('#pairing-code')).replace(' ', ''), name: 'Proiector' });
    await sp.waitForSelector('#output:not([hidden])', { timeout: 6000 });
    const read = (p, root) => p.evaluate((root) => {
      const node = document.querySelector(root);
      const c = node && (node.matches('.live-clock') ? node : node.querySelector('.live-clock'));
      const b = c && c.querySelector('.live-elapsed');
      return c ? { time: c.querySelector('.live-time').textContent, elapsed: b && !b.hidden ? b.textContent : null } : null;
    }, root);

    const lp = await signIn('leader', { width: 1024 });
    await lp.goto(`${app.url}/events/${E}/live`);
    await lp.waitForSelector('#live:not([hidden])');
    await lp.waitForSelector('#live-clock .live-elapsed:not([hidden])');
    let c = await read(lp, '#live-clock');
    check(c && /^\d\d:\d\d$/.test(c.time) && /^Live de \d\d:\d\d$/.test(c.elapsed), `leader page: "${c && c.time} · ${c && c.elapsed}"`, c);
    // tap: the current item's time, ticking every second, no re-render of the page
    await lp.evaluate(() => { document.querySelector('#setlist li').dataset.mark = '1'; });
    await lp.click('#live-clock .live-elapsed');
    c = await read(lp, '#live-clock');
    check(c && /^pe elementul curent de \d\d:\d\d$/.test(c.elapsed), `tap: "${c && c.elapsed}"`, c);
    const seconds = (text) => Number((/(\d\d):(\d\d)$/.exec(text) || [])[2]);
    const s0 = seconds(c.elapsed);
    await wait(2100);
    const c2 = await read(lp, '#live-clock');
    const kept = await lp.evaluate(() => document.querySelector('#setlist li').dataset.mark === '1');
    check(seconds(c2.elapsed) >= s0 + 2 && kept, `ticks every second (${s0} -> ${seconds(c2.elapsed)} s) without re-rendering the page`);
    // another item: the item time starts again
    await app.command({ type: 'worship.goto', itemId: items[1], step: 0 });
    await lp.waitForFunction(() => /Luca 2:1-7/.test(document.getElementById('current').textContent));
    c = await read(lp, '#live-clock');
    check(seconds(c.elapsed) <= 1, `a new item: the item time starts at 0 ("${c.elapsed}")`);
    await lp.click('#live-clock .live-elapsed');
    c = await read(lp, '#live-clock');
    check(/^Live de /.test(c.elapsed), 'tap again: back to "Live de"');
    // the big lyrics view shows the same
    await lp.keyboard.press('f');
    await lp.waitForSelector('dialog.big-lyrics[open]');
    c = await read(lp, 'dialog.big-lyrics .big-status');
    check(c && /^\d\d:\d\d$/.test(c.time) && /^Live de /.test(c.elapsed), `big lyrics: "${c && c.time} · ${c && c.elapsed}"`, c);
    const a = await layoutAudit(lp, 'dialog.big-lyrics');
    check(!a.overflow && !a.small.length, 'big lyrics: no overflow, targets >= 44 px', a);
    await lp.keyboard.press('Escape');
    // the console: the item the console drives
    const op = await signIn('operator', { width: 1024 });
    await op.goto(`${app.url}/events/${E}/operator`);
    await op.waitForSelector('#console:not([hidden])');
    await op.waitForSelector('#live-clock .live-elapsed:not([hidden])');
    c = await read(op, '#live-clock');
    check(c && /^\d\d:\d\d$/.test(c.time) && /^Live de \d\d:\d\d$/.test(c.elapsed), `console: "${c && c.time} · ${c && c.elapsed}"`, c);
    await op.click('#live-clock .live-elapsed');
    c = await read(op, '#live-clock');
    check(/^pe elementul curent de /.test(c.elapsed), 'console: tap -> the current item');
    await op.click('#live-clock .live-elapsed');
    await op.context().close();
    // English
    const en = await signIn('leader', { width: 1024, lang: 'en' });
    await en.goto(`${app.url}/events/${E}/live`);
    await en.waitForSelector('#live-clock .live-elapsed:not([hidden])');
    c = await read(en, '#live-clock');
    check(/^Live for \d\d:\d\d$/.test(c.elapsed), `EN: "${c.elapsed}"`);
    await en.click('#live-clock .live-elapsed');
    c = await read(en, '#live-clock');
    check(/^on the current item for /.test(c.elapsed), `EN tap: "${c.elapsed}"`);
    await en.click('#live-clock .live-elapsed');
    await en.context().close();
    // 12 h: every clock, the projector's too; back to 24 h
    await app.api(app.cookies.owner, 'PUT', '/api/settings/time-format', { format: '12' });
    const twelve = await lp.waitForFunction(() => /^\d{1,2}:\d\d [AP]M$/.test(document.querySelector('#live-clock .live-time').textContent), null, { timeout: 3000 }).then(() => true, () => false);
    const screen12 = await sp.waitForFunction(() => /^\d{1,2}:\d\d [AP]M$/.test(document.querySelector('#output .display-clock').textContent), null, { timeout: 3000 }).then(() => true, () => false);
    check(twelve && screen12, '12 h: the leader page and the projector switch at once', { page: await read(lp, '#live-clock'), screen: await sp.textContent('#output .display-clock') });
    await app.api(app.cookies.owner, 'PUT', '/api/settings/time-format', { format: '24' });
    check(await sp.waitForFunction(() => /^\d\d:\d\d$/.test(document.querySelector('#output .display-clock').textContent), null, { timeout: 3000 }).then(() => true, () => false), 'back to 24 h');
    // widths
    for (const width of [375, 1024, 1440]) {
      await lp.setViewportSize({ width, height: width < 600 ? 740 : 820 });
      await wait(300);
      const audit = await layoutAudit(lp, '.live-meta');
      check(!audit.overflow && !audit.small.length, `${width} px: no overflow, the elapsed toggle >= 44 px`, audit);
    }
  },
};
