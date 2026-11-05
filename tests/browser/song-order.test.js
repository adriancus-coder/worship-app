'use strict';

// "Cum se cântă" on the song page (public/song.js renderOrder): the song's own section
// order, kept in the library (songs.presentation) as the default arrangement of every
// event. The owner sees "Cum se cântă: în ordinea secțiunilor · Schimbă", opens the arrange
// sheet without the key row, appends the chorus, applies: the row shows the order and a new
// event item of the song gets it as its default; "Resetează la implicit" goes back. A member
// sees "Vezi" and a read-only sheet. The API refuses a code that is not a section. The
// leader (the library right) has the whole tool too. RO 375 / EN 1024.

const { layoutAudit } = require('./harness');

module.exports = {
  name: 'song-order',
  timeout: 180000,
  async run({ app, signIn, check }) {
    const owner = app.cookies.owner;
    const { songs } = app.seed;
    const song = async () => (await app.api(owner, 'GET', `/api/songs/${songs.G}`)).body.song;
    // the row's parts sit in their own spans (the gap is CSS): joined with " " for the check
    const text = (p) => p.$eval('#song-order', (x) => [...x.children].map((c) => c.textContent.trim()).filter(Boolean).join(' '));

    for (const [lang, width] of [['ro', 375], ['en', 1024]]) {
      const tag = `[${lang} ${width}]`;
      const p = await signIn('owner', { width, lang });
      await p.goto(`${app.url}/songs/${songs.G}`);
      await p.waitForSelector('#song-order-open');
      check(/^(Cum se cântă|How it is sung): (în ordinea secțiunilor|in the sections’ order) · (Schimbă|Change)$/.test(await text(p)), `${tag} the row: "Cum se cântă: în ordinea secțiunilor · Schimbă"`, await text(p));
      await p.click('#song-order-open');
      await p.waitForSelector('dialog.arrange-sheet[open]');
      const sheet = await p.evaluate(() => ({ key: Boolean(document.querySelector('#arrange-key-up, #arrange-original-key')), kicker: document.querySelector('dialog.arrange-sheet .preview-kicker').textContent, apply: Boolean(document.getElementById('arrange-apply')) }));
      check(!sheet.key && sheet.apply && /(salvat în bibliotecă|kept in the library)/.test(sheet.kicker), `${tag} the sheet: no key row, its own kicker, Aplică`, sheet);
      // the chorus appended: on the phone from the order tab's "Adaugă la sfârșit: + C", on
      // the desktop from the song's "+ Adaugă"
      if (width < 900) {
        await p.click('.arrange-append-button[data-code="C"]');
        const waiting = await p.evaluate(() => ({ pressed: document.querySelector('.arrange-append-button[data-code="C"]').getAttribute('aria-pressed'), targets: document.querySelectorAll('.arrange-row-target').length, text: document.querySelector('.arrange-pending-text').textContent, first: Boolean(document.getElementById('arrange-place-first')), tools: [...document.querySelectorAll('.arrange-row-tools button')].every((b) => b.disabled) }));
        check(waiting.pressed === 'true' && waiting.targets === 2 && /după care pui C/.test(waiting.text) && waiting.first && waiting.tools, `${tag} "+ C": C waits; the rows are the targets, "La început" offered, ↑ ↓ ✕ paused`, waiting);
        await p.click('.arrange-row-target[data-after="1"]'); // after the chorus: V1 C C
        check(await p.$$eval('.arrange-row .step-code', (l) => l.map((x) => x.textContent).join(' ')) === 'V1 C C' && !(await p.locator('.arrange-pending').count()), `${tag} a row tapped: C placed after it, the wait over`);
        // "La început", then taken out again with ✕; "Renunță" leaves the order alone
        await p.click('.arrange-append-button[data-code="C"]');
        await p.click('#arrange-place-first');
        check(await p.$$eval('.arrange-row .step-code', (l) => l.map((x) => x.textContent).join(' ')) === 'C V1 C C', `${tag} "La început": C first`);
        await p.click('.arrange-row:nth-child(1) .arrange-row-tools button:nth-child(3)');
        await p.click('.arrange-append-button[data-code="V1"]');
        await p.click('#arrange-place-cancel');
        check(await p.$$eval('.arrange-row .step-code', (l) => l.map((x) => x.textContent).join(' ')) === 'V1 C C' && !(await p.locator('.arrange-pending').count()), `${tag} "Renunță": nothing added`);
      } else await p.click('.arrange-add >> nth=1');
      check(await p.$$eval('.arrange-append-button', (l) => l.map((b) => b.dataset.code).join()) === 'V1,C', `${tag} "Adaugă:": a + button per section on the order panel`);
      const a = await layoutAudit(p, 'dialog.arrange-sheet');
      check(!a.overflow && !a.small.length, `${tag} the sheet: no overflow, targets >= 44 px`, a);
      await p.click('#arrange-apply');
      await p.waitForFunction(() => /(Strofa 1|Verse 1) · (Refren|Chorus) · (Refren|Chorus)/.test(document.getElementById('song-order-codes').textContent));
      const saved = await song();
      check(saved.presentation === 'V1 C C', `${tag} applied: presentation "V1 C C" saved on the song`, saved.presentation);
      // a new event item of the song: the song's order is its default arrangement
      const ev = (await app.api(owner, 'POST', '/api/events', { name: `Ordinea ${lang}`, eventDate: '2031-01-05', startTime: '10:00' })).body.event;
      await app.api(owner, 'PUT', `/api/events/${ev.id}/items`, { items: [{ type: 'song', songId: songs.G }] });
      const item = (await app.api(owner, 'GET', `/api/events/${ev.id}`)).body.items[0];
      check(item.arrangementIsDefault && item.arrangementResolved.map((x) => x.code).join(' ') === 'V1 C C', `${tag} a new event item follows the song's order by default`, item.arrangementResolved.map((x) => x.code));
      // back to the sections' order
      await p.click('#song-order-open');
      await p.waitForSelector('dialog.arrange-sheet[open]');
      if (width < 900) await p.click('#arrange-tab-order');
      await p.click('#arrange-reset');
      await p.click('#arrange-apply');
      await p.waitForFunction(() => /(în ordinea secțiunilor|in the sections’ order)/.test(document.getElementById('song-order-codes').textContent));
      check((await song()).presentation == null, `${tag} "Resetează la implicit": presentation cleared`);
      await p.context().close();
    }

    // the leader: the same tool, saved through the API
    const l = await signIn('leader', { width: 375, lang: 'ro' });
    await l.goto(`${app.url}/songs/${songs.G}`);
    await l.waitForSelector('#song-order-open');
    check(/Schimbă/.test(await text(l)), 'leader: "Schimbă" on the row');
    await l.click('#song-order-open');
    await l.waitForSelector('dialog.arrange-sheet[open] #arrange-apply');
    await l.click('#arrange-tab-song');
    await l.click('.arrange-add >> nth=1');
    await l.click('#arrange-apply');
    await l.waitForFunction(() => /Refren · Refren/.test(document.getElementById('song-order-codes').textContent));
    check((await song()).presentation === 'V1 C C' && (await app.api(app.cookies.leader, 'PUT', `/api/songs/${songs.G}/presentation`, { codes: [] })).status === 200, 'leader: the order saved, the API open to the leader');
    await l.context().close();

    // a member: "Vezi", the sheet read-only
    await app.api(owner, 'PUT', `/api/songs/${songs.G}/presentation`, { codes: ['C', 'V1'] });
    const m = await signIn('member', { width: 375, lang: 'ro' });
    await m.goto(`${app.url}/songs/${songs.G}`);
    await m.waitForSelector('#song-order-open');
    check(/^Cum se cântă: Refren · Strofa 1 · Vezi$/.test(await text(m)), 'member: "Cum se cântă: Refren · Strofa 1 · Vezi"', await text(m));
    await m.click('#song-order-open');
    await m.waitForSelector('dialog.arrange-sheet[open]');
    check(await m.locator('dialog.arrange-sheet #arrange-apply, dialog.arrange-sheet .arrange-add').count() === 0, 'member: the sheet is read-only (no Aplică, no + Adaugă)');
    await m.context().close();
    const bad = await app.api(owner, 'PUT', `/api/songs/${songs.G}/presentation`, { codes: ['V1', 'B9'] });
    check(bad.status === 400, 'a code that is not a section: 400', bad.status);
    const asMember = await app.api(app.cookies.member, 'PUT', `/api/songs/${songs.G}/presentation`, { codes: ['V1'] });
    check(asMember.status === 403, 'a member may not set it: 403', asMember.status);
    await app.api(owner, 'PUT', `/api/songs/${songs.G}/presentation`, { codes: [] });
  },
};
