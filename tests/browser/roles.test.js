'use strict';

// Echipa → Roluri (public/roles-editor.js, lib/roles.js): the built-in roles with their
// rights, a new role (name, emoji, "Se deschide ca", rights ticked; Proiector ticks Live), a
// person gets it in Echipa (the pill shows it), that person's app follows the rights (the
// menu, the header), deleting it makes the person a member again. RO 375 / EN 1024.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'roles',
  timeout: 180000,
  async run({ app, signIn, check }) {
    // the owner creates a role (RO 375)
    const o = await signIn('owner', { width: 375, lang: 'ro' });
    await o.goto(`${app.url}/team?tab=roles`);
    await o.waitForSelector('#roles-panel:not([hidden]) .role-row.builtin');
    const builtIn = await o.$$eval('#roles-panel .role-row.builtin', (rows) => rows.map((r) => r.textContent));
    check(builtIn.length === 5 && /Totul/.test(builtIn[0]) && /Membru – Urmărește · \d+ persoan/.test(builtIn[4]), 'the five built-in roles in the one list: how each opens, its people, its rights', builtIn);
    check((await o.locator('#roles-all .role-row').count()) === 5 && !(await o.locator('#roles-panel .team-panel-heading').count()), 'one list, no "de bază" / "create de tine" headings');
    await o.click('#role-add');
    await o.waitForSelector('#role-dialog[open]');
    await o.fill('#role-name', 'Tehnician sunet');
    await o.fill('#role-emoji', '🎚️');
    await o.check('#role-dialog input[name="role-base"][value="operator"]');
    await o.check('#role-dialog input[name="role-perm"][value="screens"]');
    check(await o.isChecked('#role-dialog input[name="role-perm"][value="live"]'), 'ticking Proiector ticks Live too');
    const d = await layoutAudit(o, '#role-dialog');
    check(!d.overflow && !d.small.length, 'the role dialog 375: no overflow, targets >= 44 px', d);
    await o.click('#role-save');
    await o.waitForSelector('#roles-all .role-row[data-role]');
    const row = await o.textContent('#roles-all .role-row[data-role]');
    check(/🎚️ Tehnician sunet/.test(row) && /Operator – Consola/.test(row) && /Live · Proiector/.test(row) && /nicio persoană/.test(row), 'the new role in the list: emoji, name, how it opens, rights, nobody yet', row);
    const a = await layoutAudit(o, '#roles-panel');
    check(!a.overflow && !a.small.length, 'Roluri 375: no overflow, targets >= 44 px', a);
    // the person gets it in Echipa
    await o.click('#tab-people');
    const person = o.locator('#team .team-row', { hasText: 'Membru' });
    await person.locator('.team-menu-button').click(); // the actions sit in the row's "⋯" menu
    await person.locator('button:has-text("Editează")').click();
    await o.waitForSelector('#edit-dialog[open]');
    const options = await o.$$eval('#edit-role option', (l) => l.map((x) => x.textContent));
    check(options.includes('🎚️ Tehnician sunet'), 'the role select offers the new role', options);
    await o.selectOption('#edit-role', { label: '🎚️ Tehnician sunet' });
    check(/Operator – Consola/.test(await o.textContent('#edit-role-help')), 'its help says how it opens and what it can do');
    await o.click('#edit-submit');
    await o.waitForFunction(() => !document.getElementById('edit-dialog').open);
    await wait(200);
    // the role pill is on the person's sheet (the › next to the name)
    const rolePill = async () => { await person.locator('.person-open').click(); await o.waitForSelector('#person-dialog[open] .role-pill'); const x = await o.textContent('#person-dialog .role-pill'); await o.click('#person-close'); await o.waitForFunction(() => !document.getElementById('person-dialog').open); return x; };
    check(/🎚️ Tehnician sunet/.test(await rolePill()), 'Echipa: the person\'s sheet shows the role');
    // that person's app (EN 1024): the menu follows the rights
    const m = await signIn('member', { width: 1024, lang: 'en' });
    await m.goto(`${app.url}/app`);
    await m.waitForSelector('#app-shell .shell-label:not(:empty)');
    await m.click('.shell-more');
    await m.waitForSelector('#shell-panel:not([hidden])');
    const menu = await m.evaluate(() => [...document.querySelectorAll('#shell-panel li:not([hidden]) .shell-row[data-page]')].map((x) => x.dataset.page));
    check(menu.includes('screens') && !menu.includes('media') && !menu.includes('settings'), 'the menu: Screens (projector right), no Media, no Settings', menu);
    check(/Tehnician sunet/.test(await m.textContent('.shell-who-role')), 'the header names the role', await m.textContent('.shell-who-role'));
    await m.context().close();
    // deleting it: the person becomes a member
    await o.click('#tab-roles');
    await o.click('#roles-all .role-row[data-role] button');
    await o.waitForSelector('#role-dialog[open]');
    await o.click('#role-delete');
    check(/devin Membri/.test(await o.textContent('#role-delete-text')) && /1 persoană/.test(await o.textContent('#role-delete-text')), 'delete asks first: its people become members', await o.textContent('#role-delete-text'));
    await o.click('#role-delete-yes');
    await o.waitForFunction(() => !document.querySelector('#roles-all .role-row[data-role]'));
    await o.click('#tab-people');
    await wait(200);
    check(/Membru/.test(await rolePill()), 'deleted: the person is a member again');
    const me = (await app.api(app.cookies.member, 'GET', '/api/auth/me')).body.user;
    check(me.role === 'member' && me.perms.length === 0 && !me.customRole, 'API: member, no rights', me);
    // a built-in role, reshaped by the owner: "Membru" -> "Voluntar" with the Ghiduri right
    await o.click('#tab-roles');
    await o.click('[data-edit-builtin="member"]');
    await o.waitForSelector('#role-dialog[open]');
    const fixed = await o.evaluate(() => ({ visible: !document.getElementById('role-base-choice').hidden, checked: document.querySelector('#role-dialog input[name="role-base"]:checked').value, disabled: [...document.querySelectorAll('#role-dialog input[name="role-base"]')].every((i) => i.disabled), note: document.getElementById('role-builtin-note').textContent, del: document.getElementById('role-delete').hidden }));
    check(fixed.visible && fixed.checked === 'member' && fixed.disabled && /chiar această pagină/.test(fixed.note) && fixed.del, 'a built-in role: the same dialog, "Se deschide ca" shown on its own page but fixed, no delete', fixed);
    await o.fill('#role-name', 'Voluntar');
    await o.fill('#role-emoji', '🙋');
    await o.check('#role-dialog input[name="role-perm"][value="guides"]');
    await o.click('#role-save');
    await o.waitForFunction(() => /Voluntar/.test(document.querySelector('[data-builtin="member"]').textContent));
    check(/🙋 Voluntar · modificat/.test(await o.textContent('[data-builtin="member"]')) && /Ghiduri/.test(await o.textContent('[data-builtin="member"]')), 'the list: the new name, "modificat", the new right');
    await o.click('#tab-people');
    await o.locator('#team .team-row', { hasText: 'Membru' }).locator('.person-open').click();
    await o.waitForFunction(() => /🙋 Voluntar/.test((document.querySelector('#person-dialog[open] .role-pill') || {}).textContent || ''));
    check(true, 'Echipa: the members show as "🙋 Voluntar"');
    await o.click('#person-close');
    const mv = await signIn('member', { width: 375, lang: 'ro' });
    await mv.goto(`${app.url}/guides`);
    await mv.waitForSelector('#guide-add:not([hidden])');
    check(true, 'the member now has "Ghid nou" (the Ghiduri right)');
    await mv.context().close();
    // back to the default
    await o.click('#tab-roles');
    await o.click('[data-edit-builtin="member"]');
    await o.click('#role-reset');
    await o.waitForFunction(() => !/Voluntar/.test(document.querySelector('[data-builtin="member"]').textContent));
    check(/🎵 Membru/.test(await o.textContent('[data-builtin="member"]')), '"Revino la implicit": Membru again');
    await o.context().close();
  },
};
