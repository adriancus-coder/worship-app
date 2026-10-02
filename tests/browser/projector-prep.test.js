'use strict';

// Projector preparation before the start (migration 043): the event page ("Pregătește") has a
// "Proiector" card leading to the console (operator / owner) or the live page (presenter /
// leader). Before the start the console's clock, "Pe ce ecrane" and video controls work (the
// background picker too); the hint says they are kept at the start; the projector screen stays
// idle; play is still off. Started, the event keeps every choice.

const fs = require('fs');
const path = require('path');
const { FIXTURES, wait } = require('./harness');

module.exports = {
  name: 'projector-prep',
  timeout: 180000,
  async run({ app, signIn, check, browser }) {
    const { eventId: E } = app.seed;
    const owner = app.cookies.owner;
    const up = await app.api(owner, 'POST', `/api/media/upload?title=${encodeURIComponent('Intro')}`, fs.readFileSync(path.join(FIXTURES, 'clip.webm')), { 'Content-Type': 'video/webm' });
    check(up.status === 201, 'a clip in the media library');
    const hall = (await app.api(owner, 'POST', '/api/screens', { name: 'Sală' })).body.screen;
    const lobby = (await app.api(owner, 'POST', '/api/screens', { name: 'Hol' })).body.screen;
    const sp = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    await sp.goto(`${app.url}${hall.link}`);
    await sp.waitForSelector('#output:not([hidden])', { timeout: 6000 });

    // the event page: the "Proiector" card, per role
    const op = await signIn('operator', { width: 1280 });
    await op.goto(`${app.url}/events/${E}/edit`);
    await op.waitForSelector('#projector-card:not([hidden])');
    check(/consolă|console/i.test(await op.textContent('#projector-card')) || /Pregătește proiectorul/.test(await op.textContent('#projector-prep-link')), 'the event page: a "Proiector" card with "Pregătește proiectorul"', await op.textContent('#projector-card'));
    check((await op.getAttribute('#projector-prep-link', 'href')) === `/events/${E}/operator`, 'operator: the card leads to the console');
    const lead = await signIn('leader', { width: 1024 });
    await lead.goto(`${app.url}/events/${E}/edit`);
    await lead.waitForSelector('#projector-card:not([hidden])');
    check((await lead.getAttribute('#projector-prep-link', 'href')) === `/events/${E}/live?view=full`, 'leader: the card leads to the live page');
    const mem = await signIn('member', { width: 375 });
    await mem.goto(`${app.url}/events/${E}`);
    await mem.waitForSelector('#event:not([hidden])');
    await wait(300);
    check(await mem.isHidden('#projector-card'), 'a member: no "Proiector" card');

    // the console before the start: the hint, the controls enabled
    await op.click('#projector-prep-link');
    await op.waitForSelector('#console:not([hidden])');
    await op.waitForSelector('#prep-hint:not([hidden])');
    check(/se păstrează la pornire/.test(await op.textContent('#prep-hint')), 'console, planned: "Pregătire: … se păstrează la pornire"');
    await op.waitForSelector('#screen-picker:not([hidden]) button[data-screen]:not([disabled])', { timeout: 5000 });
    check(/primesc proiecția de la pornire/.test(await op.textContent('#screen-picker .hint')), '"Pe ce ecrane": enabled, the preparation hint');
    await op.click(`#screen-picker button[data-screen="${lobby.id}"]`);
    await op.waitForFunction((id) => document.querySelector(`#screen-picker button[data-screen="${id}"]`).getAttribute('aria-pressed') === 'false', lobby.id);
    // the clock: off, top-left
    await op.waitForSelector('.clock-toggle:not([disabled])');
    await op.click('.clock-toggle');
    await op.click('[data-corner="top-left"]');
    // the background picker is enabled
    check(!(await op.isDisabled('#bg-live button')), 'the background button is enabled before the start');
    // the video: prepare the clip; play stays off
    await op.waitForSelector('#video-panel .video-row button');
    await op.click('#video-panel .video-row button');
    await op.waitForFunction(() => /se încarcă pe proiector la pornire/.test(document.getElementById('video-status-text').textContent), null, { timeout: 4000 });
    check(await op.isDisabled('#video-toggle'), 'video prepared before the start: "Pregătit: se încarcă … la pornire", play still off');
    await wait(300);
    let st = await app.state();
    check(st.status === 'planned' && st.prepared && st.clock.show === false && st.clock.position === 'top-left' && JSON.stringify(st.screens) === JSON.stringify([hall.id]) && st.video.state === 'prepared', 'stored while planned', { status: st.status, prepared: st.prepared, clock: st.clock, screens: st.screens, video: st.video.state });
    check(!(await sp.evaluate(() => /Ne ridici/.test(document.querySelector('#output .projector-stage').innerText))), 'the projector screen stays idle while preparing');

    // the start keeps it all
    await op.click('#start-button');
    await sp.waitForFunction(() => /Ne ridici/.test(document.querySelector('#output .projector-stage').innerText), null, { timeout: 5000 });
    st = await app.state();
    check(st.status === 'live' && !st.prepared && st.clock.show === false && st.clock.position === 'top-left' && JSON.stringify(st.screens) === JSON.stringify([hall.id]) && st.video.state === 'prepared', 'started: the clock, the screens and the video are kept', { clock: st.clock, screens: st.screens, video: st.video.state });
    check(await op.isHidden('#prep-hint') && !(await op.isDisabled('#video-toggle')), 'live: the preparation hint goes, play is available');
    const clock = await sp.evaluate(() => { const c = document.querySelector('#output .projector-clock'); return c ? getComputedStyle(c).display !== 'none' && !c.hidden : false; });
    check(!clock, 'the screen shows no clock (prepared off)');
  },
};
