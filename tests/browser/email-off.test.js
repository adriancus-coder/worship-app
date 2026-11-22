'use strict';

// Email not configured (no RESEND_API_KEY): the login page has no "Ai uitat parola?", the
// team page shows no email buttons and "+ Adaugă persoană" offers only the temporary-password
// card, the settings card says email is off. RO 375 / EN 1024.

module.exports = {
  name: 'email-off',
  timeout: 120000,
  async run({ app, signIn, check }) {
    for (const [lang, width] of [['ro', 375], ['en', 1024]]) {
      const tag = `[${lang} ${width}]`;
      const p = await signIn('owner', { width, lang });
      await p.goto(`${app.url}/team`);
      await p.waitForSelector('#team .team-row');
      const mails = await p.locator('#team .team-actions [data-icon="mail"]').count();
      check(mails === 0, `${tag} team rows: no "Retrimite invitația" / "Trimite link de resetare"`, mails);
      await p.click('#add-person');
      await p.waitForSelector('#add-dialog[open]');
      check((await p.locator('#add-positions input').count()) >= 5 && !(await p.isHidden('#add-positions-choice')), `${tag} + Adaugă persoană: the team positions to tick, as in Editează`);
      await p.waitForSelector('#add-dialog[open]');
      check(await p.isHidden('#add-submit-email') && await p.isHidden('#add-email-hint') && (await p.getAttribute('#add-submit', 'class')) === '', `${tag} + Adaugă persoană: only "Creează contul", primary`);
      // created with a position ticked: the account has it in the profile at once
      await p.fill('#add-name', `Nou ${lang}`);
      await p.fill('#add-email', `nou-${lang}@x.ro`);
      await p.click('#add-positions label:first-child input');
      await p.click('#add-submit');
      await p.waitForSelector('#result-dialog[open]');
      const created = (await app.api(app.cookies.owner, 'GET', '/api/team')).body.users.find((u) => u.name === `Nou ${lang}`);
      const firstPosition = (await app.api(app.cookies.owner, 'GET', '/api/positions')).body.positions[0].id;
      check(created && created.positionIds.join() === String(firstPosition), `${tag} created with a position ticked: the account has it`, created && created.positionIds);
      await p.keyboard.press('Escape');
      await p.goto(`${app.url}/settings`);
      await p.waitForFunction(() => /\S/.test((document.getElementById('email-status') || {}).textContent || ''));
      check(await p.isHidden('#email-test') && await p.isHidden('#email-hint') && /(administratorul platformei|platform administrator)/i.test(await p.textContent('#email-status')), `${tag} settings: one line "se configurează de administratorul platformei", no hint, no test button`);
      // the settings buttons: stacked full width at 375, side by side at 1024
      const rows = await p.evaluate(() => [...document.querySelectorAll('#backup-download, #email-card .form-actions > *, .settings-section .form-actions .file-button')]
        .filter((b) => b.getClientRects().length).map((b) => { const r = b.getBoundingClientRect(); const pr = b.parentElement.getBoundingClientRect(); return { w: Math.round(r.width), pw: Math.round(pr.width), h: Math.round(r.height) }; }));
      check(rows.length > 0 && rows.every((r) => (width < 480 ? r.w >= r.pw - 2 : true) && r.h <= 56), `${tag} settings buttons: ${width < 480 ? 'full width, one line' : 'side by side, one line'}`, rows);
      await p.request.post(`${app.url}/api/auth/logout`);
      await p.goto(`${app.url}/login`);
      await p.waitForSelector('#login-form button[type=submit]');
      await p.waitForTimeout(300); // the features request
      check(await p.isHidden('#forgot-row'), `${tag} login: no "Ai uitat parola?"`);
      await p.goto(`${app.url}/login?forgot=1`);
      await p.waitForTimeout(300);
      check(await p.isHidden('#forgot-form') && !(await p.isHidden('#login-form')), `${tag} login?forgot=1: still the sign-in form`);
      await p.context().close();
    }
  },
};
