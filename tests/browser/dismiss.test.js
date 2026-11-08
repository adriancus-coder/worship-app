'use strict';

// Messages closed with × (public/dismiss.js): the console's "Proiectorul e al tău" banner and
// the explanatory hints (console, live page, event, library) get a × button; closing one
// hides it on this device, across reloads; the profile page counts the closed messages and
// "Arată din nou mesajele închise" brings them all back. Hints hidden by their page (the key
// hints on phones, a hidden attribute) show no stray ×. 375 and 1280.

const { layoutAudit } = require('./harness');

module.exports = {
  name: 'dismiss',
  timeout: 240000,
  async run({ app, signIn, check }) {
    const E = app.seed.eventId;
    await app.command({ type: 'event.start' }).catch(() => {});
    const o = await signIn('operator', { width: 1280, height: 800, lang: 'ro' });
    await o.goto(`${app.url}/events/${E}/operator`);
    await o.waitForSelector('.dismissable[data-dismiss-id="op-banner"] > .dismiss');
    const before = await o.evaluate(() => ({
      banner: !document.querySelector('.dismissable[data-dismiss-id="op-banner"]').hidden,
      ids: [...document.querySelectorAll('.dismissable')].map((x) => x.dataset.dismissId).sort(),
      label: document.querySelector('.dismissable[data-dismiss-id="op-banner"] > .dismiss').getAttribute('aria-label'),
      bannerText: document.getElementById('mode-title').textContent,
    }));
    check(before.banner && ['mode-hint', 'op-add-hint', 'op-banner', 'op-keys-hint', 'projector-permission', 'screens-hint'].every((id) => before.ids.includes(id)) && /Închide mesajul/.test(before.label) && before.bannerText.length > 0,
      'the console: × on the banner, the mode hint, the add hint, the keys hint, the permission hint, the screens hint', before);
    const a = await layoutAudit(o, '#console');
    check(!a.overflow && !a.small.length, 'the console 1280 with the × buttons: no overflow, targets >= 44 px', a);
    await o.click('.dismissable[data-dismiss-id="op-banner"] > .dismiss');
    await o.click('.dismissable[data-dismiss-id="op-keys-hint"] > .dismiss');
    const closed = await o.evaluate(() => ({ banner: document.querySelector('.dismissable[data-dismiss-id="op-banner"]').hidden, keys: document.querySelector('.dismissable[data-dismiss-id="op-keys-hint"]').hidden, stored: JSON.parse(localStorage.getItem('wa_dismissed')) }));
    check(closed.banner && closed.keys && closed.stored.sort().join() === 'op-banner,op-keys-hint', 'closed: hidden and remembered on the device', closed);
    await o.reload();
    await o.click('#op-tab-add'); // the add hint lives in the "Adaugă" tab
    await o.waitForSelector('.dismissable[data-dismiss-id="op-add-hint"] > .dismiss');
    const again = await o.evaluate(() => ({ banner: document.querySelector('.dismissable[data-dismiss-id="op-banner"]').hidden, add: document.querySelector('.dismissable[data-dismiss-id="op-add-hint"]').hidden }));
    check(again.banner && !again.add, 'after a reload: still closed; the others still shown', again);

    // the profile: the count, "Arată din nou"
    await o.goto(`${app.url}/profile`);
    await o.waitForSelector('#show-dismissed:not([disabled])');
    const p = await o.evaluate(() => ({ count: document.getElementById('dismissed-count').textContent, heading: document.getElementById('dismissed-heading').textContent }));
    check(/2 mesaje închise/.test(p.count) && p.heading === 'Mesaje închise', 'the profile counts the closed messages', p);
    await o.click('#show-dismissed');
    const after = await o.evaluate(() => ({ text: document.getElementById('dismissed-count').textContent, disabled: document.getElementById('show-dismissed').disabled, stored: localStorage.getItem('wa_dismissed') }));
    check(/apar din nou/.test(after.text) && after.disabled && after.stored === '[]', '"Arată din nou": the list emptied, the button disabled', after);
    await o.goto(`${app.url}/events/${E}/operator`);
    await o.waitForSelector('.dismissable[data-dismiss-id="op-banner"] > .dismiss');
    check(await o.$eval('.dismissable[data-dismiss-id="op-banner"]', (x) => !x.hidden), 'back on the console: the banner shows again');

    // the phone: the key hints are hidden by CSS, so no stray × for them; the banner's × fits
    const m = await signIn('operator', { width: 375, lang: 'ro' });
    await m.goto(`${app.url}/events/${E}/operator`);
    await m.waitForSelector('.dismissable[data-dismiss-id="op-banner"] > .dismiss');
    const phone = await m.evaluate(() => ({
      keysShown: getComputedStyle(document.querySelector('.dismissable[data-dismiss-id="op-keys-hint"]')).display,
      bannerX: document.querySelector('.dismissable[data-dismiss-id="op-banner"] > .dismiss').getBoundingClientRect().right,
    }));
    check(phone.keysShown === 'none' && phone.bannerX <= 375, 'the phone: the keys hint and its × stay hidden; the banner × inside the screen', phone);
    const b = await layoutAudit(m, '#console');
    check(!b.overflow && !b.small.length, 'the console 375: no overflow, targets >= 44 px', b);

    // the live page and the library: hints with ×
    const l = await signIn('leader', { width: 1280, height: 800, lang: 'ro' });
    await l.goto(`${app.url}/events/${E}/live?view=full`);
    await l.waitForSelector('.dismissable[data-dismiss-id="live-keys-hint"] > .dismiss');
    const live = await l.evaluate(() => [...document.querySelectorAll('.dismissable')].map((x) => x.dataset.dismissId).sort());
    check(['live-keys-hint', 'mode-hint', 'projector-keys-hint', 'projector-permission', 'screens-hint'].every((id) => live.includes(id)), 'the live page: × on its hints', live);
    await l.goto(`${app.url}/library`);
    await l.waitForSelector('.dismissable[data-dismiss-id="library-search-hint"] > .dismiss');
    await l.click('.dismissable[data-dismiss-id="library-search-hint"] > .dismiss');
    check(await l.$eval('.dismissable[data-dismiss-id="library-search-hint"]', (x) => x.hidden), 'the library search hint closes too');
  },
};
