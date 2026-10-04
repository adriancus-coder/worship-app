'use strict';

// Where each role lands (docs/ROADMAP.md "Roles"): the presenter prepares / starts and gets
// the live page; the leader rehearses / starts and gets the big lyrics (?view=lyrics, ✕
// shows the live page underneath; next / prev move the team and the projector); the console
// stays the operator's and the owner's (presenter and leader are redirected); operator and
// member unchanged; the owner can "Vezi ca prezentator". RO / EN; 375 / 1024 / 1180.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'entry-points',
  timeout: 240000,
  async run({ app, signIn, check }) {
    const E = app.seed.eventId;
    const card = (p) => p.evaluate(() => {
      const b = document.querySelector('#now .now-primary');
      const s = document.querySelector('#now .now-actions .secondary');
      return { primary: b ? b.textContent.trim() : null, href: b ? b.getAttribute('href') : null, secondary: s ? s.textContent.trim() : null };
    });
    const eventRow = (p) => p.evaluate(() => [...document.querySelectorAll('#event-actions a')].map((a) => `${a.classList.contains('secondary') ? '' : '*'}${a.textContent.trim()}|${a.getAttribute('href')}`));

    // --- planned: the home card and the event page per role ---------------------------------
    // [home primary, home secondary, event page primary]
    const planned = {
      owner: [/Pornește live/, /Pregătește/, /Pornește live/],
      presenter: [/Pregătește/, /Pornește live/, /Editează/],
      leader: [/Repetiție/, /Pornește live/, /Repetiție/],
      operator: [/Pregătește/, /Pornește live/, /Editează/],
      member: [/Repetiție/, null, /Repetiție/],
    };
    const pages = {};
    for (const [role, [primary, secondary, eventPrimary]] of Object.entries(planned)) {
      const p = await signIn(role, { width: role === 'leader' ? 375 : 1180 });
      pages[role] = p;
      await p.waitForSelector('#now .now-card');
      const c = await card(p);
      check(primary.test(c.primary) && (secondary ? secondary.test(c.secondary || '') : !c.secondary), `${role} planned: home "${c.primary}"${c.secondary ? ` + "${c.secondary}"` : ''}`, c);
      await p.goto(`${app.url}/events/${E}`);
      await p.waitForSelector('#event-actions a');
      const row = await eventRow(p);
      check(row.length && eventPrimary.test(row[0]) && row[0].startsWith('*'), `${role} planned: the event page's primary "${row[0]}"`, row);
      const a = await layoutAudit(p, 'main');
      check(!a.overflow && !a.small.length, `${role}: no overflow, targets >= 44 px`, a);
    }
    // the console: owner and operator only; presenter and leader are sent to their live page
    for (const [role, ok] of [['presenter', false], ['leader', false], ['operator', true], ['owner', true]]) {
      const p = pages[role];
      await p.goto(`${app.url}/events/${E}/operator`);
      await p.waitForSelector(ok ? '#console:not([hidden])' : '#live:not([hidden])', { timeout: 5000 }).catch(() => {});
      check(ok ? /\/operator$/.test(new URL(p.url()).pathname) : /\/live$/.test(new URL(p.url()).pathname), `${role}: the console ${ok ? 'opens' : 'redirects to the live page'}`, p.url());
    }
    // the presenter edits the event (editor rights)
    const pr = pages.presenter;
    await pr.goto(`${app.url}/events/${E}/edit`);
    await pr.waitForSelector('#items li');
    check(/\/edit$/.test(new URL(pr.url()).pathname), 'presenter: the editor opens');
    // the presenter starts from home -> the live page
    await pr.goto(`${app.url}/app`);
    await pr.waitForSelector('#start-live');
    await pr.click('#start-live');
    await pr.waitForURL(`**/events/${E}/live**`);
    await pr.waitForSelector('#live:not([hidden])');
    check((await app.state(E)).status === 'live' && !(await pr.locator('dialog.big-lyrics[open]').count()), 'presenter: "Pornește live" -> the event is live, the live page (no big lyrics)');
    await pr.goto(`${app.url}/app`);
    await pr.waitForSelector('#now .now-card.live');
    check(/Intră live/.test((await card(pr)).primary), 'presenter live: "Intră live"');

    // --- live: the leader's big lyrics ---------------------------------------------------------
    const l = pages.leader;
    await l.goto(`${app.url}/app`);
    await l.waitForSelector('#now .now-card.live');
    const lc = await card(l);
    check(lc.primary === 'Versuri mari' && /\/live\?view=lyrics/.test(lc.href), 'leader live: "Versuri mari" -> /live?view=lyrics', lc);
    await l.click('#now .now-primary');
    await l.waitForSelector('dialog.big-lyrics[open]', { timeout: 6000 });
    await l.waitForFunction(() => document.querySelector('dialog.big-lyrics .big-text').innerText.trim().length > 0, null, { timeout: 4000 }).catch(() => {});
    const before = await app.state(E);
    await l.click('dialog.big-lyrics .big-nav button:last-child');
    await l.waitForFunction((v) => document.querySelector('dialog.big-lyrics .big-label') && v !== undefined, before.version);
    await wait(300);
    const after = await app.state(E);
    check(after.version > before.version && (after.worship.step !== before.worship.step || after.worship.itemId !== before.worship.itemId), 'leader: "Următoarea" in the big lyrics moves the team (and the projector, together mode)', { before: before.worship, after: after.worship });
    await l.click('dialog.big-lyrics .big-nav button[data-icon="undo"]'); // ← Înapoi ("✕ Ieși" comes first now)
    await wait(300);
    const back = await app.state(E);
    check(back.worship.step === before.worship.step && back.worship.itemId === before.worship.itemId, 'leader: "Înapoi" moves back');
    const al = await layoutAudit(l, 'dialog.big-lyrics');
    check(!al.overflow && !al.small.length, 'leader 375: big lyrics, targets >= 44 px', al);
    // the leader's ✕ goes back to the EVENT page (Acasă when they came from there), never to the full page
    await l.click('dialog.big-lyrics .big-close');
    await l.waitForURL(`**/events/${E}?from=home`, { timeout: 5000 });
    check(new URL(l.url()).pathname === `/events/${E}`, 'leader: ✕ returns to the event page (from home: ?from=home kept)');
    await l.waitForSelector('#event-actions a');
    const lrow = await eventRow(l);
    check(/^\*Versuri mari\|.*\/live\?view=lyrics/.test(lrow[0]) && lrow.some((x) => /Repetiție/.test(x)) && lrow.some((x) => /^Pagina Live completă\|.*\/live\?view=full/.test(x)), 'leader live: the event page\'s primary is "Versuri mari", rehearsal stays, "Pagina Live completă" secondary', lrow);
    // "Versuri mari" from the event page -> big lyrics; "✕ Ieși" -> the event page
    await l.click('#event-actions a:has-text("Versuri mari")');
    await l.waitForSelector('dialog.big-lyrics[open]', { timeout: 6000 });
    check(await l.evaluate(() => document.querySelector('dialog.big-lyrics .big-full') && !document.querySelector('dialog.big-lyrics .big-full').hidden), 'leader: a small "Pagina completă" tool inside the view');
    await l.click('dialog.big-lyrics .big-exit');
    await l.waitForFunction((path) => location.pathname === path, `/events/${E}`, { timeout: 5000 });
    await l.waitForSelector('#event-actions a');
    check(new URL(l.url()).pathname === `/events/${E}`, 'leader: "✕ Ieși" -> the event page');
    // a direct /live also lands in the big lyrics; "Pagina completă" reveals the full page; ← Ieși -> event page
    await l.goto(`${app.url}/events/${E}/live`);
    await l.waitForSelector('dialog.big-lyrics[open]', { timeout: 6000 });
    check(true, 'leader: a direct /live opens the big lyrics at once');
    await l.click('dialog.big-lyrics .big-full');
    await wait(300);
    check(!(await l.locator('dialog.big-lyrics[open]').count()) && !(await l.isHidden('#live')) && new URL(l.url()).pathname === `/events/${E}/live`, 'leader: "Pagina completă" reveals the full live page');
    await l.goto(`${app.url}/events/${E}`);
    await l.waitForSelector('#event-actions a');
    await l.click('#event-actions a:has-text("Pagina Live completă")');
    await l.waitForSelector('#live:not([hidden])');
    await wait(300);
    check(!(await l.locator('dialog.big-lyrics[open]').count()), 'leader: "Pagina Live completă" -> the full page, no big lyrics');
    await l.click('.shell-exit');
    await l.waitForFunction((path) => location.pathname === path, `/events/${E}`, { timeout: 5000 });
    check(new URL(l.url()).pathname === `/events/${E}`, 'leader: "← Ieși" from the full page -> the event page');

    // --- operator and member unchanged -----------------------------------------------------------
    const op = pages.operator;
    await op.goto(`${app.url}/app`);
    await op.waitForSelector('#now .now-card.live');
    const oc = await card(op);
    check(oc.primary === 'Consolă operator' && /\/operator/.test(oc.href), 'operator live: "Consolă operator"', oc);
    await op.goto(`${app.url}/events/${E}/rehearse`);
    await op.waitForSelector('#event-actions a');
    check(new URL(op.url()).pathname === `/events/${E}`, 'operator: still no rehearsal (redirect)');
    const m = pages.member;
    await m.goto(`${app.url}/app`);
    await m.waitForSelector('#now .now-card.live');
    check((await card(m)).primary === 'Urmărește live', 'member live: "Urmărește live"');
    await m.goto(`${app.url}/events/${E}/live`);
    await wait(300);
    check(new URL(m.url()).pathname === `/events/${E}`, 'member: the live page redirects to the event');

    // --- the owner as presenter (EN, 1024) ----------------------------------------------------------
    const o = pages.owner;
    await app.api(app.cookies.owner, 'PUT', '/api/me/locale', { locale: 'en' });
    await o.request.put(`${app.url}/api/me/locale`, { data: { locale: 'en' } });
    await o.setViewportSize({ width: 1024, height: 820 });
    await o.goto(`${app.url}/app`);
    await o.waitForSelector('#app-shell .shell-label:not(:empty)');
    await o.click('.shell-more');
    await o.waitForSelector('#shell-panel:not([hidden])');
    check((await o.textContent('#shell-panel [data-view-as="presenter"]')).trim() === 'Presenter', 'EN: "Vezi ca" offers Presenter (never the internal word)');
    await o.click('#shell-panel [data-view-as="presenter"]');
    await o.waitForFunction(() => /presenter/i.test((document.getElementById('view-as-bar') || {}).textContent || '') && document.querySelector('#now .now-card'), null, { timeout: 8000 });
    const vc = await card(o);
    check(vc.primary === 'Go live' && /\/live\?from=home$/.test(vc.href), 'owner as presenter: "Go live" -> the live page', vc);
    await o.goto(`${app.url}/events/${E}/operator`);
    await o.waitForSelector('#live:not([hidden])', { timeout: 5000 }).catch(() => {});
    check(/\/live$/.test(new URL(o.url()).pathname), 'owner as presenter: the console redirects too');
    await o.goto(`${app.url}/screens`);
    await wait(300);
    check(new URL(o.url()).pathname === '/app', 'owner as presenter: /screens redirects');
    await o.click('#view-as-bar .view-as-back');
    await o.waitForFunction(() => { const b = document.getElementById('view-as-bar'); return b && b.hidden; });
    check(true, 'back to the owner');
  },
};
