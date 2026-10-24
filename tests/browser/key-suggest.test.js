'use strict';

// "Detectează gama la toate" on /library (public/key-suggest.js): from the "⋯" menu the owner
// gets the review with one row per keyless song that has chords (title, the estimated key in
// a selector with the candidates first, the confidence, a checkbox), saves the ticked rows
// in one go, and the keys are set only where none was; the library reloads. Member: no
// menu. 375 and 1024.

const { layoutAudit } = require('./harness');

module.exports = {
  name: 'key-suggest',
  timeout: 240000,
  async run({ app, signIn, check }) {
    const owner = app.cookies.owner;
    const song = async (body) => (await app.api(owner, 'POST', '/api/songs', body)).body.song.id;
    const am = await song({ title: 'Zz în la minor', sections: [{ type: 'verse', content: '[Am]a [F]b [C]c [G]d [Am]e' }] });
    const g = await song({ title: 'Yy în sol', sections: [{ type: 'verse', content: '[G]a [D]b [Em]c [C]d [G]e' }] });
    const noChords = await song({ title: 'Xx fără acorduri', sections: [{ type: 'verse', content: 'Doar versuri' }] });

    // --- the API ----------------------------------------------------------------------------
    const s = (await app.api(owner, 'GET', '/api/songs/key-suggestions')).body;
    const mine = s.songs.filter((x) => [am, g].includes(x.id));
    check(mine.length === 2 && mine.find((x) => x.id === am).key === 'Am' && mine.find((x) => x.id === g).key === 'G' && s.withoutChords >= 1,
      'GET key-suggestions: the keyless songs with chords and their key', { mine, withoutChords: s.withoutChords });
    const member = await app.api(app.cookies.member, 'GET', '/api/songs/key-suggestions');
    const bad = await app.api(owner, 'PUT', '/api/songs/keys', { keys: [{ id: am, song_key: 'H' }] });
    check(member.status === 403 && bad.status === 400, 'a member gets 403; an unknown key 400', [member.status, bad.status]);

    // --- the review, phone ----------------------------------------------------------------
    const p = await signIn('owner', { width: 375, lang: 'ro' });
    await p.goto(`${app.url}/library`);
    await p.waitForSelector('#library-menu:not([hidden])');
    await p.click('#library-menu-button');
    await p.click('#detect-keys');
    await p.waitForSelector('#key-review:not([hidden]) .key-review-row');
    const r = await p.evaluate(() => ({
      searchHidden: document.getElementById('library-search').hidden,
      rows: [...document.querySelectorAll('.key-review-row')].map((row) => ({ id: Number(row.dataset.songId), title: row.querySelector('.key-review-title').textContent, key: row.querySelector('select').value, checked: row.querySelector('input').checked, first: row.querySelector('optgroup').children.length, confidence: row.querySelector('.key-detect-confidence').textContent })),
      save: document.getElementById('key-review-save').textContent,
      note: (document.querySelector('.key-review-note') || {}).textContent || '',
      status: document.getElementById('key-review-status').textContent,
    }));
    const rowAm = r.rows.find((x) => x.id === am);
    const rowG = r.rows.find((x) => x.id === g);
    check(r.searchHidden && rowAm && rowAm.key === 'Am' && rowAm.checked && rowAm.first === 3 && rowAm.confidence === 'Sigur' && rowG && rowG.key === 'G' && rowG.checked,
      'the review: a row per keyless song with chords, the key chosen, three candidates first, ticked', r.rows);
    check(new RegExp(`Salvează ${r.rows.length} game`).test(r.save) && /fără ton nu au acorduri/.test(r.note) && /Verifică/.test(r.status), 'the save button counts the ticked rows; the songs without chords are mentioned', { save: r.save, note: r.note });
    const a = await layoutAudit(p, '#key-review');
    check(!a.overflow && !a.small.length, 'the review 375: no overflow, targets >= 44 px', a);
    // untick all, tick one, change its key to the second candidate
    await p.click('#key-review-none');
    const none = await p.evaluate(() => ({ disabled: document.getElementById('key-review-save').disabled, checked: document.querySelectorAll('.key-review-check:checked').length }));
    check(none.disabled && none.checked === 0, '"Debifează toate": nothing ticked, saving disabled', none);
    await p.check(`#key-review-${g}`);
    await p.selectOption(`.key-review-row[data-song-id="${g}"] select`, 'Em');
    const one = await p.$eval('#key-review-save', (b) => ({ text: b.textContent, disabled: b.disabled }));
    check(one.text === 'Salvează o gamă' && !one.disabled, 'one ticked: "Salvează o gamă"', one);
    // meanwhile the other song gets a key by hand: the bulk save must not touch it
    await app.api(owner, 'PUT', `/api/songs/${am}`, { song_key: 'C' });
    await p.check(`#key-review-${am}`);
    await p.click('#key-review-save');
    await p.waitForSelector('#key-review-done:not([hidden])');
    const after = await p.evaluate(() => ({ status: document.getElementById('key-review-status').textContent, rows: document.querySelectorAll('.key-review-row').length, actionsHidden: document.getElementById('key-review-actions').hidden }));
    const keys = [(await app.api(owner, 'GET', `/api/songs/${g}`)).body.song.song_key, (await app.api(owner, 'GET', `/api/songs/${am}`)).body.song.song_key, (await app.api(owner, 'GET', `/api/songs/${noChords}`)).body.song.song_key];
    check(/Salvate: 1 game/.test(after.status) && after.actionsHidden && keys[0] === 'Em' && keys[1] === 'C' && keys[2] === null,
      'saved: the chosen key (Em), the key set by hand meanwhile kept (C), the song without chords untouched', { after, keys });
    await p.click('#key-review-done');
    await p.waitForSelector('#library-search:not([hidden])');
    await p.waitForFunction((id) => [...document.querySelectorAll('#songs li')].some((li) => li.textContent.includes('Yy în sol') && /Em/.test(li.textContent)), g);
    check(true, 'back in the library: the list reloaded with the new key');

    // --- nothing left, desktop ---------------------------------------------------------------
    const o = await signIn('owner', { width: 1024, lang: 'ro' });
    const left = (await app.api(owner, 'GET', '/api/songs/key-suggestions')).body;
    await app.api(owner, 'PUT', '/api/songs/keys', { keys: left.songs.map((x) => ({ id: x.id, song_key: x.key })) });
    await o.goto(`${app.url}/library`);
    await o.waitForSelector('#library-menu:not([hidden])');
    await o.click('#library-menu-button');
    await o.click('#detect-keys');
    await o.waitForSelector('#key-review:not([hidden]) .pane-state');
    const empty = await o.evaluate(() => ({ text: document.querySelector('#key-review .pane-state').textContent, save: document.getElementById('key-review-save').disabled, tools: document.getElementById('key-review-tools').hidden }));
    check(/Toate cântările cu acorduri au tonul setat/.test(empty.text) && empty.save && empty.tools, 'nothing left: the message names the songs without chords; no tools, saving disabled', empty);

    // --- member: no menu ---------------------------------------------------------------------
    const m = await signIn('member', { width: 375, lang: 'ro' });
    await m.goto(`${app.url}/library`);
    await m.waitForSelector('#songs li');
    const menu = await m.$eval('#library-menu', (x) => x.hidden);
    check(menu, 'a member has no "⋯" menu, so no detection', menu);
  },
};
