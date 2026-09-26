'use strict';

// Acasă: the "now" card shows the next event for every role; starting it in another tab
// turns every open home into LIVE without a reload (home:changed), ending it turns them
// back; the pulsing dot respects reduced motion; the editors' quick actions.

const { layoutAudit } = require('./harness');

module.exports = {
  name: 'home',
  async run({ app, signIn, check }) {
    const { eventId: E } = app.seed;
    const pages = {};
    for (const role of ['owner', 'leader', 'operator', 'member']) {
      pages[role] = await signIn(role, { width: role === 'member' ? 375 : 1024 });
      await pages[role].waitForSelector('#now .now-card');
    }
    const card = (p) => p.evaluate(() => {
      const c = document.querySelector('#now .now-card');
      return { live: c.classList.contains('live'), title: c.querySelector('.now-title')?.textContent, quick: !document.getElementById('quick-section').hidden };
    });
    for (const [role, p] of Object.entries(pages)) {
      const c = await card(p);
      check(c.title === 'Serviciu duminică' && !c.live, `${role}: the next event is "Serviciu duminică"`, c);
      check(c.quick === (role !== 'member'), `${role}: quick actions ${role === 'member' ? 'hidden' : 'shown (event roles)'}`, c);
      const a = await layoutAudit(p, 'main');
      check(!a.overflow && !a.small.length, `${role}: no overflow, targets >= 44 px`, a);
    }
    for (const p of Object.values(pages)) await p.evaluate(() => { window.notReloaded = true; });
    const tab = await pages.leader.context().newPage();
    await tab.goto(`${app.url}/events/${E}/live`);
    await tab.waitForSelector('#start-button:not([hidden])');
    const t0 = Date.now();
    await tab.click('#start-button');
    for (const p of Object.values(pages)) await p.waitForSelector('.now-card.live', { timeout: 5000 });
    const same = (await Promise.all(Object.values(pages).map((p) => p.evaluate(() => window.notReloaded === true)))).every(Boolean);
    check(same, `started in another tab: every home shows LIVE without a reload (${Date.now() - t0} ms)`);
    const motion = await pages.owner.evaluate(() => getComputedStyle(document.querySelector('.live-dot')).animationName);
    const rm = await signIn('member', { width: 375, reducedMotion: 'reduce' });
    await rm.waitForSelector('.live-dot');
    const still = await rm.evaluate(() => getComputedStyle(document.querySelector('.live-dot')).animationName);
    check(motion !== 'none' && still === 'none', 'the live dot pulses, but not with prefers-reduced-motion', { motion, still });
    await tab.click('#end-button');
    await tab.click('#end-dialog button[value=end]');
    for (const p of Object.values(pages)) await p.waitForFunction(() => !document.querySelector('.now-card.live'), null, { timeout: 5000 });
    check(true, 'ended: every home leaves LIVE on its own');
    await pages.owner.goto(`${app.url}/app`);
    await pages.owner.waitForSelector('#now .now-card');
    await pages.owner.click('#quick-section a[href="/events?new=1"]');
    const opened = await pages.owner.waitForURL(/\/events\/\d+\/edit/, { timeout: 5000 }).then(() => true, () => false);
    check(opened, '"+ Eveniment nou" creates the event at once and opens the editor');
    await pages.member.request.put(`${app.url}/api/me/locale`, { data: { locale: 'en' } });
    await pages.member.reload();
    await pages.member.waitForSelector('#now .now-card');
    check(/Home|Coming up|Next/i.test(await pages.member.textContent('main')), 'member home in English', await pages.member.textContent('h1'));
  },
};
