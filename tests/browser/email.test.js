'use strict';

// Email configured (a test key, api.resend.com mocked by fixtures/mock-resend.js): the owner
// adds a person with "Trimite invitația pe email", the link sets the name and password and
// signs in, a second use fails, an expired one fails; "Retrimite invitația" only while the
// person never signed in; "Trimite link de resetare" -> the link sets a new password and ends
// the other sessions; "Ai uitat parola?" answers the same for an unknown email, then rate
// limits; the temporary-password card still works. RO / EN; 375 / 1024.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { FIXTURES, layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'email',
  timeout: 240000,
  app: {
    preload: [path.join(FIXTURES, 'mock-resend.js')],
    env: { RESEND_API_KEY: 're_test_key', EMAIL_FROM: 'Worship <w@test.ro>' },
  },
  async run({ app, browser, signIn, check }) {
    const outbox = () => {
      const file = path.join(app.dataDir, 'outbox.jsonl');
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    };
    const lastMail = () => outbox().slice(-1)[0];
    const linkIn = (mail, kind) => (mail && new RegExp(`${app.url}/${kind}/[0-9a-f]{64}`).exec(mail.text) || [null])[0];
    const teamRow = (p, name) => p.locator('#team .team-row', { has: p.locator(`.team-name >> text="${name}"`) });
    const me = async (p) => { const r = await p.request.get(`${app.url}/api/auth/me`); return r.ok() ? r.json() : null; };
    const newPage = async (width) => {
      const context = await browser.newContext({ viewport: { width, height: width < 600 ? 667 : 820 }, hasTouch: width < 600, isMobile: width < 600 });
      const page = await context.newPage();
      page.on('pageerror', (err) => check(false, `page error: ${err.message}`));
      return page;
    };

    // --- the owner adds Maria by email (RO, 1024) ------------------------------------------
    const owner = await signIn('owner', { width: 1024, lang: 'ro' });
    await owner.goto(`${app.url}/team`);
    await owner.waitForSelector('#team .team-row');
    let mails = await owner.locator('#team .team-actions [data-icon="mail"]').count();
    check(mails === 4, 'team rows (four people who signed in at the seed): "Trimite link de resetare" each, no "Retrimite"', mails);
    await owner.click('#add-person');
    await owner.waitForSelector('#add-dialog[open]');
    check(!(await owner.isHidden('#add-submit-email')) && !(await owner.getAttribute('#add-submit-email', 'class')) && (await owner.getAttribute('#add-submit', 'class')) === 'secondary' && !(await owner.isHidden('#add-email-hint')), '+ Adaugă persoană: "Trimite invitația pe email" primary, "Creează contul" secondary, the hint');
    const a0 = await layoutAudit(owner, '#add-dialog');
    check(!a0.overflow && !a0.small.length, 'add dialog: targets >= 44 px', a0);
    await owner.fill('#add-name', 'Maria');
    await owner.fill('#add-email', 'maria@x.ro');
    await owner.click('input[name=add-role][value=leader]');
    await owner.click('#add-submit-email');
    await owner.waitForFunction(() => /maria@x\.ro/.test(document.getElementById('page-message').textContent));
    check(/Invitația a fost trimisă la maria@x.ro/.test(await owner.textContent('#page-message')) && await owner.isHidden('#result-dialog'), 'the page says the invitation went to maria@x.ro; no temporary-password card');
    let mail = lastMail();
    const inviteLink = linkIn(mail, 'invite');
    check(mail && mail.to === 'maria@x.ro' && /Invitație/.test(mail.subject) && /Ana te-a adăugat/.test(mail.text) && /Biserica Harul/.test(mail.text) && /7 zile/.test(mail.text) && inviteLink && mail.html.includes(inviteLink), 'the invitation email: who, church, link, 7 days', mail && { to: mail.to, subject: mail.subject });
    const mariaRow = teamRow(owner, 'Maria');
    check(await mariaRow.locator('button:has-text("Retrimite invitația")').count() === 1 && await mariaRow.locator('button:has-text("Trimite link de resetare")').count() === 1, 'Maria\'s row: "Retrimite invitația" and "Trimite link de resetare"');
    // resend: a new link, the old one spent
    await mariaRow.locator('button:has-text("Retrimite invitația")').click();
    await owner.waitForFunction((n) => document.getElementById('page-message').textContent.includes('maria@x.ro') && n, outbox().length);
    await wait(200);
    const inviteLink2 = linkIn(lastMail(), 'invite');
    check(inviteLink2 && inviteLink2 !== inviteLink && outbox().length === 2, '"Retrimite invitația": a second email with a new link');
    const spentState = await app.api(null, 'GET', inviteLink.replace(`${app.url}/invite/`, '/api/invite/'));
    check(spentState.status === 410 && spentState.body.code === 'tokenUsed', 'the first link is spent by the second (410 tokenUsed)', spentState);

    // --- Maria opens the link on her phone (375) -------------------------------------------
    const maria = await newPage(375);
    await maria.goto(inviteLink2);
    await maria.waitForSelector('#token-form:not([hidden])');
    check((await maria.inputValue('#name')) === 'Maria' && /Biserica Harul/.test(await maria.textContent('#intro')) && /maria@x\.ro/.test(await maria.textContent('#intro')), 'the invitation page: name prefilled, church and email in the intro');
    const a1 = await layoutAudit(maria, 'main');
    check(!a1.overflow && !a1.small.length, 'invitation page 375: no overflow, targets >= 44 px', a1);
    await maria.click('[data-lang=en]');
    await maria.waitForFunction(() => document.getElementById('heading').textContent === 'Welcome');
    check((await maria.textContent('#submit')) === 'Enter the app', 'EN: heading and button switch');
    await maria.click('[data-lang=ro]');
    await maria.fill('#name', 'Maria Pop');
    await maria.fill('#password', 'short');
    await maria.fill('#confirm', 'short');
    await maria.click('#submit');
    check(/10/.test(await maria.textContent('#message')), 'a short password is refused on the page');
    await maria.fill('#password', 'parola-mariei-1');
    await maria.fill('#confirm', 'parola-mariei-2');
    await maria.click('#submit');
    check(/nu sunt la fel/.test(await maria.textContent('#message')), 'mismatched passwords are refused');
    await maria.fill('#confirm', 'parola-mariei-1');
    await maria.click('#submit');
    await maria.waitForURL('**/app');
    await maria.waitForSelector('#now .now-card');
    let m = await me(maria);
    check(m && m.user.email === 'maria@x.ro' && m.user.name === 'Maria Pop' && m.user.role === 'leader' && !m.user.mustChangePassword, 'signed in as Maria Pop (leader), no forced password change', m && m.user);
    check((await app.api(null, 'POST', '/api/auth/login', { email: 'maria@x.ro', password: 'parola-mariei-1' })).status === 200, 'the chosen password signs in');
    // second use
    const maria2 = await newPage(1024);
    await maria2.goto(inviteLink2);
    await maria2.waitForSelector('#problem:not([hidden])');
    check(/folosit deja/.test(await maria2.textContent('#problem-text')) && /persoanei care te-a invitat/.test(await maria2.textContent('#problem-hint')) && await maria2.isHidden('#new-link') && await maria2.isHidden('#token-form'), 'the link a second time: "folosit deja", ask the owner, no "Cere un link nou"');
    // the owner's page: Maria signed in -> no "Retrimite", and the API says 409
    await owner.reload();
    await owner.waitForSelector('#team .team-row');
    check(await teamRow(owner, 'Maria Pop').locator('button:has-text("Retrimite invitația")').count() === 0, 'after the first sign-in: no "Retrimite invitația" for Maria');
    const mariaId = (await app.api(app.cookies.owner, 'GET', '/api/team')).body.users.find((u) => u.email === 'maria@x.ro').id;
    const again = await app.api(app.cookies.owner, 'POST', `/api/team/${mariaId}/invite`);
    check(again.status === 409 && again.body.code === 'alreadySignedIn', 'POST invite for someone who signed in: 409 alreadySignedIn', again);

    // --- an expired invitation (Ion, via the API, the clock moved in the database) -----------
    const ion = (await app.api(app.cookies.owner, 'POST', '/api/team', { name: 'Ion', email: 'ion@x.ro', role: 'member' })).body.user;
    const sent = await app.api(app.cookies.owner, 'POST', `/api/team/${ion.id}/invite`);
    check(sent.status === 200 && sent.body.sentTo === 'ion@x.ro', 'POST /api/team/:id/invite sends', sent.body);
    const ionLink = linkIn(lastMail(), 'invite');
    const db = new Database(path.join(app.dataDir, 'worship.db'));
    db.prepare('UPDATE user_tokens SET expires_at = ? WHERE user_id = ?').run(Date.now() - 1000, ion.id);
    db.close();
    await maria2.goto(ionLink);
    await maria2.waitForSelector('#problem:not([hidden])');
    check(/a expirat/.test(await maria2.textContent('#problem-text')), 'an expired invitation: "Linkul a expirat"');
    const post = await app.api(null, 'POST', ionLink.replace(`${app.url}/invite/`, '/api/invite/'), { name: 'Ion', password: 'parola-lunga-9' });
    check(post.status === 410 && post.body.code === 'tokenExpired', 'POST on the expired link: 410 tokenExpired', post);
    await maria2.goto(`${app.url}/invite/not-a-token`);
    await maria2.waitForSelector('#problem:not([hidden])');
    check(/nu este valid/.test(await maria2.textContent('#problem-text')), 'garbage: "Linkul nu este valid"');

    // --- the reset link for Maria: her other sessions end ------------------------------------
    const mariaOther = /wa_sid=[0-9a-f]+/.exec((await app.api(null, 'POST', '/api/auth/login', { email: 'maria@x.ro', password: 'parola-mariei-1' })).headers.get('set-cookie'))[0];
    const before = outbox().length;
    await teamRow(owner, 'Maria Pop').locator('button:has-text("Trimite link de resetare")').click();
    await owner.waitForFunction(() => /resetare a fost trimis la maria@x\.ro/.test(document.getElementById('page-message').textContent));
    await wait(200);
    mail = lastMail();
    const resetLink = linkIn(mail, 'reset');
    check(outbox().length === before + 1 && mail.to === 'maria@x.ro' && /Resetarea parolei/.test(mail.subject) && /o oră/.test(mail.text) && /ignoră acest email/.test(mail.text) && resetLink, 'the reset email: link, one hour, "ignoră dacă nu ai cerut"', mail && { to: mail.to, subject: mail.subject });
    await maria2.goto(resetLink);
    await maria2.waitForSelector('#token-form:not([hidden])');
    check(await maria2.isHidden('#name-field') && /maria@x\.ro/.test(await maria2.textContent('#intro')), 'the reset page: no name field, the account in the intro');
    const a2 = await layoutAudit(maria2, 'main');
    check(!a2.overflow && !a2.small.length, 'reset page 1024: targets >= 44 px', a2);
    await maria2.fill('#password', 'parola-noua-maria');
    await maria2.fill('#confirm', 'parola-noua-maria');
    await maria2.click('#submit');
    await maria2.waitForURL('**/app');
    await maria2.waitForSelector('#now .now-card');
    m = await me(maria2);
    check(m && m.user.email === 'maria@x.ro', 'signed in on the device that used the reset link');
    check((await app.api(mariaOther, 'GET', '/api/auth/me')).status === 401, 'Maria\'s other session (API cookie) ended');
    check(await me(maria) === null, 'Maria\'s phone session ended too');
    check((await app.api(null, 'POST', '/api/auth/login', { email: 'maria@x.ro', password: 'parola-mariei-1' })).status === 401 && (await app.api(null, 'POST', '/api/auth/login', { email: 'maria@x.ro', password: 'parola-noua-maria' })).status === 200, 'old password refused, new one accepted');
    await maria2.goto(resetLink);
    await maria2.waitForSelector('#problem:not([hidden])');
    check(/folosit deja/.test(await maria2.textContent('#problem-text')) && !(await maria2.isHidden('#new-link')) && (await maria2.getAttribute('#new-link', 'href')) === '/login?forgot=1', 'the reset link a second time: "folosit deja" with "Cere un link nou"');

    // --- the temporary-password card still works ------------------------------------------
    await owner.click('#add-person');
    await owner.waitForSelector('#add-dialog[open]');
    await owner.fill('#add-name', 'Vasile');
    await owner.fill('#add-email', 'vasile@x.ro');
    await owner.click('#add-submit');
    await owner.waitForSelector('#result-dialog[open]');
    const temp = await owner.textContent('#result-password');
    check(/^[a-zA-Z0-9]{12}$/.test(temp) && (await owner.inputValue('#result-message')).includes('vasile@x.ro') && outbox().length === before + 1, '"Creează contul": the card with the temporary password, no email sent');
    await owner.click('#result-dialog [data-close]');
    await wait(100);
    const a3 = await layoutAudit(owner, '#team');
    check(!a3.overflow && !a3.small.length, 'team rows 1024: no overflow, targets >= 44 px', a3);
    // 375: the same rows
    const ownerPhone = await signIn('owner', { width: 375, lang: 'en' });
    await ownerPhone.goto(`${app.url}/team`);
    await ownerPhone.waitForSelector('#team .team-row');
    check(await teamRow(ownerPhone, 'Vasile').locator('button:has-text("Resend the invitation")').count() === 1 && await teamRow(ownerPhone, 'Vasile').locator('button:has-text("Send a reset link")').count() === 1, 'EN 375: "Resend the invitation" and "Send a reset link" for Vasile');
    const a4 = await layoutAudit(ownerPhone, '#team');
    check(!a4.overflow && !a4.small.length, 'team rows 375: no overflow, targets >= 44 px', a4);
    await ownerPhone.click('#add-person');
    await ownerPhone.waitForSelector('#add-dialog[open]');
    check((await ownerPhone.textContent('#add-submit-email')).trim() === 'Send the invitation by email', 'EN: the email button');
    await ownerPhone.keyboard.press('Escape');
    // --- the same on a church's page on Platformă -------------------------------------------
    const B = (await app.api(app.cookies.owner, 'POST', '/api/platform/admins', { name: 'Biserica B', ownerName: 'Ion B', ownerEmail: 'ion@b.ro' })).body.admin;
    await ownerPhone.goto(`${app.url}/platform/${B.id}?tab=team`);
    await ownerPhone.waitForSelector('#panel-team:not([hidden]) #team .team-row');
    await ownerPhone.click('#add-person');
    await ownerPhone.waitForSelector('#add-dialog[open]');
    check(!(await ownerPhone.isHidden('#add-submit-email')) && (await ownerPhone.getAttribute('#add-submit', 'class')) === 'secondary', 'Platformă church: "Send the invitation by email" primary in + Add person');
    await ownerPhone.fill('#add-name', 'Dorina');
    await ownerPhone.fill('#add-email', 'dorina@b.ro');
    await ownerPhone.click('#add-submit-email');
    await ownerPhone.waitForFunction(() => /dorina@b\.ro/.test(document.getElementById('page-message').textContent));
    mail = lastMail();
    check(mail.to === 'dorina@b.ro' && /Biserica B/.test(mail.text) && linkIn(mail, 'invite') && await ownerPhone.isHidden('#result-dialog'), 'Platformă church: the invitation for church B went out, no card', mail && { to: mail.to });
    const dorina = teamRow(ownerPhone, 'Dorina');
    check(await dorina.locator('button:has-text("Resend the invitation")').count() === 1 && await dorina.locator('button:has-text("Send a reset link")').count() === 1, 'Platformă church: "Resend the invitation" and "Send a reset link" on the row');
    await dorina.locator('button:has-text("Send a reset link")').click();
    await ownerPhone.waitForFunction(() => /reset link was sent to dorina@b\.ro/.test(document.getElementById('page-message').textContent));
    check(linkIn(lastMail(), 'reset') !== null, 'Platformă church: the reset link went out');
    await ownerPhone.request.post(`${app.url}/api/auth/logout`);

    // --- "Ai uitat parola?" (last: it spends the hourly limit of this IP) -------------------
    await ownerPhone.goto(`${app.url}/login`);
    await ownerPhone.waitForSelector('#forgot-row:not([hidden])');
    await ownerPhone.click('#forgot-link');
    await ownerPhone.waitForSelector('#forgot-form:not([hidden])');
    check(await ownerPhone.isHidden('#login-form') && (await ownerPhone.textContent('#forgot-heading')) === 'Forgotten password', 'EN login: "Forgot your password?" opens the email form');
    const a5 = await layoutAudit(ownerPhone, 'main');
    check(!a5.overflow && !a5.small.length, 'forgot form 375: targets >= 44 px', a5);
    const count0 = outbox().length;
    await ownerPhone.fill('#forgot-email', 'nobody@x.ro');
    await ownerPhone.click('#forgot-submit');
    await ownerPhone.waitForFunction(() => /\S/.test(document.getElementById('forgot-message').textContent));
    const unknownAnswer = await ownerPhone.textContent('#forgot-message');
    check(/If an account with this email exists/.test(unknownAnswer) && outbox().length === count0, 'unknown email: the neutral answer, nothing sent');
    await ownerPhone.click('#forgot-back');
    await ownerPhone.waitForSelector('#login-form:not([hidden])');
    await ownerPhone.click('[data-lang=ro]');
    await ownerPhone.click('#forgot-link');
    await ownerPhone.fill('#forgot-email', 'm@x.ro');
    await ownerPhone.click('#forgot-submit');
    await ownerPhone.waitForFunction(() => /\S/.test(document.getElementById('forgot-message').textContent));
    await wait(200);
    const knownAnswer = await ownerPhone.textContent('#forgot-message');
    mail = lastMail();
    check(/Dacă există un cont cu acest email/.test(knownAnswer) && outbox().length === count0 + 1 && mail.to === 'm@x.ro' && linkIn(mail, 'reset'), 'a real email: the same kind of answer, a reset email sent (RO)');
    // the limit: 5 an hour per IP (two spent above) and per email
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await app.api(null, 'POST', '/api/auth/forgot', { email: `x${i}@x.ro` })).status);
    check(codes.slice(0, 3).every((c) => c === 200) && codes.slice(3).every((c) => c === 429), 'forgot: 5 an hour per IP, then 429', codes);
    await ownerPhone.goto(`${app.url}/login?forgot=1`);
    await ownerPhone.waitForSelector('#forgot-form:not([hidden])');
    check(true, '/login?forgot=1 opens the form directly');
  },
};
