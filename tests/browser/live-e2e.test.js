'use strict';

// Live end to end: a leader drives, a member follows on a phone. Every move reaches the
// member within a second; a member cannot command; "Doar text"; the setlist edited during
// live (the current song removed) moves everyone to the next item; a server restart
// (SIGTERM, lib/shutdown.js) shows "Se reconectează…" at once and comes back to the same
// place; the end.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'live-e2e',
  timeout: 240000,
  async run({ app, signIn, check }) {
    const { eventId: E } = app.seed;
    const lp = await signIn('leader', { width: 1024 });
    const mp = await signIn('member', { width: 375 });
    await mp.goto(`${app.url}/events/${E}/follow`);
    await mp.waitForSelector('#follow:not([hidden])');
    await mp.waitForFunction(() => document.getElementById('connection-text').textContent === 'Conectat');
    check(await mp.locator('#prev-button, #next-button, #start-button, #end-button, .step, .live-item').count() === 0, 'member follow page: no command controls');
    await lp.goto(`${app.url}/events/${E}/live`);
    await lp.waitForSelector('#live:not([hidden])');
    await lp.waitForFunction(() => /2/.test(document.getElementById('presence').textContent), null, { timeout: 5000 });
    check(true, 'leader sees the member online');

    const title = () => mp.evaluate(() => (document.querySelector('#slide h1') || {}).textContent || '');
    let worst = 0;
    async function move(label, action, expect) {
      const t0 = Date.now();
      await action();
      const ok = await mp.waitForFunction((x) => (document.querySelector('#slide h1') || {}).textContent === x
        && !document.getElementById('slide').innerText.includes('Se încarcă'), expect, { timeout: 3000 }).then(() => true, () => false);
      const ms = Date.now() - t0;
      worst = Math.max(worst, ms);
      check(ok, `${label} -> member at "${expect}" in ${ms} ms`, await title());
    }
    await move('start', () => lp.click('#start-button'), 'Sfânt în G');
    await move('next (section)', () => lp.click('#next-button'), 'Sfânt în G');
    await move('next (the verse)', () => lp.click('#next-button'), 'Luca 2:1-7');
    await move('prev', () => lp.click('#prev-button'), 'Sfânt în G');
    await move('tap Program item 3', () => lp.click('#setlist > li:nth-child(3) > .live-item'), 'Șase rânduri');
    await move('key →', () => lp.keyboard.press('ArrowRight'), 'Agapă');
    await move('tap a step of song 1', async () => { await lp.click('#setlist > li:nth-child(1) > .live-item'); await lp.waitForSelector('.step >> nth=1'); await lp.click('.step >> nth=1'); }, 'Sfânt în G');
    check(worst < 1000, `every move reached the member within a second (worst ${worst} ms)`);

    const forced = await mp.evaluate((eventId) => new Promise((resolve) => {
      const s = window.io({ transports: ['websocket'] });
      s.on('connect', () => s.emit('live:join', { eventId }, () => s.emit('live:command', { type: 'worship.next', eventId }, (r) => { s.close(); resolve(r); })));
    }), E);
    check(forced.ok === false && forced.code === 'forbidden', 'a member socket command is refused', forced);

    await mp.click('#text-only');
    check(await mp.locator('#slide .chord-line').count() === 0, '"Doar text" hides the chords');
    await mp.click('#text-only');

    // The current song removed from the setlist during live: everyone moves to the next item.
    const ev = (await app.api(app.cookies.owner, 'GET', `/api/events/${E}`)).body;
    const kept = ev.items.slice(1).map(({ id, type, songId, reference, body, title: t }) => ({ id, type, songId, reference, body, title: t }));
    await move('setlist saved without the current song', () => app.api(app.cookies.owner, 'PUT', `/api/events/${E}/items`, { items: kept }), 'Luca 2:1-7');
    await lp.waitForFunction(() => document.querySelector('.live-item.current .item-title')?.textContent === 'Luca 2:1-7', null, { timeout: 3000 });
    check(true, 'the leader page follows the edited setlist');

    // A clean restart: both pages say "Se reconectează…" at once, then come back to the same place.
    const t0 = Date.now();
    const stopping = app.stop();
    await mp.waitForFunction(() => document.getElementById('connection-text').textContent === 'Se reconectează…', null, { timeout: 5000 });
    check(Date.now() - t0 < 2000, `member shows "Se reconectează…" ${Date.now() - t0} ms after SIGTERM`);
    const code = await stopping;
    check(code === 0, `the server stopped cleanly (exit ${code}) in ${Date.now() - t0} ms`);
    await app.start();
    for (const p of [mp, lp]) await p.waitForFunction(() => document.getElementById('connection-text').textContent === 'Conectat', null, { timeout: 15000 });
    check(await title() === 'Luca 2:1-7', 'after the restart both reconnect to the same item', await title());
    await move('next after the restart', () => lp.click('#next-button'), 'Șase rânduri');

    await mp.request.put(`${app.url}/api/me/locale`, { data: { locale: 'en' } });
    await mp.reload();
    await mp.waitForSelector('#follow:not([hidden])');
    check(/Connected/.test(await mp.textContent('#connection-text')), 'member page in English');
    for (const [who, p, scope] of [['member', mp, '#follow'], ['leader', lp, '#live']]) {
      const a = await layoutAudit(p, scope);
      check(!a.overflow && !a.small.length, `${who}: no overflow, targets >= 44 px`, a);
    }
    await lp.click('#end-button');
    await lp.click('#end-dialog button[value=end]');
    await lp.waitForURL('**/app');
    const ended = await mp.waitForFunction(() => /ended|încheiat/i.test(document.getElementById('slide').innerText), null, { timeout: 3000 }).then(() => true, () => false);
    check(ended, 'end: the leader lands on Acasă, the member sees the event ended');
    await wait(100);
  },
};
