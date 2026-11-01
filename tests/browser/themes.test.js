'use strict';

// Song themes ("tematică"): the editor's "Teme" field (comma-separated, suggestions from the
// library), chips on the song page linking to the library filtered by the theme, the
// library's "Tema" filter, the resurse import bringing the page's "Tematica", and the ideas
// panel / "10 la întâmplare" drawing from one theme. 375 and 1024.

const path = require('path');
const { layoutAudit, FIXTURES } = require('./harness');

module.exports = {
  name: 'themes',
  timeout: 240000,
  app: { preload: [path.join(FIXTURES, 'mock-resurse.js')] }, // resursecrestine.ro stand-in
  async run({ app, signIn, check }) {
    const owner = app.cookies.owner;
    const E = app.seed.eventId;
    const song = async (body) => (await app.api(owner, 'POST', '/api/songs', body)).body.song;
    const pasti = [];
    for (let i = 1; i <= 4; i += 1) pasti.push((await song({ title: `Paște ${i}`, song_key: 'G', themes: ['Paști', 'Închinare'], sections: [{ type: 'verse', content: `Rând ${i}` }] })).id);
    for (let i = 1; i <= 3; i += 1) await song({ title: `Botez ${i}`, song_key: 'D', themes: 'botez', sections: [{ type: 'verse', content: `Apă ${i}` }] });

    // --- the API: themes saved and listed, the filter, the counts -----------------------------
    const api = (await app.api(owner, 'GET', '/api/songs/themes')).body.themes;
    check(JSON.stringify(api) === JSON.stringify([{ name: 'botez', count: 3 }, { name: 'Închinare', count: 4 }, { name: 'Paști', count: 4 }]), 'GET themes: by name with counts', api);
    const filtered = (await app.api(owner, 'GET', '/api/songs?theme=pasti')).body.songs;
    check(filtered.length === 4 && filtered.every((s) => s.themes.join() === 'Paști,Închinare'), 'GET songs?theme=pasti: the four, with their themes', filtered.map((s) => s.title));
    const bad = await app.api(owner, 'POST', '/api/songs', { title: 'Rea', themes: ['x'.repeat(41)], sections: [{ type: 'verse', content: 'x' }] });
    check(bad.status === 400 && /Temele/.test(bad.body.error), 'a theme too long: 400', bad.body);

    // --- the editor: the field with suggestions; the song page: chips ------------------------
    const p = await signIn('owner', { width: 1024, lang: 'ro' });
    await p.goto(`${app.url}/songs/${pasti[0]}/edit`);
    await p.waitForSelector('#song-key-themes');
    const field = await p.evaluate(() => ({ value: document.getElementById('song-key-themes').value, list: [...document.querySelectorAll('#song-key-themes-list option')].map((o) => o.value), label: document.querySelector('label[for="song-key-themes"]').textContent }));
    check(field.value === 'Paști, Închinare' && field.list.slice(0, 3).join() === 'botez,Închinare,Paști' && field.list.includes('Laudă și închinare') && /Teme/.test(field.label), 'the editor: the themes in one field, the library\'s themes then the index as suggestions', field);
    await p.fill('#song-key-themes', 'Paști, Cina Domnului , paști');
    await p.click('#save');
    await p.waitForFunction((id) => fetch(`/api/songs/${id}`).then((r) => r.json()).then((j) => j.song.themes.join() === 'Paști,Cina Domnului'), pasti[0], { timeout: 8000 });
    check(true, 'saved: trimmed, the repeat merged');
    await p.goto(`${app.url}/songs/${pasti[0]}`);
    await p.waitForSelector('#song-themes .theme-chip');
    const chips = await p.$$eval('#song-themes .theme-chip', (l) => l.map((a) => [a.textContent, a.getAttribute('href')]));
    check(chips.length === 2 && chips[1][0] === 'Cina Domnului' && chips[1][1] === '/library?theme=Cina%20Domnului', 'the song page: a chip per theme, linking to the filtered library', chips);
    const a = await layoutAudit(p, '#song');
    check(!a.overflow && !a.small.length, 'the song page with chips: no overflow, targets >= 44 px', a);

    // --- the song page's "Setează": the thematic index, the library's themes, another theme --
    await p.click('#song-themes .song-themes-set');
    await p.waitForSelector('#themes-dialog[open] .theme-pick');
    const dlg = await p.evaluate(() => ({
      index: document.querySelectorAll('#themes-dialog .themes-picks')[0].querySelectorAll('.theme-pick').length,
      pressed: [...document.querySelectorAll('#themes-dialog .theme-pick[aria-pressed="true"]')].map((b) => b.dataset.theme),
      hasBotez: Boolean(document.querySelector('#themes-dialog .theme-pick[data-theme="Botez"]')),
      extra: [...document.querySelectorAll('#themes-dialog .themes-picks')[1].querySelectorAll('.theme-pick')].map((b) => b.dataset.theme),
    }));
    check(dlg.index >= 30 && dlg.hasBotez && dlg.pressed.sort().join() === 'Cina Domnului,Paști' && dlg.extra.includes('Cina Domnului') && dlg.extra.includes('Închinare') && !dlg.extra.includes('botez'),
      'the pop-up: the index (Botez…), the song\'s themes pressed, the library\'s other themes listed (botez is the index\'s Botez)', dlg);
    const d = await layoutAudit(p, '#themes-dialog');
    check(!d.overflow && !d.small.length, 'the pop-up 1024: no overflow, targets >= 44 px', d);
    await p.click('#themes-dialog .theme-pick[data-theme="Botez"]');
    await p.click('#themes-dialog .theme-pick[data-theme="Cina Domnului"]');
    await p.fill('#themes-other', ' Tineret ');
    await p.click('#themes-other-add');
    const chosen = await p.$eval('#themes-chosen', (x) => x.textContent);
    check(chosen === 'Alese: Paști, Botez, Tineret', 'tap to select / unselect, another theme typed', chosen);
    await p.click('#themes-save');
    await p.waitForSelector('#themes-dialog:not([open])', { state: 'attached' });
    await p.waitForFunction(() => document.querySelectorAll('#song-themes .theme-chip').length === 3);
    const saved = (await app.api(owner, 'GET', `/api/songs/${pasti[0]}`)).body.song.themes;
    check(saved.join() === 'Paști,Botez,Tineret', 'saved from the page: the three', saved);
    const member = await signIn('member', { width: 375, lang: 'ro' });
    await member.goto(`${app.url}/songs/${pasti[0]}`);
    await member.waitForSelector('#song-themes .theme-chip');
    check(!(await member.locator('#song-themes .song-themes-set').count()), 'a member sees the chips, no "Setează"');
    const put = await app.api(app.cookies.member, 'PUT', `/api/songs/${pasti[0]}/themes`, { themes: ['x'] });
    check(put.status === 403, 'PUT themes: members 403', put.status);
    await app.api(owner, 'PUT', `/api/songs/${pasti[0]}/themes`, { themes: ['Paști', 'Cina Domnului'] }); // back, for the checks below
    await p.reload();
    await p.waitForSelector('#song-themes .theme-chip');

    // --- the library: the "Tema" filter, from the chip and by hand ------------------------
    await p.click('#song-themes .theme-chip >> nth=1');
    await p.waitForURL(/\/library\?theme=/);
    await p.waitForFunction(() => document.querySelectorAll('#songs li').length === 1);
    const lib = await p.evaluate(() => ({ select: document.getElementById('filter-theme').value, options: [...document.querySelectorAll('#filter-theme option')].map((o) => o.textContent), rows: [...document.querySelectorAll('#songs li')].map((li) => li.textContent) }));
    check(lib.select === 'Cina Domnului' && lib.options[0] === 'Toate temele' && lib.options.some((o) => /Paști \(4\)/.test(o)) && lib.rows.length === 1 && /Paște 1/.test(lib.rows[0]) && /Cina Domnului/.test(lib.rows[0]),
      'the library filtered by the chip\'s theme; the select lists every theme with its count; the row shows the themes', lib);
    await p.selectOption('#filter-theme', 'botez');
    await p.waitForFunction(() => document.querySelectorAll('#songs li').length === 3);
    check(/theme=botez/.test(p.url()), 'the filter in the URL', p.url());
    await p.selectOption('#filter-theme', '');
    await p.waitForFunction(() => document.querySelectorAll('#songs li').length > 3);
    check(!/theme=/.test(p.url()), '"Toate temele": the filter gone');

    // --- the resurse import brings the page's "Tematica" ---------------------------------
    const preview = (await app.api(owner, 'POST', '/api/resurse/preview', { id: '503' })).body;
    check(preview.song.themes.join() === 'Închinare,Paști', 'the preview carries the themes of the resurse page', preview.song.themes);
    const imported = (await app.api(owner, 'POST', '/api/resurse/import', { id: '503' })).body.song;
    check(imported.themes.join() === 'Închinare,Paști', 'the imported song has them', imported.themes);
    const after = (await app.api(owner, 'GET', '/api/songs/themes')).body.themes;
    check(after.find((x) => x.name === 'Paști').count === 5, 'the counts follow', after);

    // --- the ideas panel by theme; "10 la întâmplare" uses it ------------------------------
    await p.goto(`${app.url}/events/${E}/edit`);
    await p.waitForSelector('#ideas:not([hidden])');
    await p.click('#ideas > summary');
    await p.waitForSelector('#ideas-theme-field:not([hidden])');
    await p.selectOption('#ideas-theme', 'botez');
    await p.waitForFunction(() => document.querySelectorAll('#ideas-list .ideas-row').length === 3);
    const rows = await p.$$eval('#ideas-list .ideas-row .ideas-title', (l) => l.map((x) => x.textContent));
    check(rows.every((x) => /Botez/.test(x)), 'the ideas with the theme "botez": the three', rows);
    const before = await p.$$eval('#items > li', (l) => l.length);
    await p.click('#add-more-button');
    await p.click('[data-add="random"]');
    await p.waitForFunction((n) => document.querySelectorAll('#items > li').length === n + 3, before);
    const msg = await p.$eval('#action-message', (x) => x.textContent);
    check(/3 cântări cu tema „botez”/.test(msg), '"10 la întâmplare" with the theme: the three botez songs, with the message', msg);
    const b = await layoutAudit(p, '#ideas');
    check(!b.overflow && !b.small.length, 'the ideas panel with the theme select: no overflow, targets >= 44 px', b);

    // --- the phone -------------------------------------------------------------------------------
    const m = await signIn('owner', { width: 375, lang: 'ro' });
    await m.goto(`${app.url}/library?theme=Pa%C8%99ti`);
    await m.waitForFunction(() => document.querySelectorAll('#songs li').length === 5);
    const c = await layoutAudit(m, '#library-search');
    check(!c.overflow && !c.small.length && (await m.$eval('#filter-theme', (x) => x.value)) === 'Paști', 'the phone: the theme filter from the URL, no overflow', c);
  },
};
