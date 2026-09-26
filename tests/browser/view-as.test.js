'use strict';

// "Vezi aplicația ca": the owner switches the effective role from Mai mult; the app then
// behaves exactly as for that role (home card, menu, pages, guards) with a persistent bar and
// "Revino la proprietar"; Platformă is hidden meanwhile; leader / member have no switch.
// RO / EN; 375 / 1024.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'view-as',
  timeout: 240000,
  async run({ app, signIn, check }) {
    const { eventId: E } = app.seed;
    const menuPages = async (p) => {
      await p.waitForSelector('#app-shell .shell-label:not(:empty)');
      await p.click('.shell-more');
      await p.waitForSelector('#shell-panel:not([hidden])');
      const out = await p.evaluate(() => ({
        pages: [...document.querySelectorAll('#shell-panel li:not([hidden]) .shell-row[data-page]')].map((a) => a.dataset.page),
        viewAs: [...document.querySelectorAll('#shell-panel [data-view-as]')].filter((b) => !b.closest('[hidden]')).map((b) => `${b.dataset.viewAs}:${b.getAttribute('aria-pressed')}`),
      }));
      return out;
    };
    const closeMenu = async (p) => { await p.keyboard.press('Escape'); await wait(250); };
    const bar = (p) => p.evaluate(() => { const b = document.getElementById('view-as-bar'); return b && !b.hidden ? b.textContent : null; });
    const cardPrimary = (p) => p.evaluate(() => (document.querySelector('#now .now-primary') || {}).textContent || null);

    for (const role of ['leader', 'member']) {
      const q = await signIn(role, { width: 375 });
      const m = await menuPages(q);
      check(m.viewAs.length === 0, `${role}: no "Vezi aplicația ca"`, m.viewAs);
      check((await app.api(app.cookies[role], 'PUT', '/api/me/view-as', { role: 'member' })).status === 403, `${role}: the API refuses (403)`);
      await q.context().close();
    }

    for (const [lang, width] of [['ro', 1024], ['en', 375]]) {
      const tag = `[${lang} ${width}]`;
      const p = await signIn('owner', { width, lang });
      await p.goto(`${app.url}/app`);
      let m = await menuPages(p);
      check(m.viewAs.join(',') === 'owner:true,presenter:false,leader:false,operator:false,member:false' && m.pages.includes('team') && m.pages.includes('platform'), `${tag} owner: the switch with Proprietar selected; Echipa and Platformă in the menu`, m);
      check(await bar(p) === null, `${tag} owner: no bar`);
      // as member
      await p.click('#shell-panel [data-view-as="member"]');
      await p.waitForURL('**/app');
      await p.waitForSelector('#now .now-card');
      await p.waitForSelector('#view-as-bar:not([hidden])');
      const barText = await bar(p);
      check(/(Vezi ca membru|Viewing as member)/.test(barText) && /(Revino la proprietar|Back to owner)/.test(barText), `${tag} member: the bar "${barText.trim()}"`);
      check(await cardPrimary(p) === (lang === 'ro' ? 'Repetiție' : 'Rehearsal'), `${tag} member: the home card is the member's ("Repetiție")`, await cardPrimary(p));
      m = await menuPages(p);
      check(!m.pages.includes('team') && !m.pages.includes('settings') && !m.pages.includes('media') && !m.pages.includes('platform') && m.viewAs.includes('member:true'), `${tag} member: no Echipa / Setări / Media / Platformă; the switch stays (Membru selected)`, m);
      await closeMenu(p);
      const a = await layoutAudit(p, '#view-as-bar');
      check(!a.overflow && !a.small.length, `${tag} bar: no overflow, targets >= 44 px`, a);
      await p.goto(`${app.url}/library`);
      await p.waitForSelector('#songs li');
      check(await p.isHidden('#new-song') && await bar(p) !== null, `${tag} member: no "Cântare nouă" in the library; the bar stays`);
      await p.goto(`${app.url}/events/${E}/follow`);
      check(await p.waitForSelector('#follow:not([hidden])', { timeout: 5000 }).then(() => true, () => false) && await bar(p) !== null, `${tag} member: the follow page works, with the bar (small)`);
      await p.goto(`${app.url}/events/${E}/edit`);
      await p.waitForSelector('#event-actions a');
      check(new URL(p.url()).pathname === `/events/${E}` && await p.locator('#event-actions a[href*="/edit"]').count() === 0, `${tag} member: the editor URL redirects to the event page, no edit action`);
      check((await app.api(app.cookies.owner, 'GET', '/api/platform/admins')).status === 200, `${tag} (the owner's own cookie in the tests is untouched: another session)`);
      // as operator: the console and the projector
      await p.goto(`${app.url}/app`);
      await menuPages(p);
      await p.click('#shell-panel [data-view-as="operator"]');
      await p.waitForFunction(() => /operator/.test((document.getElementById('view-as-bar') || {}).textContent || '') && document.querySelector('#now .now-card'), null, { timeout: 8000 });
      await p.goto(`${app.url}/events/${E}/operator`);
      check(await p.waitForSelector('#console:not([hidden])', { timeout: 5000 }).then(() => true, () => false) && !(await p.isHidden('#open-projector')), `${tag} operator: the console opens, "Deschide ecranul proiectorului" there`);
      await p.goto(`${app.url}/app`);
      m = await menuPages(p);
      check(m.pages.includes('screens') && !m.pages.includes('platform') && !m.pages.includes('team'), `${tag} operator: Ecrane in the menu, no Platformă / Echipa`, m);
      // as leader: no projector
      await p.click('#shell-panel [data-view-as="leader"]');
      await p.waitForFunction(() => /lider|leader/.test((document.getElementById('view-as-bar') || {}).textContent || '') && document.querySelector('#now .now-card'), null, { timeout: 8000 });
      await p.goto(`${app.url}/events/${E}/live`);
      await p.waitForSelector('#live:not([hidden])');
      await wait(400);
      check(await p.isHidden('#open-projector'), `${tag} leader: no "Deschide ecranul proiectorului"`);
      await p.goto(`${app.url}/screens`);
      check(new URL(p.url()).pathname === '/app', `${tag} leader: /screens redirects to Acasă`);
      // back to the owner
      await p.click('#view-as-bar .view-as-back');
      await p.waitForFunction(() => { const b = document.getElementById('view-as-bar'); return b && b.hidden && document.querySelector('#now .now-card'); }, null, { timeout: 8000 });
      m = await menuPages(p);
      check(await bar(p) === null && m.pages.includes('team') && m.pages.includes('platform') && m.viewAs.includes('owner:true'), `${tag} "Revino la proprietar": bar gone, Echipa and Platformă back`, m);
      await closeMenu(p);
      await p.context().close();
    }
  },
};
