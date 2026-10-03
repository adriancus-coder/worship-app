'use strict';

// Biblioteca: one search field for the library and resursecrestine.ro (a local stand-in,
// fixtures/mock-resurse.js): typing searches the library only, Enter / "Caută și pe
// resurse" searches online too; import from a result, preview from a pasted link, "Există
// deja" the second time, other hosts refused; the ⋯ menu exports and re-imports (review,
// cancel); members see no import tools and never reach resurse.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { FIXTURES, layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'library',
  app: { preload: [path.join(FIXTURES, 'mock-resurse.js')] },
  async run({ app, signIn, check }) {
    const open = async (role, width) => {
      const p = await signIn(role, { width });
      p.resurse = [];
      p.on('request', (r) => { if (r.url().includes('/api/resurse/')) p.resurse.push(r.url()); });
      await p.goto(`${app.url}/library`);
      await p.waitForFunction(() => document.querySelectorAll('#songs li').length > 0);
      return p;
    };
    const titles = (p) => p.$$eval('#songs .song-title', (l) => l.map((x) => x.textContent));
    const LINK = 'https://www.resursecrestine.ro/cantece/502/isus-tu-esti-lumina';
    for (const width of [375, 1024]) {
      const tag = `[${width}]`;
      // each width starts from the seeded library
      for (const song of (await app.api(app.cookies.owner, 'GET', '/api/songs?q=lumina')).body.songs) await app.api(app.cookies.owner, 'DELETE', `/api/songs/${song.id}`);
      const p = await open('owner', width);
      check((await titles(p)).length === 3, `${tag} the library lists its 3 songs`, await titles(p));
      await p.click('#q');
      await p.keyboard.type('mare');
      await wait(450);
      check(JSON.stringify(await titles(p)) === '["Mare ești Tu"]' && p.resurse.length === 0, `${tag} typing searches the library only`, { titles: await titles(p), resurse: p.resurse.length });
      await p.fill('#q', 'isus');
      await p.keyboard.press('Enter');
      await p.waitForSelector('#online-results li');
      const online = await p.$$eval('#online-results li', (l) => l.map((li) => li.innerText.split('\n')[0]));
      check(online.length >= 2 && p.resurse.length > 0, `${tag} Enter also searches resursecrestine.ro`, online);
      if (width === 375) {
        await p.click('#online-results li:has-text("Tu ești lumina") button:has-text("Importă")');
        await p.waitForSelector('#online-results li:has-text("Tu ești lumina") .row-state');
        check(/Importată/.test(await p.textContent('#online-results li:has-text("Tu ești lumina") .row-state')), `${tag} "Importă" on a result imports it`);
        const id = await p.evaluate(() => fetch('/api/songs?q=lumina').then((r) => r.json()).then((j) => j.songs[0].id));
        await p.evaluate((id) => fetch(`/api/songs/${id}`, { method: 'DELETE' }), id);
        await p.fill('#q', LINK);
        await p.keyboard.press('Enter');
      } else {
        await p.click('#online-results li:has-text("Tu ești lumina") button:has-text("Previzualizare")');
      }
      await p.waitForSelector('#online-preview[open] #preview-sections .song-section');
      const box = await p.evaluate(() => { const r = document.getElementById('online-preview').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; });
      check(box, `${tag} preview (${width === 375 ? 'pasted link, bottom sheet' : 'from a result'}) fits the screen`);
      await p.click('#preview-import');
      const imported = await p.waitForFunction(() => /importată/i.test(document.getElementById('preview-message').textContent), null, { timeout: 5000 }).then(() => true, () => false);
      check(imported, `${tag} "Importă" in the preview`);
      await p.click('#preview-close-x');
      await p.fill('#q', LINK);
      await p.keyboard.press('Enter');
      await p.waitForSelector('#online-preview[open] #preview-sections .song-section');
      check(await p.$eval('#preview-import', (x) => x.disabled) && /Există deja/.test(await p.textContent('#preview-message')), `${tag} the same link again: "Există deja", Importă disabled`, await p.textContent('#preview-message'));
      await p.keyboard.press('Escape');
      await p.fill('#q', 'https://evil.example/cantece/1/x');
      await p.keyboard.press('Enter');
      await p.waitForFunction(() => document.getElementById('online-error').textContent);
      check(/invalid/i.test(await p.textContent('#online-error')), `${tag} a link to another host is refused`, await p.textContent('#online-error'));
      // ⋯ export, then import the same file: the review, then cancel
      await p.click('#library-menu-button');
      const [download] = await Promise.all([p.waitForEvent('download'), p.click('#export-library')]);
      const file = path.join(os.tmpdir(), `wa-export-${process.pid}-${width}.json`);
      await download.saveAs(file);
      const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
      check(exported.songs.length === 4, `${tag} export: ${download.suggestedFilename()} with ${exported.songs.length} songs`);
      await p.click('#library-menu-button');
      const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('#import-library')]);
      await chooser.setFiles(file);
      await p.waitForSelector('#import-review:not([hidden])');
      await p.waitForFunction(() => !document.getElementById('import-plan').hidden);
      check(await p.$eval('#library-search', (x) => x.hidden), `${tag} import: the review replaces the search`);
      await p.click('#import-cancel');
      check(!(await p.$eval('#library-search', (x) => x.hidden)), `${tag} cancel: the search is back`);
      fs.rmSync(file, { force: true });
      const a = await layoutAudit(p, 'main');
      check(!a.overflow, `${tag} no horizontal overflow`, a);
      await p.context().close();
    }
    const m = await open('member', 375);
    await m.click('#q');
    await m.keyboard.type('isus');
    await m.keyboard.press('Enter');
    await wait(600);
    check(!(await m.isVisible('#library-menu')) && !(await m.isVisible('#new-song')) && m.resurse.length === 0, 'member: no ⋯ menu, no "Cântare nouă", no resurse search');
  },
};
