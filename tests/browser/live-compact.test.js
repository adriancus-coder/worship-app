'use strict';

// The leader's compact view of the live page: "Vedere: Complet / Compact" (and "Listă" in the
// big lyrics) leaves only the Program, with each song's key and a green tick once the projector
// has shown more than 70 % of its screens (snapshot.shown, lib/live.js); the choice is kept on
// the device; the screen stays on while the event is live (navigator.wakeLock). 375 and 1024.

const { layoutAudit, wait } = require('./harness');

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
    // the tick by hand: a tap on the second item's circle ticks it, another clears it
    await p.click('#setlist li:nth-child(2) .item-done-toggle');
    await p.waitForSelector('#setlist li:nth-child(2) .item-done-toggle.item-done', { timeout: 5000 });
    let marks = await shown();
    check(marks[items[1]].done && marks[items[1]].marked === true && (await p.getAttribute('#setlist li:nth-child(2) .item-done-toggle', 'aria-pressed')) === 'true', 'a tap ticks the song by hand (shared with everyone)', marks[items[1]]);
    await p.click('#setlist li:nth-child(2) .item-done-toggle');
    await p.waitForFunction(() => !document.querySelector('#setlist li:nth-child(2) .item-done-toggle').classList.contains('item-done'), null, { timeout: 5000 });
    marks = await shown();
    check(!marks[items[1]].done && marks[items[1]].marked === false, 'another tap clears it', marks[items[1]]);
    // the grip (the leader has the events right): shown in the compact view; ArrowDown on the
    // first grip moves the first item under the second, on the server too
    const grips = await p.evaluate(() => ({ count: document.querySelectorAll('#setlist .live-item-grip').length, visible: getComputedStyle(document.querySelector('#setlist .live-item-grip')).display !== 'none' }));
    check(grips.count >= 5 && grips.visible, 'compact: a grip on every row', grips);
    const titlesBefore = await p.$$eval('#setlist .item-title', (l) => l.map((x) => x.textContent));
    await p.focus('#setlist li:nth-child(1) .live-item-grip');
    await p.keyboard.press('ArrowDown');
    await p.waitForFunction((first) => { const l = document.querySelectorAll('#setlist .item-title'); return l[1] && l[1].textContent === first; }, titlesBefore[0]);
    await p.waitForFunction((n) => (window.__orderCalls || 0) >= 0 && document.querySelectorAll('#setlist .live-item').length === n, titlesBefore.length);
    await wait(600);
    const serverOrder = (await app.api(app.cookies.owner, 'GET', `/api/events/${E}`)).body.items.map((it) => it.id);
    check(serverOrder[0] === items[1] && serverOrder[1] === items[0] && serverOrder.slice(2, 5).join() === items.slice(2, 5).join(), 'ArrowDown on the first grip: the first two swapped on the server, the rest in place', { serverOrder, items });
    await p.focus('#setlist li:nth-child(2) .live-item-grip');
    await p.keyboard.press('ArrowUp'); // back, so the ticks below read as before
    await wait(600);
    // compact, live: a tap on a song opens its preview under the row; a tap on a section sends the team there
    await p.click('#setlist li:nth-child(3) .live-item .item-title');
    await p.waitForSelector('#setlist li:nth-child(3) .now-song .song-section');
    check((await app.state()).worship.itemId === items[0], 'a tap on the row opens the preview, the team has not moved', (await app.state()).worship);
    await p.click('#setlist li:nth-child(3) .now-song .song-section >> nth=0');
    await p.waitForFunction(() => !document.querySelector('#setlist .now-song'));
    await wait(300);
    check((await app.state()).worship.itemId === items[2] && (await app.state()).worship.step === 0, 'a tap on its first section: the team goes there, the preview closes', (await app.state()).worship);
    await app.command({ type: 'worship.goto', itemId: items[0], step: 0 });
    await wait(300);

    // the key from the Program: a tap on a key badge opens the popover under its row; a pick
    // saves the transposition for the event; a song without a key gets its library key
    await p.click('#setlist li:nth-child(1) .item-key');
    await p.waitForSelector('#setlist li:nth-child(1) .now-key-row .now-keys');
    const popover = await p.evaluate(() => ({ keys: document.querySelectorAll('#setlist li:nth-child(1) .now-keys button').length, pressed: document.querySelector('#setlist li:nth-child(1) .now-keys [aria-pressed="true"]').dataset.key, badge: document.querySelector('#setlist li:nth-child(1) .item-key').getAttribute('aria-pressed') }));
    check(popover.keys === 12 && popover.pressed === 'G' && popover.badge === 'true', 'a tap on "Ton G" opens the 12 keys under the row, G selected', popover);
    await p.click('#setlist li:nth-child(1) .now-keys [data-key="A"]');
    await p.waitForFunction(() => /Ton A/.test(document.querySelector('#setlist li:nth-child(1) .item-key').textContent), null, { timeout: 5000 });
    const transposed = (await app.api(app.cookies.owner, 'GET', `/api/events/${E}`)).body.items[0];
    check(transposed.transpose === 2 && transposed.displayKey === 'A' && !(await p.locator('#setlist .now-key-row').count()), 'A picked: the event item is transposed +2, the popover closes', { transpose: transposed.transpose, displayKey: transposed.displayKey });
    await p.click('#setlist li:nth-child(1) .item-key');
    await p.waitForSelector('#setlist .now-key-row');
    await p.click('#setlist li:nth-child(1) .now-keys [data-key="G"]'); // back
    await p.waitForFunction(() => /Ton G/.test(document.querySelector('#setlist li:nth-child(1) .item-key').textContent), null, { timeout: 5000 });
    const last = (await app.api(app.cookies.owner, 'GET', `/api/events/${E}`)).body.items.length;
    await p.click(`#setlist li:nth-child(${last}) .item-key-none`); // the song without a key
    await p.waitForSelector(`#setlist li:nth-child(${last}) .now-key-minor`);
    await p.click(`#setlist li:nth-child(${last}) .now-key-minor`);
    await p.waitForSelector(`#setlist li:nth-child(${last}) .now-keys [data-key="Em"]`);
    await p.click(`#setlist li:nth-child(${last}) .now-keys [data-key="Em"]`);
    await p.waitForFunction((n) => /Ton Em|Ton Mim/.test(document.querySelector(`#setlist li:nth-child(${n}) .item-key`).textContent), last, { timeout: 5000 });
    check((await app.api(app.cookies.owner, 'GET', `/api/songs/${noKeyId}`)).body.song.song_key === 'Em', 'a song without a key: "minor" then Em sets the library key', null);

    // "Adaugă": the console's add panel on this page too (search, "În setlist"), the Program hidden meanwhile
    await p.click('#live-tab-add');
    const addTab = await p.evaluate(() => ({ list: document.getElementById('setlist').hidden, add: document.getElementById('live-add').hidden, stored: localStorage.getItem('wa_live_left'), newSong: !document.getElementById('live-new-song').disabled }));
    check(addTab.list && !addTab.add && addTab.stored === 'add' && addTab.newSong, '"Adaugă" on the live page: the add panel alone, remembered, "+ Cântare nouă" enabled while live', addTab);
    const extraSong = (await app.api(app.cookies.owner, 'POST', '/api/songs', { title: 'Adăugată din live', sections: [{ type: 'verse', content: 'Un rând' }] })).body.song.id;
    await p.fill('#add-q', 'Adăugată din live');
    await p.waitForSelector('#add-songs li');
    await p.click('#add-songs li >> nth=0 >> button:has-text("În setlist")');
    await wait(800);
    const afterAdd = (await app.api(app.cookies.owner, 'GET', `/api/events/${E}`)).body.items;
    check(afterAdd.some((it) => it.songId === extraSong), '"În setlist" from the live page adds the song to the Program', afterAdd.map((it) => it.songId));
    await p.click('#live-tab-program');
    await p.waitForFunction(() => !document.getElementById('setlist').hidden);

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
    check(/Scoate bifa/.test(label), 'the tick says what a tap does (clears it)', label);

    // opened again (the page itself, not the lyrics): still compact; "Complet" brings the page back
    await p.goto(`${app.url}/events/${E}/live?view=full`);
    await p.waitForSelector('#live:not([hidden])');
    check(await p.evaluate(() => document.body.classList.contains('live-compact')), 'after a reload: still compact');
    await p.click('#live-view [data-view="full"]');
    const full = await p.evaluate(() => ({ compact: document.body.classList.contains('live-compact'), current: getComputedStyle(document.querySelector('.live-current')).display, stored: localStorage.getItem('wa_live_compact') }));
    check(!full.compact && full.current !== 'none' && full.stored === '0', '"Complet": the full page again, remembered', full);

    // --- desktop (the leader: the switch is theirs): the switch on the full page, the tick rendered
    const o = await signIn('leader', { width: 1024, lang: 'ro' });
    await o.goto(`${app.url}/events/${E}/live?view=full`);
    await o.waitForSelector('#live-view [data-view="compact"]');
    await o.click('#live-view [data-view="compact"]');
    await o.waitForFunction(() => document.body.classList.contains('live-compact'));
    const b = await layoutAudit(o, '#live');
    check(!b.overflow && !b.small.length && (await o.locator('#setlist .item-done').count()) >= 1, 'the compact view 1024: no overflow, the tick shown', b);

    // the event page's "Program compact" (the leader): the compact view at once, no big lyrics
    await p.goto(`${app.url}/events/${E}`);
    await p.waitForSelector('#event-actions a[href*="view=compact"]');
    await p.click('#event-actions a[href*="view=compact"]');
    await p.waitForSelector('#setlist .live-item');
    await wait(500);
    const direct = await p.evaluate(() => ({ compact: document.body.classList.contains('live-compact'), big: Boolean(document.querySelector('dialog.big-lyrics[open]')), actions: [...document.querySelectorAll('#event-actions a')].length }));
    check(direct.compact && !direct.big, '"Program compact" from the event page: the compact view, no big lyrics over it', direct);

    // after the end the ticks stay (the history of the service); a finished event never restarts
    await app.command({ type: 'event.end' });
    sh = await shown();
    check(sh[items[0]].done && (await app.command({ type: 'event.start' })).code === 'finished', 'after the end: the ticks stay; no second start', sh[items[0]]);
  },
};
