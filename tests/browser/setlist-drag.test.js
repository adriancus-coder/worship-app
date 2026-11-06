'use strict';

// The editor's Program reorders by dragging the grip (≡, public/drag-list.js): the leader
// (RO 375, touch) drags the first item under the second, the rows take the new order, the
// Program is unsaved until "Salvează" and the server has the order after; the arrow keys on a
// grip move the item one place; Escape during a drag puts it back; no ↑ / ↓ buttons any
// more; targets >= 44 px.

const { layoutAudit } = require('./harness');

module.exports = {
  name: 'setlist-drag',
  timeout: 120000,
  async run({ app, signIn, check }) {
    const E = app.seed.eventId; // five items
    const p = await signIn('leader', { width: 375, lang: 'ro' });
    await p.goto(`${app.url}/events/${E}/edit`);
    await p.waitForSelector('#items li .item-grip');
    const titles = () => p.evaluate(() => [...document.querySelectorAll('#items li .item-title')].map((n) => n.textContent));
    const before = await titles();
    check(before.length === 5 && (await p.locator('#items [data-action="up"], #items [data-action="down"]').count()) === 0 && (await p.locator('#items .item-grip').count()) === 5, 'five items, a grip on each, no ↑ / ↓ buttons', before);
    check(/Trage ≡/.test(await p.textContent('#reorder-hint')) && /Trage ≡ ca să muți/.test(await p.textContent('#press-hint-editor')) && await p.isHidden('#reorder-hint'), 'the hints say to drag ≡ (on the phone: the press hint)', await p.textContent('#press-hint-editor'));

    // drag the first item's grip to under the second one
    const grip = await p.locator('#items li:nth-child(1) .item-grip').boundingBox();
    const second = await p.locator('#items li:nth-child(2)').boundingBox();
    const x = grip.x + grip.width / 2;
    const y = grip.y + grip.height / 2;
    await p.mouse.move(x, y);
    await p.mouse.down();
    await p.mouse.move(x, y + 20, { steps: 4 });
    const mid = await p.evaluate(() => ({ dragging: Boolean(document.querySelector('#items li.is-dragging')), reordering: document.getElementById('items').classList.contains('is-reordering'), noSelect: getComputedStyle(document.body).userSelect === 'none' }));
    check(mid.dragging && mid.reordering && mid.noSelect, 'while dragging: the row is lifted, the list reorders, no text selection', mid);
    await p.mouse.move(x, second.y + second.height, { steps: 10 });
    await p.mouse.up();
    const after = await titles();
    check(after[0] === before[1] && after[1] === before[0] && after.slice(2).join('|') === before.slice(2).join('|'), 'dropped under the second: the first two swapped, the rest unchanged', after);
    check(!(await p.locator('#items li.is-dragging').count()) && !(await p.evaluate(() => [...document.querySelectorAll('#items li')].some((li) => li.style.transform))), 'after the drop: nothing lifted or shifted');
    check(/Nesalvat|nesalvat/.test(await p.textContent('#save-state')), 'the Program is unsaved', await p.textContent('#save-state'));

    // Escape during a drag: back where it was
    const g3 = await p.locator('#items li:nth-child(3) .item-grip').boundingBox();
    await p.mouse.move(g3.x + g3.width / 2, g3.y + g3.height / 2);
    await p.mouse.down();
    await p.mouse.move(g3.x + g3.width / 2, g3.y - 120, { steps: 8 });
    await p.keyboard.press('Escape');
    await p.mouse.up();
    check((await titles()).join('|') === after.join('|') && !(await p.locator('#items li.is-dragging').count()), 'Escape during a drag: the order is unchanged');

    // the keyboard: the arrows on a grip move the item one place
    await p.focus('#items li:nth-child(5) .item-grip');
    await p.keyboard.press('ArrowUp');
    const keyed = await titles();
    check(keyed[3] === after[4] && keyed[4] === after[3] && (await p.evaluate(() => document.activeElement.classList.contains('item-grip') && document.activeElement.dataset.index === '3')), 'ArrowUp on the last grip: moved up one place, the focus follows', keyed);

    const a = await layoutAudit(p, '#items');
    check(!a.overflow && !a.small.length, 'leader 375: no overflow, targets >= 44 px', a);

    // saved: the server has the order
    await p.click('#save-button');
    await p.waitForFunction(() => /Salvat/.test(document.getElementById('save-state').textContent));
    const saved = (await app.api(app.cookies.leader, 'GET', `/api/events/${E}`)).body.items.map((it) => it.title || (it.song && it.song.title) || it.reference || '');
    check(saved.length === 5 && keyed.every((t, i) => saved[i].includes(t) || t.includes(saved[i]) || saved[i] === '' || t === ''), 'saved: the server has the new order', { saved, keyed });
  },
};
