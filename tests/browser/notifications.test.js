'use strict';

// Stage 7, the notifications centre: rows appear in the person's language, the unread badge on
// "Mai mult", the list with unread marks, "Marchează toate ca citite", the per-kind switches;
// a notification's link opens its page. RO 375 / EN 1024.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'notifications',
  timeout: 180000,
  async run({ app, signIn, check }) {
    const owner = app.cookies.owner;
    const E2 = app.seed.event2Id;
    const positions = (await app.api(owner, 'GET', '/api/positions')).body.positions;
    const memberId = (await app.api(owner, 'GET', '/api/team')).body.users.find((u) => u.email === 'm@x.ro').id;
    await app.api(app.cookies.leader, 'PUT', '/api/me/locale', { locale: 'en' }); // rows are written in the person's language
    await app.api(app.cookies.member, 'PUT', '/api/me/locale', { locale: 'ro' });
    await app.api(app.cookies.leader, 'PUT', `/api/events/${E2}/assignments`, { assignments: [{ userId: memberId, positionId: positions[1].id }] });
    // a setlist change and a live start produce rows for the member; a decline for the leader
    await app.api(owner, 'PUT', `/api/events/${E2}/items`, { items: [{ type: 'verse', reference: 'Ps 100' }] });
    const mine = (await app.api(app.cookies.member, 'GET', `/api/events/${E2}/assignments`)).body.me[0];
    await app.api(app.cookies.member, 'POST', `/api/events/${E2}/assignments/${mine.id}/respond`, { status: 'declined', note: 'Plecat' });
    await wait(200);

    for (const [lang, width, role, expectKind, expectTitle] of [['ro', 375, 'member', 'setlist_changed', /Programul s-a schimbat: Seara/], ['en', 1024, 'leader', 'declined', /Membru cannot come: Chitară/]]) {
      const tag = `[${lang} ${width} ${role}]`;
      const p = await signIn(role, { width, lang });
      await p.goto(`${app.url}/app`);
      await p.waitForSelector('#app-shell .shell-label:not(:empty)');
      await p.waitForFunction(() => { const b = document.querySelector('.shell-badge'); return b && !b.hidden; }, null, { timeout: 5000 });
      const badge = await p.textContent('.shell-badge');
      check(Number(badge) >= 1, `${tag} the unread badge on "Mai mult" (${badge})`);
      await p.goto(`${app.url}/notifications`);
      await p.waitForSelector('.notif-row');
      const rows = await p.evaluate(() => [...document.querySelectorAll('.notif-row')].map((r) => ({ kind: r.dataset.kind, unread: r.classList.contains('unread'), title: r.querySelector('.notif-title').textContent })));
      const row = rows.find((r) => r.kind === expectKind);
      check(row && expectTitle.test(row.title) && row.unread, `${tag} the list: "${row && row.title}" unread, in the person's language`, rows);
      const a = await layoutAudit(p, 'main');
      check(!a.overflow && !a.small.length, `${tag} notifications page: no overflow, targets >= 44 px`, a);
      // per-kind switches
      const kinds = await p.evaluate(() => [...document.querySelectorAll('#notif-prefs input')].map((i) => `${i.dataset.kind}:${i.checked}`));
      check(kinds.length === 5 && kinds.every((k) => k.endsWith(':true')), `${tag} five kinds, all on`, kinds);
      await p.click('#notif-prefs input[data-kind="reminder"]');
      await p.waitForFunction(() => /\S/.test(document.getElementById('prefs-message').textContent));
      check((await app.api(app.cookies[role], 'GET', '/api/notifications')).body.prefs.reminder === false, `${tag} a switch saves (reminder off)`);
      await p.click('#notif-prefs input[data-kind="reminder"]');
      await wait(200);
      // mark all read: the badge goes
      await p.click('#notif-read-all');
      await p.waitForFunction(() => !document.querySelector('.notif-row.unread') && document.querySelector('.shell-badge').hidden, null, { timeout: 5000 });
      check(await p.isHidden('#notif-read-all'), `${tag} "Marchează toate ca citite": no unread rows, the badge gone`);
      // the link opens the page
      await p.click('.notif-row .notif-link');
      await p.waitForURL(`**/events/${E2}**`);
      check(new URL(p.url()).pathname.startsWith(`/events/${E2}`), `${tag} a notification opens its event`);
      await p.context().close();
    }
  },
};
