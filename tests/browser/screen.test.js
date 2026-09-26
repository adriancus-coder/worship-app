'use strict';

// /screen, the projector: pairing with a code, frames following the live position within
// a second, text always inside the 5 % margins (1280x720 and 1920x1080), black, the cursor
// hiding, a server restart that never blanks the screen, revoking, the claim link.

module.exports = {
  name: 'screen',
  timeout: 240000,
  async run({ app, browser, signIn, check }) {
    const { eventId: E } = app.seed;
    const sp = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
    sp.on('pageerror', (err) => check(false, 'screen page error', err.message));
    await sp.goto(`${app.url}/screen`);
    await sp.waitForFunction(() => /\d{3} \d{3}/.test(document.getElementById('pairing-code').textContent));
    const code = (await sp.textContent('#pairing-code')).replace(' ', '');
    const claim = await app.api(app.cookies.owner, 'POST', '/api/screens/claim', { code, name: 'Proiector sală' });
    check(claim.status < 300, `the owner claims the code (${claim.status})`);
    const paired = await sp.waitForSelector('#output:not([hidden])', { timeout: 6000 }).then(() => true, () => false);
    check(paired && await sp.evaluate(() => /^[0-9a-f]{64}$/.test(localStorage.getItem('wa_screen_token'))), 'the screen pairs and keeps its token');

    const out = () => sp.evaluate(() => {
      const o = document.getElementById('output');
      const box = o.querySelector('.projector-text');
      const r = box ? box.getBoundingClientRect() : null;
      return {
        text: o.innerText.replace(/\n+/g, ' / '),
        fits: r ? (r.left >= innerWidth * 0.05 - 1 && r.right <= innerWidth * 0.95 + 1 && r.top >= innerHeight * 0.05 - 1
          && r.bottom <= innerHeight * 0.95 + 1 && box.scrollHeight <= box.clientHeight + 1) : null,
        overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
        chords: /\[|\b(Em|Bm|G\/B)\b/.test(o.innerText),
      };
    });
    const lp = await signIn('leader', { width: 1280 });
    await lp.goto(`${app.url}/events/${E}/live`);
    await lp.waitForSelector('#live:not([hidden])');
    const moveTo = async (label, action, pattern) => {
      const t0 = Date.now();
      await action();
      const ok = await sp.waitForFunction((re) => new RegExp(re).test(document.getElementById('output').innerText), pattern, { timeout: 3000 }).then(() => true, () => false);
      const o = await out();
      check(ok && Date.now() - t0 < 1500, `${label} -> screen "${o.text.slice(0, 40)}" in ${Date.now() - t0} ms`);
      check(!o.chords, `${label}: lyrics only, no chords`);
      return o;
    };
    await moveTo('start', () => lp.click('#start-button'), 'Ne ridici');
    await moveTo('next', () => lp.click('#next-button'), 'Sfânt');
    await moveTo('the verse', () => lp.click('#setlist > li:nth-child(2) > .live-item'), 'Cezar');
    await moveTo('the 6-line song', () => lp.click('#setlist > li:nth-child(3) > .live-item'), 'Primul');
    for (const [w, h] of [[1280, 720], [1920, 1080]]) {
      await sp.setViewportSize({ width: w, height: h });
      await sp.waitForTimeout(300);
      const o = await out();
      check(o.fits && !o.overflow, `${w}x${h}: the 6-line song fits inside the 5 % margins`, o);
    }
    await sp.mouse.move(500, 500);
    await sp.waitForTimeout(2600);
    check(await sp.evaluate(() => document.body.classList.contains('cursor-hidden')), 'the cursor hides after 2 s without moving');
    await lp.keyboard.press('b');
    const black = await sp.waitForFunction(() => document.getElementById('output').innerText === '', null, { timeout: 3000 }).then(() => true, () => false);
    check(black, 'B on the leader page: the screen goes black');
    await lp.keyboard.press('b');
    await sp.waitForFunction(() => /Primul/.test(document.getElementById('output').innerText));

    // A clean server restart: the screen keeps its frame, then reconnects.
    const before = (await out()).text;
    await app.stop();
    await sp.waitForTimeout(1000);
    check((await out()).text === before, 'server stopped: the screen keeps showing the same text');
    await app.start();
    await sp.waitForTimeout(3000);
    check((await out()).text === before && (await app.api(app.cookies.owner, 'GET', '/api/screens')).body.screens.some((s) => s.online), 'server back: the screen is online again, same frame');

    const list = (await app.api(app.cookies.owner, 'GET', '/api/screens')).body.screens;
    await app.api(app.cookies.owner, 'DELETE', `/api/screens/${list[0].id}`);
    const revoked = await sp.waitForFunction(() => /\d{3} \d{3}/.test(document.getElementById('pairing-code').textContent), null, { timeout: 8000 }).then(() => true, () => false);
    check(revoked && await sp.evaluate(() => localStorage.getItem('wa_screen_token') === null), 'revoked: the screen shows a new pairing code, its token is gone');

    const link = (await app.api(app.cookies.leader, 'POST', '/api/screens/auto-claim', { name: 'Fereastra liderului' })).body;
    const win = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    await win.goto(app.url + link.claimUrl);
    check(await win.waitForSelector('#output:not([hidden])', { timeout: 6000 }).then(() => true, () => false), 'the claim link pairs a new window at once');
    const again = await (await browser.newContext()).newPage();
    await again.goto(app.url + link.claimUrl);
    await again.waitForTimeout(1500);
    check(/\d{3} \d{3}/.test(await again.textContent('#pairing-code')), 'the same claim link a second time: only a pairing code');
    const en = await (await browser.newContext({ extraHTTPHeaders: { 'Accept-Language': 'en' } })).newPage();
    await en.goto(`${app.url}/screen`);
    await en.waitForFunction(() => /\d{3} \d{3}/.test(document.getElementById('pairing-code').textContent));
    check(/screen|code/i.test(await en.textContent('#pairing-heading')), 'the pairing screen in English', await en.textContent('#pairing-heading'));
  },
};
