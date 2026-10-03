'use strict';

// "⤢ Versuri mari" for members: on the follow page the same full-screen view (chords above,
// label, next line, A− / A+, ✕ / Escape / F, wake lock), no live commands; in follow mode it
// follows every move with no control buttons; free mode -> "← Înapoi" / "Înainte →" move only
// this phone; detached -> "Revino la live"; ✕ returns at the same position; the rehearsal
// page has the same view with its own navigation. RO 375 / EN 1024 / RO 1180.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'member-big',
  timeout: 300000,
  async run({ app, signIn, check }) {
    const { eventId: E, items } = app.seed;
    const G = items[0];
    check((await app.command({ type: 'event.start' })).ok, 'the event is live');
    const big = (p) => p.evaluate(() => {
      const d = document.querySelector('dialog.big-lyrics');
      if (!d || !d.open) return null;
      return {
        label: d.querySelector('.big-label').textContent, text: d.querySelector('.big-text').innerText.replace(/\s+/g, ' ').trim(),
        next: d.querySelector('.big-next').textContent, font: parseFloat(getComputedStyle(d.querySelector('.big-text')).fontSize),
        chords: d.querySelectorAll('.big-text .chord-line').length, nav: !d.querySelector('.big-nav').classList.contains('big-nav-exit-only'),
        buttons: [...d.querySelectorAll('.big-nav > button:not(.big-exit)')].filter((b) => !b.hidden && b.getClientRects().length).map((b) => b.textContent.trim()),
        end: d.querySelectorAll('.end-item').length, status: (d.querySelector('.big-status') || {}).textContent || '',
      };
    });
    const at = async () => { const s = await app.state(); return `${s.worship.itemId === G ? 'G' : 'other'}.${s.worship.step}`; };
    const pageLabel = (p) => p.evaluate(() => (document.querySelector('#slide .section-label') || {}).textContent || document.getElementById('slide').innerText.slice(0, 40));

    for (const [lang, width] of [['ro', 375], ['en', 1024], ['ro', 1180]]) {
      const tag = `[${lang} ${width}]`;
      await app.command({ type: 'team.mode', mode: 'follow' });
      await app.command({ type: 'worship.goto', itemId: G, step: 0 });
      const p = await signIn('member', { width, lang });
      await p.evaluate(() => { try { localStorage.removeItem('wa_big_scale'); localStorage.setItem('wa_text_only', '0'); } catch (e) {} });
      await p.goto(`${app.url}/events/${E}/follow`);
      await p.waitForSelector('#big-open:not([hidden])');
      // follow mode: opens, follows, no control buttons
      await p.click('#big-open');
      await p.waitForSelector('dialog.big-lyrics[open]');
      await p.waitForFunction(() => document.querySelector('dialog.big-lyrics .big-text').innerText.trim().length > 0, null, { timeout: 4000 }).catch(() => {});
      let b = await big(p);
      check(b && /Sfânt în G/.test(b.label) && /Ne ridici/.test(b.text) && b.chords > 0 && b.font > 18 && /Refren|Chorus/.test(b.next) && /Sfânt, sfânt/.test(b.next), `${tag} "Versuri mari" opens: label, chords above, the next line`, b);
      check(!b.nav && b.end === 0 && /(Urmărești live|Following live)/.test(b.status), `${tag} follow mode: no control buttons, no "■ Sfârșit", status "Urmărești live"`, b);
      await app.command({ type: 'worship.next' });
      await p.waitForFunction(() => /Refren|Chorus/i.test(document.querySelector('dialog.big-lyrics .big-label').textContent), null, { timeout: 4000 });
      check(true, `${tag} live moves on -> the view follows (Refren)`);
      const a = await layoutAudit(p, 'dialog.big-lyrics');
      check(!a.overflow && !a.small.length, `${tag} no overflow, targets >= 44 px`, a);
      // ArrowRight / E do nothing to live in follow mode; → detaches this phone only
      await p.keyboard.press('e');
      await wait(300);
      check(await at() === 'G.1' && !(await app.state()).worship.ended, `${tag} E does nothing (no live commands)`);
      await p.keyboard.press('ArrowLeft');
      await wait(300);
      b = await big(p);
      check(await at() === 'G.1' && b.nav && b.buttons.some((x) => /Revino la live|Back to live/.test(x)) && /Ne ridici/.test(b.text), `${tag} ← moves only this phone: detached, "Revino la live" shown, live still at G.1`, b);
      await p.click('dialog.big-lyrics .big-back-live');
      await wait(300);
      b = await big(p);
      check(!b.nav && /Refren|Chorus/i.test(b.label), `${tag} "Revino la live": back at live, the bar is gone`, b);
      // A+ persists
      const before = b.font;
      await p.click('dialog.big-lyrics .big-tools button:nth-child(3)');
      await wait(200);
      check((await big(p)).font > before, `${tag} A+ enlarges`);
      // ✕ returns at the same position
      await p.click('dialog.big-lyrics .big-close');
      await wait(200);
      check(!(await big(p)) && /Refren|Chorus/i.test(await pageLabel(p)), `${tag} ✕ closes at the same position (Refren)`);
      // free mode: Înapoi / Înainte move only this phone
      await app.command({ type: 'team.mode', mode: 'free' });
      await wait(400);
      await p.keyboard.press('f');
      await p.waitForSelector('dialog.big-lyrics[open]');
      b = await big(p);
      check(b.nav && b.buttons.length === 2 && /(Navigare liberă|Free navigation)/.test(b.status), `${tag} free mode (key F): "← Înapoi" / "Înainte →", no Revino`, b);
      await p.click('dialog.big-lyrics .big-nav > button:last-child');
      await wait(300);
      b = await big(p);
      check(await at() === 'G.1' && !/Refren|Chorus/i.test(b.label) && b.label.length > 0, `${tag} "Înainte →" moves only the member (live still G.1): ${b.label}`, b);
      await p.keyboard.press('Escape');
      await wait(200);
      check(!(await big(p)) && !/Refren|Chorus/i.test(await pageLabel(p)), `${tag} Escape closes at the member's own position`);
      await p.context().close();
    }

    // the rehearsal page: the same view, own navigation through the steps and items
    await app.command({ type: 'event.end' });
    const r = await signIn('member', { width: 1024 });
    await r.goto(`${app.url}/events/${E}/rehearse`);
    await r.waitForSelector('#big-open:not([hidden])');
    await r.click('#slide .song-section');
    await r.waitForSelector('dialog.big-lyrics[open]');
    await r.waitForFunction(() => document.querySelector('dialog.big-lyrics .big-text').innerText.trim().length > 0, null, { timeout: 4000 }).catch(() => {});
    let b = await big(r);
    check(b && /Sfânt în G/.test(b.label) && /Ne ridici/.test(b.text) && b.nav && b.buttons.length === 2 && b.end === 0 && !b.status, 'rehearsal: tapping the section opens the view, own navigation, no status line', b);
    await r.click('dialog.big-lyrics .big-nav > button:last-child');
    await wait(200);
    b = await big(r);
    check(/Refren/.test(b.label), 'rehearsal: "Înainte →" -> the chorus', b.label);
    await r.click('dialog.big-lyrics .big-nav > button:last-child');
    await wait(400);
    b = await big(r);
    check(/Luca/.test(b.label) && /2 \/ 5|2 din 5|Elementul 2/.test(await r.textContent('#position')), 'rehearsal: past the song -> the next item; the page follows', { label: b.label, position: await r.textContent('#position') });
    await r.keyboard.press('Escape');
    await wait(200);
    check(!(await big(r)) && /Luca/.test(await r.textContent('#slide')), 'rehearsal: Escape returns at the same item');
    const ra = await layoutAudit(r, 'main');
    check(!ra.overflow && !ra.small.length, 'rehearsal page: no overflow, targets >= 44 px', ra);
  },
};
