'use strict';

// The song key is easy to find and change: the song page's "Ton: Sol · Schimbă" row (a leader
// changes the key inline; sections and content hashes unchanged), the arrange sheet's
// "Original: <key> · Schimbă" (same, from the event editor), the editor's "Detalii" card
// with the key large and a hint while empty, the library's "fără ton" tag and "Fără ton"
// filter; the operator sees the same (EDITOR_ROLES); a member sees the key but no Schimbă.
// RO 375 / EN 1024.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'song-key',
  timeout: 240000,
  async run({ app, signIn, check }) {
    const owner = app.cookies.owner;
    const { songs } = app.seed;
    const song = async (id) => (await app.api(owner, 'GET', `/api/songs/${id}`)).body.song;
    const hashes = (s) => JSON.stringify(s.sections.map((x) => [x.content_hash, x.content]));
    // a keyless song for the filter and the "Tonul nu e setat" state
    const noKeyId = (await app.api(owner, 'POST', '/api/songs', { title: 'Import fără ton', sections: [{ type: 'verse', content: 'Fără acorduri' }] })).body.song.id;

    for (const [lang, width] of [['ro', 375], ['en', 1024]]) {
      const tag = `[${lang} ${width}]`;
      const before = await song(songs.G);
      // --- the song page: a leader changes the key ---
      const l = await signIn('leader', { width, lang });
      await l.goto(`${app.url}/songs/${songs.G}`);
      await l.waitForSelector('#song-key-box .song-key-value');
      // the reader's notation (C / Do) is a user setting, not the language
      const notation = await l.evaluate((keys) => Object.fromEntries(keys.map((k) => [k, window.NOTATION.chord(k)])), ['G', 'A', 'D', 'E']);
      const row = await l.textContent('#song-key-box');
      check(new RegExp(`^(Ton|Key):\\s*${notation[before.song_key]}\\s*·\\s*(Schimbă|Change)`).test(row.replace(/\s+/g, ' ').trim()), `${tag} song page: "Ton: ${notation[before.song_key]} · Schimbă" under the title`, row);
      const big = await l.$eval('#song-key-box .song-key-value', (x) => parseFloat(getComputedStyle(x).fontSize));
      check(big >= 22, `${tag} the key is large (${big}px)`);
      await l.click('#song-key-box .song-key-change');
      await l.waitForSelector('#song-key-box select.key-pick');
      await l.selectOption('#song-key-box select.key-pick', 'A');
      await l.waitForFunction((k) => new RegExp(k).test(document.querySelector('#song-key-box .song-key-value').textContent), notation.A);
      const after = await song(songs.G);
      check(after.song_key === 'A' && hashes(after) === hashes(before) && after.sections.length === before.sections.length, `${tag} saved from the song page: key A, sections and content hashes unchanged`);
      const a1 = await layoutAudit(l, '#song');
      check(!a1.overflow && !a1.small.length, `${tag} song page: no overflow, targets >= 44 px`, a1);
      // the keyless song: "Tonul nu e setat · Setează" in the accent colour
      await l.goto(`${app.url}/songs/${noKeyId}`);
      await l.waitForSelector('#song-key-box.song-key-unset');
      const unset = await l.evaluate(() => {
        const box = document.getElementById('song-key-box');
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-text').trim();
        const probe = document.createElement('span'); probe.style.color = accent; document.body.append(probe);
        const want = getComputedStyle(probe).color; probe.remove();
        return { text: box.textContent.replace(/\s+/g, ' ').trim(), accent: getComputedStyle(box.querySelector('.song-key-unset-text')).color === want };
      });
      check(/^(Tonul nu e setat|The key is not set)\s*·\s*(Setează|Set it)$/.test(unset.text) && unset.accent, `${tag} no key: "Tonul nu e setat · Setează" in the accent colour`, unset);

      // --- the editor: the "Detalii" card ---
      await l.goto(`${app.url}/songs/${songs.G}/edit`);
      await l.waitForSelector('#song-form:not([hidden]) .editor-details');
      const details = await l.evaluate(() => {
        const card = document.querySelector('.editor-details');
        return { heading: card.querySelector('h2').textContent, fields: ['song-title', 'song-author', 'song-key'].every((id) => card.contains(document.getElementById(id))), value: card.querySelector('.editor-key-value').textContent, hint: card.querySelector('.editor-key-hint').textContent, first: document.querySelector('#song-editor > *') === card };
      });
      check(/^(Detalii|Details)$/.test(details.heading) && details.fields && details.first && details.value === notation.A && details.hint === '', `${tag} editor: "Detalii" card first with title, author and the key ${notation.A} large`, details);
      await l.selectOption('#song-key', '');
      check(/(Adaugă tonul ca să poți transpune|Add the key so you can transpose)/.test(await l.textContent('.editor-key-hint')), `${tag} editor: the hint when the key is empty`);

      // --- the arrange sheet from the event editor: "Original: <key> · Schimbă" ---
      await l.goto(`${app.url}/events/${app.seed.eventId}/edit`);
      await l.waitForSelector('#items .item-main');
      await l.locator('#items .item-main').first().click();
      await l.click('#opt-arrange');
      await l.waitForSelector('dialog.arrange-sheet[open]');
      if (width < 900) await l.click('#arrange-tab-order');
      const orig = (await l.textContent('#arrange-original-key')).replace(/\s+/g, ' ').trim();
      check(new RegExp(`^Original:\\s*${notation.A}\\s*·\\s*(Schimbă|Change)`).test(orig), `${tag} arrange sheet: "Original: ${notation.A} · Schimbă" always`, orig);
      const mid = await song(songs.G);
      await l.click('#arrange-original-key .song-key-change');
      await l.selectOption('#arrange-original-key select.key-pick', 'G');
      await l.waitForFunction((k) => new RegExp(`Original:\\s*${k}`).test(document.getElementById('arrange-original-key').textContent), notation.G);
      const back = await song(songs.G);
      check(back.song_key === 'G' && hashes(back) === hashes(mid), `${tag} saved from the arrange sheet: key G, sections untouched`);
      check(new RegExp(`^${notation.G}`).test((await l.textContent('.arrange-key')).trim()), `${tag} the transposed display follows the new original`, await l.textContent('.arrange-key'));
      await l.click('#arrange-cancel');
      await l.context().close();

      // --- the library: the "fără ton" tag and the "Fără ton" filter ---
      const o = await signIn('owner', { width, lang });
      await o.goto(`${app.url}/library`);
      await o.waitForFunction(() => document.querySelectorAll('#songs li').length >= 4);
      const tagged = await o.$$eval('#songs li', (l2) => l2.filter((li) => li.querySelector('.tag-no-key')).map((li) => li.querySelector('.song-title').textContent));
      check(JSON.stringify(tagged) === JSON.stringify(['Import fără ton']), `${tag} library: only the keyless song carries the "fără ton" tag`, tagged);
      check((await o.getAttribute('#filter-no-key', 'aria-pressed')) === 'false', `${tag} the filter is a selection control (aria-pressed)`);
      await o.click('#filter-no-key');
      await o.waitForFunction(() => document.querySelectorAll('#songs li').length === 1);
      check((await o.textContent('#songs .song-title')) === 'Import fără ton' && /noKey=1/.test(o.url()), `${tag} "Fără ton" lists the keyless songs; the filter is in the URL`);
      await o.reload();
      await o.waitForFunction(() => document.querySelectorAll('#songs li').length === 1);
      check((await o.getAttribute('#filter-no-key', 'aria-pressed')) === 'true', `${tag} reload keeps the filter`);
      const a2 = await layoutAudit(o, 'main');
      check(!a2.overflow && !a2.small.length, `${tag} library: no overflow, targets >= 44 px`, a2);
      await o.context().close();
    }

    // the operator: the same (EDITOR_ROLES); the member: the key, no Schimbă
    const op = await signIn('operator', { width: 1024 });
    await op.goto(`${app.url}/songs/${songs.SIX}`);
    await op.waitForSelector('#song-key-box .song-key-change');
    await op.click('#song-key-box .song-key-change');
    await op.selectOption('#song-key-box select.key-pick', 'E');
    const E = await op.evaluate(() => window.NOTATION.chord('E'));
    await op.waitForFunction((k) => document.querySelector('#song-key-box .song-key-value').textContent === k, E);
    check((await song(songs.SIX)).song_key === 'E', 'operator: changes the key from the song page');
    const m = await signIn('member', { width: 375 });
    await m.goto(`${app.url}/songs/${songs.SIX}`);
    await m.waitForSelector('#song-key-box .song-key-value');
    check((await m.textContent('#song-key-box .song-key-value')) === E && await m.locator('#song-key-box button').count() === 0, `member: sees "Ton: ${E}", no Schimbă`);
    await m.goto(`${app.url}/library`);
    await m.waitForFunction(() => document.querySelectorAll('#songs li').length >= 4);
    await m.click('#filter-no-key');
    await wait(500);
    check((await m.locator('#songs li').count()) === 1, 'member: the "Fără ton" filter works too');
  },
};
