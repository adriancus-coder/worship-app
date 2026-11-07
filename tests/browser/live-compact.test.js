'use strict';

// The leader's compact view of the live page: "Vedere: Complet / Compact" (and "Listă" in the
// big lyrics) leaves only the Program, with each song's key and a green tick once the projector
// has shown more than 70 % of its screens (snapshot.shown, lib/live.js); the choice is kept on
// the device; the screen stays on while the event is live (navigator.wakeLock). 375 and 1024.

const { layoutAudit } = require('./harness');

module.exports = {
  name: 'live-compact',
  timeout: 240000,
  async run({ app, signIn, check }) {
    const E = app.seed.eventId;
    const items = app.seed.items;
    // a song without a key at the end of the Program: the list says "fără ton" for it
    const noKeyId = (await app.api(app.cookies.owner, 'POST', '/api/songs', { title: 'Cântare fără ton', sections: [{ type: 'verse', content: 'Un rând' }] })).body.song.id;
    const current = (await app.api(app.cookies.owner, 'GET', `/api/events/${E}`)).body.items;
    await app.api(app.cookies.owner, 'PUT', `/api/events/${E}/items`, { items: [...current, { type: 'song', songId: noKeyId }] });
    await app.command({ type: 'event.start' });
    // a fake wake lock, counted
    const WAKE = `Object.defineProperty(navigator, 'wakeLock', { value: { request: () => { window.__wake = (window.__wake || 0) + 1; return Promise.resolve({ released: false, release: () => Promise.resolve() }); } } });`;

    // --- the API: the screens shown, the tick after 70 % ------------------------------------
    const song = app.seed.items[0]; // "Sfânt în G": verse + chorus (2 screens)
    let snap = await app.state();
    const shownState = snap.state || snap; // live:state carries { state, presence }
    check(shownState.shown && shownState.shown[song] && shownState.shown[song].total >= 1, 'the snapshot carries shown { shown, total, done } per item', shownState.shown && shownState.shown[song]);
    const shown = async () => { const st = await app.state(); return (st.state || st).shown; };

    // --- the leader's phone: compact from the big lyrics ------------------------------------
    const p = await signIn('leader', { width: 375, lang: 'ro' });
    await p.addInitScript(WAKE);
    await p.goto(`${app.url}/events/${E}/live?view=lyrics`);
    await p.waitForSelector('.big-list:not([hidden])');
    await p.click('.big-list');
    await p.waitForFunction(() => document.body.classList.contains('live-compact'));
    const compact = await p.evaluate(() => ({
      current: getComputedStyle(document.querySelector('.live-current')).display,
      info: getComputedStyle(document.querySelector('.live-info')).display,
      list: document.querySelectorAll('#setlist .live-item').length,
      keys: [...document.querySelectorAll('#setlist .item-key')].map((x) => x.textContent),
      noKey: [...document.querySelectorAll('#setlist .live-item')].map((li) => (li.querySelector('.item-key-none') ? li.querySelector('.item-key-none').textContent : null)),
      pressed: document.querySelector('#live-view [aria-pressed="true"]').dataset.view,
      stored: localStorage.getItem('wa_live_compact'),
      wake: window.__wake || 0,
    }));
    check(compact.current === 'none' && compact.info === 'none' && compact.list >= 5 && compact.keys.length >= 3 && compact.pressed === 'compact' && compact.stored === '1' && compact.wake >= 1,
      'compact: only the Program with the keys; the choice kept; the screen kept on', compact);
    check(compact.noKey[compact.noKey.length - 1] === 'fără ton' && compact.noKey.filter(Boolean).length === 1, 'the song without a key says "fără ton", the others not', compact.noKey);
    const a = await layoutAudit(p, '#live');
    check(!a.overflow && !a.small.length, 'the compact view 375: no overflow, targets >= 44 px', a);

    // the projector shows the first song fully: the tick appears; the second song only half: none
    const steps = (await shown())[items[0]].total;
    for (let s = 0; s < steps; s += 1) await app.command({ type: 'worship.goto', itemId: items[0], step: s });
    await p.waitForSelector(`#setlist .live-item[aria-current] .item-done, #setlist li:nth-child(1) .item-done`);
    let sh = await shown();
    check(sh[items[0]].done && sh[items[0]].shown === steps, 'every screen of the first song shown: done', sh[items[0]]);
    const six = items[2]; // "Șase rânduri": one verse of six lines -> several screens
    const sixTotal = sh[six].total;
    await app.command({ type: 'worship.goto', itemId: six, step: 0 });
    sh = await shown();
    const ticks = await p.evaluate(() => [...document.querySelectorAll('#setlist li')].map((li) => Boolean(li.querySelector('.item-done'))));
    check(sixTotal >= 2 ? !sh[six].done : true, 'one screen of a longer song: not done yet', { sixTotal, shown: sh[six] });
    check(ticks[0] === true && (sixTotal < 2 || ticks[2] === false), 'the list: a tick on the first song only', ticks);
    const label = await p.$eval('#setlist .item-done', (x) => x.getAttribute('aria-label'));
    check(/70/.test(label), 'the tick says what it means', label);

    // opened again (the page itself, not the lyrics): still compact; "Complet" brings the page back
    await p.goto(`${app.url}/events/${E}/live?view=full`);
    await p.waitForSelector('#live:not([hidden])');
    check(await p.evaluate(() => document.body.classList.contains('live-compact')), 'after a reload: still compact');
    await p.click('#live-view [data-view="full"]');
    const full = await p.evaluate(() => ({ compact: document.body.classList.contains('live-compact'), current: getComputedStyle(document.querySelector('.live-current')).display, stored: localStorage.getItem('wa_live_compact') }));
    check(!full.compact && full.current !== 'none' && full.stored === '0', '"Complet": the full page again, remembered', full);

    // --- desktop: the switch on the full page, the tick rendered ----------------------------
    const o = await signIn('owner', { width: 1024, lang: 'ro' });
    await o.goto(`${app.url}/events/${E}/live?view=full`);
    await o.waitForSelector('#live-view [data-view="compact"]');
    await o.click('#live-view [data-view="compact"]');
    await o.waitForFunction(() => document.body.classList.contains('live-compact'));
    const b = await layoutAudit(o, '#live');
    check(!b.overflow && !b.small.length && (await o.locator('#setlist .item-done').count()) >= 1, 'the compact view 1024: no overflow, the tick shown', b);

    // after the end the ticks stay (the history of the service); a finished event never restarts
    await app.command({ type: 'event.end' });
    sh = await shown();
    check(sh[items[0]].done && (await app.command({ type: 'event.start' })).code === 'finished', 'after the end: the ticks stay; no second start', sh[items[0]]);
  },
};
