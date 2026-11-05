'use strict';

// The operator has every leader right: creates and edits a song (the library's ⋯ menu stays the owner's),
// uploads media, renames a screen; a leader opens the console and an operator the live
// page (roles differ only by where an event lands them).

const path = require('path');
const { FIXTURES } = require('./harness');

module.exports = {
  name: 'operator-rights',
  async run({ app, browser, signIn, check }) {
    const { eventId: E } = app.seed;
    const p = await signIn('operator', { width: 1024 });
    // a song
    await p.goto(`${app.url}/songs/new`);
    check(new URL(p.url()).pathname === '/songs/new', 'the operator opens the song editor');
    await p.fill('#song-title', 'Cântarea operatorului');
    await p.fill('#sections-editor textarea >> nth=0', '[G]Prima strofă');
    await p.click('#save');
    await p.waitForURL(/\/songs\/\d+$/, { timeout: 5000 });
    const songId = Number(new URL(p.url()).pathname.split('/')[2]);
    check(songId > 0, 'creates a song');
    await p.goto(`${app.url}/songs/${songId}/edit`);
    await p.waitForSelector('#song-title');
    await p.fill('#song-title', 'Cântarea operatorului (v2)');
    await p.click('#save');
    await p.waitForURL(`**/songs/${songId}`);
    check((await app.api(app.cookies.operator, 'GET', `/api/songs/${songId}`)).body.song.title === 'Cântarea operatorului (v2)', 'edits it');
    // the whole-library tools (the ⋯ menu: export, import, the key detection, resurse) are the owner's
    await p.goto(`${app.url}/library`);
    await p.waitForFunction(() => document.querySelectorAll('#songs li').length > 0);
    check(await p.isHidden('#library-menu') && await p.isVisible('#new-song'), 'library: "Cântare nouă", but no ⋯ menu (the owner\'s)');
    check((await app.api(app.cookies.operator, 'GET', '/api/songs/export')).status === 403 && (await app.api(app.cookies.operator, 'POST', '/api/songs/import', { type: 'worship-app-library', version: 1, songs: [] })).status === 403, 'export / import refused to the operator');
    // media
    await p.goto(`${app.url}/media`);
    await p.waitForFunction(() => !/^Se încarcă/.test(document.getElementById('status').textContent));
    await p.setInputFiles('#upload-file', path.join(FIXTURES, 'clip.webm'));
    const uploaded = await p.waitForFunction(() => /încărcat/.test(document.getElementById('upload-message').textContent), null, { timeout: 10000 }).then(() => true, () => false);
    check(uploaded, 'uploads media');
    // screens: pair, rename
    const sp = await (await browser.newContext()).newPage();
    await sp.goto(`${app.url}/screen`);
    await sp.waitForFunction(() => /\d{3} \d{3}/.test(document.getElementById('pairing-code').textContent));
    const code = (await sp.textContent('#pairing-code')).replace(' ', '');
    await p.goto(`${app.url}/screens`);
    await p.waitForSelector('#pair-open');
    await p.click('#pair-open'); // "Împerechează cu cod": the code form is collapsed
    await p.waitForSelector('#pair-code');
    await p.fill('#pair-code', code);
    await p.fill('#pair-name', 'Al operatorului');
    await p.click('#pair-submit');
    await sp.waitForSelector('#output:not([hidden])', { timeout: 6000 });
    await p.waitForSelector('.screen-row:has-text("Al operatorului")');
    await p.click('.screen-row:has-text("Al operatorului") button:has-text("Redenumește")');
    await p.fill('#rename-name', 'Redenumit');
    await p.click('#rename-form button[type=submit]');
    check(await p.waitForSelector('.screen-row:has-text("Redenumit")', { timeout: 4000 }).then(() => true, () => false), 'pairs and renames a screen');
    // either live page
    await app.command({ type: 'event.start' });
    await p.goto(`${app.url}/events/${E}/live`);
    check(await p.waitForSelector('#live:not([hidden])', { timeout: 5000 }).then(() => true, () => false), 'the operator can open the live page');
    const l = await signIn('leader', { width: 1024 });
    await l.goto(`${app.url}/events/${E}/operator`);
    await l.waitForSelector('#live:not([hidden])', { timeout: 5000 }).catch(() => {});
    check(/\/live$/.test(new URL(l.url()).pathname), 'the leader is sent from the console to the live page', l.url());
    await l.goto(`${app.url}/events/${E}`);
    await l.waitForSelector('#event-actions a');
    const leaderPrimary = await l.getAttribute('#event-actions a:first-child', 'href');
    await p.goto(`${app.url}/events/${E}`);
    await p.waitForSelector('#event-actions a');
    const operatorPrimary = await p.getAttribute('#event-actions a:first-child', 'href');
    check(/\/live\?view=lyrics/.test(leaderPrimary) && /\/operator/.test(operatorPrimary), 'default entry points: leader -> big lyrics, operator -> console', { leaderPrimary, operatorPrimary });
    // The rehearsal page is gone for everyone: no link, the old URL lands on the event page.
    check(await p.locator('#event-actions a[href*="/rehearse"]').count() === 0 && await l.locator('#event-actions a[href*="/rehearse"]').count() === 0, 'no "Repetiție" on the event page (operator, leader)');
    await p.goto(`${app.url}/events/${E}/rehearse`);
    await p.waitForSelector('#items .item-main');
    check(new URL(p.url()).pathname === `/events/${E}`, `operator: /events/${E}/rehearse redirects to the event page`);
    const m2 = await signIn('member', { width: 1024 });
    await m2.goto(`${app.url}/events/${E}/rehearse`);
    await m2.waitForSelector('#items .item-main');
    check(new URL(m2.url()).pathname === `/events/${E}`, 'member: the old rehearsal link lands on the event page too');
    await m2.context().close();
    // The projector window and the Ecrane page are the operator's: the leader keeps the preview
    await l.goto(`${app.url}/events/${E}/live?view=full`); // the leader lands in the big lyrics otherwise
    await l.waitForSelector('#live:not([hidden])');
    await l.waitForTimeout(500);
    check(await l.isHidden('#open-projector') && await l.isHidden('#projector-permission'), 'leader: no "Deschide ecranul proiectorului"');
    check(await l.evaluate(() => Boolean(document.querySelector('#projector-preview')) && document.querySelectorAll('[data-source]').length >= 3), 'leader: the preview and the source buttons stay');
    const mirrored = await l.waitForFunction(() => /Ne ridici|Sfânt/.test(document.getElementById('projector-preview').innerText), null, { timeout: 4000 }).then(() => true, () => false);
    check(mirrored, 'leader: the preview mirrors the screen');
    await l.goto(`${app.url}/screens`);
    check(new URL(l.url()).pathname === '/app', 'leader: /screens redirects to Acasă');
    check((await app.api(app.cookies.leader, 'POST', '/api/screens/auto-claim', { name: 'X' })).status === 403, 'leader: auto-claim 403');
    await l.goto(`${app.url}/app`);
    await l.waitForSelector('#now .now-card');
    const homePrimary = await l.evaluate(() => { const b = document.querySelector('#now .now-primary'); return b.getAttribute('href') || b.textContent; });
    check(!/operator|screens/.test(homePrimary), 'leader home card: the primary never points to the console / projector setup', homePrimary);
    await p.goto(`${app.url}/events/${E}/operator`);
    await p.waitForSelector('#console:not([hidden])');
    const [popup] = await Promise.all([p.waitForEvent('popup'), p.click('#open-projector')]);
    await popup.waitForURL(/\/screen\/[a-z0-9]{12}$/, { timeout: 5000 });
    check(await popup.waitForSelector('#output:not([hidden])', { timeout: 6000 }).then(() => true, () => false), 'operator: "Deschide ecranul proiectorului" opens a paired window as before');
    await popup.close();
  },
};
