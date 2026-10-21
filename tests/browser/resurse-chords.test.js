'use strict';

// Import from resursecrestine.ro with the chords (fixtures/mock-resurse.js stands in for the
// site): "Importă" on a result whose text has no chords takes them from the sheet that
// matches the lyrics ("Importată, cu acorduri"; the song page shows chord lines and the
// sheet's key); the preview offers the sheets (author · key · how much of the lyrics) and
// "Fără acorduri"; a sheet with other lyrics imports as the song it is.

const path = require('path');
const FIXTURES = path.join(__dirname, 'fixtures');

module.exports = {
  name: 'resurse-chords',
  app: { preload: [path.join(FIXTURES, 'mock-resurse.js')] },
  timeout: 180000,
  async run({ app, signIn, check }) {
    const p = await signIn('owner', { width: 1024, lang: 'ro' });
    await p.goto(`${app.url}/library`);
    await p.waitForSelector('#q');
    await p.fill('#q', 'Fără');
    await p.keyboard.press('Enter');
    await p.waitForSelector('#online-results li:has-text("Fără acorduri")');
    await p.click('#online-results li:has-text("Fără acorduri") button:has-text("Importă")');
    await p.waitForSelector('#online-results li:has-text("Fără acorduri") .row-state');
    check((await p.textContent('#online-results li:has-text("Fără acorduri") .row-state')) === 'Importată, cu acorduri', '"Importă": the song came with the chords of the matching sheet');
    const song = (await app.api(app.cookies.owner, 'GET', '/api/songs?q=acorduri')).body.songs.find((s) => s.title === 'Fără acorduri');
    const full = (await app.api(app.cookies.owner, 'GET', `/api/songs/${song.id}`)).body.song;
    check(full.song_key === 'D' && full.sections.length === 2 && full.sections[0].content.startsWith('[D]Când totul') && /\[G\]Viața/.test(full.sections[1].content), 'the library: key D, the chords over the song\'s own lines', { key: full.song_key, first: full.sections[0].content });
    await p.goto(`${app.url}/songs/${song.id}`);
    await p.waitForSelector('#sections .chord-line');
    check((await p.locator('#sections .chord-line').count()) >= 3, 'the song page shows the chord lines');
    await app.api(app.cookies.owner, 'DELETE', `/api/songs/${song.id}`);

    // the preview: the sheets to pick from; "Fără acorduri"; the other sheet = another song
    await p.goto(`${app.url}/library`);
    await p.waitForSelector('#q');
    await p.fill('#q', 'Fără');
    await p.keyboard.press('Enter');
    await p.waitForSelector('#online-results li:has-text("Fără acorduri")');
    await p.click('#online-results li:has-text("Fără acorduri") button:has-text("Previzualizare")');
    await p.waitForSelector('#online-preview[open] #preview-chords button');
    const choice = await p.$$eval('#preview-chords button', (l) => l.map((b) => ({ sheet: b.dataset.sheet, text: b.textContent, pressed: b.getAttribute('aria-pressed') })));
    check(choice.length === 3 && choice[0].sheet === 'none' && /Adeline M\. · Re|Adeline M\. · D/.test(choice[1].text) && /100 %/.test(choice[1].text) && /0 %/.test(choice[2].text) && choice[1].pressed === 'true', 'the preview: "Fără acorduri", the matching sheet (selected, 100 %), the other one (0 %)', choice);
    check((await p.locator('#preview-sections .chord-line').count()) >= 3, 'the preview shows the chords of the selected sheet');
    await p.click('#preview-chords [data-sheet="none"]');
    await p.waitForFunction(() => document.querySelector('#preview-chords [data-sheet="none"]') && document.querySelector('#preview-chords [data-sheet="none"]').getAttribute('aria-pressed') === 'true');
    check((await p.locator('#preview-sections .chord-line').count()) === 0, '"Fără acorduri": the preview without chords');
    await p.click('#preview-chords [data-sheet="9002"]');
    await p.waitForFunction(() => document.querySelector('#preview-chords [data-sheet="9002"]') && document.querySelector('#preview-chords [data-sheet="9002"]').getAttribute('aria-pressed') === 'true');
    const other = await p.evaluate(() => ({ lines: [...document.querySelectorAll('#preview-sections .lyric-line')].map((x) => x.textContent), meta: document.getElementById('preview-meta').textContent }));
    check(other.lines[0].startsWith('In dragostea Ta') && /Am|Lam/.test(other.meta), 'the other sheet: its own lyrics and key (another song with this title)', other);
    await p.click('#preview-import');
    await p.waitForFunction(() => /importată/i.test(document.getElementById('preview-message').textContent), null, { timeout: 5000 });
    const imported = (await app.api(app.cookies.owner, 'GET', '/api/songs?q=acorduri')).body.songs.find((s) => s.title === 'Fără acorduri');
    const got = (await app.api(app.cookies.owner, 'GET', `/api/songs/${imported.id}`)).body.song;
    check(got.song_key === 'Am' && got.sections[0].content.startsWith('[Am]In dragostea'), 'imported as picked in the preview', { key: got.song_key, first: got.sections[0].content });
    await p.context().close();
  },
};
