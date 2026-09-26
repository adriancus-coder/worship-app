'use strict';

// Tap or hold (public/press.js) on the Program lists: on the leader page and the console a
// short tap moves there within a second, a long press on a song opens the arrange sheet
// without moving (and its release never clicks the sheet), a finger that moves cancels, a
// long press on a verse does nothing, right-click / Shift+Enter on desktop, the visible
// "Aranjează"; in the editor a tap selects and a long press arranges; the hint once.

const { layoutAudit, wait } = require('./harness');

async function press(p, sel, ms, dy = 0) {
  const target = p.locator(sel).first();
  await target.scrollIntoViewIfNeeded();
  const r = await target.boundingBox();
  const x = r.x + r.width / 2;
  const y = r.y + r.height / 2;
  if (p.touch) {
    const cdp = p.cdp || (p.cdp = await p.context().newCDPSession(p));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await wait(ms / 2);
    if (dy) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + dy, id: 1 }] });
    await wait(ms / 2);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await p.mouse.move(x, y);
    await p.mouse.down();
    await wait(ms / 2);
    if (dy) await p.mouse.move(x, y + dy, { steps: 3 });
    await wait(ms / 2);
    await p.mouse.up();
  }
}

async function tap(p, sel) {
  if (!p.touch) return p.click(sel);
  const target = p.locator(sel).first();
  await target.scrollIntoViewIfNeeded();
  const r = await target.boundingBox();
  return p.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2);
}

const sheetOpen = (p) => p.evaluate(() => Boolean(document.querySelector('dialog.arrange-sheet[open]')));
const closeSheet = async (p) => { await p.keyboard.press('Escape'); await wait(200); };

module.exports = {
  name: 'tap-hold',
  timeout: 300000,
  async run({ app, signIn, check }) {
    const { eventId: E } = app.seed;
    check((await app.command({ type: 'event.start' })).ok, 'the event is live');
    for (const lang of ['ro', 'en']) {
      for (const width of [375, 1024, 1440]) {
        const tag = `[${lang} ${width}]`;
        for (const [who, role, sub, list, item, current] of [
          ['leader', 'leader', 'live', '#setlist', '.live-item', '#setlist .live-item.current .item-title'],
          ['console', 'operator', 'operator', '#op-list', '.op-item', '#op-list .op-item.on-projector .item-title'],
        ]) {
          const p = await signIn(role, { width, lang });
          await p.goto(`${app.url}/events/${E}/${sub}`);
          await p.waitForSelector(`${list} ${item}:not([disabled])`);
          const nth = (i) => `${list} > li:nth-child(${i}) > ${item}`;
          const where = () => p.evaluate((sel) => document.querySelector(sel)?.textContent, current);
          await p.click(nth(1));
          await wait(400);
          const hint = await p.evaluate(() => document.querySelector('#press-hint-live .press-hint-text')?.textContent || null);
          check(Boolean(hint), `${tag} ${who}: the hint "${hint}"`);
          const t0 = Date.now();
          await tap(p, nth(3));
          const moved = await p.waitForFunction((sel) => document.querySelector(sel)?.textContent === 'Șase rânduri', current, { timeout: 3000 }).then(() => true, () => false);
          check(moved && Date.now() - t0 < 1000 && !(await sheetOpen(p)), `${tag} ${who}: a tap on song 3 moves there in ${Date.now() - t0} ms`);
          await press(p, nth(5), 700);
          await wait(300);
          check(await sheetOpen(p) && await where() === 'Șase rânduri', `${tag} ${who}: a long press on song 5 opens the sheet, nothing moves, the release clicks nothing`);
          await closeSheet(p);
          check(!(await p.$('#press-hint-live')), `${tag} ${who}: the first long press hides the hint`);
          await press(p, nth(5), 700, 30);
          await wait(300);
          check(!(await sheetOpen(p)) && await where() === 'Șase rânduri', `${tag} ${who}: moving the finger cancels (no sheet, no move)`);
          await press(p, nth(2), 700);
          await wait(300);
          check(!(await sheetOpen(p)) && await where() === 'Șase rânduri', `${tag} ${who}: a long press on the verse does nothing`);
          if (!p.touch) {
            await p.click(nth(5), { button: 'right' });
            await wait(300);
            check(await sheetOpen(p), `${tag} ${who}: right-click opens the sheet`);
            await closeSheet(p);
            await p.focus(nth(1));
            await p.keyboard.press('Shift+Enter');
            await wait(300);
            check(await sheetOpen(p), `${tag} ${who}: Shift+Enter opens the sheet`);
            await closeSheet(p);
          }
          await p.click(`${list} > li:nth-child(1) .item-arrange`);
          await wait(300);
          check(await sheetOpen(p), `${tag} ${who}: the visible "Aranjează" opens the sheet`);
          await closeSheet(p);
          const a = await layoutAudit(p, list);
          check(!a.overflow && !a.small.length, `${tag} ${who}: no overflow, targets >= 44 px`, a);
          await p.context().close();
        }
        const o = await signIn('owner', { width, lang });
        await o.goto(`${app.url}/events/${E}/edit`);
        await o.waitForSelector('#items .item-main');
        const en = (i) => `#items > li:nth-child(${i}) .item-main`;
        check(Boolean(await o.$('#press-hint-editor')), `${tag} editor: the hint`);
        await tap(o, en(3));
        await wait(300);
        check(await o.getAttribute(en(3), 'aria-expanded') === 'true' && !(await sheetOpen(o)), `${tag} editor: a tap selects (no sheet)`);
        await press(o, en(5), 700);
        await wait(400);
        check(await sheetOpen(o) && await o.getAttribute(en(5), 'aria-expanded') === 'true', `${tag} editor: a long press on a song selects it and opens the sheet`);
        await closeSheet(o);
        await press(o, en(4), 700);
        await wait(300);
        check(!(await sheetOpen(o)), `${tag} editor: a long press on the announcement does nothing`);
        await o.context().close();
      }
    }
  },
};
