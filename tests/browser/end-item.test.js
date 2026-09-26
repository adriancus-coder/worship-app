'use strict';

// "End of the item" (worship.endItem, key E) on the leader page and the console: the next
// item's first step ("Următoarea cântare →" / "Următorul element →" with its title); after
// the last item "Sfârșit" clears the screen to the logo (black without one) and the position
// stays; in split mode the console ends only the projector's item, the leader only the
// team's; a member cannot send it; the row on phones.

const fs = require('fs');
const path = require('path');
const { FIXTURES, layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'end-item',
  timeout: 240000,
  async run({ app, signIn, check }) {
    const { eventId: E, items } = app.seed;
    const [G, VERSE, SIX, ANN, T3] = items;
    const name = { [G]: 'G', [VERSE]: 'verse', [SIX]: 'six', [ANN]: 'ann', [T3]: 'T3' };
    const state = async () => { await wait(350); const s = await app.state(); return { team: `${name[s.worship.itemId]}.${s.worship.step}`, projector: s.mode === 'split' ? `${name[s.projector.itemId]}.${s.projector.step}` : 'follows', source: s.projector.source }; };
    const label = (p, sel) => p.evaluate((sel) => { const b = document.querySelector(sel); return { text: [...b.children].map((c) => c.textContent).join(' / '), disabled: b.disabled }; }, sel);
    const reset = async () => {
      await app.command({ type: 'live.mode', mode: 'together' });
      await app.command({ type: 'projector.source', source: 'content' });
      await app.command({ type: 'worship.goto', itemId: G, step: 1 });
      await wait(300);
    };
    check((await app.command({ type: 'event.start' })).ok, 'the event is live');
    for (const withLogo of [false, true]) {
      if (withLogo) await app.api(app.cookies.owner, 'PUT', '/api/settings/logo', fs.readFileSync(path.join(FIXTURES, 'logo.png')), { 'Content-Type': 'image/png' });
      const clear = withLogo ? 'logo' : 'black';
      for (const width of [375, 1440]) {
        const tag = `[${width} ${withLogo ? 'logo' : 'no logo'}]`;
        await reset();
        const L = await signIn('leader', { width });
        await L.goto(`${app.url}/events/${E}/live`);
        await L.waitForSelector('#end-item-button:not([hidden])');
        await wait(400);
        const row = await L.evaluate(() => {
          const r = (s) => document.querySelector(s).getBoundingClientRect();
          const [a, b, c] = [r('#prev-button'), r('#end-item-button'), r('#next-button')];
          return { twoLines: Math.abs(a.top - b.top) < 2 && c.top > b.bottom - 1, oneRow: Math.abs(a.top - c.top) < 2 && Math.abs(b.top - c.top) < 2 };
        });
        check(width < 600 ? row.twoLines : row.oneRow, `${tag} ${width < 600 ? 'Înapoi + end on one line, Următoarea below' : 'one row of three'}`, row);
        const a = await layoutAudit(L, '.live-nav');
        check(!a.overflow && !a.small.length, `${tag} the row: no overflow, targets >= 44 px`, a);
        check((await label(L, '#end-item-button')).text === 'Următorul element → / Luca 2:1-7', `${tag} at the song: "Următorul element → / Luca 2:1-7"`, await label(L, '#end-item-button'));
        await L.click('#end-item-button');
        check((await state()).team === 'verse.0', `${tag} click -> the verse, first step`);
        check((await label(L, '#end-item-button')).text === 'Următoarea cântare → / Șase rânduri', `${tag} at the verse: "Următoarea cântare → / Șase rânduri"`);
        await L.keyboard.press('e');
        check((await state()).team === 'six.0', `${tag} key E -> the next song`);
        await app.command({ type: 'worship.goto', itemId: T3, step: 1 });
        await wait(300);
        check((await label(L, '#end-item-button')).text === 'Sfârșit', `${tag} the last item: "Sfârșit"`);
        await L.click('#end-item-button');
        const s = await state();
        check(s.team === 'T3.1' && s.source === clear, `${tag} "Sfârșit": the position stays, the screen -> ${clear}`, s);
        check((await label(L, '#end-item-button')).disabled, `${tag} "Sfârșit" is then disabled`);

        await reset();
        const C = await signIn('operator', { width });
        await C.goto(`${app.url}/events/${E}/operator`);
        await C.waitForSelector('#op-end-item:not([disabled])');
        await C.click('#op-end-item');
        check((await state()).team === 'verse.0', `${tag} console together: moves the one position`);
        await app.command({ type: 'live.mode', mode: 'split' });
        await app.command({ type: 'projector.goto', itemId: SIX, step: 0 });
        await wait(400);
        await C.click('#op-end-item');
        let t = await state();
        check(t.projector === 'ann.0' && t.team === 'verse.0', `${tag} split: the console ends only the projector's item`, t);
        await L.click('#end-item-button');
        t = await state();
        check(t.team === 'six.0' && t.projector === 'ann.0', `${tag} split: the leader ends only the team's item`, t);
        await app.command({ type: 'worship.goto', itemId: T3, step: 1 });
        await wait(300);
        check((await label(L, '#end-item-button')).disabled, `${tag} split, team on the last item: the leader's "Sfârșit" is disabled`);
        await app.command({ type: 'projector.goto', itemId: T3, step: 0 });
        await wait(300);
        await C.keyboard.press('e');
        t = await state();
        check(t.projector === 'T3.0' && t.source === clear && t.team === 'T3.1', `${tag} split: the console's "Sfârșit" (E) clears only the projector`, t);
        await L.context().close();
        await C.context().close();
      }
    }
    const m = await signIn('member', { width: 375 });
    const forced = await m.evaluate((eventId) => new Promise((resolve) => {
      const s = window.io({ transports: ['websocket'] });
      s.on('connect', () => s.emit('live:join', { eventId }, () => s.emit('live:command', { type: 'worship.endItem', eventId }, (r) => { s.close(); resolve(r); })));
    }), E);
    check(forced.code === 'forbidden', 'a member cannot send worship.endItem', forced);
  },
};
