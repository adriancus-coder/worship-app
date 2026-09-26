'use strict';

// The leader's projector panel: the preview shows exactly what the screen shows, the source
// buttons (content / logo / black; B and L toggle), a logo uploaded while "Logo" is on
// appears at once, "Deschide proiectorul" opens a paired /screen window, the screen count.

const fs = require('fs');
const path = require('path');
const { FIXTURES, layoutAudit } = require('./harness');

module.exports = {
  name: 'panel',
  async run({ app, browser, signIn, check }) {
    const { eventId: E } = app.seed;
    const sp = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    await sp.goto(`${app.url}/screen`);
    await sp.waitForFunction(() => /\d{3} \d{3}/.test(document.getElementById('pairing-code').textContent));
    await app.api(app.cookies.owner, 'POST', '/api/screens/claim', { code: (await sp.textContent('#pairing-code')).replace(' ', ''), name: 'Proiector sală' });
    await sp.waitForSelector('#output:not([hidden])', { timeout: 6000 });
    const lp = await signIn('leader', { width: 1280 });
    await lp.goto(`${app.url}/events/${E}/live`);
    await lp.waitForSelector('#live:not([hidden])');
    check(await lp.waitForFunction(() => /Un ecran/.test(document.getElementById('projector-screens').textContent), null, { timeout: 5000 }).then(() => true, () => false), '"Un ecran conectat"');
    const pressed = () => lp.$$eval('[data-source][aria-pressed=true]', (l) => l.map((x) => x.dataset.source).join(','));
    const preview = () => lp.evaluate(() => document.getElementById('projector-preview').innerText.replace(/\n+/g, ' / '));
    const screen = () => sp.evaluate(() => { const o = document.getElementById('output'); return { text: o.innerText.replace(/\n+/g, ' / '), logo: Boolean(o.querySelector('.projector-logo')) }; });
    await lp.click('#start-button');
    await sp.waitForFunction(() => /Ne ridici/.test(document.getElementById('output').innerText));
    await lp.waitForTimeout(300);
    check(await preview() === (await screen()).text && await pressed() === 'content', 'started: preview == screen, "Conținut" selected');
    await lp.click('#next-button');
    await sp.waitForFunction(() => /Sfânt/.test(document.getElementById('output').innerText));
    await lp.waitForTimeout(300);
    check(await preview() === (await screen()).text, 'next: preview == screen');
    await lp.click('[data-source="black"]');
    await lp.waitForTimeout(300);
    check(await pressed() === 'black' && (await screen()).text === '', '"Ecran negru": screen black, the button selected');
    await lp.click('[data-source="logo"]');
    await lp.waitForTimeout(300);
    check(await pressed() === 'logo' && !(await screen()).logo, '"Logo" with no logo uploaded: black');
    await app.api(app.cookies.owner, 'PUT', '/api/settings/logo', fs.readFileSync(path.join(FIXTURES, 'logo.png')), { 'Content-Type': 'image/png' });
    const logo = await sp.waitForSelector('.projector-logo', { timeout: 3000 }).then(() => true, () => false);
    const previewLogo = await lp.waitForSelector('#projector-preview .projector-logo', { timeout: 3000 }).then(() => true, () => false);
    check(logo && previewLogo, 'a logo uploaded while on "Logo" appears on the screen and in the preview');
    await lp.click('[data-source="content"]');
    for (const [key, source] of [['b', 'black'], ['b', 'content'], ['l', 'logo'], ['l', 'content']]) {
      await lp.keyboard.press(key);
      await lp.waitForTimeout(300);
      check(await pressed() === source, `key ${key.toUpperCase()} -> ${source}`);
    }
    // "Deschide proiectorul" is the operator's (and the owner's): hidden for the leader,
    // who still sees the count of screens the operator opens.
    check(await lp.isHidden('#open-projector'), 'leader: no "Deschide proiectorul" button');
    const op = await signIn('owner', { width: 1280 });
    await op.goto(`${app.url}/events/${E}/live`);
    await op.waitForSelector('#open-projector:not([hidden])');
    const [popup] = await Promise.all([op.waitForEvent('popup'), op.click('#open-projector')]);
    await popup.waitForURL('**/screen', { timeout: 5000 });
    check(await popup.waitForSelector('#output:not([hidden])', { timeout: 6000 }).then(() => true, () => false), 'owner: "Deschide proiectorul" opens a paired /screen window');
    check(await lp.waitForFunction(() => /2/.test(document.getElementById('projector-screens').textContent), null, { timeout: 5000 }).then(() => true, () => false), 'the leader\'s panel counts 2 screens');
    await popup.close();
    await op.context().close();
    check(await lp.waitForFunction(() => /Un ecran/.test(document.getElementById('projector-screens').textContent), null, { timeout: 5000 }).then(() => true, () => false), 'popup closed: back to one screen');
    const a = await layoutAudit(lp, '.projector-panel');
    check(!a.overflow && !a.small.length, 'panel: no overflow, targets >= 44 px', a);
    await lp.setViewportSize({ width: 375, height: 800 });
    await lp.waitForTimeout(300);
    check(!(await layoutAudit(lp)).overflow, '375 px: no horizontal overflow');
  },
};
