'use strict';

// "+ Cântare nouă" on the console: the song editor in a non-modal sheet (next / prev keep
// working); chords-over-lyrics pasted, "Salvează · În setlist" -> the members see the song
// with chords; "Salvează · Doar pe proiector" -> they never see it; a duplicate title ->
// the link and "Adaugă cântarea existentă"; a search with no result -> "Creează „…” ca
// cântare nouă" prefills the title; closing with unsaved text asks; the draft survives a
// reload; RO / EN; 375 / 1024 / 1440.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'live-new-song',
  timeout: 240000,
  async run({ app, signIn, check }) {
    const { eventId: E } = app.seed;
    check((await app.command({ type: 'event.start' })).ok, 'the event is live');
    const p = await signIn('operator', { width: 1440 });
    await p.goto(`${app.url}/events/${E}/operator`);
    await p.waitForSelector('#console:not([hidden])');
    const memberItems = async () => (await app.api(app.cookies.member, 'GET', `/api/events/${E}`)).body.items;
    const sheetOpen = () => p.evaluate(() => { const d = document.querySelector('dialog.new-song-sheet'); return Boolean(d && d.open); });

    await p.click('#op-new-song');
    await p.waitForSelector('dialog.new-song-sheet[open]');
    check(await sheetOpen() && await p.evaluate(() => document.activeElement.id === 'new-title'), 'the sheet opens with the title focused');
    // the live controls keep working while the sheet is open
    const step0 = (await app.state()).worship.step;
    await p.click('#op-next');
    await wait(300);
    check((await app.state()).worship.step === step0 + 1 && await sheetOpen(), '"Următoarea" works with the sheet open (non-modal)');
    await p.evaluate(() => document.activeElement.blur());
    await p.keyboard.press('ArrowLeft');
    await wait(300);
    check((await app.state()).worship.step === step0, '← works too (focus outside the sheet)');
    // write a song with chords over the lyrics
    await p.fill('#new-title', 'Cântare scrisă acum');
    await p.fill('#new-section-0-content', 'G        D\nDomnul e bun\nEm      C\nÎn veci ține');
    await p.click('#new-section-0-note'); // blur converts the pasted lines
    await wait(400);
    const converted = await p.inputValue('#new-section-0-content');
    const chords = await p.locator('#new-preview .chord-line').count();
    check(/\[G\]Domnul e \[D\]bun/.test(converted) && chords >= 1, `chords over lyrics -> inline chords, chords in the preview ("${converted.split('\n')[0]}")`);
    const a = await layoutAudit(p, 'dialog.new-song-sheet');
    check(!a.overflow && !a.small.length, '1440: the sheet has no overflow, targets >= 44 px', a);
    await p.click('#new-song-setlist');
    await p.waitForFunction(() => !document.querySelector('dialog.new-song-sheet').open, null, { timeout: 5000 });
    await wait(400);
    let items = await memberItems();
    const added = items.find((it) => it.title === 'Cântare scrisă acum');
    check(items.length === 6 && Boolean(added), '"Salvează · În setlist": the members see the new song right after the current item', items.map((i) => i.title));
    const song = (await app.api(app.cookies.member, 'GET', `/api/events/${E}/items/${added.id}/song`)).body.song;
    check(song && /\[G\]Domnul e \[D\]bun/.test(song.sections[0].content), 'the members get it with chords');
    check((await app.api(app.cookies.owner, 'GET', '/api/songs?q=scrisă')).body.songs.length === 1, 'it is a library song now');
    // projector only
    await p.click('#op-new-song');
    await p.waitForSelector('dialog.new-song-sheet[open]');
    check((await p.inputValue('#new-title')) === '', 'a fresh sheet after a save');
    await p.fill('#new-title', 'Doar pe ecran');
    await p.fill('#new-section-0-content', '[C]Numai proiectorul');
    await p.click('#new-song-projector');
    await p.waitForFunction(() => !document.querySelector('dialog.new-song-sheet').open, null, { timeout: 5000 });
    await wait(400);
    check(await p.locator('.op-item.projector-only:has-text("Doar pe ecran")').count() === 1 && (await memberItems()).length === 6, '"Doar pe proiector": in the console only, the members never see it');
    // a duplicate title
    await p.click('#op-new-song');
    await p.waitForSelector('dialog.new-song-sheet[open]');
    await p.fill('#new-title', 'Cântare scrisă acum');
    await p.fill('#new-section-0-content', 'alt text');
    await p.click('#new-song-setlist');
    await p.waitForSelector('#new-song-message a');
    const link = await p.getAttribute('#new-song-message a', 'href');
    check(new RegExp(`^/songs/${song.id}$`).test(link) && await p.locator('.new-song-existing').count() === 1 && await sheetOpen(), `duplicate: 409 shown inline with the link (${link}) and "Adaugă cântarea existentă"`);
    await p.click('.new-song-existing');
    await p.waitForFunction(() => !document.querySelector('dialog.new-song-sheet').open, null, { timeout: 5000 });
    await wait(400);
    items = await memberItems();
    check(items.filter((it) => it.title === 'Cântare scrisă acum').length === 2, '"Adaugă cântarea existentă" adds the existing song', items.map((i) => i.title));
    // no result -> prefilled
    await p.fill('#add-q', 'zzz nimic');
    await p.waitForSelector('#add-songs .result-create button');
    check(/zzz nimic/.test(await p.textContent('#add-songs .result-create button')), '"Creează „zzz nimic” ca cântare nouă" under an empty search');
    await p.click('#add-songs .result-create button');
    await p.waitForSelector('dialog.new-song-sheet[open]');
    check((await p.inputValue('#new-title')) === 'zzz nimic', 'the title is prefilled');
    // unsaved text: closing asks
    await p.fill('#new-section-0-content', 'ceva nesalvat');
    await p.click('#new-song-cancel');
    check(!(await p.isHidden('.new-song-confirm')) && await sheetOpen(), '"Anulează" with unsaved text asks first');
    await p.click('#new-song-keep');
    check(await p.isHidden('.new-song-confirm') && await sheetOpen(), '"Continuă scrierea" keeps the sheet');
    // the draft survives a reload
    await wait(600);
    await p.reload();
    await p.waitForSelector('#console:not([hidden])');
    await p.click('#op-new-song');
    await p.waitForSelector('dialog.new-song-sheet[open]');
    check((await p.inputValue('#new-title')) === 'zzz nimic' && (await p.inputValue('#new-section-0-content')) === 'ceva nesalvat', 'the draft is back after a reload');
    await p.keyboard.press('Escape');
    await wait(100);
    check(await sheetOpen(), 'Escape with unsaved text: the sheet stays (asks)');
    await p.click('#new-song-discard');
    check(!(await sheetOpen()), '"Da, renunță" closes');
    await p.click('#op-new-song');
    await p.waitForSelector('dialog.new-song-sheet[open]');
    check((await p.inputValue('#new-title')) === '', 'discarded: no draft left');
    await p.click('#new-song-cancel');
    check(!(await sheetOpen()), 'an empty sheet closes at once');
    for (const [w, h] of [[1024, 768], [375, 800]]) {
      await p.setViewportSize({ width: w, height: h });
      await p.click('#op-new-song');
      await p.waitForSelector('dialog.new-song-sheet[open]');
      await wait(300);
      const b = await layoutAudit(p, 'dialog.new-song-sheet');
      const fits = await p.evaluate(() => { const r = document.querySelector('dialog.new-song-sheet').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; });
      check(!b.overflow && !b.small.length && fits, `${w}: the sheet fits, no overflow, targets >= 44 px`, b);
      await p.click('#new-song-cancel');
    }
    await p.context().close();
    // English
    const en = await signIn('operator', { width: 1024, lang: 'en' });
    await en.goto(`${app.url}/events/${E}/operator`);
    await en.waitForSelector('#console:not([hidden])');
    await en.click('#op-new-song');
    await en.waitForSelector('dialog.new-song-sheet[open]');
    check(await en.textContent('#new-song-heading') === 'New song' && /Save · In the setlist/.test(await en.textContent('#new-song-setlist')), 'EN texts');
    await en.context().close();
  },
};
