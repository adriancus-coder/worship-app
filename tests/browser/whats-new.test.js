'use strict';

// "Ce e nou" after an update: a device that saw no release yet (the feature is new) gets the
// newest one as a pop-up on opening (RO 375); "Am înțeles" keeps it as seen, a reload shows
// nothing; a device that saw an older release gets the newer ones; "Mai mult → Ce e nou"
// reopens the whole list (EN 1024). With an invitation waiting, "Ce e nou" comes first and
// the invitation pop-up right after it.

const { layoutAudit, wait, laterAnswers } = require('./harness');

module.exports = {
  name: 'whats-new',
  timeout: 180000,
  async run({ app, signIn, check }) {
    const E = app.seed.eventId;
    await app.api(app.cookies.leader, 'POST', `/api/events/${E}/attendance/send`, {}); // an invitation for everyone
    const news = (await app.api(app.cookies.member, 'GET', '/api/whats-new')).body;
    const latest = news.latest;
    const newest = news.releases[0].items.length; // whatever the newest release lists

    const p = await signIn('member', { width: 375, lang: 'ro' });
    await p.evaluate(() => { localStorage.setItem('wa_test_news', '1'); localStorage.removeItem('wa_whats_new_seen'); });
    await p.goto(`${app.url}/app`);
    await p.waitForSelector('#whats-new[open]');
    const shape = await p.evaluate(() => ({ kicker: document.querySelector('#whats-new .answer-popup-kicker').textContent, items: document.querySelectorAll('#whats-new li').length, titles: document.querySelectorAll('#whats-new h3').length, invite: Boolean(document.querySelector('#answer-popup[open]')) }));
    check(shape.kicker === 'Ce e nou' && shape.items === newest && shape.titles === 0 && !shape.invite, 'a device that saw none: the newest release, before the invitation pop-up', shape);
    const a = await layoutAudit(p, '#whats-new');
    check(!a.overflow && !a.small.length, 'the pop-up 375: no overflow, targets >= 44 px', a);
    await p.click('#whats-new-ok');
    await p.waitForSelector('#whats-new', { state: 'hidden' });
    await p.waitForSelector('#answer-popup[open]');
    check((await p.evaluate(() => localStorage.getItem('wa_whats_new_seen'))) === latest, '"Am înțeles": kept as seen; the invitation pop-up follows');
    await p.click('#answer-popup-later');
    await p.reload();
    await wait(1500);
    check(!(await p.isVisible('#whats-new')), 'a reload shows nothing new');
    // an older release seen: the newer ones (here the newest)
    await p.evaluate(() => localStorage.setItem('wa_whats_new_seen', '2000-01-01'));
    await p.reload();
    await p.waitForSelector('#whats-new[open]');
    check(true, 'a device that saw an older release gets the newer ones');
    await p.click('#whats-new-ok');
    await p.context().close();

    // the menu row reopens the whole list (EN 1024)
    const e = await signIn('member', { width: 1024, lang: 'en' });
    await e.goto(`${app.url}/app`);
    await laterAnswers(e); // the invitation pop-up (answer-popup.test.js) is not this test's
    await e.waitForSelector('#app-shell .shell-label:not(:empty)');
    await e.click('.shell-more');
    await e.waitForSelector('#shell-panel .shell-whats-new', { state: 'visible' });
    check((await e.textContent('#shell-panel .shell-whats-new')).includes('What’s new'), 'the menu has "What’s new"');
    await e.click('#shell-panel .shell-whats-new');
    await e.waitForSelector('#whats-new[open]');
    const all = await e.evaluate(() => ({ title: document.getElementById('whats-new-title').textContent, titles: document.querySelectorAll('#whats-new h3').length, ok: document.getElementById('whats-new-ok').textContent }));
    check(all.title === 'What’s new in the app' && all.titles >= 1 && all.ok === 'Got it', 'the whole list, in English', all);
    await e.context().close();
  },
};
