'use strict';

// The song as on the home card, everywhere (public/programme-big.js): on the event page
// (viewing) a tap on a song row shows the whole song and a tap on a section opens "⤢ Versuri
// mari" there, swiping on into the next song (whose row opens); inside the big view a tap on
// the text ("Toată cântarea", the tool too on wide screens) lists the sections and a tap on one goes there, back to
// the large view; the editor keeps its preview as it was (no tap targets). A member at 375,
// the leader at 1024; the leader's live big view has the whole-song tool too.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'event-big',
  timeout: 180000,
  async run({ app, signIn, check }) {
    const { eventId: E, items } = app.seed;
    const big = (p) => p.evaluate(() => {
      const d = document.querySelector('dialog.big-lyrics[open]');
      if (!d) return null;
      return { label: d.querySelector('.big-label').textContent, whole: d.classList.contains('whole'), pressed: d.querySelector('.big-whole').getAttribute('aria-pressed'), sections: [...d.querySelectorAll('.big-whole-section')].map((x) => `${x.querySelector('.section-label').textContent}${x.classList.contains('is-current') ? '*' : ''}`), text: d.querySelector('.big-text').innerText.slice(0, 30) };
    });

    for (const [lang, width, role] of [['ro', 375, 'member'], ['en', 1024, 'leader']]) {
      const tag = `[${lang} ${width} ${role}]`;
      const p = await signIn(role, { width, lang });
      await p.goto(`${app.url}/events/${E}`);
      await p.waitForSelector('#items .item-main');
      await p.locator('#items .item-main').first().click();
      await p.waitForSelector('#detail .detail-sections.is-tappable .song-section');
      const preview = await p.evaluate(() => ({ hint: Boolean(document.querySelector('#detail .now-song-hint')), sections: document.querySelectorAll('#detail .detail-sections .song-section').length, cursor: getComputedStyle(document.querySelector('#detail .detail-sections .song-section')).cursor }));
      check(preview.hint && preview.sections === 2 && preview.cursor === 'pointer', `${tag} the song row: the whole song with the "atinge o strofă" hint, the sections tappable`, preview);
      await p.click('#detail .detail-sections .song-section >> nth=1');
      await p.waitForSelector('dialog.big-lyrics[open]');
      await p.waitForFunction(() => /(Refren|Chorus)/.test(document.querySelector('dialog.big-lyrics .big-label').textContent));
      let b = await big(p);
      check(/Sfânt/.test(b.text) && !b.whole && b.pressed === 'false', `${tag} the chorus tapped: the big view at the chorus`, b);
      // "Toată cântarea" (a tap on the text; the tool only on wide screens): the sections, the chorus marked; a tap on the verse goes there
      check((await p.locator('dialog.big-lyrics .big-whole').isVisible()) === (width >= 600), `${tag} the "Toată cântarea" tool ${width >= 600 ? 'in the top bar' : 'not on a phone (a tap on the text does it)'}`);
      await p.click('dialog.big-lyrics .big-text');
      await p.waitForSelector('dialog.big-lyrics.whole .big-whole-section');
      b = await big(p);
      check(b.whole && b.pressed === 'true' && b.sections.length === 2 && /(Refren|Chorus)\*$/.test(b.sections[1]) && !/\*/.test(b.sections[0]), `${tag} "Toată cântarea": both sections, the chorus marked`, b);
      const a = await layoutAudit(p, 'dialog.big-lyrics');
      check(!a.overflow && !a.small.length, `${tag} the whole-song view: no overflow, targets >= 44 px`, a);
      await p.click('dialog.big-lyrics .big-whole-section >> nth=0');
      await p.waitForFunction(() => !document.querySelector('dialog.big-lyrics').classList.contains('whole') && /(Strofa 1|Verse 1)/.test(document.querySelector('dialog.big-lyrics .big-label').textContent));
      check(true, `${tag} a section tapped there: back to the large view, at the verse`);
      // a tap on the text again shows the whole song; a tap beside the sections goes back; → on past the song opens the next song's row
      await p.click('dialog.big-lyrics .big-text');
      await p.waitForSelector('dialog.big-lyrics.whole');
      await p.click('dialog.big-lyrics .big-body', { position: { x: 10, y: 10 } });
      await p.waitForFunction(() => !document.querySelector('dialog.big-lyrics').classList.contains('whole'));
      await p.click('dialog.big-lyrics .big-nav > button:last-child');
      await p.click('dialog.big-lyrics .big-nav > button:last-child');
      await p.waitForFunction(() => /Șase rânduri/.test(document.querySelector('dialog.big-lyrics .big-label').textContent), null, { timeout: 5000 });
      check(await p.evaluate((id) => document.querySelector('#items .item-main[aria-expanded="true"] .item-title').textContent === 'Șase rânduri', items[2]), `${tag} "Înainte →" past the song: the next song, its row selected on the page`);
      await p.click('dialog.big-lyrics .big-nav .big-exit');
      await p.waitForSelector('dialog.big-lyrics[open]', { state: 'detached' }).catch(() => null);
      await wait(200);
      check(!(await p.locator('dialog.big-lyrics[open]').count()) && await p.evaluate(() => Boolean(document.querySelector('#detail .detail-sections'))), `${tag} "Ieși": back on the page, the song still shown`);
      await p.context().close();
    }

    // the editor: the preview is not a tap target
    const o = await signIn('owner', { width: 1024, lang: 'ro' });
    await o.goto(`${app.url}/events/${E}/edit`);
    await o.waitForSelector('#items .item-main');
    await o.locator('#items .item-main').first().click();
    await o.waitForSelector('#detail .detail-sections .song-section');
    check(!(await o.locator('#detail .detail-sections.is-tappable').count()) && !(await o.locator('#detail .now-song-hint').count()), 'the editor: the preview as before (no tap targets, no hint)');
    // the leader's live big view: the whole-song tool, a tap moves live
    await app.api(app.cookies.owner, 'POST', `/api/events/${E}/start`, {});
    await o.goto(`${app.url}/events/${E}/live?view=full`);
    await o.waitForSelector('#big-open:not([hidden])');
    await o.click('#big-open');
    await o.waitForSelector('dialog.big-lyrics[open]');
    await o.click('dialog.big-lyrics .big-whole'); // 1024: the tool
    await o.waitForSelector('dialog.big-lyrics.whole .big-whole-section');
    await o.click('dialog.big-lyrics .big-whole-section >> nth=1');
    await o.waitForFunction(() => !document.querySelector('dialog.big-lyrics').classList.contains('whole') && /Refren/.test(document.querySelector('dialog.big-lyrics .big-label').textContent), null, { timeout: 5000 });
    const live = await app.state();
    check(live.worship.step === 1, 'live: a tap on the chorus in "Toată cântarea" moves the live position there', live.worship);
    await app.api(app.cookies.owner, 'POST', `/api/events/${E}/withdraw`, {});
    await o.context().close();
  },
};
