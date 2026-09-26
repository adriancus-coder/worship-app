'use strict';

// "Margine de siguranță proiector": at 8 % the text box and the corner clock sit visibly
// further from the edges on /screen (and the logo), the previews draw the dashed guide at
// the margin, a screen's own value wins over the church's, backgrounds are not inset, and
// 0 % puts things back to the edges (as before the margin). RO 1024 settings page.

const { wait } = require('./harness');

module.exports = {
  name: 'screen-margin',
  timeout: 240000,
  async run({ app, browser, signIn, check }) {
    const { eventId: E } = app.seed;
    const owner = app.cookies.owner;
    const pair = async (name) => {
      const sp = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
      sp.on('pageerror', (err) => check(false, `screen page error: ${err.message}`));
      await sp.goto(`${app.url}/screen`);
      await sp.waitForFunction(() => /\d{3} \d{3}/.test(document.getElementById('pairing-code').textContent));
      await app.api(owner, 'POST', '/api/screens/claim', { code: (await sp.textContent('#pairing-code')).replace(' ', ''), name });
      await sp.waitForSelector('#output:not([hidden])', { timeout: 6000 });
      return sp;
    };
    const sp = await pair('Sala');
    const sp2 = await pair('Balcon');
    await app.command({ type: 'event.start' });
    await app.command({ type: 'clock.set', show: true, position: 'top-left' });
    const measure = (p) => p.evaluate(() => {
      const o = document.getElementById('output');
      const box = o.querySelector('.projector-text');
      const r = box ? box.getBoundingClientRect() : null;
      const c = o.querySelector('.display-clock');
      const cr = c && !c.hidden ? c.getBoundingClientRect() : null;
      const s = getComputedStyle(o);
      return { margin: o.dataset.safeMargin, safeX: parseFloat(s.getPropertyValue('--safe-x')), safeY: parseFloat(s.getPropertyValue('--safe-y')),
        left: r ? r.left : null, right: r ? r.right : null, top: r ? r.top : null, clockTop: cr ? cr.top : null, clockLeft: cr ? cr.left : null,
        guide: Boolean(o.querySelector('.projector-safe-guide:not([hidden])')) };
    });
    await sp.waitForFunction(() => /Ne ridici/.test(document.querySelector('#output .projector-stage').innerText));
    const m5 = await measure(sp);
    check(m5.margin === '5' && Math.round(m5.safeX) === 96 && Math.round(m5.safeY) === 54 && m5.left >= 96 - 1 && m5.right <= 1920 - 96 + 1 && !m5.guide, '5 % default on 1920x1080: text inside 96 / 54 px, no guide on the screen', m5);
    check(m5.clockTop !== null && Math.round(m5.clockTop) === 54 + 20 && Math.round(m5.clockLeft) === 96 + 24, 'the clock offset = margin + 20 / 24 px', m5);

    // the church setting: 8 %
    const o = await signIn('owner', { width: 1024, lang: 'ro' });
    await o.goto(`${app.url}/settings`);
    await o.waitForSelector('#safe-margin');
    await o.waitForFunction(() => document.getElementById('safe-margin-value').textContent === '5 %');
    await o.fill('#safe-margin', '8');
    await o.dispatchEvent('#safe-margin', 'change');
    await o.waitForFunction(() => /8 %/.test(document.getElementById('margin-message').textContent));
    check((await app.api(owner, 'GET', '/api/settings')).body.safeMargin === 8, 'Setări: the margin saves (8 %)');
    await sp.waitForFunction(() => document.getElementById('output').dataset.safeMargin === '8', null, { timeout: 5000 });
    const m8 = await measure(sp);
    check(Math.round(m8.safeX) === 154 && Math.round(m8.safeY) === 86 && m8.left >= 154 - 1 && m8.right <= 1920 - 154 + 1 && m8.top >= 86 - 1, '8 %: the text sits inside 154 / 86 px on both screens', m8);
    check(Math.round(m8.clockTop) === 86 + 20 && Math.round(m8.clockLeft) === 154 + 24, '8 %: the clock moved in with the margin', m8);
    check((await measure(sp2)).margin === '8', 'the second screen follows the church value too');
    // the previews: the dashed guide at the margin
    const l = await signIn('leader', { width: 1180 });
    await l.goto(`${app.url}/events/${E}/live`);
    await l.waitForSelector('#live:not([hidden])');
    await l.waitForFunction(() => document.getElementById('projector-preview').dataset.safeMargin === '8', null, { timeout: 5000 });
    const guide = await l.evaluate(() => {
      const p = document.getElementById('projector-preview');
      const g = p.querySelector('.projector-safe-guide');
      const pr = p.getBoundingClientRect();
      const gr = g.getBoundingClientRect();
      return { shown: !g.hidden && getComputedStyle(g).borderTopStyle === 'dashed', inset: Math.round(gr.left - pr.left), expected: Math.round(pr.width * 0.08) };
    });
    check(guide.shown && Math.abs(guide.inset - guide.expected) <= 2, 'leader preview: a dashed rectangle at the 8 % margin', guide);
    const op = await signIn('operator', { width: 1180 });
    await op.goto(`${app.url}/events/${E}/operator`);
    await op.waitForSelector('#console:not([hidden])');
    check(await op.evaluate(() => !document.querySelector('#projector-preview .projector-safe-guide').hidden), 'console preview: the guide too');
    // per screen: "Balcon" gets its own 12 %; "Sala" keeps the church value
    await op.goto(`${app.url}/screens`);
    await op.waitForSelector('.screen-row');
    const row = op.locator('.screen-row', { hasText: 'Balcon' });
    check((await row.locator('select[data-margin] option:first-child').textContent()) === 'Implicit (8 %)', 'the row select names the church default (8 %)');
    await row.locator('select[data-margin]').selectOption('12');
    await row.locator('.screen-margin .message').waitFor();
    await sp2.waitForFunction(() => document.getElementById('output').dataset.safeMargin === '12', null, { timeout: 5000 });
    const m12 = await measure(sp2);
    check(Math.round(m12.safeX) === 230 && (await measure(sp)).margin === '8', 'Balcon 12 % (230 px), Sala still 8 %', m12);
    // the church changes to 4 %: Sala follows, Balcon keeps 12
    await app.api(owner, 'PUT', '/api/settings/safe-margin', { percent: 4 });
    await sp.waitForFunction(() => document.getElementById('output').dataset.safeMargin === '4', null, { timeout: 5000 });
    await wait(300);
    check((await measure(sp2)).margin === '12', 'a screen\'s own value wins over the church\'s');
    // the logo and a background: the logo inside the margin, the background full-bleed
    await app.command({ type: 'projector.source', source: 'logo' });
    await wait(400);
    const bg = await sp.evaluate(() => {
      const o = document.getElementById('output');
      const backdrop = o.querySelector('.projector-backdrop').getBoundingClientRect();
      const stage = o.querySelector('.projector-stage');
      const cs = getComputedStyle(stage);
      return { full: backdrop.left === 0 && backdrop.right === innerWidth, pad: parseFloat(cs.paddingLeft) };
    });
    check(bg.full && Math.round(bg.pad) === Math.round(1920 * 0.04), 'the backdrop fills the screen; the stage (logo) is padded by the margin', bg);
    await app.command({ type: 'projector.source', source: 'content' });
    // 0 %: back to the edges
    await app.api(owner, 'PUT', '/api/settings/safe-margin', { percent: 0 });
    await sp.waitForFunction(() => document.getElementById('output').dataset.safeMargin === '0', null, { timeout: 5000 });
    await wait(300);
    const m0 = await measure(sp);
    check(m0.safeX === 0 && m0.safeY === 0 && Math.round(m0.clockTop) === 20 && Math.round(m0.clockLeft) === 24, '0 %: no inset, the clock at 20 / 24 px as before', m0);
    check((await app.api(owner, 'PUT', '/api/settings/safe-margin', { percent: 13 })).status === 400 && (await app.api(app.cookies.leader, 'PUT', '/api/settings/safe-margin', { percent: 3 })).status === 403, '13 % refused; owner only');
  },
};
