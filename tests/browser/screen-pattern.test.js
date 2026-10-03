'use strict';

// "Ecran de test" on /screens: the paired screen shows the calibration pattern (border, the
// 2-10 % markers, the centre cross, its resolution and margin); "Aplică 6 %" saves that
// screen's margin and the pattern follows; "Închide" brings the content back; a live move
// replaces a pattern too. RO 1024 and EN 375.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'screen-pattern',
  timeout: 240000,
  async run({ app, browser, signIn, check }) {
    const owner = app.cookies.owner;
    const sp = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
    sp.on('pageerror', (err) => check(false, `screen page error: ${err.message}`));
    await sp.goto(`${app.url}/screen`);
    await sp.waitForFunction(() => /\d{3} \d{3}/.test(document.getElementById('pairing-code').textContent));
    await app.api(owner, 'POST', '/api/screens/claim', { code: (await sp.textContent('#pairing-code')).replace(' ', ''), name: 'Sala' });
    await sp.waitForSelector('#output:not([hidden])', { timeout: 6000 });
    await app.command({ type: 'event.start' });
    await sp.waitForFunction(() => /Ne ridici/.test(document.querySelector('#output .projector-stage').innerText));
    const pattern = () => sp.evaluate(() => {
      const box = document.querySelector('#output .projector-pattern');
      if (!box) return null;
      const labels = [...box.querySelectorAll('.pattern-label-tl')].map((l) => l.textContent);
      const border = box.querySelector('.pattern-border').getBoundingClientRect();
      const safe = box.querySelector('.pattern-safe').getBoundingClientRect();
      return { labels, info: box.querySelector('.pattern-info').innerText.replace(/\s+/g, ' '), borderLeft: border.left, borderRight: border.right, safeLeft: Math.round(safe.left), cross: box.querySelectorAll('.pattern-cross').length };
    });

    for (const [lang, width] of [['ro', 1024], ['en', 375]]) {
      const tag = `[${lang} ${width}]`;
      const p = await signIn('operator', { width, lang });
      await p.goto(`${app.url}/screens`);
      await p.waitForSelector('.screen-row');
      const button = p.locator('.screen-row button[data-pattern]');
      check((await button.textContent()).trim() === (lang === 'ro' ? 'Ecran de test' : 'Test screen') && (await button.getAttribute('aria-pressed')) === 'false', `${tag} the row has "Ecran de test"`);
      await button.click();
      await p.waitForSelector('.pattern-panel');
      await sp.waitForSelector('#output .projector-pattern', { timeout: 5000 });
      const pat = await pattern();
      const expectResolution = lang === 'ro' ? /Rezoluție: 1920 × 1080/ : /Resolution: 1920 × 1080/;
      const expectMargin = lang === 'ro' ? /Margine de siguranță: 5 %/ : /Safe margin: 5 %/;
      check(pat && pat.labels.join(',') === '2 %,4 %,6 %,8 %,10 %' && pat.cross === 2 && Math.round(pat.borderLeft) === 1 && Math.round(pat.borderRight) === 1919, `${tag} the pattern: border 1 px from the edges, markers 2-10 %, centre cross`, pat);
      check(pat && expectResolution.test(pat.info) && expectMargin.test(pat.info) && /Sala/.test(pat.info), `${tag} the pattern names the resolution, the margin and the screen (${lang.toUpperCase()})`, pat && pat.info);
      check(pat && pat.safeLeft === Math.round(1920 * 0.05), `${tag} the current margin (5 %) drawn solid`, pat && pat.safeLeft);
      const panel = await p.evaluate(() => ({ hint: document.querySelector('.pattern-panel .hint').textContent, buttons: [...document.querySelectorAll('.pattern-apply button')].map((b) => b.textContent.trim()) }));
      check(/(primul procent|first percent)/i.test(panel.hint) && panel.buttons.join(',') === (lang === 'ro' ? 'Aplică 2 %,Aplică 4 %,Aplică 6 %,Aplică 8 %,Aplică 10 %' : 'Apply 2 %,Apply 4 %,Apply 6 %,Apply 8 %,Apply 10 %'), `${tag} under the button: the reading hint and "Aplică 2/4/6/8/10 %"`, panel);
      const a = await layoutAudit(p, '#screens');
      check(!a.overflow && !a.small.length, `${tag} the row: no overflow, targets >= 44 px`, a);
      // Aplică 6 %
      await p.click('.pattern-apply button[data-apply="6"]');
      await p.waitForFunction(() => /6 %/.test(document.querySelector('.pattern-panel .message').textContent));
      const saved = (await app.api(owner, 'GET', '/api/screens')).body.screens[0];
      await sp.waitForFunction(() => /: 6 %/.test(document.querySelector('#output .pattern-info').innerText), null, { timeout: 5000 });
      const pat6 = await pattern();
      check(saved.safeMargin === 6 && saved.testPattern === true && pat6.safeLeft === Math.round(1920 * 0.06) && (await p.inputValue('select[data-margin]')) === '6', `${tag} "Aplică 6 %": saved on the screen, the pattern shows 6 %, the select follows`, { saved: saved.safeMargin, safeLeft: pat6.safeLeft });
      // Închide: the live content is back, with the margin
      await p.click('.screen-row button[data-pattern]');
      await sp.waitForFunction(() => !document.querySelector('#output .projector-pattern') && /Ne ridici/.test(document.querySelector('#output .projector-stage').innerText), null, { timeout: 5000 });
      await p.waitForFunction(() => !document.querySelector('.pattern-panel'), null, { timeout: 5000 });
      check((await sp.evaluate(() => document.getElementById('output').dataset.safeMargin)) === '6' && await p.locator('.pattern-panel').count() === 0, `${tag} "Închide": the lyrics again at 6 %, the panel gone`);
      // the pattern again, then a live move replaces it
      await p.click('.screen-row button[data-pattern]');
      await sp.waitForSelector('#output .projector-pattern', { timeout: 5000 });
      await app.command({ type: 'worship.next' });
      await sp.waitForFunction(() => !document.querySelector('#output .projector-pattern'), null, { timeout: 5000 });
      check(/Sfânt/.test(await sp.evaluate(() => document.querySelector('#output .projector-stage').innerText)), `${tag} the next live frame replaces the pattern`);
      await app.command({ type: 'worship.prev' });
      await app.api(owner, 'PUT', `/api/screens/${saved.id}/margin`, { percent: null });
      await p.context().close();
    }
    // margin 0: as before
    await app.api(owner, 'PUT', '/api/settings/safe-margin', { percent: 0 });
    await sp.waitForFunction(() => document.getElementById('output').dataset.safeMargin === '0', null, { timeout: 5000 });
    await wait(300);
    const m0 = await sp.evaluate(() => { const r = document.querySelector('#output .projector-text').getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right) }; });
    check(m0.left >= 0 && m0.right <= 1920 && m0.left < 96, 'margin 0 %: the text may reach the edges again', m0);
  },
};
