'use strict';

// After "Sfârșit" the big lyrics show a small "✓ Terminat" pill and the NEXT item prepared:
// a song's title, key (reader's notation) and first section at ~70 % of the lyrics size
// (chords per "Doar text"); a verse / announcement's reference or title and text; at the end
// of the programme "Sfârșitul programului". The bar keeps "← Înapoi · ✓ Terminat · Următoarea";
// "Următoarea" goes there. The member's follow view shows the same. RO 375 / EN 1180.

const { wait } = require('./harness');

module.exports = {
  name: 'big-after-end',
  timeout: 240000,
  async run({ app, signIn, check }) {
    const { eventId: E, items } = app.seed;
    const [G, VERSE, SIX, ANN, T3] = items;
    check((await app.command({ type: 'event.start' })).ok, 'the event is live');
    const view = (p) => p.evaluate(() => {
      const d = document.querySelector('dialog.big-lyrics');
      if (!d || !d.open) return null;
      const after = d.querySelector('.big-after');
      const section = d.querySelector('.big-after-section');
      const text = d.querySelector('.big-text');
      return {
        pill: after ? (after.querySelector('.big-done-pill') || {}).textContent : null, title: after ? (after.querySelector('.big-after-title') || {}).textContent : null,
        key: after ? (after.querySelector('.big-after-key') || {}).textContent || '' : '', body: after ? after.innerText.replace(/\s+/g, ' ').trim() : text.innerText.replace(/\s+/g, ' ').trim(),
        ratio: section ? parseFloat(getComputedStyle(section).fontSize) / parseFloat(getComputedStyle(text).fontSize) : null,
        chords: d.querySelectorAll('.big-after-section .chord-line').length,
        bar: [...d.querySelectorAll('.big-nav > button')].filter((b) => b.getClientRects().length).map((b) => `${b.textContent.trim()}${b.disabled ? '(off)' : ''}`),
      };
    });
    for (const [lang, width] of [['ro', 375], ['en', 1180]]) {
      const tag = `[${lang} ${width}]`;
      await app.command({ type: 'worship.goto', itemId: G, step: 1 });
      const p = await signIn('leader', { width, lang });
      await p.evaluate(() => { try { localStorage.setItem('wa_text_only', '0'); } catch (e) {} });
      await p.goto(`${app.url}/events/${E}/live`);
      await p.waitForSelector('#live:not([hidden])');
      if (await p.evaluate(() => Boolean(document.querySelector('dialog.big-lyrics[open]')))) await p.keyboard.press('Escape');
      await p.waitForSelector('.step[aria-current=step]');
      await p.click('.step[aria-current=step]');
      await p.waitForSelector('dialog.big-lyrics[open]');
      // song ended -> next is the verse: reference + text
      await p.keyboard.press('e');
      await p.waitForSelector('dialog.big-lyrics .big-after', { timeout: 4000 });
      let v = await view(p);
      check(/(Terminat|Ended)/g.test(v.pill) && /Luca 2:1-7/.test(v.title) && /În zilele acelea/.test(v.body), `${tag} after Sfârșit: "✓ Terminat" pill, then the verse's reference and text`, v);
      check(v.bar.length === 4 && /off/.test(v.bar[2]) && /(Următoarea|Next)/.test(v.bar[3]) && /Luca/.test(v.bar[3]), `${tag} the bar: ✕ Ieși · ← Înapoi · ✓ Terminat (off) · Următoarea: Luca…`, v.bar);
      await p.click('dialog.big-lyrics .big-nav > button:last-child');
      await wait(400);
      check((await app.state()).worship.itemId === VERSE, `${tag} "Următoarea" goes to the verse`);
      // verse ended -> next is a song: title, key, first section at ~70 % with chords
      await p.keyboard.press('e');
      await p.waitForFunction(() => /Șase rânduri/.test((document.querySelector('dialog.big-lyrics .big-after-title') || {}).textContent || ''), null, { timeout: 4000 });
      v = await view(p);
      const D = await p.evaluate(() => window.NOTATION.chord('D'));
      check(/Șase rânduri/.test(v.title) && new RegExp(D).test(v.key) && /Primul rând/.test(v.body) && v.chords > 0 && v.ratio > 0.6 && v.ratio < 0.8, `${tag} next song prepared: title, key ${D}, first section with chords at ~70 % (${v.ratio && v.ratio.toFixed(2)})`, v);
      // "Doar text" hides the chords there too
      await p.click('dialog.big-lyrics .big-tools button:nth-child(1)');
      await wait(300);
      check((await view(p)).chords === 0, `${tag} "Doar text" honoured in the prepared section`);
      await p.click('dialog.big-lyrics .big-tools button:nth-child(1)');
      // song ended -> next is the announcement: title + text
      await app.command({ type: 'worship.goto', itemId: SIX, step: 0 });
      await app.command({ type: 'worship.endItem' });
      await p.waitForFunction(() => /Agapă/.test((document.querySelector('dialog.big-lyrics .big-after-title') || {}).textContent || ''), null, { timeout: 4000 });
      v = await view(p);
      check(/Agapă/.test(v.title) && /După serviciu/.test(v.body), `${tag} next announcement: its title and text`, v);
      // last item ended -> "Sfârșitul programului"
      await app.command({ type: 'worship.goto', itemId: T3, step: 0 });
      await app.command({ type: 'worship.endItem' });
      await p.waitForFunction(() => /(Sfârșitul programului|End of the setlist)/.test((document.querySelector('dialog.big-lyrics .big-after') || {}).textContent || ''), null, { timeout: 4000 });
      v = await view(p);
      check(/(Terminat|Ended)/g.test(v.pill) && !v.title, `${tag} last item: "✓ Terminat" + "Sfârșitul programului"`, v);
      await p.context().close();
    }
    // the member's follow view after an end: the same prepared layout
    await app.command({ type: 'worship.goto', itemId: G, step: 1 });
    const m = await signIn('member', { width: 375 });
    await m.goto(`${app.url}/events/${E}/follow`);
    await m.waitForSelector('#big-open:not([hidden])');
    await m.click('#big-open');
    await m.waitForSelector('dialog.big-lyrics[open]');
    await app.command({ type: 'worship.endItem' });
    await m.waitForSelector('dialog.big-lyrics .big-after', { timeout: 5000 });
    const mv = await view(m);
    check(/(Terminat)/.test(mv.pill) && /Luca 2:1-7/.test(mv.title) && /În zilele acelea/.test(mv.body), 'member follow view: "✓ Terminat" + the next item prepared', mv);
    void ANN;
  },
};
