'use strict';

// A chorus whose lyrics start with a leftover "Refren:" line: the next line reads "Urmează:
// Refren. <real first line>" (never "Refren. Refren:"), the step buttons and the editor's
// order summary agree, the projector shows the lyrics exactly as stored; the song editor's
// paste conversion drops a label-only first line that the section type already says.
// RO 375 / EN 1024 / RO 1180.

const { wait } = require('./harness');

module.exports = {
  name: 'next-dedup',
  timeout: 240000,
  async run({ app, browser, signIn, check }) {
    const owner = app.cookies.owner;
    const songId = (await app.api(owner, 'POST', '/api/songs', { title: 'Cu etichetă', song_key: 'C', sections: [
      { type: 'verse', content: '[C]Prima strofă a [G]cântării' },
      { type: 'chorus', content: 'Refren:\n[F]Aleluia, [C]aleluia' },
    ] })).body.song.id;
    const eventId = (await app.api(owner, 'POST', '/api/events', { name: 'Etichete', eventDate: app.seed.today, startTime: '19:00' })).body.event.id;
    await app.api(owner, 'PUT', `/api/events/${eventId}/items`, { items: [{ type: 'song', songId }] });
    const itemId = (await app.api(owner, 'GET', `/api/events/${eventId}`)).body.items[0].id;
    // a paired screen for the projector
    const sp = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    await sp.goto(`${app.url}/screen`);
    await sp.waitForFunction(() => /\d{3} \d{3}/.test(document.getElementById('pairing-code').textContent));
    await app.api(owner, 'POST', '/api/screens/claim', { code: (await sp.textContent('#pairing-code')).replace(' ', ''), name: 'Proiector' });
    await sp.waitForSelector('#output:not([hidden])', { timeout: 6000 });
    check((await app.command({ eventId, type: 'event.start' })).ok, 'the event is live');
    await app.command({ eventId, type: 'projector.source', source: 'content' });

    for (const [lang, width] of [['ro', 375], ['en', 1024], ['ro', 1180]]) {
      const tag = `[${lang} ${width}]`;
      // the editor's order summary
      const p = await signIn('leader', { width, lang });
      await p.goto(`${app.url}/events/${eventId}/edit`);
      await p.waitForSelector('#items .item-main');
      await p.locator('#items .item-main').first().click();
      await p.waitForSelector('.order-summary-row');
      const summary = await p.$$eval('.order-summary-row .step-line', (l) => l.map((x) => x.textContent));
      check(summary[1] === 'Aleluia, aleluia', `${tag} editor summary: the chorus row shows the real first line`, summary);
      // live: the step buttons and the next line
      await app.command({ eventId, type: 'worship.goto', itemId, step: 0 });
      await p.goto(`${app.url}/events/${eventId}/live?view=full`); // a leader lands in the lyrics otherwise
      await p.waitForSelector('#live:not([hidden])');
      await p.waitForSelector('.step[aria-current=step]');
      const steps = await p.$$eval('.step .step-line', (l) => l.map((x) => x.textContent));
      check(steps[1] === 'Aleluia, aleluia' && !/Refren:/.test(steps.join(' ')), `${tag} step buttons: the same first line, no "Refren:"`, steps);
      await p.click('.step[aria-current=step]');
      await p.waitForSelector('dialog.big-lyrics[open]');
      await p.waitForFunction(() => /Aleluia|Refren|Chorus/.test(document.querySelector('dialog.big-lyrics .big-next').textContent), null, { timeout: 4000 }).catch(() => {});
      const next = await p.textContent('dialog.big-lyrics .big-next');
      check(/^(Urmează|Next): (Refren|Chorus)\. Aleluia, aleluia$/.test(next.trim()), `${tag} "Urmează: Refren. Aleluia, aleluia" (no repeated name)`, next);
      await p.keyboard.press('Escape');
      // the projector: the lyrics as stored, "Refren:" included
      await app.command({ eventId, type: 'worship.next' });
      await wait(500);
      const shown = await sp.evaluate(() => document.querySelector('#output .projector-stage').innerText.replace(/\s+/g, ' ').trim());
      check(/Refren:/.test(shown) && /Aleluia, aleluia/.test(shown), `${tag} projector: the chorus exactly as stored ("Refren:" line kept)`, shown);
      await p.context().close();
    }

    // the song editor's paste conversion: a label-only first line is dropped when the type says it
    const e = await signIn('leader', { width: 1024 });
    await e.goto(`${app.url}/songs/new`);
    await e.waitForSelector('#song-form:not([hidden])');
    await e.selectOption('#section-0-type', 'chorus');
    await e.fill('#section-0-content', 'Refren:\nF        C\nAleluia, aleluia');
    await e.focus('#song-title');
    await wait(100);
    check((await e.inputValue('#section-0-content')) === '[F]Aleluia, [C]aleluia', 'editor: pasted chorus "Refren:" + chords over lyrics -> "[F]Aleluia, [C]aleluia"', await e.inputValue('#section-0-content'));
    await e.selectOption('#section-0-type', 'verse');
    await e.fill('#section-0-content', 'Refren:\nAleluia');
    await e.focus('#song-title');
    await wait(100);
    check((await e.inputValue('#section-0-content')) === 'Refren:\nAleluia', 'editor: the label stays when the section is a verse');
    // existing songs are untouched
    const stored = (await app.api(owner, 'GET', `/api/songs/${songId}`)).body.song.sections[1].content;
    check(stored === 'Refren:\n[F]Aleluia, [C]aleluia', 'the stored song is untouched');
  },
};
