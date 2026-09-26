'use strict';

// Deleting a church from Platformă: an active church has no delete action (a hint says to
// deactivate first; the API says 409); deactivated -> "Șterge biserica" opens a dialog that
// explains the 7-day delay and the final backup and needs the exact name (a wrong one keeps
// the button disabled; the API says 409); scheduled -> the pill with the date and "Anulează
// ștergerea" on the church page and on the /platform row; cancel; the sweep (test hook, as
// if 8 days later) purges it: 404, the row is gone, the final zip exists, other churches
// stay; the platform's own church: 403. RO / EN; 375 / 1024.

const fs = require('fs');
const path = require('path');
const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'platform-delete',
  timeout: 180000,
  async run({ app, browser, signIn, check }) {
    const D = (await app.api(app.cookies.owner, 'POST', '/api/platform/admins', { name: 'Biserica D', ownerName: 'Dan', ownerEmail: 'dan@d.ro' })).body.admin;
    const K = (await app.api(app.cookies.owner, 'POST', '/api/platform/admins', { name: 'Biserica K', ownerName: 'Kim', ownerEmail: 'kim@k.ro' })).body.admin;
    check(D && K && D.id && K.id, 'two churches created');
    check((await app.api(app.cookies.owner, 'POST', `/api/platform/admins/${D.id}/delete`, { confirmName: 'Biserica D' })).status === 409, 'API: an active church cannot be scheduled (409)');
    check((await app.api(app.cookies.owner, 'POST', '/api/platform/admins/1/delete', { confirmName: 'Biserica Harul' })).status === 403, "API: the platform's own church (403)");
    for (const [lang, width] of [['ro', 375], ['en', 1024]]) {
      const tag = `[${lang} ${width}]`;
      const p = await signIn('owner', { width, lang });
      await p.goto(`${app.url}/platform/${D.id}`);
      await p.waitForSelector('#church:not([hidden])');
      if (lang === 'ro') {
        check(await p.isHidden('#delete-area') && !(await p.isHidden('#delete-hint')), `${tag} active: no "Șterge biserica", the hint says to deactivate first`);
        await p.click('#act-deactivate');
        await p.click('#confirm-yes');
        await p.waitForFunction(() => /dezactivată|deactivated/.test(document.getElementById('page-message').textContent));
        check(!(await p.isHidden('#delete-area')) && await p.isHidden('#delete-hint'), `${tag} deactivated: "Șterge biserica" shows`);
        await p.click('#act-delete');
        await p.waitForSelector('#delete-dialog[open]');
        const text = await p.textContent('#delete-text');
        check(/7 zile/.test(text) && /backup/.test(text) && await p.isDisabled('#delete-submit'), `${tag} the dialog explains the 7 days and the final backup; the button waits for the name`);
        await p.fill('#delete-name', 'biserica d');
        check(await p.isDisabled('#delete-submit'), `${tag} a wrong name keeps "Programează ștergerea" disabled`);
        check((await app.api(app.cookies.owner, 'POST', `/api/platform/admins/${D.id}/delete`, { confirmName: 'biserica d' })).status === 409, `${tag} API: wrong name 409`);
        const a = await layoutAudit(p, '#delete-dialog');
        check(!a.overflow && !a.small.length, `${tag} dialog: no overflow, targets >= 44 px`, a);
        await p.fill('#delete-name', 'Biserica D');
        await p.click('#delete-submit');
        await p.waitForFunction(() => /ștearsă definitiv pe/.test(document.getElementById('page-message').textContent));
        const pill = await p.textContent('#church-delete');
        check(/Ștergere programată pe .+/.test(pill) && !(await p.isHidden('#act-cancel-delete')) && await p.isHidden('#delete-area'), `${tag} pending: "${pill}" + "Anulează ștergerea"`);
        const admin = (await app.api(app.cookies.owner, 'GET', `/api/platform/admins/${D.id}`)).body.admin;
        check(Math.abs(admin.deleteAt - (Date.now() + 7 * 86400000)) < 60000, `${tag} deleteAt = now + 7 days`);
        // the /platform row
        await p.goto(`${app.url}/platform`);
        await p.waitForSelector('#churches .church-row');
        const row = p.locator('#churches .church-row:has-text("Biserica D")');
        check(/Ștergere programată pe/.test(await row.textContent()) && await row.locator('button:has-text("Anulează ștergerea")').count() === 1, `${tag} the /platform row: the pill and "Anulează ștergerea"`);
        const b = await layoutAudit(p, '#churches');
        check(!b.overflow && !b.small.length, `${tag} list: no overflow, targets >= 44 px`, b);
        await row.locator('button:has-text("Anulează ștergerea")').click();
        await p.click('#confirm-yes');
        await p.waitForFunction(() => /anulată/.test(document.getElementById('page-message').textContent));
        check(!/Ștergere programată/.test(await row.textContent()), `${tag} cancelled from the row: the pill is gone`);
        check((await app.api(app.cookies.owner, 'GET', `/api/platform/admins/${D.id}`)).body.admin.deleteAt === null, `${tag} API: nothing pending`);
      } else {
        // English, pending again: the church page texts
        await app.api(app.cookies.owner, 'POST', `/api/platform/admins/${D.id}/delete`, { confirmName: 'Biserica D' });
        await p.reload();
        await p.waitForSelector('#church:not([hidden])');
        check(/Deletion scheduled for/.test(await p.textContent('#church-delete')) && /Cancel the deletion/.test(await p.textContent('#act-cancel-delete')), `${tag} pending in English`);
        const a = await layoutAudit(p, '.church-head');
        check(!a.overflow && !a.small.length, `${tag} header: no overflow, targets >= 44 px`, a);
      }
      await p.context().close();
    }
    // the sweep (test hook): as if 8 days later
    const later = Date.now() + 8 * 86400000;
    const swept = await app.api(app.cookies.owner, 'POST', '/api/platform/deletions/sweep', { now: later });
    check(swept.status === 200 && swept.body.purged.length === 1 && swept.body.purged[0] === D.id, 'the sweep purged the church', swept.body);
    check((await app.api(app.cookies.owner, 'GET', `/api/platform/admins/${D.id}`)).status === 404, 'the church is gone (404)');
    const list = (await app.api(app.cookies.owner, 'GET', '/api/platform/admins')).body.admins;
    check(!list.some((a) => a.id === D.id) && list.some((a) => a.id === K.id) && list.some((a) => a.id === 1), 'the other churches stay');
    const zip = path.join(app.dataDir, 'deleted', `${D.id}-${new Date(later).toISOString().slice(0, 10)}.zip`);
    check(fs.existsSync(zip) && fs.statSync(zip).size > 100, `the final backup zip exists (${path.basename(zip)})`);
    check(!fs.existsSync(path.join(app.dataDir, 'uploads', `admin-${D.id}`)), 'no upload folder left');
    const p = await signIn('owner', { width: 1024 });
    await p.goto(`${app.url}/platform`);
    await p.waitForSelector('#churches .church-row');
    check(await p.locator('#churches .church-row:has-text("Biserica D")').count() === 0 && await p.locator('#churches .church-row:has-text("Biserica K")').count() === 1, 'the list: no "Biserica D", "Biserica K" still there');
    await wait(100);
  },
};
