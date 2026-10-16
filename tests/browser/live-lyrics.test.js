'use strict';

// "✎ Versuri" during the service: the leader (RO 375) opens the song on screen in the sheet,
// changes the first verse and saves "doar pentru acest eveniment": the page shows the new
// text and the "Versuri modificate pentru acest eveniment" pill, the projector frame changes,
// the library does not; then "Salvează în bibliotecă" changes the library song and the pill
// goes; the operator console (EN 1024) has the same button and "Revino la textul din
// bibliotecă" after an event-only save; unsaved changes are asked about on close.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'live-lyrics',
  timeout: 240000,
  async run({ app, signIn, check }) {
    const { eventId: E, items, songs } = app.seed;
    check((await app.command({ type: 'event.start' })).ok, 'the event is live');
    await app.takeProjector('owner');
    await app.command({ type: 'worship.goto', itemId: items[0], step: 0 });
    const librarySection = async () => (await app.api(app.cookies.owner, 'GET', `/api/songs/${songs.G}`)).body.song.sections[0].content;
    const itemSection = async () => (await app.api(app.cookies.member, 'GET', `/api/events/${E}/items/${items[0]}/song`)).body.song.sections[0].content;

    const l = await signIn('leader', { width: 375, lang: 'ro' });
    await l.goto(`${app.url}/events/${E}/live?view=full`);
    await l.waitForSelector('#live:not([hidden])');
    await l.waitForSelector('#edit-lyrics');
    await l.click('#edit-lyrics');
    await l.waitForSelector('dialog.lyrics-sheet[open]');
    await l.waitForFunction(() => document.getElementById('ly-section-0-content') && document.getElementById('ly-section-0-content').value.includes('noaptea'));
    const shape = await l.evaluate(() => ({ heading: document.getElementById('lyrics-heading').textContent, details: document.querySelector('.lyrics-sheet .editor-details').getClientRects().length === 0, sections: document.querySelectorAll('.lyrics-sheet .section-editor').length, restore: document.getElementById('lyrics-restore').hidden, library: !document.getElementById('lyrics-save-library').hidden }));
    check(shape.heading === 'Sfânt în G' && shape.details && shape.sections === 2 && shape.restore && shape.library, 'the sheet: the song on screen, its two sections, no title / key fields, both saves', shape);
    const a = await layoutAudit(l, 'dialog.lyrics-sheet');
    check(!a.overflow && !a.small.length, 'the sheet 375: no overflow, targets >= 44 px', a);
    await l.fill('#ly-section-0-content', '[G]Ne ridici din [D]noaptea grea\n[Em]Tu ești [C]lumina mea\n[G]Rând nou doar azi');
    await l.click('#lyrics-save-event');
    await l.waitForSelector('dialog.lyrics-sheet', { state: 'hidden' });
    await l.waitForSelector('.pill-edited');
    await l.waitForFunction(() => /Rând nou doar azi/.test(document.getElementById('current').textContent));
    check(/Rând nou doar azi/.test(await itemSection()) && !/Rând nou/.test(await librarySection()), 'saved for this event only: the item has the new text, the library not');
    const frame = (await app.state()).version; // the version moved
    const shown = await l.evaluate(() => document.querySelector('#projector-preview') && document.querySelector('#projector-preview').textContent);
    check(/Rând nou doar azi/.test(shown || ''), 'the projector preview shows the new line', shown);
    check(frame > 0, 'a new live version');
    // the library: "Salvează în bibliotecă" from the (edited) text; the pill goes
    await l.click('#edit-lyrics');
    await l.waitForSelector('dialog.lyrics-sheet[open]');
    await l.waitForFunction(() => !document.getElementById('lyrics-restore').hidden);
    await l.fill('#ly-section-0-content', '[G]Ne ridici din [D]noaptea grea\n[Em]Tu ești [C]lumina mea\n[G]Rând nou pentru totdeauna');
    await l.click('#lyrics-save-library');
    await l.waitForSelector('dialog.lyrics-sheet', { state: 'hidden' });
    await l.waitForFunction(() => !document.querySelector('.pill-edited') && /pentru totdeauna/.test(document.getElementById('current').textContent));
    check(/Rând nou pentru totdeauna/.test(await librarySection()) && /pentru totdeauna/.test(await itemSection()), 'saved to the library: the song changed for good, the item follows it');
    // unsaved changes are asked about
    await l.click('#edit-lyrics');
    await l.waitForSelector('dialog.lyrics-sheet[open]');
    await l.fill('#ly-section-1-content', 'alt refren');
    await l.click('#lyrics-cancel');
    check(!(await l.isHidden('#lyrics-discard')), 'closing with changes asks first');
    await l.click('#lyrics-discard');
    await l.waitForSelector('dialog.lyrics-sheet', { state: 'hidden' });
    check(/pentru totdeauna/.test(await itemSection()), 'dropped: nothing saved');
    await l.context().close();

    // the console (EN 1024): the button, an event-only save, "Back to the library text"
    const op = await signIn('operator', { width: 1024, lang: 'en' });
    await op.goto(`${app.url}/events/${E}/operator`);
    await op.waitForSelector('#console:not([hidden])');
    await op.waitForSelector('#op-edit-lyrics:not([hidden])');
    await op.click('#op-edit-lyrics');
    await op.waitForSelector('dialog.lyrics-sheet[open]');
    await op.waitForFunction(() => document.getElementById('ly-section-0-content').value.includes('totdeauna'));
    await op.fill('#ly-section-0-content', 'Only tonight');
    await op.click('#lyrics-save-event');
    await op.waitForSelector('dialog.lyrics-sheet', { state: 'hidden' });
    await op.waitForSelector('#op-lyrics-edited:not([hidden])');
    check(/Only tonight/.test(await itemSection()) && /pentru totdeauna/.test(await librarySection()), 'console: saved for this event only');
    await op.click('#op-edit-lyrics');
    await op.waitForSelector('dialog.lyrics-sheet[open]');
    await op.waitForFunction(() => !document.getElementById('lyrics-restore').hidden);
    await op.click('#lyrics-restore');
    await op.waitForSelector('dialog.lyrics-sheet', { state: 'hidden' });
    await op.waitForSelector('#op-lyrics-edited', { state: 'hidden' });
    await wait(200);
    check(/pentru totdeauna/.test(await itemSection()), '"Back to the library text": the library text again');
    await op.context().close();
  },
};
