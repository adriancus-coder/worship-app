'use strict';

// The platform page: only its owner sees "Mai mult → Platformă"; "+ Biserică nouă" creates
// a church and shows its owner's temporary password once with a welcome message; that owner
// must change the password, then sees an empty library and nothing of other churches;
// deactivate -> its users get 401, its screen drops; reactivate -> back; the platform's own
// church cannot be deactivated; a normal owner gets 403 and no menu entry; RO/EN; 375/1024.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'platform',
  timeout: 240000,
  async run({ app, browser, signIn, check }) {
    const menu = async (p) => {
      await p.waitForSelector('#app-shell .shell-label:not(:empty)');
      await p.click('.shell-more');
      const shown = await p.isVisible('#shell-panel [data-page=platform]');
      await p.keyboard.press('Escape');
      return shown;
    };
    let created = null;
    for (const [lang, width] of [['ro', 375], ['en', 1024]]) {
      const tag = `[${lang} ${width}]`;
      const p = await signIn('owner', { width, lang });
      check(await menu(p), `${tag} the platform owner sees "Mai mult → Platformă"`);
      await p.goto(`${app.url}/platform`);
      await p.waitForSelector('#churches .church-row');
      const rows = await p.$$eval('#churches .church-row', (l) => l.map((r) => ({ platform: r.classList.contains('platform'), buttons: [...r.querySelectorAll('button')].map((b) => b.textContent) })));
      check(rows.length >= 1 && rows[0].platform && !rows[0].buttons.some((b) => /Dezactivează|Deactivate/.test(b)), `${tag} its own church is marked and has no "Dezactivează"`, rows[0]);
      check(Boolean(await p.textContent('#total-heading')) && await p.locator('.church-row .storage-bar').count() === rows.length, `${tag} the total against the disk and a storage bar per church`);
      await p.click('#add-church');
      await p.fill('#add-name', `Biserica ${lang}`);
      await p.fill('#add-owner-name', `Pastor ${lang}`);
      await p.fill('#add-owner-email', `pastor.${lang}@x.ro`);
      await p.click('#add-submit');
      await p.waitForSelector('#result-dialog[open]');
      const card = { email: await p.textContent('#result-email'), password: await p.textContent('#result-password'), message: await p.inputValue('#result-message') };
      check(/^[a-zA-Z0-9]{12}$/.test(card.password) && card.message.includes(card.password) && card.message.includes(card.email), `${tag} the result card: temporary password once, the welcome message to copy`, card.email);
      const a = await layoutAudit(p, 'main');
      check(!a.overflow && !a.small.length, `${tag} no overflow, targets >= 44 px`, a);
      await p.click('#result-dialog [data-close]');
      await wait(100); // the dialog's close event is queued
      check(await p.textContent('#result-password') === '', `${tag} the password is gone once the card closes`);
      if (!created) created = { ...card, name: `Biserica ${lang}` };
      await p.context().close();
    }

    // The new church's owner: must change the password, then an empty library, no menu entry.
    const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
    const n = await ctx.newPage();
    await n.goto(`${app.url}/login`);
    await n.fill('[name=email]', created.email);
    await n.fill('[name=password]', created.password);
    await n.click('button[type=submit]');
    await n.waitForURL('**/change-password');
    check(true, 'the new owner must change the temporary password first');
    await n.fill('#current', created.password).catch(() => {});
    const fields = await n.$$('input[type=password]');
    await fields[0].fill(created.password);
    await fields[1].fill('parola-noua-7');
    if (fields[2]) await fields[2].fill('parola-noua-7');
    await n.click('button[type=submit]');
    await n.waitForURL('**/app', { timeout: 5000 }).catch(() => {});
    await n.goto(`${app.url}/library`);
    await n.waitForTimeout(800);
    check(await n.locator('#songs li').count() === 0, 'the new church starts with an empty library');
    const events = await n.evaluate(() => fetch('/api/events').then((r) => r.json()));
    check(events.events.length === 0, 'and sees no other church\'s events');
    check(!(await menu(n)), 'a normal owner has no "Platformă" entry');
    check(await n.evaluate(() => fetch('/api/platform/admins').then((r) => r.status)) === 403, 'a normal owner gets 403 on /api/platform');
    await n.goto(`${app.url}/platform`);
    check(new URL(n.url()).pathname === '/app', 'and /platform sends them to Acasă');
    await n.evaluate(() => fetch('/api/songs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Cântarea lor', sections: [{ type: 'verse', content: 'x' }] }) }));
    const o = await signIn('owner', { width: 1024 });
    await o.goto(`${app.url}/library`);
    await o.waitForSelector('#songs li');
    check(!(await o.textContent('#songs')).includes('Cântarea lor'), 'the platform owner does not see the new church\'s songs in the library');

    // A screen of the new church; then deactivate from the page.
    const sp = await (await browser.newContext()).newPage();
    await sp.goto(`${app.url}/screen`);
    await sp.waitForFunction(() => /\d{3} \d{3}/.test(document.getElementById('pairing-code').textContent));
    await n.evaluate((code) => fetch('/api/screens/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name: 'Ecran' }) }), (await sp.textContent('#pairing-code')).replace(' ', ''));
    await sp.waitForSelector('#output:not([hidden])', { timeout: 6000 });
    await o.goto(`${app.url}/platform`);
    await o.waitForSelector('#churches .church-row');
    const row = `#churches .church-row:has-text("${created.name}")`;
    await o.click(`${row} button:has-text("Dezactivează")`);
    await o.click('#confirm-yes');
    await o.waitForSelector(`${row}.inactive`);
    check(true, 'deactivated from the page: the row shows it');
    check(await n.evaluate(() => fetch('/api/auth/me').then((r) => r.status)) === 401, 'its users get 401 at once');
    const offline = await sp.waitForFunction(async () => {
      const res = await fetch('/api/screen/me', { headers: { 'X-Screen-Token': localStorage.getItem('wa_screen_token') } });
      return res.status === 423;
    }, null, { timeout: 5000 }).then(() => true, () => false);
    check(offline && await sp.evaluate(() => Boolean(localStorage.getItem('wa_screen_token'))), 'its screen is dropped but keeps its token');
    await o.click(`${row} button:has-text("Reactivează")`);
    await o.click('#confirm-yes');
    await o.waitForSelector(`${row}:not(.inactive)`);
    await n.goto(`${app.url}/login`);
    await n.fill('[name=email]', created.email);
    await n.fill('[name=password]', 'parola-noua-7');
    await n.click('button[type=submit]');
    check(await n.waitForURL('**/app', { timeout: 5000 }).then(() => true, () => false), 'reactivated: its owner signs in again');
    // quota and a new owner password from the page
    await o.click(`${row} button:has-text("Limită spațiu")`);
    await o.fill('#quota-mb', '50');
    await o.click('#quota-submit');
    await wait(400);
    check(/50\.0 MB/.test(await o.locator(row).textContent()), 'the storage limit is set per church (50 MB)');
    await o.click(`${row} button:has-text("Parolă nouă")`);
    await o.click('#confirm-yes');
    await o.waitForSelector('#result-dialog[open]');
    check(/^[a-zA-Z0-9]{12}$/.test(await o.textContent('#result-password')), 'a new temporary password for its owner, shown once');
    await wait(100);
  },
};
