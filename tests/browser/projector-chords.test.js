'use strict';

// "Acorduri" on the projector: off by default (the words alone); the operator's "Acorduri"
// toggle (next to Gama) puts the chords above the words on the paired screen, inside the
// safe margins; key C toggles it; a verse has no chords; Settings hold what a new event
// starts with ("Ascunse" by default).

const { layoutAudit } = require('./harness');

module.exports = {
  name: 'projector-chords',
  timeout: 240000,
  async run({ app, browser, signIn, check }) {
    const { eventId: E, items } = app.seed;
    const sp = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    await sp.goto(`${app.url}/screen`);
    await sp.waitForFunction(() => /\d{3} \d{3}/.test(document.getElementById('pairing-code').textContent));
    await app.api(app.cookies.owner, 'POST', '/api/screens/claim', { code: (await sp.textContent('#pairing-code')).replace(' ', ''), name: 'Proiector' });
    await sp.waitForSelector('#output:not([hidden])', { timeout: 6000 });
    const out = () => sp.evaluate(() => {
      const o = document.getElementById('output');
      const box = o.querySelector('.projector-text');
      const r = box ? box.getBoundingClientRect() : null;
      return {
        chords: [...o.querySelectorAll('.projector-chord')].map((c) => c.textContent.trim()).filter(Boolean),
        text: o.querySelector('.projector-stage').innerText.replace(/\s+/g, ' ').trim(),
        fits: r ? (r.left >= innerWidth * 0.05 - 1 && r.right <= innerWidth * 0.95 + 1 && r.top >= innerHeight * 0.05 - 1 && r.bottom <= innerHeight * 0.95 + 1 && box.scrollWidth <= box.clientWidth + 1 && box.scrollHeight <= box.clientHeight + 1) : null,
        font: box ? parseFloat(getComputedStyle(box).fontSize) : null,
      };
    });
    check((await app.command({ type: 'event.start' })).ok, 'the event is live');
    await app.command({ type: 'worship.goto', itemId: items[0], step: 0 });
    await sp.waitForFunction(() => /ridici/.test(document.querySelector('#output .projector-stage').innerText), null, { timeout: 5000 });
    let o = await out();
    check(o.chords.length === 0 && /Ne ridici din noaptea grea/.test(o.text), 'off by default: the words alone', o);

    const op = await signIn('operator', { width: 1024, lang: 'ro' });
    await op.goto(`${app.url}/events/${E}/operator`);
    await op.waitForSelector('#chords-panel .chords-toggle:not([disabled])');
    const panel = await op.evaluate(() => { const k = document.getElementById('key-panel').getBoundingClientRect(); const c = document.getElementById('chords-panel').getBoundingClientRect(); return { text: document.querySelector('#chords-panel .chords-toggle').textContent, pressed: document.querySelector('#chords-panel .chords-toggle').getAttribute('aria-pressed'), near: c.top >= k.top }; });
    check(panel.text === 'Acorduri' && panel.pressed === 'false' && panel.near, 'the console: an "Acorduri" toggle after Gama, off', panel);
    await op.click('#chords-panel .chords-toggle');
    await sp.waitForFunction(() => document.querySelectorAll('#output .projector-chord').length > 0, null, { timeout: 5000 });
    o = await out();
    check(JSON.stringify(o.chords) === '["G","D","Em","C"]' && /Ne ridici din/.test(o.text) && /noaptea grea/.test(o.text), '"Acorduri": the chords above the words on the screen (G D / Em C)', o);
    check(o.fits, 'the chorded lyrics stay inside the safe margins and the box', o);
    await sp.screenshot({ path: process.env.WA_SHOT || '/dev/null' }).catch(() => {});
    check((await op.getAttribute('#chords-panel .chords-toggle', 'aria-pressed')) === 'true', 'the toggle shows on');
    await app.command({ type: 'worship.goto', itemId: items[1], step: 0 });
    await sp.waitForFunction(() => /Cezar/.test(document.querySelector('#output .projector-stage').innerText), null, { timeout: 5000 });
    check((await out()).chords.length === 0, 'a verse: no chords');
    await app.command({ type: 'worship.goto', itemId: items[0], step: 0 });
    await sp.waitForFunction(() => document.querySelectorAll('#output .projector-chord').length > 0, null, { timeout: 5000 });
    await op.keyboard.press('c');
    check(await sp.waitForFunction(() => document.querySelectorAll('#output .projector-chord').length === 0, null, { timeout: 5000 }).then(() => true, () => false), 'key C: the words alone again');
    const a = await layoutAudit(op, '#chords-panel');
    check(!a.overflow && !a.small.length, 'the toggle: targets >= 44 px', a);
    await op.context().close();

    const s = await signIn('owner', { width: 1024, lang: 'ro' });
    await s.goto(`${app.url}/settings`);
    await s.waitForSelector('[data-chords-show="0"][aria-pressed="true"]');
    check((await s.textContent('#chords-heading')) === 'Acorduri pe proiector', 'Settings: "Acorduri pe proiector", Ascunse by default');
    await s.click('[data-chords-show="1"]');
    await s.waitForSelector('[data-chords-show="1"][aria-pressed="true"]');
    check(/pornește cu acordurile/.test(await s.textContent('#chords-message')), '"Afișate": saved');
    await s.click('[data-chords-show="0"]');
    await s.waitForSelector('[data-chords-show="0"][aria-pressed="true"]');
    await s.context().close();
    await sp.context().close();
  },
};
