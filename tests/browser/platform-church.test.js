'use strict';

// One church on the platform (/platform/:id): the platform owner opens church B from the
// list and sees counts, never content; adds a person (B's owner sees them on /team), edits
// and resets them (old sessions gone); revokes a B screen (it shows a pairing code again);
// the platform's own church sends its team to /team; B's owner and a leader of the
// platform church get 403 on every route. RO/EN; 375/1024.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'platform-church',
  timeout: 240000,
  async run({ app, browser, signIn, check }) {
    const B = (await app.api(app.cookies.owner, 'POST', '/api/platform/admins', { name: 'Biserica B', ownerName: 'Ion', ownerEmail: 'ion@b.ro' })).body;
    const bId = B.admin.id;
    // B's owner: a password of their own, a secret song, a paired screen.
    let bOwner = await app.login('ion@b.ro').catch(() => null);
    const res0 = await app.api(null, 'POST', '/api/auth/login', { email: 'ion@b.ro', password: B.temporaryPassword });
    bOwner = /wa_sid=[0-9a-f]+/.exec(res0.headers.get('set-cookie'))[0];
    await app.api(bOwner, 'POST', '/api/me/password', { current: B.temporaryPassword, password: 'parola-b-owner-1' });
    bOwner = /wa_sid=[0-9a-f]+/.exec((await app.api(null, 'POST', '/api/auth/login', { email: 'ion@b.ro', password: 'parola-b-owner-1' })).headers.get('set-cookie'))[0];
    await app.api(bOwner, 'POST', '/api/songs', { title: 'SECRET-CANTARE', sections: [{ type: 'verse', content: 'secret lyric' }] });
    await app.api(bOwner, 'POST', '/api/events', { name: 'SECRET-EVENIMENT', eventDate: app.seed.today });
    const sp = await (await browser.newContext()).newPage();
    await sp.goto(`${app.url}/screen`);
    await sp.waitForFunction(() => /\d{3} \d{3}/.test(document.getElementById('pairing-code').textContent));
    await app.api(bOwner, 'POST', '/api/screens/claim', { code: (await sp.textContent('#pairing-code')).replace(' ', ''), name: 'Ecran B' });
    await sp.waitForSelector('#output:not([hidden])', { timeout: 6000 });

    let created = null;
    for (const [lang, width] of [['ro', 375], ['en', 1024]]) {
      const tag = `[${lang} ${width}]`;
      const p = await signIn('owner', { width, lang });
      await p.goto(`${app.url}/platform`);
      await p.waitForSelector('#churches .church-row');
      await p.click(`#churches a.church-link:has-text("Biserica B")`);
      await p.waitForURL(`**/platform/${bId}`);
      await p.waitForSelector('#church:not([hidden])');
      check(await p.textContent('#church-name') === 'Biserica B' && (await p.getAttribute('#back-link', 'href')) === '/platform', `${tag} the row opens /platform/${bId}, back link to Platformă`);
      const body = await p.textContent('main');
      check(!/SECRET/.test(body) && /1|2/.test(await p.textContent('#usage')), `${tag} Prezentare: counts, no song or event names`);
      check(!(await p.isHidden('#backup-warning')), `${tag} no backup yet: the 30-day warning shows`);
      let a = await layoutAudit(p, 'main');
      check(!a.overflow && !a.small.length, `${tag} overview: no overflow, targets >= 44 px`, a);
      // Echipa: add a person
      await p.click('#tab-team');
      await p.waitForSelector('#panel-team:not([hidden]) #team .team-row');
      check(await p.locator('#team .team-row').count() >= 1 && await p.locator('#team .team-row >> nth=0 >> .team-actions button').count() === 0, `${tag} Echipa: the church's owner has no row actions`);
      if (!created) {
        await p.click('#add-person');
        await p.fill('#add-name', 'Maria');
        await p.fill('#add-email', 'maria@b.ro');
        await p.click('input[name=add-role][value=leader]');
        await p.click('#add-submit');
        await p.waitForSelector('#result-dialog[open]');
        created = { email: await p.textContent('#result-email'), password: await p.textContent('#result-password'), message: await p.inputValue('#result-message') };
        check(/^[a-zA-Z0-9]{12}$/.test(created.password) && created.message.includes('Biserica B'), `${tag} "+ Adaugă persoană": the welcome card for the church`);
        await p.click('#result-dialog [data-close]');
        await wait(100);
        const team = (await app.api(bOwner, 'GET', '/api/team')).body.users;
        check(team.some((u) => u.email === 'maria@b.ro' && u.role === 'leader'), `${tag} B's owner sees the new person on /team`);
        // Maria signs in and changes her password; her session is then reset from here.
        const first = /wa_sid=[0-9a-f]+/.exec((await app.api(null, 'POST', '/api/auth/login', { email: 'maria@b.ro', password: created.password })).headers.get('set-cookie'))[0];
        await app.api(first, 'POST', '/api/me/password', { current: created.password, password: 'parola-maria-1' });
        const maria = /wa_sid=[0-9a-f]+/.exec((await app.api(null, 'POST', '/api/auth/login', { email: 'maria@b.ro', password: 'parola-maria-1' })).headers.get('set-cookie'))[0];
        check((await app.api(maria, 'GET', '/api/auth/me')).status === 200, `${tag} Maria is signed in`);
        await p.click('#team .team-row:has-text("Maria") button:has-text("Resetează")');
        await p.click('#confirm-yes');
        await p.waitForSelector('#result-dialog[open]');
        check((await app.api(maria, 'GET', '/api/auth/me')).status === 401, `${tag} reset from the platform: her old session is gone`);
        await p.click('#result-dialog [data-close]');
        await wait(100);
        await p.click('#team .team-row:has-text("Maria") button:has-text("Editează")');
        await p.selectOption('#edit-role', 'operator');
        await p.click('#edit-submit');
        await p.waitForFunction(() => /Maria/.test(document.getElementById('page-message').textContent));
        check((await app.api(bOwner, 'GET', '/api/team')).body.users.find((u) => u.email === 'maria@b.ro').role === 'operator', `${tag} the role change reaches the church`);
      }
      a = await layoutAudit(p, '#panel-team');
      check(!a.overflow && !a.small.length, `${tag} Echipa: no overflow, targets >= 44 px`, a);
      // Ecrane
      await p.click('#tab-screens');
      await p.waitForSelector('#panel-screens:not([hidden])');
      await p.waitForFunction(() => document.querySelector('#screens .screen-row') || !document.getElementById('screens-status').hidden);
      if (lang === 'ro') {
        check(/Ecran B/.test(await p.textContent('#screens')) && await p.locator('#screens .online-dot.on').count() === 1, `${tag} Ecrane: "Ecran B" online`);
        await p.click('#screens .screen-row:has-text("Ecran B") button');
        await p.click('#confirm-yes');
        const code = await sp.waitForFunction(() => /\d{3} \d{3}/.test(document.getElementById('pairing-code').textContent), null, { timeout: 8000 }).then(() => true, () => false);
        check(code, `${tag} revoke: the screen shows a pairing code again`);
      } else {
        check(await p.locator('#screens .screen-row').count() === 0 && /No screen|Niciun/.test(await p.textContent('#screens-status')), `${tag} Ecrane after the revoke: empty`);
      }
      // the platform's own church: the team tab links to /team
      await p.goto(`${app.url}/platform/1?tab=team`);
      await p.waitForSelector('#church:not([hidden])');
      check(!(await p.isHidden('#team-own')) && (await p.getAttribute('#team-own a', 'href')) === '/team' && await p.isHidden('#add-person'), `${tag} the platform's own church: "Gestionează din Echipa", no editor here`);
      await p.context().close();
    }
    // 403 for everyone else: B's owner, a leader of the platform church
    const leaderP = app.cookies.leader;
    const routes = [
      ['GET', `/api/platform/admins/${bId}`], ['GET', `/api/platform/admins/${bId}/users`],
      ['POST', `/api/platform/admins/${bId}/users`, { name: 'X', email: 'x@b.ro', role: 'member' }],
      ['GET', `/api/platform/admins/${bId}/screens`], ['POST', `/api/platform/admins/${bId}/screens/1/revoke`],
    ];
    for (const [who, cookie] of [["B's owner", bOwner], ['a leader of the platform church', leaderP]]) {
      const codes = [];
      for (const [method, url, body] of routes) codes.push((await app.api(cookie, method, url, body)).status);
      check(codes.every((c) => c === 403), `${who}: 403 on every /api/platform/admins/:id route`, codes);
      const page = await (await browser.newContext()).newPage();
      await page.goto(`${app.url}/login`);
      await page.fill('[name=email]', who.startsWith('B') ? 'ion@b.ro' : 'lider@x.ro');
      await page.fill('[name=password]', who.startsWith('B') ? 'parola-b-owner-1' : 'parola-lunga-1');
      await page.click('button[type=submit]');
      await page.waitForURL('**/app');
      await page.goto(`${app.url}/platform/${bId}`);
      check(new URL(page.url()).pathname === '/app', `${who}: /platform/${bId} sends them to Acasă`);
      await page.context().close();
    }
  },
};
