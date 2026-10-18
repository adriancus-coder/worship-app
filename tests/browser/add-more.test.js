'use strict';

// The add bar under the Program is one row: "+ Cântare", "+ Verset" and "+ Altele", a menu
// with the other types (Video, Anunț, Predică, Rugăciune, Altceva). Picking one adds that
// item and closes the menu; Escape and a tap outside close it. One row at 375 and 1024.

const { layoutAudit } = require('./harness');

module.exports = {
  name: 'add-more',
  async run({ app, signIn, check }) {
    const owner = app.cookies.owner;
    for (const [lang, width] of [['ro', 375], ['en', 1024]]) {
      const tag = `[${lang} ${width}]`;
      const id = (await app.api(owner, 'POST', '/api/events', { name: `Altele ${width}`, eventDate: app.seed.today, startTime: '18:00' })).body.event.id;
      const p = await signIn('leader', { width, lang });
      await p.goto(`${app.url}/events/${id}/edit`);
      await p.waitForSelector('#add-bar:not([hidden])');
      const bar = await p.evaluate(() => {
        const top = (s) => Math.round(document.querySelector(s).getBoundingClientRect().top);
        return { tops: new Set(['[data-add="song"]', '[data-add="verse"]', '#add-more-button'].map(top)).size, visible: [...document.querySelectorAll('#add-bar [data-add]')].filter((b) => b.getClientRects().length).map((b) => b.dataset.add), hidden: document.getElementById('add-more-list').hidden, label: document.getElementById('add-more-button').textContent.trim() };
      });
      check(bar.tops === 1 && JSON.stringify(bar.visible) === '["song","verse"]' && bar.hidden && /^(Altele|More)/.test(bar.label), `${tag} one row: + Cântare · + Verset · + Altele; the other types out of sight`, bar);
      const a = await layoutAudit(p, '#add-bar');
      check(!a.overflow && !a.small.length, `${tag} the bar: no overflow, targets >= 44 px`, a);
      await p.click('#add-more-button');
      await p.waitForSelector('#add-more-list:not([hidden])');
      const menu = await p.evaluate(() => ({ items: [...document.querySelectorAll('#add-more-list [data-add]')].map((b) => b.dataset.add), expanded: document.getElementById('add-more-button').getAttribute('aria-expanded'), focused: document.activeElement && document.activeElement.dataset.add, inView: document.getElementById('add-more-list').getBoundingClientRect().bottom <= innerHeight, sideways: document.querySelector('.setlist-scroll').scrollLeft, inside: document.getElementById('add-more-list').getBoundingClientRect().right <= document.querySelector('.setlist-scroll').getBoundingClientRect().right + 1 }));
      check(JSON.stringify(menu.items) === '["video","announcement","sermon","prayer","other"]' && menu.expanded === 'true' && menu.focused === 'video' && menu.inView && !menu.sideways && menu.inside, `${tag} "+ Altele" opens the menu: Video · Anunț · Predică · Rugăciune · Altceva, in view inside the pane (no sideways scroll), the first focused`, menu);
      const m = await layoutAudit(p, '#add-more-list');
      check(!m.overflow && !m.small.length, `${tag} the menu: no overflow, targets >= 44 px`, m);
      await p.keyboard.press('Escape');
      check(await p.$eval('#add-more-list', (x) => x.hidden) && (await p.evaluate(() => document.activeElement.id)) === 'add-more-button', `${tag} Escape closes it, the focus back on the button`);
      await p.click('#add-more-button');
      await p.click('[data-add="sermon"]');
      await p.waitForSelector('#it-who');
      const after = await p.evaluate(() => ({ hidden: document.getElementById('add-more-list').hidden, items: [...document.querySelectorAll('#items li .type-badge, #items li .badge')].map((b) => b.textContent.trim()), count: document.querySelectorAll('#items li').length }));
      check(after.hidden && after.count === 1, `${tag} "Predică" from the menu adds the item and closes the menu`, after);
      await p.context().close();
    }
  },
};
