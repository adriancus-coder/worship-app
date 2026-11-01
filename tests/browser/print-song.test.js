'use strict';

// "Tipărește" on the song page: a PDF made in the browser (public/song-pdf.js) with the
// title, the key, the themes and the sections as shown (chords above the lyrics, or the text
// alone with "Doar text"), Liberation Sans embedded (ă â î ș ț). A download on a desktop
// (checked with poppler's pdffonts / pdftotext when present), the share sheet on a phone
// (navigator.share mocked). The button is for everyone. The print styles still leave a clean
// sheet for Ctrl+P. 375 and 1024.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const tool = (name) => { try { execFileSync('which', [name], { stdio: 'pipe' }); return true; } catch (err) { return false; } };

module.exports = {
  name: 'print-song',
  async run({ app, signIn, check }) {
    const { songs } = app.seed;
    const owner = app.cookies.owner;
    await app.api(owner, 'PUT', `/api/songs/${songs.G}/themes`, { themes: ['Închinare'] });
    // --- a desktop: the download, a real PDF ------------------------------------------------
    const o = await signIn('owner', { width: 1024, lang: 'ro' });
    await o.goto(`${app.url}/songs/${songs.G}`);
    await o.waitForSelector('#sections .chord-tap');
    check(!(await o.isHidden('#print-song')) && (await o.textContent('#print-song')).trim() === 'Tipărește', 'the song page: a "Tipărește" button');
    const [download] = await Promise.all([o.waitForEvent('download'), o.click('#print-song')]);
    const file = path.join(os.tmpdir(), `wa-song-${process.pid}.pdf`);
    await download.saveAs(file);
    const bytes = fs.readFileSync(file);
    const title = (await o.textContent('#song-title')).trim();
    check(/\.pdf$/.test(download.suggestedFilename()) && bytes.subarray(0, 5).toString() === '%PDF-' && bytes.length > 20000 && bytes.length < 400000, `a PDF downloaded: ${download.suggestedFilename()}, ${bytes.length} bytes`);
    await o.waitForFunction(() => /descărcat/.test(document.getElementById('status').textContent));
    if (tool('pdffonts') && tool('pdftotext')) {
      const fontsOut = execFileSync('pdffonts', [file], { encoding: 'utf8' });
      const text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
      check(/LiberationSans\b.*(TrueType|CID).*yes/.test(fontsOut) && /LiberationSans-Bold/.test(fontsOut), 'pdffonts: Liberation Sans regular + bold embedded', fontsOut);
      const chords = await o.evaluate(() => document.querySelector('#sections .chord-line').textContent.trim().split(/\s+/)[0]);
      const lyric = await o.evaluate(() => document.querySelector('#sections .lyric-line').textContent.trim().slice(0, 12));
      const firstChordLine = await o.evaluate(() => document.querySelector('#sections .chord-line').textContent.trim().replace(/\s+/g, ' '));
      check(text.includes(title) && /Ton: /.test(text) && text.includes('Închinare') && text.replace(/[ \t]+/g, ' ').includes(firstChordLine) && text.includes(lyric), 'pdftotext: the title, "Ton:", the theme, the first chord and the first lyric line', { title, chords, lyric, head: text.slice(0, 300) });
      // a diacritic from the lyrics survives (the font subset carries ă â î ș ț)
      const diacritic = (await o.evaluate(() => document.getElementById('sections').textContent)).match(/[ăâîșț]/);
      check(!diacritic || new RegExp(diacritic[0]).test(text), 'the diacritics are in the PDF text', diacritic && diacritic[0]);
    } else check(true, 'poppler not installed here: the PDF text was not inspected');
    fs.rmSync(file, { force: true });
    // "Doar text": the PDF carries no chords
    await o.click('#text-only');
    await o.waitForFunction(() => !document.querySelector('#sections .chord-line'));
    const [download2] = await Promise.all([o.waitForEvent('download'), o.click('#print-song')]);
    const file2 = path.join(os.tmpdir(), `wa-song-text-${process.pid}.pdf`);
    await download2.saveAs(file2);
    if (tool('pdftotext')) {
      const text2 = execFileSync('pdftotext', ['-layout', file2, '-'], { encoding: 'utf8' });
      const chordLine = await o.evaluate(() => { document.getElementById('text-only').click(); return new Promise((r) => setTimeout(() => r(document.querySelector('#sections .chord-line').textContent.trim().replace(/\s+/g, ' ')), 50)); });
      const collapsed = text2.replace(/[ \t]+/g, ' ');
      check(text2.includes(title) && !collapsed.includes(chordLine), '"Doar text": the PDF has the lyrics without the chord lines', { chordLine });
    }
    fs.rmSync(file2, { force: true });
    // the print styles (Ctrl+P): a clean sheet
    await o.emulateMedia({ media: 'print' });
    const sheet = await o.evaluate(() => {
      const shown = (sel) => { const n = document.querySelector(sel); return n ? getComputedStyle(n).display !== 'none' : null; };
      return { shell: shown('.app-shell'), actions: shown('.song-actions'), title: shown('#song-title'), sections: shown('#sections'), paper: getComputedStyle(document.body).backgroundColor };
    });
    check(sheet.shell === false && sheet.actions === false && sheet.title && sheet.sections && sheet.paper === 'rgb(255, 255, 255)', 'Ctrl+P: no shell or buttons, black on white', sheet);
    await o.emulateMedia({ media: 'screen' });

    // --- a phone: the share sheet with the file --------------------------------------------
    const p = await signIn('member', { width: 375, lang: 'ro' });
    await p.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' });
      navigator.canShare = (data) => Boolean(data && data.files && data.files.length);
      navigator.share = async (data) => { window.__shared = { name: data.files[0].name, type: data.files[0].type, size: data.files[0].size, title: data.title }; };
    });
    await p.goto(`${app.url}/songs/${songs.G}`);
    await p.waitForSelector('#sections .chord-tap');
    await p.click('#print-song');
    await p.waitForFunction(() => window.__shared);
    const shared = await p.evaluate(() => window.__shared);
    check(shared.type === 'application/pdf' && /\.pdf$/.test(shared.name) && shared.size > 20000 && shared.title === title, 'a phone: the PDF goes to the share sheet', shared);
    check(/Tipărește sau Salvează/.test(await p.textContent('#status')), 'the status says what to choose', await p.textContent('#status'));
    const e = await signIn('owner', { width: 1024, lang: 'en' });
    await e.goto(`${app.url}/songs/${songs.G}`);
    await e.waitForSelector('#print-song');
    check((await e.textContent('#print-song')).trim() === 'Print', 'EN: "Print"');
  },
};
