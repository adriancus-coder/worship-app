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
    const preview = () => lp.evaluate(() => document.querySelector('#projector-preview .projector-stage').innerText.replace(/\n+/g, ' / '));
    const screen = () => sp.evaluate(() => { const o = document.getElementById('output'); return { text: o.querySelector('.projector-stage').innerText.replace(/\n+/g, ' / '), logo: Boolean(o.querySelector('.projector-logo')) }; });
    await lp.click('#start-button');
    await sp.waitForFunction(() => /Ne ridici/.test(document.querySelector('#output .projector-stage').innerText));
    await lp.waitForTimeout(300);
    check(await preview() === (await screen()).text && await pressed() === 'content', 'started: preview == screen, "Conținut" selected');
    await lp.click('#next-button');
    await sp.waitForFunction(() => /Sfânt/.test(document.querySelector('#output .projector-stage').innerText));
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
    // The corner clock: on by default at the bottom right, 180 %, HH:MM; the preview shows the
    // same; K hides / shows it on both within a second; the corners and the size from the panel.
    const clockOn = (p, root) => p.evaluate((root) => {
      const c = document.querySelector(`${root} .display-clock`);
      if (!c || c.hidden) return null;
      const r = c.getBoundingClientRect();
      const box = c.parentElement.getBoundingClientRect();
      return { text: c.textContent, corner: c.className.replace('display-clock ', ''), scale: c.parentElement.style.getPropertyValue('--clock-scale'),
        right: box.right - r.right < box.width / 3, bottom: box.bottom - r.bottom < box.height / 3, font: parseFloat(getComputedStyle(c).fontSize) };
    }, root);
    let sc = await clockOn(sp, '#output');
    let pc = await clockOn(lp, '#projector-preview');
    check(sc && /^\d\d:\d\d$/.test(sc.text) && sc.corner === 'bottom-right' && sc.scale === '1.8' && sc.right && sc.bottom, 'the screen shows HH:MM at the bottom right, 180 %', sc);
    check(pc && pc.text === sc.text && pc.corner === sc.corner && pc.font < sc.font, 'the preview shows the same clock, scaled down', { pc, sc });
    await lp.keyboard.press('k');
    const hidden = await sp.waitForFunction(() => document.querySelector('#output .display-clock').hidden, null, { timeout: 1000 }).then(() => true, () => false);
    check(hidden && !(await clockOn(lp, '#projector-preview')) && await lp.getAttribute('.clock-toggle', 'aria-pressed') === 'false', 'K: the clock disappears on the screen and in the preview within a second, "Ceas" off');
    await lp.keyboard.press('k');
    check(await sp.waitForFunction(() => !document.querySelector('#output .display-clock').hidden, null, { timeout: 1000 }).then(() => true, () => false), 'K again: back');
    for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
      await lp.click(`[data-corner="${corner}"]`);
      const moved = await sp.waitForFunction((c) => document.querySelector('#output .display-clock').classList.contains(c), corner, { timeout: 3000 }).then(() => true, () => false);
      sc = await clockOn(sp, '#output');
      const inCorner = sc && (corner.startsWith('top') ? !sc.bottom : sc.bottom) && (corner.endsWith('left') ? !sc.right : sc.right);
      check(moved && inCorner && await lp.getAttribute(`[data-corner="${corner}"]`, 'aria-pressed') === 'true', `corner ${corner} on the screen, selected in the panel`, sc);
    }
    const big = (await clockOn(sp, '#output')).font;
    await lp.fill('#clock-scale', '70');
    await lp.dispatchEvent('#clock-scale', 'change');
    await sp.waitForFunction(() => document.getElementById('output').style.getPropertyValue('--clock-scale') === '0.7', null, { timeout: 1000 }).catch(() => {});
    sc = await clockOn(sp, '#output');
    check(sc && sc.scale === '0.7' && sc.font < big * 0.5 && await lp.textContent('.clock-size-value') === '70 %', '70 %: a smaller clock, "70 %" in the panel', sc);
    await lp.fill('#clock-scale', '180');
    await lp.dispatchEvent('#clock-scale', 'change');
    await sp.waitForFunction(() => document.getElementById('output').style.getPropertyValue('--clock-scale') === '1.8', null, { timeout: 1000 }).catch(() => {});
    check(Math.abs((await clockOn(sp, '#output')).font - big) < 1, '180 %: back to the big clock');
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
