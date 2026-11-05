'use strict';

// The library import chooses where the new songs go: "În care bibliotecă intră cântările noi"
// (Biserica / Școala duminicală), preset to the library shown when the file was picked; the
// summary names the library. A school-only writer has no choice: the school's. The API:
// ?collection= puts every new song there whatever the file says, existing songs keep their
// library on an update. 375 RO and 1024 EN.

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { layoutAudit, PASSWORD } = require('./harness');

module.exports = {
  name: 'import-collection',
  timeout: 240000,
  async run({ app, signIn, check, browser }) {
    const owner = app.cookies.owner;
    const file = (songs) => ({ type: 'worship-app-library', version: 1, songs: songs.map((title) => ({ title, sections: [{ type: 'verse', content: `Rând ${title}` }] })) });
    const write = (name, songs) => { const f = path.join(os.tmpdir(), `wa-${name}-${process.pid}.json`); fs.writeFileSync(f, JSON.stringify(file(songs))); return f; };
    const where = async (title) => (await app.api(owner, 'GET', '/api/songs?collection=all')).body.songs.filter((s) => s.title === title).map((s) => s.collection).join();

    // --- the API ----------------------------------------------------------------------------
    const main = await app.api(owner, 'POST', '/api/songs/import?collection=school', file(['Școlar A']));
    check(main.status === 200 && main.body.added === 1 && main.body.collection === 'school' && await where('Școlar A') === 'school', '?collection=school: the song lands in the school library though the file says nothing', main.body);
    const fileSays = { ...file(['Școlar B']) }; fileSays.songs[0].collection = 'school';
    check((await app.api(owner, 'POST', '/api/songs/import?collection=main', fileSays)).status === 200 && await where('Școlar B') === 'main', '?collection=main wins over the file\'s own collection');
    check((await app.api(owner, 'POST', '/api/songs/import', fileSays)).status === 200 && (await app.api(owner, 'POST', '/api/songs/import', { ...file(['Școlar C']), songs: [{ ...fileSays.songs[0], title: 'Școlar C' }] })).body.added === 1 && await where('Școlar C') === 'school', 'without ?collection: the file\'s own collection counts');
    const update = await app.api(owner, 'POST', '/api/songs/import?mode=update&collection=main', file(['Școlar A']));
    check(update.status === 200 && update.body.updated === 1 && await where('Școlar A') === 'school', 'an update keeps the existing song in its library', update.body);
    check((await app.api(owner, 'POST', '/api/songs/import?collection=x', file(['Y']))).status === 400, 'an unknown library: 400');
    // an existing song keeps what the file does not bring; the file's themes are merged (both modes)
    const kept = (await app.api(owner, 'POST', '/api/songs', { title: 'Păstrată', author: 'Autor vechi', song_key: 'G', themes: ['Veche'], sections: [{ type: 'verse', content: 'Text vechi' }, { type: 'chorus', content: 'Refren vechi' }] })).body.song;
    await app.api(owner, 'PUT', `/api/songs/${kept.id}/presentation`, { codes: ['C', 'V1'] });
    const again = { type: 'worship-app-library', version: 1, songs: [{ title: 'Păstrată', themes: ['Caietul bisericii'], sections: [{ type: 'verse', content: 'Text nou' }] }] };
    const skip = await app.api(owner, 'POST', '/api/songs/import', again);
    let now = (await app.api(owner, 'GET', `/api/songs/${kept.id}`)).body.song;
    check(skip.body.skipped === 1 && now.sections.map((x) => x.content).join('|') === 'Text vechi|Refren vechi' && now.themes.join() === 'Veche,Caietul bisericii' && now.song_key === 'G', 'skip: the text untouched, the file\'s theme added', { skipped: skip.body.skipped, themes: now.themes });
    const upd = await app.api(owner, 'POST', '/api/songs/import?mode=update', again);
    now = (await app.api(owner, 'GET', `/api/songs/${kept.id}`)).body.song;
    check(upd.body.updated === 1 && now.sections.map((x) => x.content).join('|') === 'Text nou' && now.song_key === 'G' && now.author === 'Autor vechi' && now.themes.join() === 'Veche,Caietul bisericii' && now.presentation === 'C V1', 'update: the text replaced; key, author, themes and "Cum se cântă" kept', { key: now.song_key, author: now.author, themes: now.themes, presentation: now.presentation });

    // --- the owner's form: preset from the shown library, the choice, the summary ---------
    for (const [lang, width, tab, pick] of [['ro', 375, 'school', 'school'], ['en', 1024, 'main', 'school']]) {
      const tag = `[${lang} ${width}]`;
      const p = await signIn('owner', { width, lang });
      await p.goto(`${app.url}/library${tab === 'school' ? '?collection=school' : ''}`);
      await p.waitForSelector('#library-menu:not([hidden])');
      const f = write(`${lang}-${width}`, [`Importată ${lang}`]);
      await p.click('#library-menu-button');
      const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('#import-library')]);
      await chooser.setFiles(f);
      await p.waitForFunction(() => !document.getElementById('import-plan').hidden);
      const form = await p.evaluate(() => ({
        shown: !document.getElementById('import-collection-field').hidden,
        pressed: document.querySelector('#import-collection [aria-pressed="true"]').dataset.collection,
        label: document.getElementById('import-collection-label').textContent,
        options: [...document.querySelectorAll('#import-collection button')].map((b) => b.textContent),
      }));
      check(form.shown && form.pressed === tab && (lang === 'ro' ? /bibliotecă intră/.test(form.label) && form.options.join() === 'Biserica,Școala duminicală' : /Which library/.test(form.label) && form.options.join() === 'Church,Sunday school'),
        `${tag} the review: the library choice, preset to the ${tab} tab`, form);
      const a = await layoutAudit(p, '#import-review');
      check(!a.overflow && !a.small.length, `${tag} the review: no overflow, targets >= 44 px`, a);
      if (pick !== tab) await p.click(`#import-collection [data-collection="${pick}"]`);
      await p.click('#import-run');
      await p.waitForSelector('#import-result:not([hidden])');
      const summary = await p.textContent('#import-summary');
      check(await where(`Importată ${lang}`) === pick && new RegExp(lang === 'ro' ? 'Biblioteca: Școala duminicală' : 'Library: Sunday school').test(summary), `${tag} imported into the ${pick} library; the summary names it`, summary);
      fs.rmSync(f, { force: true });
      await p.context().close();
    }

    // --- a school-only writer: no choice, the school's --------------------------------------
    const role = (await app.api(owner, 'POST', '/api/roles', { name: 'Școala', emoji: '🎒', base: 'member', perms: ['school'] })).body.role;
    const maria = (await app.api(owner, 'POST', '/api/team', { name: 'Maria', email: 'maria@x.ro', role: `custom:${role.id}` })).body.user;
    const db = new Database(path.join(app.dataDir, 'worship.db'));
    db.prepare("UPDATE users SET password_hash = (SELECT password_hash FROM users WHERE email = 'ana@example.ro'), must_change_password = 0 WHERE id = ?").run(maria.id);
    db.close();
    const context = await browser.newContext({ viewport: { width: 1024, height: 820 }, locale: 'ro-RO' });
    const s = await context.newPage();
    await s.goto(`${app.url}/login`);
    await s.fill('[name=email]', 'maria@x.ro');
    await s.fill('[name=password]', PASSWORD);
    await s.click('button[type=submit]');
    await s.waitForURL('**/app');
    await s.goto(`${app.url}/library`);
    await s.waitForSelector('#library-menu:not([hidden])');
    const f = write('school', ['A școlii']);
    await s.click('#library-menu-button');
    const [chooser] = await Promise.all([s.waitForEvent('filechooser'), s.click('#import-library')]);
    await chooser.setFiles(f);
    await s.waitForFunction(() => !document.getElementById('import-plan').hidden);
    check(await s.evaluate(() => document.getElementById('import-collection-field').hidden), 'the school writer: no library choice');
    await s.click('#import-run');
    await s.waitForSelector('#import-result:not([hidden])');
    check(await where('A școlii') === 'school' && /Școala duminicală/.test(await s.textContent('#import-summary')), 'the school writer\'s import lands in the school library, the summary says so');
    fs.rmSync(f, { force: true });
    await context.close();
  },
};
