'use strict';

// "Setări proiector" on the live page and the console: the one-time choices (background,
// clock, key, chords, "Așteaptă strofa", video) fold under one row; closed by default, the
// row says what is on; open / closed is kept on the device; a prepared video opens it; the
// keys (K) work while it is closed.

const fs = require('fs');
const path = require('path');
const { FIXTURES, layoutAudit } = require('./harness');

module.exports = {
  name: 'projector-settings',
  async run({ app, browser, signIn, check }) {
    const { eventId: E } = app.seed;
    const owner = app.cookies.owner;
    const up = await app.api(owner, 'POST', `/api/media/upload?title=${encodeURIComponent('Clip anunț')}`, fs.readFileSync(path.join(FIXTURES, 'clip.webm')), { 'Content-Type': 'video/webm' });
    check(up.status === 201, 'a clip in the media library');
    const fold = () => { try { localStorage.setItem('wa_test_fold', '1'); } catch (err) { /* none */ } }; // the harness leaves the row alone
    // the operator first: a prepared video stays loaded (video.stop keeps it) and opens the row
    for (const [who, page, width] of [['operator', 'operator', 1024], ['owner', 'live', 1280]]) {
      const p = await signIn(who, { width, height: 900 });
      await p.context().addInitScript(fold);
      await p.evaluate(fold);
      await p.evaluate(() => localStorage.removeItem('wa_projector_settings')); // a device that never opened it
      await app.command({ type: 'clock.set', show: false }, who); // nothing on: the row names what is inside
      await p.goto(`${app.url}/events/${E}/${page}`);
      await p.waitForSelector(page === 'live' ? '#live:not([hidden])' : '#console:not([hidden])');
      await p.waitForSelector('.projector-settings-row');
      const row = () => p.textContent('.projector-settings-row');
      check(!(await p.$eval('#projector-settings', (d) => d.open)), `${who}: "Setări proiector" starts closed`);
      check(/Setări proiector/.test(await row()) && /fundal · ceas · gamă · acorduri · video/.test(await row()), `${who}: the row names what is inside`, await row());
      check(await p.isHidden('#clock-panel .clock-toggle') && await p.isHidden('#bg-live button') && await p.isHidden('#video-panel'), `${who}: the clock, background and video controls are folded`);
      check(await p.isVisible('[data-source="content"]') && await p.isVisible('#projector-preview'), `${who}: the preview and Cântare / Logo / Negru stay in view`);
      // the key K switches the clock on while the row is closed; the row says so
      await p.click('#start-button');
      await p.waitForSelector('#start-button', { state: 'hidden' });
      await p.waitForTimeout(300);
      await p.keyboard.press('k');
      check(await p.waitForFunction(() => /Ceas/.test(document.querySelector('.projector-settings-state').textContent), null, { timeout: 4000 }).then(() => true, () => false), `${who}: K turns the clock on; the row says "Ceas ↘"`, await row());
      check(!(await p.$eval('#projector-settings', (d) => d.open)), `${who}: the key does not open the row`);
      // open: remembered after a reload
      await p.click('.projector-settings-row');
      await p.waitForSelector('#clock-panel .clock-toggle', { state: 'visible' });
      check(await p.getAttribute('#clock-panel .clock-toggle', 'aria-pressed') === 'true', `${who}: open, the clock toggle shows it on`);
      const audit = await layoutAudit(p, '.projector-settings');
      check(audit.small.length === 0, `${who}: open, the folded controls keep their targets`, audit.small.join(' | '));
      await p.reload();
      await p.waitForSelector('.projector-settings-row');
      check(await p.$eval('#projector-settings', (d) => d.open), `${who}: open stays open after a reload`);
      await p.click('.projector-settings-row');
      await p.waitForSelector('#clock-panel .clock-toggle', { state: 'hidden' });
      // a prepared video opens the row (its Play / Stop must be reachable) and names it
      if (who === 'owner') {
      await app.command({ type: 'video.prepare', mediaId: up.body.media.id }, who);
      check(await p.waitForFunction(() => document.getElementById('projector-settings').open && /Video/.test(document.querySelector('.projector-settings-state').textContent), null, { timeout: 4000 }).then(() => true, () => false), `${who}: preparing a video opens the row and names it`, await row());
      }
      await app.command({ type: 'clock.set', show: false }, who).catch(() => null);
      await app.command({ type: 'event.withdraw' }, 'owner'); // back to planned for the next role
      await p.context().close();
    }
  },
};
