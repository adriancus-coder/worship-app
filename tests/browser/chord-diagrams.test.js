'use strict';

// Chord diagrams: on the song page and at the rehearsal every chord is tappable; a tap opens
// the pop-up with the chord's name (in the reader's notation), a Chitară / Pian selection
// (kept on the device) and the drawing: the guitar shape (strings, dots, a barre) or the
// piano keys lit. Escape closes it; "Doar text" has no chords to tap. 375 and 1024.

const { layoutAudit } = require('./harness');

module.exports = {
  name: 'chord-diagrams',
  timeout: 180000,
  async run({ app, signIn, check }) {
    const { songs, eventId: E } = app.seed;
    const p = await signIn('member', { width: 375, lang: 'ro' });
    await p.goto(`${app.url}/songs/${songs.G}`);
    await p.waitForSelector('#sections .chord-tap');
    const taps = await p.$$eval('#sections .chord-tap', (l) => l.map((x) => ({ text: x.textContent, chord: x.dataset.chord, role: x.getAttribute('role') })));
    check(taps.length >= 2 && taps.every((x) => x.role === 'button' && x.text === x.chord), `the song page: ${taps.length} tappable chords, the spacing of the line kept`, taps.slice(0, 4));
    const line = await p.$eval('#sections .chord-line', (x) => x.textContent);
    check(/\S\s{2,}\S/.test(line) || line.trim().split(/\s+/).length === 1, 'the chord line keeps its spacing', line);
    await p.click('#sections .chord-tap >> nth=0');
    await p.waitForSelector('#chord-dialog[open]');
    const d = await p.evaluate(() => ({ title: document.getElementById('chord-dialog-title').textContent, pressed: document.querySelector('#chord-dialog [data-instrument][aria-pressed="true"]').dataset.instrument, guitar: Boolean(document.querySelector('#chord-dialog .chord-guitar')), dots: document.querySelectorAll('#chord-dialog .gtr-dot').length, strings: document.querySelectorAll('#chord-dialog .gtr-string').length }));
    check(d.title === taps[0].chord && d.pressed === 'guitar' && d.guitar && d.strings === 6 && d.dots >= 2, 'a tap: the pop-up with the chord, Chitară selected, the shape (6 strings, dots)', d);
    const a = await layoutAudit(p, '#chord-dialog');
    check(!a.overflow && !a.small.length, 'the pop-up 375: no overflow, targets >= 44 px', a);
    await p.click('#chord-dialog [data-instrument="piano"]');
    const piano = await p.evaluate(() => ({ keys: document.querySelectorAll('#chord-dialog .pno-key').length, on: document.querySelectorAll('#chord-dialog .pno-key.is-on').length, root: document.querySelectorAll('#chord-dialog .pno-key.is-root').length, pressed: document.querySelector('#chord-dialog [data-instrument][aria-pressed="true"]').dataset.instrument, stored: localStorage.getItem('wa_chord_instrument') }));
    check(piano.keys === 24 && piano.on >= 3 && piano.root === 1 && piano.pressed === 'piano' && piano.stored === 'piano', '"Pian": two octaves, the chord\'s keys lit, the root marked; the choice kept', piano);
    await p.keyboard.press('Escape');
    await p.waitForSelector('#chord-dialog', { state: 'hidden' });
    await p.reload();
    await p.waitForSelector('#sections .chord-tap');
    await p.keyboard.press('Tab'); // keyboard: a chord gets focus; Enter opens
    await p.focus('#sections .chord-tap >> nth=1');
    await p.keyboard.press('Enter');
    await p.waitForSelector('#chord-dialog[open]');
    check((await p.$eval('#chord-dialog [data-instrument][aria-pressed="true"]', (x) => x.dataset.instrument)) === 'piano' && Boolean(await p.$('#chord-dialog .chord-piano')), 'after a reload: Enter on a chord opens it on the piano, as chosen');
    await p.keyboard.press('Escape');
    await p.click('#text-only');
    check((await p.locator('#sections .chord-tap').count()) === 0, '"Doar text": nothing to tap');
    await p.click('#text-only');
    await p.context().close();

    // solfège: the pop-up names the chord as the reader reads it; the rehearsal has the taps too
    const l = await signIn('leader', { width: 1024, lang: 'ro' });
    await l.goto(`${app.url}/events/${E}/rehearse`);
    await l.waitForSelector('#slide .chord-tap');
    await l.evaluate(() => window.NOTATION.set('solfege'));
    await l.waitForFunction(() => /^(Do|Re|Mi|Fa|Sol|La|Si)/.test(document.querySelector('#slide .chord-tap').textContent));
    const first = await l.$eval('#slide .chord-tap', (x) => x.textContent);
    await l.click('#slide .chord-tap >> nth=0');
    await l.waitForSelector('#chord-dialog[open]');
    check((await l.textContent('#chord-dialog-title')) === first && /^(Do|Re|Mi|Fa|Sol|La|Si)/.test(first), `the rehearsal, in solfège: the pop-up says "${first}"`);
    await l.evaluate(() => window.NOTATION.set('letters'));
    await l.context().close();
  },
};
