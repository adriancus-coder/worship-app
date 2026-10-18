'use strict';

// "Gama pe proiector": the song's key, small, in a corner, only on the first screen of each
// song. The operator console and the live page have a "Gama" panel next to the clock (toggle,
// corner, size; key G); Settings hold what a new event starts with (off by default). A paired
// screen shows "G" on the first screen of the song, nothing on the second; it moves and grows
// from the panel.

const { layoutAudit } = require('./harness');

module.exports = {
  name: 'projector-key',
  timeout: 240000,
  async run({ app, browser, signIn, check }) {
    const { eventId: E, items } = app.seed;
    const sp = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    await sp.goto(`${app.url}/screen`);
    await sp.waitForFunction(() => /\d{3} \d{3}/.test(document.getElementById('pairing-code').textContent));
    await app.api(app.cookies.owner, 'POST', '/api/screens/claim', { code: (await sp.textContent('#pairing-code')).replace(' ', ''), name: 'Proiector' });
    await sp.waitForSelector('#output:not([hidden])', { timeout: 6000 });
    const key = () => sp.evaluate(() => { const k = document.querySelector('#output .display-key'); const r = k.getBoundingClientRect(); return { hidden: k.hidden, text: k.textContent, corner: k.className.replace('display-clock display-key ', ''), left: Math.round(r.left), top: Math.round(r.top), font: parseFloat(getComputedStyle(k).fontSize) }; });
    const keyShown = (want) => sp.waitForFunction((want) => document.querySelector('#output .display-key').hidden === !want, want, { timeout: 4000 }).then(() => true, () => false);

    // Settings: the defaults panel (off, top left, 100 %)
    const s = await signIn('owner', { width: 1024, lang: 'ro' });
    await s.goto(`${app.url}/settings`);
    await s.waitForSelector('#key-panel .clock-toggle');
    const defaults = await s.evaluate(() => ({ heading: document.getElementById('key-heading').textContent, toggle: document.querySelector('#key-panel .clock-toggle').textContent, pressed: document.querySelector('#key-panel .clock-toggle').getAttribute('aria-pressed'), corner: document.querySelector('#key-panel [data-corner][aria-pressed="true"]').dataset.corner, size: document.getElementById('key-default-scale').value }));
    check(defaults.heading === 'Gama pe proiector' && defaults.toggle === 'Gama' && defaults.pressed === 'false' && defaults.corner === 'top-left' && defaults.size === '100', 'Settings: "Gama pe proiector" with the clock\'s controls: off, top left, 100 %', defaults);
    const a = await layoutAudit(s, '#key-panel');
    check(!a.overflow && !a.small.length, 'the settings panel: no overflow, targets >= 44 px', a);
    await s.context().close();

    // The operator console: "Gama" next to "Ceas"; off by default on the screen
    check((await app.command({ type: 'event.start' })).ok, 'the event is live');
    await app.command({ type: 'worship.goto', itemId: items[0], step: 0 }); // "Sfânt în G", first screen
    const op = await signIn('operator', { width: 1024, lang: 'ro' });
    await op.goto(`${app.url}/events/${E}/operator`);
    await op.waitForSelector('#key-panel .clock-toggle:not([disabled])');
    const panel = await op.evaluate(() => { const c = document.getElementById('clock-panel').getBoundingClientRect(); const k = document.getElementById('key-panel').getBoundingClientRect(); return { toggle: document.querySelector('#key-panel .clock-toggle').textContent, beside: Math.abs(k.top - c.top) < 2 && k.left > c.right, under: k.top >= c.bottom - 1, pressed: document.querySelector('#key-panel .clock-toggle').getAttribute('aria-pressed') }; });
    check(panel.toggle === 'Gama' && (panel.beside || panel.under) && panel.pressed === 'false', 'the console: a "Gama" panel next to (or under) the clock panel, off', panel);
    check((await key()).hidden, 'off by default: no key on the screen');
    await op.click('#key-panel .clock-toggle');
    check(await keyShown(true), '"Gama": the screen shows the key at once');
    let k = await key();
    check(k.text === 'G' && k.corner === 'top-left' && k.left >= 1280 * 0.05 - 1 && k.top >= 720 * 0.05 - 1 && k.left < 200 && k.top < 120, '"G", small, top left, inside the safe margin', k);
    const font = k.font;
    await op.click('#key-panel [data-corner="top-right"]');
    check(await sp.waitForFunction(() => document.querySelector('#output .display-key').classList.contains('top-right'), null, { timeout: 4000 }).then(() => true, () => false) && (await key()).left > 1000, 'the corner from the panel: top right', await key());
    await op.$eval('#key-scale', (input) => { input.value = '150'; input.dispatchEvent(new Event('change', { bubbles: true })); });
    check(await sp.waitForFunction((f) => parseFloat(getComputedStyle(document.querySelector('#output .display-key')).fontSize) > f * 1.4, font, { timeout: 4000 }).then(() => true, () => false), 'the size from the panel: 150 % -> bigger on the screen', { before: font, after: (await key()).font });
    await app.command({ type: 'worship.next' });
    check(await keyShown(false), 'the second screen of the song: no key');
    await app.command({ type: 'worship.goto', itemId: items[0], step: 0 });
    check(await keyShown(true), 'back on the first screen: the key again');
    await op.keyboard.press('g');
    check(await keyShown(false) && await op.waitForFunction(() => document.querySelector('#key-panel .clock-toggle').getAttribute('aria-pressed') === 'false', null, { timeout: 3000 }).then(() => true, () => false), 'key G: off on the screen, "Gama" off in the panel');
    await op.keyboard.press('g');
    check(await keyShown(true), 'G again: back');
    await sp.screenshot({ path: process.env.WA_SHOT || '/dev/null' }).catch(() => {});
    const b = await layoutAudit(op, '#key-panel');
    check(!b.overflow && !b.small.length, 'the console panel: no overflow, targets >= 44 px', b);
    await op.context().close();

    // The live page (leader) has the same panel
    const lp = await signIn('leader', { width: 1024, lang: 'en' });
    await lp.goto(`${app.url}/events/${E}/live?view=full`);
    await lp.waitForSelector('#key-panel .clock-toggle:not([disabled])');
    check((await lp.textContent('#key-panel .clock-toggle')) === 'Key' && (await lp.getAttribute('#key-panel .clock-toggle', 'aria-pressed')) === 'true', 'the live page: "Key" on, next to the clock');
    await lp.keyboard.press('g');
    check(await keyShown(false), 'the leader\'s G turns it off');
    await lp.context().close();
    await sp.context().close();
  },
};
