'use strict';

// Song proposals: a member proposes two songs for a planned event with a note (event page,
// library only); the leader sees them in the editor with the name and note, adds one "la
// sfârșit" (item appears, pill Adăugată, notification), declines the other with a note (the
// member sees it); live: a member proposes from the follow page -> toast on the console ->
// "Doar pe proiector" -> the team never sees it, the pill says Adăugată; the 6th open proposal
// is refused; finished event -> no button. RO 375 / EN 1024 / 1440.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'proposals',
  timeout: 240000,
  async run({ app, signIn, check }) {
    const owner = app.cookies.owner;
    const E2 = app.seed.event2Id; // planned, one item
    const E = app.seed.eventId;
    const songs = app.seed.songs;
    const propose = (p, title, note) => (async () => {
      await p.click('#propose-song', { timeout: 10000 });
      await p.waitForSelector('dialog.proposal-dialog[open]');
      await p.fill('#prop-q', title);
      await p.waitForSelector(`dialog.proposal-dialog .song-list li:has-text("${title}") button`, { timeout: 5000 });
      await p.click(`dialog.proposal-dialog .song-list li:has-text("${title}") button`);
      await p.waitForSelector('.proposal-note-step:not([hidden])');
      if (note) await p.fill('#proposal-note', note);
      await p.click('#proposal-send', { timeout: 10000 });
      await p.waitForFunction((tt) => new RegExp(tt).test(document.querySelector('#proposals .proposal-message').textContent), title);
    })();

    // the member (RO 375) on the planned event's page
    const m = await signIn('member', { width: 375, lang: 'ro' });
    await m.goto(`${app.url}/events/${E2}`);
    await m.waitForSelector('#propose-song');
    check(await m.locator('#proposals .proposal-row').count() === 0, 'member: "Propune o cântare", no proposals yet');
    await m.click('#propose-song');
    await m.waitForSelector('dialog.proposal-dialog[open]');
    check(await m.isHidden('#prop-online-search') && await m.isHidden('#prop-online-section'), 'the picker is library only (no online search for members)');
    await m.keyboard.press('Escape');
    await propose(m, 'Sfânt în G', 'Ar merge după predică');
    await propose(m, 'Mare ești Tu', '');
    const mine = await m.evaluate(() => [...document.querySelectorAll('#proposals .proposal-row')].map((r) => `${r.querySelector('.proposal-title').textContent}|${r.querySelector('.proposal-pill').textContent}`));
    check(mine.length === 2 && mine.every((x) => /Trimisă$/.test(x)), 'member: "Propunerile mele" with two pills Trimisă', mine);
    const a = await layoutAudit(m, '#proposals');
    check(!a.overflow && !a.small.length, 'member 375: no overflow, targets >= 44 px', a);

    // the leader (EN 1440): the editor's "Propuneri (2)" with name and note
    const l = await signIn('leader', { width: 1440, lang: 'en' });
    await l.goto(`${app.url}/events/${E2}/edit`);
    await l.waitForSelector('#proposals .proposal-row');
    const rows = await l.evaluate(() => [...document.querySelectorAll('#proposals .proposal-row')].map((r) => r.textContent));
    check(rows.length === 2 && rows.some((r) => /Sfânt în G/.test(r) && /proposed by Membru/.test(r) && /Ar merge după predică/.test(r)) && (await l.textContent('#proposals-count')) === '2' && /Proposals: 2/.test(await l.textContent('#proposals-badge')), 'leader: two proposals with the proposer and the note; the count and the header badge', rows);
    const itemsBefore = await l.locator('#items li').count();
    await l.click('#proposals .proposal-row:has-text("Sfânt în G") button[data-action="setlist"]');
    await l.waitForFunction((n) => document.querySelectorAll('#items li').length === n + 1, itemsBefore);
    const last = await l.locator('#items li').last().textContent();
    check(/Sfânt în G/.test(last) && /Added to the setlist/.test(await l.locator('#proposals .proposal-row:has-text("Sfânt în G")').textContent()), 'leader: "Add at the end" -> the song is the last item, the row says where it landed');
    await l.click('#proposals .proposal-row:has-text("Mare ești Tu") button[data-action="decline"]');
    await l.fill('#proposals .proposal-decline-note', 'Next Sunday');
    await l.click('#proposals button[data-action="decline-confirm"]');
    await l.waitForFunction(() => /Declined/.test(document.querySelector('#proposals .proposal-row:nth-of-type(2), #proposals .proposal-row').textContent) || [...document.querySelectorAll('#proposals .proposal-pill')].some((p) => p.textContent === 'Declined'));
    check((await l.textContent('#proposals-count')) === '' && await l.isHidden('#proposals-badge'), 'leader: nothing open, the badge is gone');
    const al = await layoutAudit(l, '#proposals');
    check(!al.overflow && !al.small.length, 'leader 1440: targets >= 44 px', al);
    // the member sees the answers + notifications
    await m.reload();
    await m.waitForSelector('#proposals .proposal-row');
    const after = await m.evaluate(() => [...document.querySelectorAll('#proposals .proposal-row')].map((r) => r.textContent));
    check(after.some((r) => /Sfânt în G/.test(r) && /Adăugată/.test(r)) && after.some((r) => /Mare ești Tu/.test(r) && /Respinsă/.test(r) && /Răspuns: Next Sunday/.test(r)), 'member: pills Adăugată / Respinsă with the leader\'s note', after);
    const notifs = (await app.api(app.cookies.member, 'GET', '/api/notifications')).body.notifications.filter((n) => n.kind === 'proposal_decided');
    check(notifs.length === 2, 'member: two proposal_decided notifications');
    check((await app.api(app.cookies.leader, 'GET', '/api/notifications')).body.notifications.filter((n) => n.kind === 'proposal').length >= 2, 'leader: proposal notifications');

    // live: the follow page proposes, the console gets the toast, "Doar pe proiector"
    await app.command({ type: 'event.start' });
    const op = await signIn('operator', { width: 1024, lang: 'ro' });
    await op.goto(`${app.url}/events/${E}/operator`);
    await op.waitForSelector('#console:not([hidden])');
    await m.goto(`${app.url}/events/${E}/follow`);
    await m.waitForSelector('#follow:not([hidden])');
    await m.waitForSelector('#propose-song');
    await propose(m, 'Șase rânduri', 'Acum');
    await op.waitForSelector('#info-toast.proposal-toast:not([hidden])', { timeout: 6000 });
    check(/Membru propune: Șase rânduri/.test(await op.textContent('#info-toast')) && await op.locator('#info-toast button[data-proposal-action]').count() === 3, 'console: the toast "Membru propune: Șase rânduri" with three actions');
    const toastBox = await op.evaluate(() => { const r = document.getElementById('info-toast').getBoundingClientRect(); const grid = document.querySelector('#op-steps, .op-center'); const g = grid ? grid.getBoundingClientRect() : null; return { right: r.right <= innerWidth, top: r.top, overGrid: g ? !(r.bottom < g.top || r.left > g.right || r.right < g.left) && r.top > g.top + 80 : false }; });
    check(toastBox.right && !toastBox.overGrid, 'the toast sits top right, off the step grid', toastBox);
    const teamItems = (await app.api(app.cookies.member, 'GET', `/api/events/${E}`)).body.items.length;
    await op.click('#info-toast button[data-proposal-action="projector"]');
    await op.waitForSelector('#info-toast:not(.proposal-toast)', { timeout: 5000 }).catch(() => {});
    await wait(400);
    check((await app.api(app.cookies.member, 'GET', `/api/events/${E}`)).body.items.length === teamItems, '"Doar pe proiector": the team\'s setlist is unchanged');
    check((await app.api(app.cookies.operator, 'GET', `/api/events/${E}/proposals`)).body.proposals.some((p) => p.status === 'added' && p.addedTarget === 'projector'), 'the proposal is added (projector)');
    await m.waitForFunction(() => /Adăugată/.test(document.querySelector('#proposals .proposal-row').textContent), null, { timeout: 35000 });
    check(true, 'member (follow page): the pill says Adăugată');
    // the console's own "Propuneri" panel lists it as added
    check(/Adăugată doar pe proiector/.test(await op.textContent('#proposals')), 'console panel: "Adăugată doar pe proiector"');
    // the sixth open proposal is refused with a message
    const ids = Object.values(songs);
    const extra = [];
    for (let i = 0; i < 6; i++) extra.push((await app.api(owner, 'POST', '/api/songs', { title: `Extra ${i}`, sections: [{ type: 'verse', content: 'x' }] })).body.song.id);
    for (let i = 0; i < 5; i++) check((await app.api(app.cookies.member, 'POST', `/api/events/${E}/proposals`, { songId: extra[i] })).status === 201, `open proposal ${i + 1}`);
    await m.click('#propose-song');
    await m.waitForSelector('dialog.proposal-dialog[open]');
    await m.fill('#prop-q', 'Extra 5');
    await m.click('dialog.proposal-dialog .song-list li:has-text("Extra 5") button');
    await m.waitForSelector('.proposal-note-step:not([hidden])');
    await m.click('#proposal-send');
    await m.waitForFunction(() => /5 propuneri/.test(document.getElementById('proposal-dialog-message').textContent));
    check(true, 'the sixth open proposal: the message about the limit (429)');
    await m.keyboard.press('Escape');
    void ids;
    // finished: no button
    await app.command({ type: 'event.end' });
    await m.goto(`${app.url}/events/${E}`);
    await m.waitForSelector('#proposals .proposals-member');
    check(await m.locator('#propose-song').count() === 0, 'finished event: no "Propune o cântare"');
  },
};
