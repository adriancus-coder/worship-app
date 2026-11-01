'use strict';

// "Tipărește" on the song page: the print styles leave a clean sheet (title, key, themes,
// the lyrics as shown) and drop the shell, the buttons and the history; the chords print
// when "Doar text" is off. The button exists for everyone (the Sunday school prints its
// songs for the children). 375 and 1024.

module.exports = {
  name: 'print-song',
  async run({ app, signIn, check }) {
    const { songs } = app.seed;
    const p = await signIn('member', { width: 375, lang: 'ro' });
    await p.goto(`${app.url}/songs/${songs.G}`);
    await p.waitForSelector('#sections .chord-tap');
    check(!(await p.isHidden('#print-song')) && (await p.textContent('#print-song')).trim() === 'Tipărește', 'the song page: a "Tipărește" button for everyone');
    let printed = false;
    await p.exposeFunction('__printed', () => { printed = true; });
    await p.evaluate(() => { window.print = () => window.__printed(); });
    await p.click('#print-song');
    await p.waitForFunction(() => true);
    check(printed, 'the button opens the print dialog');
    await p.emulateMedia({ media: 'print' });
    const sheet = await p.evaluate(() => {
      const shown = (sel) => { const n = document.querySelector(sel); return n ? getComputedStyle(n).display !== 'none' : null; };
      return {
        shell: shown('.app-shell'), actions: shown('.song-actions'), back: shown('.back'), history: shown('#song-history'), keyChange: shown('.song-key-change'),
        title: shown('#song-title'), sections: shown('#sections'), chords: shown('.chord-line'),
        chordInk: getComputedStyle(document.querySelector('.chord-line')).color, lyricInk: getComputedStyle(document.querySelector('.lyric-line')).color,
        paper: getComputedStyle(document.body).backgroundColor,
      };
    });
    check(sheet.shell === false && sheet.actions === false && sheet.back === false && sheet.keyChange !== true && sheet.title && sheet.sections && sheet.chords,
      'print: no shell, buttons or history; the title, the key and the lyrics with their chords stay', sheet);
    check(sheet.paper === 'rgb(255, 255, 255)' && sheet.lyricInk === 'rgb(0, 0, 0)' && sheet.chordInk === 'rgb(0, 0, 0)', 'print: black on white', sheet);
    await p.emulateMedia({ media: 'screen' });
    // "Doar text": the sheet follows (no chords)
    await p.click('#text-only');
    await p.waitForFunction(() => !document.querySelector('#sections .chord-line'));
    await p.emulateMedia({ media: 'print' });
    check(await p.evaluate(() => !document.querySelector('#sections .chord-line') && document.querySelectorAll('#sections .lyrics').length >= 1 && getComputedStyle(document.querySelector('#sections .lyrics')).color === 'rgb(0, 0, 0)'), '"Doar text": the sheet prints the lyrics only, in ink');
    const o = await signIn('owner', { width: 1024, lang: 'en' });
    await o.goto(`${app.url}/songs/${songs.G}`);
    await o.waitForSelector('#print-song');
    check((await o.textContent('#print-song')).trim() === 'Print', 'EN: "Print"');
  },
};
