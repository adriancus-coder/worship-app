'use strict';

// "Acorduri și teme de pe resurse" (public/resurse-sync.js, lib/resurse-sync.js): from the
// library's "⋯" menu the review says how many songs lack chords or themes, "Pornește" runs
// the lookup (the site stand-in: fixtures/mock-resurse.js, no pause between songs), the
// progress shows, then the report: the song the site has gets its chords over its own lines,
// the themes and the key; a song the site does not have is "negăsită" with "Caută pe
// resurse", which fills the library's search and runs the online search. The owner at 375
// RO and 1024 EN; the API refuses a member and a second run while one runs.

const path = require('path');
const { FIXTURES, layoutAudit } = require('./harness');

module.exports = {
  name: 'resurse-sync',
  app: { preload: [path.join(FIXTURES, 'mock-resurse.js')], env: { RESURSE_SYNC_DELAY_MS: '0' } },
  timeout: 180000,
  async run({ app, signIn, check }) {
    const owner = app.cookies.owner;
    const PLAIN = [{ type: 'verse', content: '1. Când totul pare că-i pierdut,\nAl meu Păstor îmi va fi scut.' }, { type: 'chorus', content: 'Viața mea e-n mâna Sa\nȘi cu credință voi cânta' }];
    check((await app.api(app.cookies.member, 'GET', '/api/resurse/sync')).status === 403, 'a member: no sync');

    for (const [lang, width] of [['ro', 375], ['en', 1024]]) {
      const tag = `[${lang} ${width}]`;
      // a song the site has (503, sheet 9001, themes), one it has not
      const bare = (await app.api(owner, 'POST', '/api/songs', { title: 'Fără acorduri', sections: PLAIN })).body.song;
      const lost = (await app.api(owner, 'POST', '/api/songs', { title: `Nicăieri ${lang}`, sections: [{ type: 'verse', content: 'x' }] })).body.song;
      const p = await signIn('owner', { width, lang });
      await p.goto(`${app.url}/library`);
      await p.waitForSelector('#library-menu:not([hidden])');
      await p.click('#library-menu-button');
      await p.click('#resurse-sync');
      await p.waitForSelector('#sync-review:not([hidden])');
      await p.waitForFunction(() => !document.getElementById('sync-review-start').disabled);
      const intro = await p.evaluate(() => ({ status: document.getElementById('sync-review-status').textContent, start: document.getElementById('sync-review-start').textContent, hidden: document.getElementById('library-results').hidden }));
      check(/(fără acorduri sau fără teme|without chords or themes)/.test(intro.status) && /\d+/.test(intro.start) && intro.hidden, `${tag} the review: how many songs lack chords or themes, "Pornește (n)", the list hidden`, intro);
      await p.click('#sync-review-start');
      await p.waitForFunction(() => /(Gata|Done)/.test(document.getElementById('sync-progress-text').textContent) && !document.getElementById('sync-review-start').hidden, null, { timeout: 20000 });
      const rows = await p.$$eval('#sync-review-list .sync-row', (l) => l.map((r) => `${r.querySelector('.key-review-title').textContent}:${r.dataset.status}`));
      check(rows.includes('Fără acorduri:chords') && rows.includes(`Nicăieri ${lang}:notFound`), `${tag} the report: "Fără acorduri" got chords, "Nicăieri" not found`, rows);
      check(await p.locator('#sync-review-list .sync-summary').count() === 1 && /(Înapoi|Back)/.test(await p.textContent('#sync-review-cancel')), `${tag} finished: the summary on top, "Înapoi la bibliotecă", "Pornește" again for another run`);
      const a = await layoutAudit(p, '#sync-review');
      check(!a.overflow && !a.small.length, `${tag} the review: no overflow, targets >= 44 px`, a);
      const after = (await app.api(owner, 'GET', `/api/songs/${bare.id}`)).body.song;
      check(after.song_key === 'D' && after.themes.join() === 'Închinare,Paști' && after.sections[0].content === '1. [D]Când totul pare[A] că-i pierdut,\n[Bm]Al meu Păstor î[G]mi va fi scut.', `${tag} the song: chords over its own lines, the themes, the key`, { key: after.song_key, themes: after.themes, first: after.sections[0].content });
      // "Caută pe resurse" on the one not found: the library's search with its title, online
      await p.click(`#sync-review-list .sync-row[data-song-id="${lost.id}"] .sync-row-search`);
      await p.waitForSelector('#sync-review', { state: 'hidden' });
      await p.waitForSelector('#online-section:not([hidden])', { timeout: 8000 });
      check((await p.inputValue('#q')) === `Nicăieri ${lang}` && !(await p.isHidden('#library-results')), `${tag} "Caută pe resurse": back in the library, the title in the search, the online results asked`);
      await p.context().close();
      await app.api(owner, 'DELETE', `/api/songs/${bare.id}`);
      await app.api(owner, 'DELETE', `/api/songs/${lost.id}`);
    }
  },
};
