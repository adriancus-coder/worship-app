'use strict';

// The rehearsal: "Elementul 1 din 5" is a button that opens the Program; a tap on any item
// goes there (the position, the URL, the slide); Escape closes; A− / A+ change the text size
// and the choice is kept. On a phone, for a member.

const { layoutAudit } = require('./harness');

module.exports = {
  name: 'rehearse-jump',
  async run({ app, signIn, check }) {
    const { eventId: E } = app.seed;
    const p = await signIn('member', { width: 375, lang: 'ro' });
    await p.goto(`${app.url}/events/${E}/rehearse`);
    await p.waitForSelector('#rehearse:not([hidden])');
    check((await p.textContent('#position')) === 'Elementul 1 din 5' && (await p.$eval('#jump-open', (b) => b.tagName)) === 'BUTTON', 'the position is a button');
    await p.click('#jump-open');
    await p.waitForSelector('#rehearse-jump[open]');
    const items = await p.$$eval('#rehearse-jump-list .jump-item', (l) => l.map((b) => ({ text: b.textContent.trim(), current: b.classList.contains('current') })));
    check(items.length === 5 && items[0].current && /Sfânt în G/.test(items[0].text) && /Agapă/.test(items[3].text), 'the Program: every item, the current one marked', items);
    const a = await layoutAudit(p, '#rehearse-jump');
    check(!a.overflow && !a.small.length, 'the list 375: no overflow, targets >= 44 px', a);
    await p.click('#rehearse-jump-list .jump-item >> nth=3');
    await p.waitForSelector('#rehearse-jump', { state: 'hidden' });
    await p.waitForFunction(() => document.getElementById('position').textContent === 'Elementul 4 din 5');
    check(/[?&]i=4\b/.test(p.url()) && /Agapă/.test(await p.textContent('#slide')), 'a tap: the 4th item, the URL says so');
    await p.click('#jump-open');
    await p.waitForSelector('#rehearse-jump[open]');
    await p.keyboard.press('Escape');
    await p.waitForSelector('#rehearse-jump', { state: 'hidden' });
    check((await p.textContent('#position')) === 'Elementul 4 din 5', 'Escape closes it, nothing moves');
    // the text size
    await p.click('#jump-open');
    await p.waitForSelector('#rehearse-jump[open]');
    await p.click('#rehearse-jump-list .jump-item >> nth=0');
    await p.waitForFunction(() => document.getElementById('position').textContent === 'Elementul 1 din 5');
    const size = () => p.$eval('#slide', (s) => parseFloat(getComputedStyle(s).fontSize));
    const before = await size();
    await p.click('#text-larger');
    await p.click('#text-larger');
    const bigger = await size();
    await p.click('#text-smaller');
    const back = await size();
    check(bigger > before && back < bigger, `A+ / A−: the slide's text grows and shrinks (${before} -> ${bigger} -> ${back})`);
    await p.reload();
    await p.waitForSelector('#rehearse:not([hidden])');
    check(Math.abs((await size()) - back) < 0.5, 'the size is kept on the device');
    await p.context().close();
  },
};
