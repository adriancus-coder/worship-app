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
      check(await p.isHidden('#add-submit-email') && await p.isHidden('#add-email-hint') && (await p.getAttribute('#add-submit', 'class')) === '', `${tag} + Adaugă persoană: only "Creează contul", primary`);
      await p.keyboard.press('Escape');
      await p.goto(`${app.url}/settings`);
      await p.waitForFunction(() => /\S/.test((document.getElementById('email-status') || {}).textContent || ''));
      check(await p.isHidden('#email-test') && /(dezactivat|disabled)/i.test(await p.textContent('#email-status')), `${tag} settings: the email card says off, no test button`);
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
