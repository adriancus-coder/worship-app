'use strict';

// The big lyrics always have a way out: the top bar (Doar text · A− · A+ · ✕) stays at full
// opacity, small; the bottom bar starts with "✕ Ieși" (44 px) on every device; tapping the
// lyrics shows nothing extra; "✕ Ieși" and Escape return to the page at the same position.
// Leader / operator view, the member's follow view and the rehearsal view; 375 and 1180.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'big-exit',
  timeout: 240000,
  async run({ app, signIn, check }) {
    const { eventId: E, items } = app.seed;
    check((await app.command({ type: 'event.start' })).ok, 'the event is live');
    await app.command({ type: 'worship.goto', itemId: items[0], step: 1 });
    const bar = (p) => p.evaluate(() => {
      const d = document.querySelector('dialog.big-lyrics');
      if (!d || !d.open) return null;
      const top = d.querySelector('.big-top');
      const exit = d.querySelector('.big-nav > .big-exit');
      const r = exit.getBoundingClientRect();
      const first = [...d.querySelectorAll('.big-nav > button')].filter((b) => b.getClientRects().length)[0];
      return { topOpacity: getComputedStyle(top).opacity, topHeight: Math.round(top.getBoundingClientRect().height), exitH: Math.round(r.height), exitW: Math.round(r.width), exitFirst: first === exit, exitText: exit.textContent.trim(), hasClose: Boolean(d.querySelector('.big-close').getClientRects().length) };
    });
    for (const [lang, width, role, url, opener] of [
      ['ro', 375, 'leader', '/live', '.step[aria-current=step]'], ['en', 1180, 'operator', '/operator', '.op-step[aria-current=step]'],
      ['ro', 375, 'member', '/follow', '#big-open'], ['en', 1180, 'member', '/follow', '#big-open'], ['ro', 1180, 'member', '/rehearse', '#big-open'],
    ]) {
      const tag = `[${lang} ${width} ${role}${url}]`;
      const p = await signIn(role, { width, lang });
      await p.goto(`${app.url}/events/${E}${url}`);
      await p.waitForSelector(opener);
      await p.click(opener);
      await p.waitForSelector('dialog.big-lyrics[open]');
      await wait(300);
      let b = await bar(p);
      check(b && b.topOpacity === '1' && b.topHeight <= 60 && b.hasClose && b.exitFirst && b.exitH >= 44 && b.exitW >= 44 && /^(Ieși|Exit)$/.test(b.exitText), `${tag} top bar visible and small, "✕ Ieși" first in the bottom bar (${b && b.exitW}x${b && b.exitH})`, b);
      // a tap on the lyrics shows nothing extra
      const beforeTap = await p.evaluate(() => document.querySelector('dialog.big-lyrics').innerHTML.length);
      await p.click('dialog.big-lyrics .big-body');
      await wait(200);
      check(await p.evaluate((n) => Math.abs(document.querySelector('dialog.big-lyrics').innerHTML.length - n) < 40, beforeTap) && (await bar(p)).topOpacity === '1', `${tag} tapping the lyrics changes nothing, the bar stays`);
      const a = await layoutAudit(p, 'dialog.big-lyrics');
      check(!a.overflow && !a.small.length, `${tag} targets >= 44 px, no overflow`, a);
      // "✕ Ieși" returns at the same position
      const posBefore = url === '/rehearse' ? await p.textContent('#position') : (await app.state()).worship;
      await p.click('dialog.big-lyrics .big-exit');
      await wait(200);
      const closed = !(await p.evaluate(() => Boolean(document.querySelector('dialog.big-lyrics[open]'))));
      const posAfter = url === '/rehearse' ? await p.textContent('#position') : (await app.state()).worship;
      check(closed && JSON.stringify(posBefore) === JSON.stringify(posAfter), `${tag} "✕ Ieși" closes at the same position`, { posBefore, posAfter });
      // Escape too
      await p.click(opener);
      await p.waitForSelector('dialog.big-lyrics[open]');
      await p.keyboard.press('Escape');
      await wait(200);
      check(!(await p.evaluate(() => Boolean(document.querySelector('dialog.big-lyrics[open]')))), `${tag} Escape closes`);
      await p.context().close();
    }
  },
};
