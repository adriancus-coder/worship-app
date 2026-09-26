'use strict';

// The "next" line of the big lyrics (and the follow page's "Urmează", and the step-row
// "Următoarea: …" label): the next step of the same song with its first lyric line, the next
// song with its key, a verse / announcement by its reference or title, "Sfârșitul programului"
// at the very end. Larger than before, one line, 44 px, scales with A− / A+. RO 375, EN 1180.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'big-next',
  timeout: 180000,
  async run({ app, signIn, check }) {
    const [G, VERSE, SIX, ANN, T3] = app.seed.items;
    await app.command({ type: 'event.start' });
    const goto = async (itemId, step) => { await app.command({ type: 'worship.goto', itemId, step }); await wait(350); };
    const bigNext = (p) => p.evaluate(() => {
      const n = document.querySelector('dialog.big-lyrics .big-next');
      const r = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      return { text: n.textContent, height: r.height, font: parseFloat(cs.fontSize), overflow: r.right > window.innerWidth + 1 || r.left < -1, ellipsis: cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap' };
    });

    for (const [lang, width, role] of [['ro', 375, 'leader'], ['en', 1180, 'presenter']]) {
      const tag = `[${lang} ${width}]`;
      const p = await signIn(role, { width, lang });
      const m = await signIn('member', { width, lang });
      await m.goto(`${app.url}/events/${app.seed.eventId}/follow`);
      await m.waitForSelector('#follow:not([hidden])');
      const follow = () => m.evaluate(() => (document.querySelector('#slide .up-next') || {}).textContent || '');
      await p.goto(`${app.url}/events/${app.seed.eventId}/live`);
      await p.waitForSelector('#live:not([hidden])');
      const stepRow = () => p.textContent('#next-button');

      const cases = lang === 'ro' ? [
        [G, 0, /^Urmează: Refren\. Sfânt, sfânt, sfânt$/, /Următoarea: Refren →/],
        [G, 1, /^Urmează: Luca 2:1-7$/, /Următoarea: Luca 2:1-7 →/],
        [VERSE, 0, /^Urmează cântarea: Șase rânduri \(Ton D\)$/, /Următoarea: cântarea „Șase rânduri” →/],
        [SIX, 0, /^Urmează: Agapă$/, /Următoarea: Agapă →/],
        [ANN, 0, /^Urmează cântarea: Mare ești Tu \(Ton C\)$/, /cântarea „Mare ești Tu”/],
        [T3, 1, /^Sfârșitul programului$/, /^Sfârșitul programului$/],
      ] : [
        [G, 0, /^Next: Chorus\. Sfânt, sfânt, sfânt$/, /Next: Chorus →/],
        [G, 1, /^Next: Luca 2:1-7$/, /Next: Luca 2:1-7 →/],
        [VERSE, 0, /^Next song: Șase rânduri \(Key D\)$/, /Next: the song “Șase rânduri” →/],
        [SIX, 0, /^Next: Agapă$/, /Next: Agapă →/],
        [ANN, 0, /^Next song: Mare ești Tu \(Key C\)$/, /the song “Mare ești Tu”/],
        [T3, 1, /^End of the setlist$/, /^End of the setlist$/],
      ];
      await goto(G, 0);
      await p.click('#big-open');
      await p.waitForSelector('dialog.big-lyrics[open]');
      for (const [itemId, step, big, row] of cases) {
        await goto(itemId, step);
        await p.waitForFunction((re) => new RegExp(re).test(document.querySelector('dialog.big-lyrics .big-next').textContent), big.source, { timeout: 4000 }).catch(() => {});
        const b = await bigNext(p);
        check(big.test(b.text), `${tag} big lyrics ${itemId}/${step}: "${b.text}"`, b);
        check(b.height >= 44 && !b.overflow && b.ellipsis, `${tag} the line is >= 44 px, one line with ellipsis, inside the screen`, b);
        await m.waitForFunction((re) => new RegExp(re).test((document.querySelector('#slide .up-next') || {}).textContent || ''), big.source, { timeout: 4000 }).catch(() => {});
        check(big.test(await follow()), `${tag} follow page "Urmează": the same words`, await follow());
        check(row.test(await stepRow()), `${tag} step-row button: "${await stepRow()}"`);
      }
      // A− / A+ scale the next line with the lyrics
      const f0 = (await bigNext(p)).font;
      await p.click('dialog.big-lyrics .big-tools button:has-text("A+")');
      await wait(150);
      const f1 = (await bigNext(p)).font;
      await p.click('dialog.big-lyrics .big-tools button:has-text("A−")');
      await p.click('dialog.big-lyrics .big-tools button:has-text("A−")');
      await wait(150);
      const f2 = (await bigNext(p)).font;
      check(f1 > f0 && f2 < f0 && f0 >= 22, `${tag} A+ / A− scale the next line (${f2.toFixed(1)} < ${f0.toFixed(1)} < ${f1.toFixed(1)} px)`);
      await p.click('dialog.big-lyrics .big-tools button:has-text("A+")'); // back to the default
      const a = await layoutAudit(p, 'dialog.big-lyrics');
      check(!a.overflow && !a.small.length, `${tag} big lyrics: no overflow, targets >= 44 px`, a);
      await p.keyboard.press('Escape');
      await p.context().close();
      await m.context().close();
    }
  },
};
