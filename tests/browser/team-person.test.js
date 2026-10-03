'use strict';

// Echipa (the owner): the person dialog edits the email too (the row shows the new one; a
// taken one says so); a deactivated account gets "Șterge definitiv" (active ones never), a
// confirmation, then the row is gone. RO 375 / EN 1024.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'team-person',
  timeout: 180000,
  async run({ app, signIn, check }) {
    const owner = app.cookies.owner;
    for (const [lang, width] of [['ro', 375], ['en', 1024]]) {
      const tag = `[${lang} ${width}]`;
      const made = (await app.api(owner, 'POST', '/api/team', { name: `Vasile ${lang}`, email: `vasile-${lang}@x.ro`, role: 'member' })).body.user;
      const o = await signIn('owner', { width, lang });
      await o.goto(`${app.url}/team`);
      await o.waitForSelector('#team .team-row');
      const row = o.locator('#team .team-row', { hasText: `Vasile ${lang}` });
      // the email in the dialog
      await row.locator('button[data-icon="edit"]').click();
      await o.waitForSelector('#edit-dialog[open]');
      check((await o.inputValue('#edit-email')) === `vasile-${lang}@x.ro`, `${tag} the dialog shows the email`);
      await o.fill('#edit-email', 'lider@x.ro');
      await o.click('#edit-submit');
      await o.waitForFunction(() => /\S/.test(document.getElementById('edit-message').textContent));
      check(/(Există deja|already exists)/.test(await o.textContent('#edit-message')), `${tag} a taken email: a clear message`, await o.textContent('#edit-message'));
      await o.fill('#edit-email', `nou-${lang}@x.ro`);
      await o.click('#edit-submit');
      await o.waitForFunction(() => !document.getElementById('edit-dialog').open);
      await wait(200);
      check((await row.locator('.team-email').textContent()) === `nou-${lang}@x.ro`, `${tag} saved: the row shows the new email`);
      check((await o.locator('#team .team-row:not(.inactive) [data-action="remove"]').count()) === 0, `${tag} active accounts: no "Șterge definitiv"`);
      // deactivated -> "Șterge definitiv"
      await app.api(owner, 'POST', `/api/team/${made.id}/deactivate`);
      await o.reload();
      await o.waitForSelector('#team .team-row.inactive [data-action="remove"]');
      const a = await layoutAudit(o, '#team');
      check(!a.overflow && !a.small.length, `${tag} the rows with the new button: no overflow, targets >= 44 px`, a);
      await o.locator('#team .team-row', { hasText: `Vasile ${lang}` }).locator('[data-action="remove"]').click();
      await o.waitForSelector('#confirm-dialog[open]');
      check(/(nu se poate anula|cannot be undone)/i.test(await o.textContent('#confirm-dialog')), `${tag} it asks first (cannot be undone)`);
      await o.click('#confirm-yes');
      await o.waitForFunction(() => !document.getElementById('confirm-dialog').open);
      await wait(200);
      check((await o.locator('#team .team-row', { hasText: `Vasile ${lang}` }).count()) === 0 && /(șters|deleted)/.test(await o.textContent('#page-message')), `${tag} deleted: the row is gone, a message says so`);
      check(!(await app.api(owner, 'GET', '/api/team')).body.users.some((u) => u.id === made.id), `${tag} API: gone`);
      await o.context().close();
    }
  },
};
