'use strict';

// The theme filter in "Adaugă o cântare" (public/song-search.js, pick mode): "Tema: Toate
// temele / <theme> (n)" under the search field, hidden while the library has no themes; a
// theme lists only its songs (with a search word too), "Toate temele" lists everything again;
// opening the dialog again starts from all themes. The operator's add dialog has it too.
// RO 375 / EN 1024.

const { layoutAudit } = require('./harness');

module.exports = {
  name: 'pick-theme',
  timeout: 180000,
  async run({ app, signIn, check }) {
    const owner = app.cookies.owner;
    const song = async (body) => (await app.api(owner, 'POST', '/api/songs', body)).body.song;
    for (let i = 1; i <= 3; i += 1) await song({ title: `Paște ${i}`, song_key: 'G', themes: ['Paști'], sections: [{ type: 'verse', content: `Rând ${i}` }] });
    await song({ title: 'Colind unu', song_key: 'D', themes: ['Crăciun'], sections: [{ type: 'verse', content: 'Zăpadă' }] });
    const titles = (p, list) => p.$$eval(`${list} .song-title`, (l) => l.map((x) => x.textContent.trim()));

    for (const [lang, width] of [['ro', 375], ['en', 1024]]) {
      const tag = `[${lang} ${width}]`;
      const eventId = (await app.api(owner, 'POST', '/api/events', { name: `Teme ${width}`, eventDate: app.seed.today, startTime: '18:00' })).body.event.id;
      const p = await signIn('presenter', { width, lang });
      await p.goto(`${app.url}/events/${eventId}/edit`);
      await p.waitForSelector('[data-add="song"]');
      await p.click('[data-add="song"]');
      await p.waitForSelector('#song-dialog[open]');
      await p.waitForSelector('#pick-theme-field:not([hidden])');
      const field = await p.evaluate(() => ({
        label: document.querySelector('#pick-theme-field .sort-label').textContent, options: [...document.querySelectorAll('#pick-filter-theme option')].map((o) => o.textContent), value: document.getElementById('pick-filter-theme').value,
        below: document.getElementById('pick-theme-field').getBoundingClientRect().top >= document.getElementById('pick-q').getBoundingClientRect().bottom,
      }));
      check(/^(Tema|Theme)$/.test(field.label) && field.options.join('|') === (lang === 'ro' ? 'Toate temele|Fără temă (3)|Crăciun (1)|Paști (3)' : 'All themes|No theme (3)|Crăciun (1)|Paști (3)') && field.value === '' && field.below, `${tag} the theme filter under the search field: all themes, no theme (3), Crăciun (1), Paști (3)`, field);
      await p.waitForFunction(() => document.querySelectorAll('#pick-songs li').length >= 7);
      await p.selectOption('#pick-filter-theme', 'Paști');
      await p.waitForFunction(() => document.querySelectorAll('#pick-songs li').length === 3);
      check((await titles(p, '#pick-songs')).every((x) => /^Paște/.test(x)), `${tag} "Paști": only its three songs`, await titles(p, '#pick-songs'));
      const a = await layoutAudit(p, '#song-dialog');
      check(!a.overflow && !a.small.length, `${tag} the dialog with the filter: no overflow, targets >= 44 px`, a);
      await p.fill('#pick-q', '2');
      await p.waitForFunction(() => document.querySelectorAll('#pick-songs li').length === 1);
      check((await titles(p, '#pick-songs')).join() === 'Paște 2', `${tag} a search word within the theme`);
      await p.fill('#pick-q', 'Colind');
      await p.waitForFunction(() => document.querySelectorAll('#pick-songs li').length === 0);
      check(/(Niciun rezultat|No results|Colind)/.test(await p.textContent('#pick-status')), `${tag} a song of another theme is not found: a message`, await p.textContent('#pick-status'));
      await p.fill('#pick-q', '');
      await p.selectOption('#pick-filter-theme', '');
      await p.waitForFunction(() => document.querySelectorAll('#pick-songs li').length >= 7);
      check(true, `${tag} "Toate temele": everything again`);
      // closed and opened again: all themes
      await p.selectOption('#pick-filter-theme', 'Crăciun');
      await p.waitForFunction(() => document.querySelectorAll('#pick-songs li').length === 1);
      await p.click('#song-dialog-close');
      await p.waitForSelector('#song-dialog[open]', { state: 'detached' }).catch(() => {});
      await p.click('[data-add="song"]');
      await p.waitForSelector('#song-dialog[open]');
      await p.waitForFunction(() => document.getElementById('pick-filter-theme').value === '' && document.querySelectorAll('#pick-songs li').length >= 7);
      check(true, `${tag} opened again: all themes`);
      await p.context().close();
    }
  },
};
