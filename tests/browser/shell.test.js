'use strict';

// The app shell: bottom tab bar on phones / rail from 900 px on every signed-in page, the
// "Mai mult" panel (roles, language, notation, logout), and the full-screen pages (live,
// follow) with only "← Ieși"; /screen has no shell at all.

const { layoutAudit } = require('./harness');

module.exports = {
  name: 'shell',
  async run({ app, signIn, check, browser }) {
    const { eventId: E, songs } = app.seed;
    const pages = ['/app', '/library', '/events', `/events/${E}`, `/events/${E}/edit`, `/events/${E}/rehearse`, '/screens', '/settings', '/media', `/songs/${songs.G}`, `/songs/${songs.G}/edit`];
    for (const width of [375, 1024]) {
      const p = await signIn('owner', { width });
      for (const path of pages) {
        await p.goto(app.url + path);
        await p.waitForSelector('#app-shell .shell-label:not(:empty)');
        const r = await p.evaluate(() => {
          const nav = document.getElementById('app-shell').getBoundingClientRect();
          return { rail: nav.width < 200 && nav.height > 300, bottom: nav.bottom >= innerHeight - 1 && nav.width >= innerWidth - 1 };
        });
        check(width < 900 ? r.bottom : r.rail, `[${width}] ${path}: ${width < 900 ? 'bottom tab bar' : 'side rail'}`, r);
        const a = await layoutAudit(p, '#app-shell');
        check(!a.overflow && !a.small.length, `[${width}] ${path}: no overflow, shell targets >= 44 px`, a);
      }
      // "Mai mult"
      await p.goto(`${app.url}/events`);
      await p.waitForSelector('#app-shell .shell-label:not(:empty)');
      await p.click('.shell-more');
      const panel = await p.evaluate(() => ({
        open: !document.getElementById('shell-panel').hidden,
        role: document.querySelector('.shell-who-role').textContent,
        pages: [...document.querySelectorAll('#shell-panel li:not([hidden]) .shell-row[data-page]')].map((a) => a.dataset.page),
      }));
      check(panel.open && panel.pages.includes('team') && panel.pages.includes('settings'), `[${width}] owner "Mai mult": team and settings listed`, panel);
      await p.keyboard.press('Escape');
      const closed = await p.waitForFunction(() => document.getElementById('shell-panel').hidden && document.activeElement.classList.contains('shell-more'), null, { timeout: 2000 }).then(() => true, () => false);
      check(closed, `[${width}] Escape closes the panel, focus back on "Mai mult"`);
      if (width === 375) {
        await p.click('.shell-more');
        await p.click('#shell-panel [data-lang=en]');
        await p.click('#shell-panel [data-value=solfege]');
        await p.goto(`${app.url}/events`);
        await p.waitForSelector('#app-shell .shell-label:not(:empty)');
        const me = await p.evaluate(() => fetch('/api/auth/me').then((r) => r.json()));
        const labels = await p.$$eval('.shell-label', (l) => l.map((x) => x.textContent));
        check(me.user.locale === 'en' && me.user.chordNotation === 'solfege' && labels.includes('Home'), 'language and notation saved on the user, shell in English after reload', { locale: me.user.locale, notation: me.user.chordNotation, labels });
        await p.click('.shell-more');
        await p.click('#shell-panel [data-lang=ro]');
        await p.click('#shell-panel [data-value=letters]');
        await p.click('.shell-logout');
        await p.waitForURL('**/login');
        check(true, '"Deconectare" signs out to /login');
      }
      for (const role of ['leader', 'operator', 'member']) {
        const q = await signIn(role, { width });
        await q.waitForSelector('#app-shell .shell-label:not(:empty)');
        await q.click('.shell-more');
        const list = await q.$$eval('#shell-panel li:not([hidden]) .shell-row[data-page]', (l) => l.map((a) => a.dataset.page));
        check(!list.includes('team') && !list.includes('settings'), `[${width}] ${role}: no team / settings in "Mai mult"`, list);
        const editor = role !== 'member';
        check(list.includes('media') === editor && list.includes('screens') === editor, `[${width}] ${role}: media / screens ${editor ? 'listed (the editor roles)' : 'hidden'}`, list);
        await q.context().close();
      }
      await p.context().close();
    }
    // Full-screen pages: no shell, only "← Ieși" back to the event.
    for (const [role, path] of [['leader', 'live'], ['member', 'follow'], ['operator', 'operator']]) {
      const q = await signIn(role, { width: 375 });
      await q.goto(`${app.url}/events/${E}/${path}`);
      await q.waitForSelector('.shell-exit');
      check(!(await q.$('#app-shell')) && (await q.getAttribute('.shell-exit', 'href')) === `/events/${E}`, `${path}: no tab bar, "← Ieși" -> /events/${E}`);
      await q.context().close();
    }
    const s = await (await browser.newContext()).newPage();
    await s.goto(`${app.url}/screen`);
    await s.waitForTimeout(500);
    check(!(await s.$('#app-shell')) && !(await s.$('.shell-exit')), '/screen: no shell, no exit link');
  },
};
