'use strict';

// Ghiduri: the leader (RO 375) makes "Pornirea sunetului" for the Voce position - two steps,
// one problem, a photo - and the page reads it back numbered with the photo; a member (EN
// 1024) follows it: "Done" boxes kept on the device until "Start again", the problem opens to
// its fix; scheduled on the top event for that position, Home links the guide; an operator
// has no "New guide". The menu has "Ghiduri" for everyone.

const { layoutAudit, wait } = require('./harness');
const sharp = require('sharp');

module.exports = {
  name: 'guides',
  timeout: 240000,
  async run({ app, signIn, check }) {
    const owner = app.cookies.owner;
    const voce = (await app.api(owner, 'GET', '/api/positions')).body.positions.find((p) => p.name === 'Voce');
    const photo = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#335577' } }).jpeg().toBuffer();

    // the leader writes it (RO 375)
    const l = await signIn('leader', { width: 375, lang: 'ro' });
    await l.goto(`${app.url}/guides`);
    await l.waitForSelector('#guide-add:not([hidden])');
    check(/Niciun ghid încă/.test(await l.textContent('#guides-status')), 'no guide yet: a hint to start');
    await l.click('#guide-add');
    await l.waitForSelector('#guide-dialog[open]');
    await l.fill('#g-title', 'Pornirea sunetului');
    await l.fill('#g-emoji', '🎚️');
    await l.fill('#g-summary', 'Duminica, cu 30 de minute înainte.');
    await l.check(`#g-positions input[value="${voce.id}"]`);
    await l.click('#g-create');
    await l.waitForURL(/\/guides\/\d+\?edit=1$/);
    await l.waitForSelector('#guide-details:not([hidden])');
    const gid = Number(new URL(l.url()).pathname.split('/').pop());
    const addItem = async (kind, title, body) => {
      const form = l.locator(`[data-add="${kind}"]`);
      await form.locator('input').fill(title);
      await form.locator('textarea').fill(body);
      const before = await l.locator(kind === 'step' ? '#steps .guide-item' : '#problems .guide-item').count();
      await form.locator('button[type="submit"]').click();
      await l.waitForFunction(([sel, n]) => document.querySelectorAll(sel).length === n + 1, [kind === 'step' ? '#steps .guide-item' : '#problems .guide-item', before]);
    };
    await addItem('step', 'Pornește prelungitorul', 'Butonul roșu, sub masă.');
    await addItem('step', 'Pornește mixerul', 'Butonul din spate.\nAșteaptă 30 de secunde.');
    await addItem('problem', 'Nu se aude microfonul wireless', 'Verifică bateria.\nApoi canalul 3 pe mixer.');
    await l.locator('#steps .guide-item').first().locator('input[type="file"]').setInputFiles({ name: 'mixer.jpg', mimeType: 'image/jpeg', buffer: photo });
    await l.waitForSelector('#steps .guide-item img.guide-photo');
    const a = await layoutAudit(l, 'main');
    check(!a.overflow && !a.small.length, 'the editor 375: no overflow, targets >= 44 px', a);
    await l.click('#guide-edit'); // Gata cu editarea
    await l.waitForSelector('#steps .guide-step .guide-done');
    const read = await l.evaluate(() => ({
      title: document.getElementById('guide-title').textContent,
      steps: [...document.querySelectorAll('#steps .guide-step')].map((s) => s.querySelector('.guide-step-n').textContent + ' ' + s.querySelector('.guide-item-title').textContent),
      body: document.querySelectorAll('#steps .guide-body')[1].textContent,
      img: document.querySelector('#steps img.guide-photo').naturalWidth,
      forText: document.getElementById('guide-for').textContent,
    }));
    check(/🎚️ Pornirea sunetului/.test(read.title) && read.steps.join('|') === 'Pasul 1 Pornește prelungitorul|Pasul 2 Pornește mixerul' && /\n/.test(read.body) && read.img > 0 && /Voce/.test(read.forText), 'reading: numbered steps, the text on its lines, the photo, who it is for', read);
    await l.context().close();

    // a member scheduled for Voce on the top event (EN 1024): Home links the guide
    const home = (await app.api(app.cookies.member, 'GET', '/api/home')).body;
    const top = home.live || home.next;
    const memberId = (await app.api(owner, 'GET', '/api/team')).body.users.find((u) => u.email === 'm@x.ro').id;
    await app.api(app.cookies.leader, 'PUT', `/api/events/${top.id}/assignments`, { assignments: [{ userId: memberId, positionId: voce.id }] });
    const m = await signIn('member', { width: 1024, lang: 'en' });
    await m.goto(`${app.url}/app`);
    await m.waitForSelector('.now-guide');
    check(/Guide: Pornirea sunetului/.test(await m.textContent('.now-guide')), 'Home: the guide for the position the member serves on');
    await m.click('.now-guide');
    await m.waitForSelector('#steps .guide-step');
    check(await m.isHidden('#guide-edit'), 'a member cannot edit');
    await m.locator('#steps .guide-step').first().locator('input[type="checkbox"]').check();
    await m.waitForFunction(() => /1 of 2 steps done/.test(document.getElementById('guide-progress').textContent));
    await m.reload();
    await m.waitForSelector('#steps .guide-step.done');
    check(/1 of 2 steps done/.test(await m.textContent('#guide-progress')), 'the "Done" boxes stay on this device');
    await m.click('#guide-restart');
    check(await m.locator('#steps .guide-step.done').count() === 0, '"Start again" clears them');
    await m.click('#problems summary');
    check(/canalul 3/.test(await m.textContent('#problems .guide-problem')), 'the problem opens to its fix');
    const b = await layoutAudit(m, 'main');
    check(!b.overflow && !b.small.length, 'reading 1024: no overflow, targets >= 44 px', b);
    // the list and the menu
    await m.goto(`${app.url}/guides`);
    await m.waitForSelector('.guide-row');
    check(/Pornirea sunetului/.test(await m.textContent('.guide-row')) && await m.isHidden('#guide-add'), 'the list: the guide, no "New guide" for a member');
    await m.click('.shell-more');
    check(await m.isVisible('#shell-panel .shell-row[data-page="guides"]'), 'the menu has "Guides"');
    await m.context().close();

    // the operator: reads, no "Ghid nou" (no guides right)
    const op = await signIn('operator', { width: 375 });
    await op.goto(`${app.url}/guides`);
    await op.waitForSelector('.guide-row');
    check(await op.isHidden('#guide-add'), 'the operator reads, no "Ghid nou"');
    await op.context().close();
    // clean up for other checks
    await wait(50);
    await app.api(app.cookies.leader, 'DELETE', `/api/guides/${gid}`);
  },
};
