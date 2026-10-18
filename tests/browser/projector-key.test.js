'use strict';

// "Gama pe proiector" (Settings): the song's key, small, top left, only on the first screen
// of each song. Off by default; the owner turns it on in Settings (a selection control); a
// paired screen shows "G" on the first screen of the song, nothing on the second; the key
// sits inside the safe margin; off again, it is gone.

const { layoutAudit } = require('./harness');

module.exports = {
  name: 'projector-key',
  timeout: 180000,
  async run({ app, browser, signIn, check }) {
    const { eventId: E, items } = app.seed;
    const sp = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    await sp.goto(`${app.url}/screen`);
    await sp.waitForFunction(() => /\d{3} \d{3}/.test(document.getElementById('pairing-code').textContent));
    await app.api(app.cookies.owner, 'POST', '/api/screens/claim', { code: (await sp.textContent('#pairing-code')).replace(' ', ''), name: 'Proiector' });
    await sp.waitForSelector('#output:not([hidden])', { timeout: 6000 });
    check((await app.command({ type: 'event.start' })).ok, 'the event is live');
    await app.command({ type: 'worship.goto', itemId: items[0], step: 0 }); // "Sfânt în G", first screen
    await sp.waitForFunction(() => /Sfânt|ridici|Ne /.test(document.querySelector('#output .projector-stage').textContent), null, { timeout: 5000 }).catch(() => {});
    const key = () => sp.evaluate(() => { const k = document.querySelector('#output .display-key'); const r = k.getBoundingClientRect(); return { hidden: k.hidden, text: k.textContent, left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width) }; });
    check((await key()).hidden, 'off by default: no key on the screen', await key());

    const p = await signIn('owner', { width: 1024, lang: 'ro' });
    await p.goto(`${app.url}/settings`);
    await p.waitForSelector('[data-key-show="0"][aria-pressed="true"]');
    const a = await layoutAudit(p, '[aria-labelledby="key-show-heading"]');
    check(!a.overflow && !a.small.length && (await p.textContent('#key-show-heading')) === 'Gama pe proiector', 'Settings: "Gama pe proiector", a selection control (Ascunsă selected), targets >= 44 px', a);
    await p.click('[data-key-show="1"]');
    await p.waitForSelector('[data-key-show="1"][aria-pressed="true"]');
    check(/prima strofă/.test(await p.textContent('#key-show-message')), '"Afișată": saved, the message says so', await p.textContent('#key-show-message'));
    const shown = await sp.waitForFunction(() => { const k = document.querySelector('#output .display-key'); return !k.hidden && k.textContent === 'G'; }, null, { timeout: 4000 }).then(() => true, () => false);
    const k = await key();
    await sp.screenshot({ path: process.env.WA_SHOT || '/dev/null' }).catch(() => {});
    check(shown && k.left >= 1280 * 0.05 - 1 && k.top >= 720 * 0.05 - 1 && k.left < 200 && k.top < 120 && k.width > 0, 'the screen shows "G" at once, small, top left, inside the safe margin', k);
    await app.command({ type: 'worship.next' });
    check(await sp.waitForFunction(() => document.querySelector('#output .display-key').hidden, null, { timeout: 4000 }).then(() => true, () => false), 'the second screen of the song: no key');
    await app.command({ type: 'worship.goto', itemId: items[0], step: 0 });
    check(await sp.waitForFunction(() => !document.querySelector('#output .display-key').hidden, null, { timeout: 4000 }).then(() => true, () => false), 'back on the first screen: the key again');
    await p.click('[data-key-show="0"]');
    await p.waitForSelector('[data-key-show="0"][aria-pressed="true"]');
    check(await sp.waitForFunction(() => document.querySelector('#output .display-key').hidden, null, { timeout: 4000 }).then(() => true, () => false), '"Ascunsă": gone from the screen at once');
    await p.context().close();
    await sp.context().close();
  },
};
