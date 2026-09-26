'use strict';

// "■ Sfârșit" (worship.endItem, key E) on the leader page and the console: always there
// while an item is on screen; it ends the item in place (the screen goes black, logo or
// not; the position stays; L still shows the logo) and becomes "✓ Terminat" until the next move;
// "Următoarea" then reads "Următoarea: <next item> →". Next -> the next item's first step,
// prev -> the ended song's last step, content back. The last item is no special case. In
// split mode the console clears only the projector, the leader only the team. The team page
// shows "Sfârșitul cântării · Urmează: …". A member cannot send it. RO/EN; 375/1024/1440.

const fs = require('fs');
const path = require('path');
const { FIXTURES, layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'end-item',
  timeout: 300000,
  async run({ app, browser, signIn, check }) {
    const { eventId: E, items } = app.seed;
    const [G, VERSE, SIX, , T3] = items;
    const name = Object.fromEntries(items.map((id, i) => [id, ['G', 'verse', 'six', 'ann', 'T3'][i]]));
    const state = async () => {
      await wait(350);
      const s = await app.state();
      return { team: `${name[s.worship.itemId]}.${s.worship.step}${s.worship.ended ? ' ended' : ''}`, projector: s.mode === 'split' ? `${name[s.projector.itemId]}.${s.projector.step}${s.projector.ended ? ' ended' : ''}` : 'follows', source: s.projector.source };
    };
    const button = (p, sel) => p.evaluate((sel) => { const b = document.querySelector(sel); return { text: b.textContent, disabled: b.disabled }; }, sel);
    const reset = async () => {
      await app.command({ type: 'live.mode', mode: 'together' });
      await app.command({ type: 'projector.source', source: 'content' });
      await app.command({ type: 'worship.goto', itemId: G, step: 0 });
      await wait(300);
    };
    // A screen, to see what the projector shows.
    const sp = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    await sp.goto(`${app.url}/screen`);
    await sp.waitForFunction(() => /\d{3} \d{3}/.test(document.getElementById('pairing-code').textContent));
    await app.api(app.cookies.owner, 'POST', '/api/screens/claim', { code: (await sp.textContent('#pairing-code')).replace(' ', ''), name: 'Proiector' });
    await sp.waitForSelector('#output:not([hidden])', { timeout: 6000 });
    const screen = async () => { await wait(300); return sp.evaluate(() => { const o = document.getElementById('output'); return o.querySelector('.projector-stage').innerText.trim().replace(/\s+/g, ' ') || (o.querySelector('.projector-logo') ? 'LOGO' : 'BLACK'); }); };
    check((await app.command({ type: 'event.start' })).ok, 'the event is live');

    for (const withLogo of [false, true]) {
      if (withLogo) await app.api(app.cookies.owner, 'PUT', '/api/settings/logo', fs.readFileSync(path.join(FIXTURES, 'logo.png')), { 'Content-Type': 'image/png' });
      const clear = 'BLACK'; // always, logo or not
      for (const [lang, width] of [['ro', 375], ['en', 1024], ['ro', 1440]]) {
        if (!withLogo && width === 1440) continue;
        if (withLogo && width === 1024) continue;
        const tag = `[${lang} ${width} ${withLogo ? 'logo' : 'no logo'}]`;
        const END = lang === 'ro' ? 'Sfârșit' : 'End';
        const DONE = lang === 'ro' ? 'Terminat' : 'Ended';
        await reset();
        const m = await signIn('member', { width: 375, lang });
        await m.goto(`${app.url}/events/${E}/follow`);
        await m.waitForSelector('#follow:not([hidden])');
        const L = await signIn('leader', { width, lang });
        await L.goto(`${app.url}/events/${E}/live`);
        await L.waitForSelector('#end-item-button:not([hidden])');
        await L.click('#next-button'); // mid-song: G.1
        await wait(300);
        const row = await L.evaluate(() => {
          const r = (s) => document.querySelector(s).getBoundingClientRect();
          const [a, b, c] = [r('#prev-button'), r('#end-item-button'), r('#next-button')];
          return { twoLines: Math.abs(a.top - b.top) < 2 && c.top > b.bottom - 1 && c.width > b.width * 1.8, oneRow: Math.abs(a.top - c.top) < 2 && Math.abs(b.top - c.top) < 2 };
        });
        check(width < 600 ? row.twoLines : row.oneRow, `${tag} ${width < 600 ? 'Înapoi + Sfârșit on one line, Următoarea full width below' : 'one row of three'}`, row);
        const a = await layoutAudit(L, '.live-nav');
        check(!a.overflow && !a.small.length, `${tag} the row: no overflow, targets >= 44 px`, a);
        let b = await button(L, '#end-item-button');
        check(b.text === END && !b.disabled, `${tag} mid-song: "■ ${END}" enabled`, b);
        await L.click('#end-item-button');
        const s1 = await state();
        check(s1.team === 'G.1 ended' && s1.source === 'content' && await screen() === clear, `${tag} "${END}": the position stays (G.1), the screen shows ${clear}`, s1);
        b = await button(L, '#end-item-button');
        check(b.text === DONE && b.disabled, `${tag} the button reads "✓ ${DONE}" (disabled)`, b);
        const nextText = await L.textContent('#next-button');
        check(nextText.includes('Luca 2:1-7'), `${tag} "Următoarea" names the next item: "${nextText}"`);
        const follow = await m.waitForFunction(() => /Sfârșitul cântării|End of the song/.test(document.getElementById('slide').innerText) && /Luca 2:1-7/.test(document.getElementById('slide').innerText), null, { timeout: 3000 }).then(() => true, () => false);
        check(follow, `${tag} team page: "Sfârșitul cântării · Urmează: Luca 2:1-7"`);
        if (withLogo) {
          await L.keyboard.press('l');
          check(await screen() === 'LOGO', `${tag} L while ended: the explicit Logo source still shows the logo`);
          await L.keyboard.press('l');
          check(await screen() === 'BLACK', `${tag} L again: back to the ended item's black, not the lyrics`);
        }
        await L.keyboard.press('ArrowRight');
        const s2 = await state();
        check(s2.team === 'verse.0' && /Cezar/.test(await screen()), `${tag} next -> the next item's first step, content back`, s2);
        if (withLogo) {
          await L.keyboard.press('l');
          check(await screen() === 'LOGO', `${tag} L after the move: the logo is still available`);
          await L.keyboard.press('l');
        }
        check((await button(L, '#end-item-button')).text === END, `${tag} after the move: "■ ${END}" again`);
        await app.command({ type: 'worship.goto', itemId: G, step: 0 });
        await wait(300);
        await L.keyboard.press('e');
        await L.click('#prev-button');
        const s3 = await state();
        check(s3.team === 'G.1' && /Sfânt/.test(await screen()), `${tag} key E, then prev -> the ended song's last step (G.1), content back`, s3);
        await app.command({ type: 'worship.goto', itemId: T3, step: 1 });
        await wait(300);
        check(!(await button(L, '#end-item-button')).disabled, `${tag} the last item: "${END}" enabled too`);
        await L.click('#end-item-button');
        const s4 = await state();
        check(s4.team === 'T3.1 ended' && await screen() === clear, `${tag} the last item: the position stays, the screen cleared`, s4);

        // console + split: the console clears only the projector, the leader only the team
        await reset();
        const C = await signIn('operator', { width, lang });
        await C.goto(`${app.url}/events/${E}/operator`);
        await C.waitForSelector('#op-end-item:not([disabled])');
        await app.command({ type: 'live.mode', mode: 'split' });
        await app.command({ type: 'projector.goto', itemId: SIX, step: 0 });
        await wait(400);
        await C.click('#op-end-item');
        let t = await state();
        check(t.projector === 'six.0 ended' && t.team === 'G.0' && await screen() === clear, `${tag} split: the console clears only the projector`, t);
        check((await button(C, '#op-end-item')).disabled, `${tag} console: "✓ ${DONE}"`);
        await L.click('#end-item-button');
        t = await state();
        check(t.team === 'G.0 ended' && t.projector === 'six.0 ended', `${tag} split: the leader ends only the team's item`, t);
        await C.keyboard.press('ArrowRight');
        t = await state();
        check(t.projector === 'ann.0' && t.team === 'G.0 ended' && /Agapă|serviciu/.test(await screen()), `${tag} split: the console moves on, the team stays ended`, t);
        await L.context().close();
        await C.context().close();
        await m.context().close();
      }
    }
    const mem = await signIn('member', { width: 375 });
    const forced = await mem.evaluate((eventId) => new Promise((resolve) => {
      const s = window.io({ transports: ['websocket'] });
      s.on('connect', () => s.emit('live:join', { eventId }, () => s.emit('live:command', { type: 'worship.endItem', eventId }, (r) => { s.close(); resolve(r); })));
    }), E);
    check(forced.code === 'forbidden', 'a member cannot send worship.endItem', forced);
    void VERSE;
  },
};
