'use strict';

// "+ Cântare" adds several songs in a row: the dialog stays open after "Adaugă", the added
// row says "✓ Adăugată" (disabled), the header counts ("3 adăugate"), the field is cleared
// and focused, the Program list behind grows live; "Importă și adaugă" from resurse the
// same; Închide (full width) / ✕ / Escape close it and the Program shows every song in
// order. Verset / Video / Anunț dialogs unchanged. RO 375 / EN 1024 / RO 1180.

const path = require('path');
const { FIXTURES, layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'add-many',
  timeout: 240000,
  app: { preload: [path.join(FIXTURES, 'mock-resurse.js')] },
  async run({ app, signIn, check }) {
    const owner = app.cookies.owner;
    for (const [lang, width] of [['ro', 375], ['en', 1024], ['ro', 1180]]) {
      const tag = `[${lang} ${width}]`;
      for (const s of (await app.api(owner, 'GET', '/api/songs?q=lumina')).body.songs) await app.api(owner, 'DELETE', `/api/songs/${s.id}`);
      const eventId = (await app.api(owner, 'POST', '/api/events', { name: `Adaugă ${width}`, eventDate: app.seed.today, startTime: '18:00' })).body.event.id;
      const p = await signIn('presenter', { width, lang });
      await p.goto(`${app.url}/events/${eventId}/edit`);
      await p.waitForSelector('[data-add="song"]');
      await p.click('[data-add="song"]');
      await p.waitForSelector('#song-dialog[open]');
      const items = () => p.locator('#items li').count();
      const add = async (title) => {
        await p.fill('#pick-q', title);
        await p.click(`#pick-songs li:has-text("${title}") button:not(.result-done)`);
        await p.waitForFunction((tt) => [...document.querySelectorAll('#pick-songs li')].some((li) => li.textContent.includes(tt) && li.querySelector('button.result-done')), title);
      };
      await add('Mare ești Tu');
      const first = await p.evaluate(() => ({
        open: document.getElementById('song-dialog').open, count: document.getElementById('song-dialog-count').textContent,
        q: document.getElementById('pick-q').value, focused: document.activeElement && document.activeElement.id,
        done: [...document.querySelectorAll('#pick-songs li')].filter((li) => li.querySelector('button.result-done')).map((li) => `${li.querySelector('.song-title').textContent}|${li.querySelector('button.result-done').textContent.trim()}|${li.querySelector('button.result-done').disabled}`),
        items: document.querySelectorAll('#items li').length,
      }));
      check(first.open && /^(1 adăugată|1 added)$/.test(first.count) && first.q === '' && first.focused === 'pick-q' && first.done.length === 1 && /^Mare ești Tu\|(Adăugată|Added)\|true$/.test(first.done[0]) && first.items === 1,
        `${tag} "Adaugă": the dialog stays open, the row says "✓ Adăugată" (disabled), "1 adăugată", the field cleared and focused, Program has 1`, first);
      await add('Sfânt în G');
      await add('Șase rânduri');
      check(/^(3 adăugate|3 added)$/.test(await p.textContent('#song-dialog-count')) && (await items()) === 3, `${tag} three in a row: "3 adăugate", Program has 3 live`);
      // from resurse: "Importă și adaugă" keeps the dialog open too
      await p.fill('#pick-q', 'isus');
      await p.keyboard.press('Enter');
      await p.waitForSelector('#pick-online-results li');
      await p.click(`#pick-online-results li:has-text("Tu ești lumina") button:has-text("${lang === 'ro' ? 'Importă și adaugă' : 'Import and add'}")`);
      await p.waitForFunction(() => document.querySelectorAll('#items li').length === 4);
      const online = await p.evaluate(() => ({ open: document.getElementById('song-dialog').open, count: document.getElementById('song-dialog-count').textContent, q: document.getElementById('pick-q').value }));
      check(online.open && /^(4 adăugate|4 added)$/.test(online.count) && online.q === '', `${tag} "Importă și adaugă": imported and added, the dialog stays open, "4 adăugate"`, online);
      const a = await layoutAudit(p, '#song-dialog');
      const closeWidth = await p.evaluate(() => { const b = document.getElementById('song-dialog-close'); return Math.round(b.getBoundingClientRect().width / b.parentElement.getBoundingClientRect().width * 100); });
      check(!a.overflow && !a.small.length && closeWidth >= 98, `${tag} the dialog: targets >= 44 px, "Închide" full width (${closeWidth}%)`, a);
      await p.click('#song-dialog-close');
      await p.waitForFunction(() => !document.getElementById('song-dialog').open);
      const order = await p.$$eval('#items li .item-title', (l) => l.map((x) => x.textContent));
      check(JSON.stringify(order) === JSON.stringify(['Mare ești Tu', 'Sfânt în G', 'Șase rânduri', 'Isus, Tu ești lumina']) || (order.length === 4 && order[0] === 'Mare ești Tu' && order[1] === 'Sfânt în G' && order[2] === 'Șase rânduri'), `${tag} Închide: Program shows all four in order`, order);
      // ✕ and Escape close it too; a new session starts the counter again
      await p.click('[data-add="song"]');
      await p.waitForSelector('#song-dialog[open]');
      check(await p.isHidden('#song-dialog-count') && await p.locator('#pick-songs button.result-done').count() === 0, `${tag} reopened: the counter starts again, no "Adăugată" rows`);
      await p.click('#song-dialog-x');
      await p.waitForFunction(() => !document.getElementById('song-dialog').open);
      await p.click('[data-add="song"]');
      await p.waitForSelector('#song-dialog[open]');
      await p.keyboard.press('Escape');
      await p.waitForFunction(() => !document.getElementById('song-dialog').open);
      check(true, `${tag} ✕ and Escape close it`);
      await p.click('#save-button');
      await p.waitForFunction(() => /Salvat|Saved/.test(document.getElementById('save-state').textContent));
      const saved = (await app.api(owner, 'GET', `/api/events/${eventId}`)).body.items.map((it) => it.type);
      check(saved.length === 4 && saved.every((x) => x === 'song'), `${tag} saved: the 4 songs`, saved);
      // the other dialogs are unchanged: Verset adds one item at once, no song dialog
      await p.click('[data-add="verse"]');
      await wait(300);
      check((await items()) === 5 && !(await p.evaluate(() => document.getElementById('song-dialog').open)), `${tag} Verset: one item, no song dialog`);
      await p.context().close();
    }
  },
};
