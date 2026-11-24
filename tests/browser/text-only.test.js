'use strict';

// "Doar text" (the lyrics without chords) everywhere lyrics show, one choice per device
// (public/text-only.js): the live page's current section (next to C · Do), the event page's
// song detail, the big lyrics; a change in one place reaches the others and the song page.

module.exports = {
  name: 'text-only',
  async run({ app, signIn, check }) {
    const { eventId: E, songs } = app.seed;
    await app.command({ type: 'event.start' }, 'owner');
    await app.command({ type: 'worship.goto', itemId: null, step: 0 }, 'owner').catch(() => null);
    const p = await signIn('owner', { width: 1024, lang: 'ro' });
    await p.goto(`${app.url}/events/${E}/live`);
    await p.waitForSelector('#live:not([hidden])');
    // the song with chords on the projector
    const item = (await app.api(app.cookies.owner, 'GET', `/api/events/${E}`)).body.items.find((it) => it.songId === songs.T3);
    await app.command({ type: 'worship.goto', itemId: item.id, step: 0 }, 'owner');
    await p.waitForSelector('.current-section .chord-line');
    check(await p.isVisible('.current-tools #text-only') && (await p.getAttribute('.current-tools #text-only', 'aria-pressed')) === 'false', 'live page: "Doar text" next to C · Do, off');
    await p.click('.current-tools #text-only');
    await p.waitForFunction(() => document.querySelectorAll('.current-section .chord-line').length === 0);
    check((await p.getAttribute('.current-tools #text-only', 'aria-pressed')) === 'true' && await p.isVisible('.current-section .lyrics, .current-section .lyric-line'), 'live page: on, the section shows the words only');
    // the big lyrics share the choice; switching it off there brings the chords back on the page
    await p.click('#big-open');
    await p.waitForSelector('dialog.big-lyrics[open]');
    check((await p.getAttribute('dialog.big-lyrics .big-tools button:nth-child(1)', 'aria-pressed')) === 'true', 'the big lyrics: "Doar text" on too');
    await p.click('dialog.big-lyrics .big-tools button:nth-child(1)');
    await p.click('dialog.big-lyrics .big-close');
    await p.waitForFunction(() => document.querySelectorAll('.current-section .chord-line').length > 0);
    check((await p.getAttribute('.current-tools #text-only', 'aria-pressed')) === 'false', 'switched off in the big lyrics: the page follows');
    // the event page: the song's detail has the toggle; the choice is the device's
    await p.goto(`${app.url}/events/${E}`);
    await p.waitForSelector('#items .item-main');
    await p.locator('#items .item-main', { hasText: 'Mare ești Tu' }).click();
    await p.waitForSelector('.detail-sections .chord-line');
    await p.click('.detail-sections #text-only');
    await p.waitForFunction(() => document.querySelectorAll('.detail-sections .chord-line').length === 0);
    check((await p.getAttribute('.detail-sections #text-only', 'aria-pressed')) === 'true', 'event page: "Doar text" on the song detail hides the chords');
    await p.goto(`${app.url}/songs/${songs.T3}`);
    await p.waitForSelector('#sections');
    check((await p.getAttribute('#text-only', 'aria-pressed')) === 'true' && (await p.locator('#sections .chord-line').count()) === 0, 'the song page: the same choice (text only)');
    await p.click('#text-only'); // back to chords for the next tests
    await app.command({ type: 'event.withdraw' }, 'owner');
    await p.context().close();
  },
};
