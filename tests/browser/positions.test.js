'use strict';

// Stage 7, positions: the seeded list in Setări (owner) and on /positions (leader): add,
// rename, reorder, deactivate; a member sets their positions and phone on "Profilul meu"; the
// owner sees the chips on Echipa and edits them in the person's dialog; the operator has no
// "Poziții în echipă" in the menu. RO 375 / EN 1024.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'positions',
  timeout: 180000,
  async run({ app, signIn, check }) {
    const names = (p) => p.evaluate(() => [...document.querySelectorAll('.position-row .position-name')].map((n) => n.textContent));
    // the owner manages on Echipa -> Poziții (RO 375); /positions lands there
    const l = await signIn('owner', { width: 375, lang: 'ro' });
    await l.goto(`${app.url}/positions`);
    await l.waitForSelector('#positions-panel:not([hidden]) .position-row');
    check(/\/team$/.test(new URL(l.url()).pathname) && (await names(l)).join(',') === 'Voce,Chitară,Pian/Clape,Bas,Tobe,Operator,Prezentator', 'seeded positions on Echipa -> Poziții (/positions redirects there)');
    await l.fill('.positions-add input', 'Vioară');
    await l.click('.positions-add button');
    await l.waitForSelector('.position-row:has-text("Vioară")');
    await l.click('.position-row:has-text("Vioară") button[aria-label^="Mută"][aria-label$="mai sus"]');
    await l.waitForFunction(() => document.querySelectorAll('.position-row')[6].textContent.includes('Vioară'));
    check((await names(l))[6] === 'Vioară', 'added, moved up one');
    check(await l.locator('.position-row:has-text("Vioară") .position-emoji').textContent() === '🎻', 'the new position got an emoji guessed from its name (🎻)');
    await l.click('.position-row:has-text("Tobe") button:has-text("Redenumește")');
    await l.fill('.position-rename', 'Tobe / Percuție');
    await l.fill('.position-emoji-input', '🪘');
    await l.press('.position-rename', 'Enter');
    await l.waitForSelector('.position-row:has-text("Tobe / Percuție")');
    check(await l.locator('.position-row:has-text("Tobe / Percuție") .position-emoji').textContent() === '🪘', 'renamed with a new emoji (🪘)');
    await l.click('.position-row:has-text("Prezentator") button:has-text("Dezactivează")');
    await l.waitForSelector('.position-row.inactive');
    check(await l.locator('.position-row.inactive .position-name').textContent() === 'Prezentator', 'renamed inline; "Prezentator" deactivated (kept, struck through)');
    const a = await layoutAudit(l, 'main');
    check(!a.overflow && !a.small.length, 'positions 375: no overflow, targets >= 44 px', a);
    check(await l.evaluate(() => !document.querySelector('#directory') || document.getElementById('directory').hidden), 'owner: no directory list (the accounts list instead)');
    await l.context().close();
    // the operator: no menu row, /positions redirects
    const op = await signIn('operator', { width: 1024 });
    await op.goto(`${app.url}/positions`);
    await wait(300);
    check(new URL(op.url()).pathname === '/team' && await op.waitForSelector('#directory .directory-row', { timeout: 5000 }).then(() => true, () => false), 'operator: /positions redirects to Echipa (the directory, no editor)');
    await op.context().close();
    // a member: the profile (EN 1024)
    const m = await signIn('member', { width: 1024, lang: 'en' });
    await m.goto(`${app.url}/app`);
    await m.waitForSelector('#app-shell .shell-label:not(:empty)');
    await m.click('.shell-more');
    await m.waitForSelector('#shell-panel:not([hidden])');
    const menu = await m.evaluate(() => [...document.querySelectorAll('#shell-panel li:not([hidden]) .shell-row[data-page]')].map((x) => x.dataset.page));
    check(menu.includes('profile') && !menu.includes('positions'), 'member menu: "Profilul meu", no "Poziții în echipă"', menu);
    await m.click('#shell-panel .shell-row[data-page="profile"]');
    await m.waitForSelector('#profile-form:not([hidden])');
    const boxes = await m.evaluate(() => [...document.querySelectorAll('#p-positions label')].map((x) => x.textContent));
    check(boxes.length === 7 && !boxes.some((b) => b.endsWith('Prezentator')) && boxes.includes('🎻 Vioară'), 'profile: the active positions as checkboxes (no deactivated one)', boxes);
    await m.click('#p-positions label:has-text("Vioară") input');
    await m.click('#p-positions label:has-text("Voce") input');
    await m.fill('#p-phone', '+40 700 123 456');
    await m.click('#submit');
    await m.waitForFunction(() => /saved/i.test(document.getElementById('message').textContent));
    const saved = (await app.api(app.cookies.member, 'GET', '/api/me/profile')).body.profile;
    check(saved.positionIds.length === 2 && saved.phone === '+40 700 123 456', 'profile saved: two positions and the phone', saved);
    const am = await layoutAudit(m, 'main');
    check(!am.overflow && !am.small.length, 'profile 1024: targets >= 44 px', am);
    await m.context().close();
    // the owner: chips on Echipa, edits them; the Poziții tab has the editor
    const o = await signIn('owner', { width: 1024, lang: 'ro' });
    await o.goto(`${app.url}/team`);
    await o.waitForSelector('#team .team-row');
    const row = o.locator('#team .team-row', { hasText: 'Membru' });
    const chips = await row.locator('.position-pill').allTextContents();
    check(chips.join(',') === '🎤 Voce,🎻 Vioară', 'Echipa: the member\'s positions as chips, with their emoji', chips);
    await row.locator('button:has-text("Editează")').click();
    await o.waitForSelector('#edit-dialog[open]');
    await o.click('#edit-positions label:has-text("Bas") input');
    await o.click('#edit-submit');
    await o.waitForFunction(() => !document.getElementById('edit-dialog').open);
    await wait(200);
    check((await row.locator('.position-pill').allTextContents()).includes('🎸 Bas'), 'the owner adds "Bas" from the person\'s dialog');
    await o.goto(`${app.url}/team?tab=positions`);
    await o.waitForSelector('#positions-editor .position-row');
    check((await names(o)).length === 8 && await o.locator('#positions-editor .positions-add').isVisible(), 'Echipa → Poziții: the same editor (Setări has none any more)');
  },
};
