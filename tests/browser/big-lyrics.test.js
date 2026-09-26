'use strict';

// "⤢ Versuri mari" on the leader page and the console: opened from the current step, the
// button or key F; the current section large with chords above; next / prev / "■ Sfârșit"
// are the live commands (projector and phones follow); swipe left / right; A+ persists;
// ✕ returns to the page at the same position; another device's move updates the view;
// "Doar text" honoured; RO/EN; 375 / 1024 / 1180 / 1440; no overflow.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'big-lyrics',
  timeout: 300000,
  async run({ app, browser, signIn, check }) {
    const { eventId: E, items } = app.seed;
    const [G, VERSE] = items;
    check((await app.command({ type: 'event.start' })).ok, 'the event is live');
    const sp = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    await sp.goto(`${app.url}/screen`);
    await sp.waitForFunction(() => /\d{3} \d{3}/.test(document.getElementById('pairing-code').textContent));
    await app.api(app.cookies.owner, 'POST', '/api/screens/claim', { code: (await sp.textContent('#pairing-code')).replace(' ', ''), name: 'Proiector' });
    await sp.waitForSelector('#output:not([hidden])', { timeout: 6000 });
    const screen = async () => { await wait(300); return sp.evaluate(() => document.querySelector('#output .projector-stage').innerText.trim().replace(/\s+/g, ' ') || 'BLACK'); };
    const m = await signIn('member', { width: 375 });
    await m.goto(`${app.url}/events/${E}/follow`);
    await m.waitForSelector('#follow:not([hidden])');
    const phone = () => m.evaluate(() => document.getElementById('slide').innerText.replace(/\s+/g, ' ').slice(0, 60));
    const big = (p) => p.evaluate(() => {
      const d = document.querySelector('dialog.big-lyrics');
      if (!d || !d.open) return null;
      return { label: d.querySelector('.big-label').textContent, text: d.querySelector('.big-text').innerText.replace(/\s+/g, ' ').trim(), next: d.querySelector('.big-next').textContent, font: parseFloat(getComputedStyle(d.querySelector('.big-text')).fontSize), chords: d.querySelectorAll('.big-text .chord-line').length, status: d.querySelector('.big-status').textContent };
    });
    const at = async () => { const s = await app.state(); return `${s.worship.itemId === G ? 'G' : 'other'}.${s.worship.step}${s.worship.ended ? ' ended' : ''}`; };

    for (const [lang, width, role, sub, stepSel] of [
      ['ro', 375, 'leader', 'live', '.step'], ['en', 1024, 'operator', 'operator', '.op-step'],
      ['ro', 1180, 'operator', 'operator', '.op-step'], ['en', 1440, 'leader', 'live', '.step'],
    ]) {
      const tag = `[${lang} ${width} ${role}]`;
      await app.command({ type: 'live.mode', mode: 'together' });
      await app.command({ type: 'projector.source', source: 'content' });
      await app.command({ type: 'worship.goto', itemId: G, step: 0 });
      await wait(300);
      const p = await signIn(role, { width, lang });
      await p.evaluate(() => { try { localStorage.removeItem('wa_big_scale'); localStorage.setItem('wa_text_only', '0'); } catch (e) {} });
      await p.goto(`${app.url}/events/${E}/${sub}`);
      await p.waitForSelector(sub === 'live' ? '#live:not([hidden])' : '#console:not([hidden])');
      await p.waitForSelector(`${stepSel}[aria-current=step]`);
      // open from the current step
      await p.click(`${stepSel}[aria-current=step]`);
      await p.waitForSelector('dialog.big-lyrics[open]');
      // the section arrives with the song (one fetch): wait for its text
      await p.waitForFunction(() => document.querySelector('dialog.big-lyrics .big-text').innerText.trim().length > 0, null, { timeout: 4000 }).catch(() => {});
      let b = await big(p);
      check(b && /Sfânt în G/.test(b.label) && /Ne ridici/.test(b.text) && b.chords > 0 && b.font > 18, `${tag} the current step opens the big lyrics: label "${b.label}", ${Math.round(b.font)} px, chords above`, b);
      check(/Refren|Chorus/.test(b.next) && /Sfânt, sfânt/.test(b.next), `${tag} the next section's first line at the bottom`, b.next);
      const a = await layoutAudit(p, 'dialog.big-lyrics');
      check(!a.overflow && !a.small.length, `${tag} no overflow, targets >= 44 px`, a);
      check(await p.evaluate(() => document.querySelector('dialog.big-lyrics .big-body').scrollWidth <= document.querySelector('dialog.big-lyrics .big-body').clientWidth), `${tag} the text fits the width`);
      // next moves the live position: projector and phone follow
      await p.click('dialog.big-lyrics .big-nav > button:last-child');
      await wait(400);
      check(await at() === 'G.1' && /Sfânt/.test(await screen()) && /Sfânt/.test(await phone()), `${tag} "Următoarea" -> G.1 on the projector and the phone`);
      b = await big(p);
      check(/Refren|Chorus/i.test(b.label), `${tag} the view moved to the chorus`, b.label);
      // key ← back, then Space forward
      await p.keyboard.press('ArrowLeft');
      await wait(300);
      check(await at() === 'G.0', `${tag} ← -> G.0`);
      await p.keyboard.press(' ');
      await wait(300);
      check(await at() === 'G.1', `${tag} Space -> G.1`);
      // A+ persists across a reopen
      const before = (await big(p)).font;
      await p.click('dialog.big-lyrics .big-tools button:nth-child(3)');
      await wait(200);
      const after = (await big(p)).font;
      check(after > before, `${tag} A+ enlarges (${Math.round(before)} -> ${Math.round(after)} px)`);
      await p.click('dialog.big-lyrics .big-close');
      await wait(200);
      check(!(await big(p)) && await at() === 'G.1' && await p.evaluate(() => Boolean(document.querySelector('#live:not([hidden]), #console:not([hidden])'))), `${tag} ✕ returns to the page at the same position`);
      await p.keyboard.press('f');
      await p.waitForSelector('dialog.big-lyrics[open]');
      check(Math.abs((await big(p)).font - after) < 1, `${tag} F reopens with the saved size`);
      // "Doar text"
      await p.click('dialog.big-lyrics .big-tools button:nth-child(1)');
      await wait(300);
      check((await big(p)).chords === 0, `${tag} "Doar text" hides the chords`);
      await p.click('dialog.big-lyrics .big-tools button:nth-child(1)');
      // another device moves: the view follows
      await app.command({ type: 'worship.goto', itemId: VERSE, step: 0 });
      const followed = await p.waitForFunction(() => /Luca 2:1-7/.test(document.querySelector('dialog.big-lyrics .big-label').textContent), null, { timeout: 3000 }).then(() => true, () => false);
      check(followed && /Cezar/.test((await big(p)).text), `${tag} another device's move updates the view (the verse)`);
      // swipe (touch widths): right = prev, left = next
      if (width < 600) {
        const box = await p.locator('dialog.big-lyrics .big-body').boundingBox();
        const y = box.y + box.height / 2;
        const cdp = await p.context().newCDPSession(p);
        const swipe = async (fromX, toX) => {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y, id: 1 }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: toX, y, id: 1 }] });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await wait(400);
        };
        await swipe(box.x + 60, box.x + box.width - 60);
        check(await at() === 'G.1', `${tag} swipe right -> prev (G.1)`);
        await swipe(box.x + box.width - 60, box.x + 60);
        check((await app.state()).worship.itemId === VERSE, `${tag} swipe left -> next (the verse)`);
      }
      // "■ Sfârșit" from the view: the projector goes black, the position stays
      await app.command({ type: 'worship.goto', itemId: G, step: 1 });
      await wait(300);
      await p.keyboard.press('e');
      await wait(400);
      check(await at() === 'G.1 ended' && await screen() === 'BLACK', `${tag} E in the view: black, the position stays`);
      b = await big(p);
      check(/Sfârșitul cântării|End of the song/.test(b.text) && /Luca 2:1-7/.test(b.next), `${tag} the view says the song ended, next is the verse`);
      check(/Conectat|Connected/.test(b.status) && /Împreună|Together/.test(b.status), `${tag} the status line: connection · mode`, b.status);
      await p.keyboard.press('Escape');
      await wait(200);
      check(!(await big(p)), `${tag} Escape closes`);
      // split mode on the console: the status line says where the team is
      if (sub === 'operator') {
        await app.command({ type: 'live.mode', mode: 'split' });
        await app.command({ type: 'projector.goto', itemId: VERSE, step: 0 });
        await wait(400);
        await p.keyboard.press('f');
        await p.waitForSelector('dialog.big-lyrics[open]');
        b = await big(p);
        check(/Luca 2:1-7/.test(b.label) && /Separat|Separate/.test(b.status) && /Echipa e la|The team is at/.test(b.status), `${tag} split: the projector's item, "Echipa e la …"`, b);
        await p.keyboard.press('Escape');
      }
      await p.context().close();
    }
  },
};
