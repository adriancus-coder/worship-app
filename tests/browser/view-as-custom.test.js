'use strict';

// "Vezi aplicația ca" for the church's own roles (migration 061): the owner's switch in Mai
// mult lists the custom roles after the built-in ones; choosing "Școala duminicală" gives
// the member experience with the school right only (the library opens on the school's,
// "Cântare nouă" there, no Echipa), the bar names the role; "Revino la proprietar" restores
// everything. A role deleted meanwhile leaves the owner as owner. RO 375 / EN 1024.

const { wait } = require('./harness');

module.exports = {
  name: 'view-as-custom',
  timeout: 240000,
  async run({ app, signIn, check }) {
    const owner = app.cookies.owner;
    const role = (await app.api(owner, 'POST', '/api/roles', { name: 'Școala duminicală', emoji: '🎒', base: 'member', perms: ['school'] })).body.role;
    const openMenu = async (p) => {
      await p.waitForSelector('#app-shell .shell-label:not(:empty)');
      await p.click('.shell-more');
      await p.waitForSelector('#shell-panel:not([hidden])');
      return p.evaluate(() => [...document.querySelectorAll('#shell-panel [data-view-as]')].filter((b) => !b.closest('[hidden]')).map((b) => `${b.dataset.viewAs}:${b.getAttribute('aria-pressed')}:${b.textContent.trim()}`));
    };
    const bar = (p) => p.evaluate(() => { const b = document.getElementById('view-as-bar'); return b && !b.hidden ? b.textContent : null; });
    for (const [lang, width] of [['ro', 375], ['en', 1024]]) {
      const tag = `[${lang} ${width}]`;
      const p = await signIn('owner', { width, lang });
      await p.goto(`${app.url}/app`);
      const buttons = await openMenu(p);
      check(buttons.length === 6 && buttons[5] === `custom:${role.id}:false:🎒 Școala duminicală`, `${tag} the switch: the four built-in roles, then "🎒 Școala duminicală"`, buttons);
      await p.click(`#shell-panel [data-view-as="custom:${role.id}"]`);
      await p.waitForURL('**/app');
      await p.waitForSelector('#view-as-bar:not([hidden])');
      await p.waitForSelector('#now .now-card');
      const text = await bar(p);
      check(/Școala duminicală/.test(text) && /(Revino la proprietar|Back to owner)/.test(text), `${tag} the bar names the role`, text);
      const me = (await p.evaluate(() => fetch('/api/auth/me').then((r) => r.json()))).user;
      check(me.role === 'member' && me.viewAs === `custom:${role.id}` && me.perms.join() === 'school' && me.customRole.name === 'Școala duminicală', `${tag} the effective role: member with the school right`, me);
      await p.goto(`${app.url}/library`);
      await p.waitForSelector('#songs li, #status:not([hidden])');
      await wait(300);
      const lib = await p.evaluate(() => ({ pressed: document.querySelector('#collection-switch [aria-pressed="true"]').dataset.collection, newSong: !document.getElementById('new-song').hidden, bar: !document.getElementById('view-as-bar').hidden }));
      check(lib.pressed === 'school' && lib.newSong && lib.bar, `${tag} the library opens on the school's, "Cântare nouă" shown, the bar stays`, lib);
      check((await p.evaluate(() => fetch('/api/team').then((r) => r.status))) === 403, `${tag} the team API refuses (no right)`);
      const again = await openMenu(p);
      check(again.some((b) => b.startsWith(`custom:${role.id}:true`)), `${tag} the switch keeps the roles, the school one selected`, again);
      await p.keyboard.press('Escape');
      await wait(200);
      await p.click('#view-as-bar .view-as-back');
      await p.waitForFunction(() => { const b = document.getElementById('view-as-bar'); return b && b.hidden && document.querySelector('#now .now-card'); }, null, { timeout: 8000 });
      check(await bar(p) === null && (await p.evaluate(() => fetch('/api/auth/me').then((r) => r.json()))).user.role === 'owner', `${tag} back to the owner`);
      await p.context().close();
    }
    // the role goes while viewed: the owner is the owner again
    const q = await signIn('owner', { width: 1024, lang: 'ro' });
    await q.goto(`${app.url}/app`);
    await openMenu(q);
    await q.click(`#shell-panel [data-view-as="custom:${role.id}"]`);
    await q.waitForSelector('#view-as-bar:not([hidden])');
    await app.api(owner, 'DELETE', `/api/roles/${role.id}`);
    await q.reload();
    await q.waitForSelector('#now .now-card');
    const after = await q.evaluate(() => fetch('/api/auth/me').then((r) => r.json()));
    check(after.user.role === 'owner' && after.user.viewAs === null && await bar(q) === null, 'the role deleted meanwhile: owner again, no bar', after.user);
  },
};
