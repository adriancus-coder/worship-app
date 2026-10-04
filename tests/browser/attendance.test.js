'use strict';

// Participation: the leader (RO 375) sends "Trimite invitația" to the whole team from the
// editor's Echipa tab, then the button reminds those without an answer; the member (EN 1024)
// answers on the home card (Maybe: the chosen option filled with the accent and checked), then
// changes to Yes with a note on the event page; the leader's picker lists first the ones who
// come, and a person who said "Vin" starts confirmed on the position.

const { layoutAudit } = require('./harness');

module.exports = {
  name: 'attendance',
  timeout: 240000,
  async run({ app, signIn, check }) {
    const E = app.seed.eventId; // today's event: the home card's top event
    const active = (await app.api(app.cookies.owner, 'GET', '/api/team')).body.users.filter((u) => u.active).length;
    // the chosen option: the accent fill (the token), the check mark, bold
    const chosen = (page, sel) => page.$eval(sel, (b) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--accent-fill)';
      document.body.append(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();
      const cs = getComputedStyle(b);
      return { pressed: b.getAttribute('aria-pressed'), accent: cs.backgroundColor === accent, check: getComputedStyle(b, '::before').content !== 'none', bold: Number(cs.fontWeight) >= 700 };
    });

    // the leader invites (RO 375)
    const l = await signIn('leader', { width: 375, lang: 'ro' });
    await l.goto(`${app.url}/events/${E}/edit`);
    await l.waitForSelector('#editor-tabs:not([hidden])');
    await l.click('#tab-team');
    await l.waitForSelector('#team-panel:not([hidden]) .attend');
    check(/nu a fost trimisă/.test(await l.textContent('#attend-summary')) && (await l.textContent('#send-invite')).trim() === 'Trimite invitația', 'not invited yet: "Trimite invitația"');
    await l.click('#send-invite');
    await l.waitForFunction((n) => new RegExp(`Invitația a plecat la ${n} persoane`).test(document.querySelector('#team-panel .assign-message').textContent), active);
    check(/Reamintește celor fără răspuns \(\d+\)/.test(await l.textContent('#send-invite')) && /fără răspuns/.test(await l.textContent('#attend-summary')), `sent to all ${active}; the button now reminds`);
    const a = await layoutAudit(l, '#team-panel');
    check(!a.overflow && !a.small.length, 'Echipa tab 375: no overflow, targets >= 44 px', a);
    await l.context().close();

    // the member answers (EN 1024): home card "Maybe", then "Yes" with a note on the event page
    const m = await signIn('member', { width: 1024, lang: 'en' });
    await m.goto(`${app.url}/app`);
    await m.waitForSelector('.now-attend');
    check(/Are you coming/.test(await m.textContent('.now-attend')) && await m.locator('.now-attend [aria-pressed="true"]').count() === 0, 'home card: "Are you coming?" Yes / Maybe / No, nothing chosen yet');
    await m.click('.now-attend [data-answer="maybe"]');
    await m.waitForSelector('.now-attend [data-answer="maybe"][aria-pressed="true"]');
    const maybe = await chosen(m, '.now-attend [data-answer="maybe"]');
    const other = await chosen(m, '.now-attend [data-answer="accepted"]');
    check(maybe.accent && maybe.check && maybe.bold && !other.accent && other.pressed === 'false', 'the chosen answer is filled with the accent, checked and bold; the others are flat', { maybe, other });
    await m.goto(`${app.url}/events/${E}`);
    await m.click('#tab-team');
    await m.waitForSelector('#team-card .attend-me [data-answer="maybe"][aria-pressed="true"]');
    await m.fill('#attend-note', 'Until 11');
    await m.click('#team-card .attend-me [data-answer="accepted"]');
    await m.waitForSelector('#team-card .attend-me [data-answer="accepted"][aria-pressed="true"]');
    check(/1 coming/.test(await m.textContent('#attend-summary')) && /Coming · 1/.test(await m.textContent('#team-card .attend-list')), 'event page: changed to Yes; the summary and the list follow');
    const b = await layoutAudit(m, '#team-card');
    check(!b.overflow && !b.small.length, 'team card 1024: no overflow, targets >= 44 px', b);
    await m.context().close();

    // the leader's picker: the ones who come first; on the position they start confirmed
    const l2 = await signIn('leader', { width: 1024, lang: 'ro' });
    await l2.goto(`${app.url}/events/${E}/edit`);
    await l2.click('#tab-team');
    await l2.waitForSelector('#team-panel:not([hidden]) .team-position');
    const group = l2.locator('.team-position:has(h3:text-matches("(^| )Voce$"))');
    const first = await group.locator('optgroup').first().getAttribute('label');
    check(first === 'Vin la eveniment' && /Membru/.test(await group.locator('optgroup').first().textContent()), 'the picker: "Vin la eveniment" first, with the member', first);
    const value = await group.locator('optgroup').first().locator('option:has-text("Membru")').getAttribute('value');
    await group.locator('select').selectOption(value);
    await group.locator('.assign-row:has-text("Membru")').waitFor();
    check(/confirmat/.test(await group.locator('.assign-row:has-text("Membru") .assign-pill').textContent()), 'said "Vin": confirmed on the position at once');
    await l2.context().close();
  },
};
