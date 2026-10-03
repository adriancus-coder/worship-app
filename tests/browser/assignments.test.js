'use strict';

// Stage 7, the team of an event: the leader assigns three people in the editor's "Echipa" tab
// (the suggestions first), members see the card on the event page and "Ești programat" on the
// home card, one accepts, one declines with a note; the leader's summary and the declined row
// stand out; the operator sees the card but has no Echipa tab. RO 375 / EN 1024.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'assignments',
  timeout: 240000,
  async run({ app, signIn, check }) {
    const owner = app.cookies.owner;
    const E = app.seed.eventId; // today's event: the home card's top event
    const positions = (await app.api(owner, 'GET', '/api/positions')).body.positions;
    const id = (name) => positions.find((p) => p.name === name).id;
    const users = (await app.api(owner, 'GET', '/api/team')).body.users;
    const uid = (email) => users.find((u) => u.email === email).id;
    // the member's usual position: Chitară; the operator: Operator
    await app.api(owner, 'PUT', `/api/team/${uid('m@x.ro')}/positions`, { positionIds: [id('Chitară')] });
    await app.api(owner, 'PUT', `/api/team/${uid('op@x.ro')}/positions`, { positionIds: [id('Operator')] });

    // the leader assigns (RO 375)
    const l = await signIn('leader', { width: 375, lang: 'ro' });
    await l.goto(`${app.url}/events/${E}/edit`);
    await l.waitForSelector('#editor-tabs:not([hidden])');
    await l.click('#tab-team');
    await l.waitForSelector('#team-panel:not([hidden]) .team-position');
    const groups = await l.evaluate(() => [...document.querySelectorAll('.team-position')].map((g) => ({ name: g.querySelector('h3').textContent, options: [...g.querySelectorAll('optgroup')].map((o) => `${o.label}: ${[...o.querySelectorAll('option')].map((x) => x.textContent).join('/')}`) })));
    const chitara = groups.find((g) => g.name === '🎸 Chitară');
    check(groups.length >= 7 && chitara && /Cu această poziție: Membru/.test(chitara.options[0]) && /Alții/.test(chitara.options[1]), 'Echipa tab: one picker per position, the people with the position first', chitara);
    const pick = async (position, name) => {
      const group = l.locator(`.team-position:has(h3:text-matches("(^| )${position}$"))`);
      const value = await group.locator(`option:has-text("${name}")`).first().getAttribute('value');
      await group.locator('select').selectOption(value);
      await group.locator(`.assign-row:has-text("${name}")`).waitFor();
    };
    await pick('Chitară', 'Membru');
    await pick('Operator', 'Operator');
    await pick('Voce', 'Prezentator');
    const summary = await l.textContent('#team-edit-summary');
    check(/0 confirmați · 3 așteaptă · 0 nu poate/.test(summary) && (await l.textContent('#tab-team-count')) === '3', `leader: three assigned, "${summary}", the tab counts 3`);
    check(!(await l.isDisabled('#send-schedule')), '"Trimite programarea" is enabled with 3 pending');
    const a = await layoutAudit(l, '#team-panel');
    check(!a.overflow && !a.small.length, 'Echipa tab 375: no overflow, targets >= 44 px', a);
    await l.click('#send-schedule');
    await l.waitForFunction(() => /Trimis la 3/.test(document.querySelector('#team-panel .assign-message').textContent));
    check(await l.isDisabled('#send-schedule'), 'sent: the button rests until a new row');

    // the member: home card + event page (EN 1024)
    const m = await signIn('member', { width: 1024, lang: 'en' });
    await m.goto(`${app.url}/app`);
    await m.waitForSelector('.now-assignment');
    check(/You are scheduled: 🎸 Chitară/.test(await m.textContent('.now-assignment')) && await m.locator('.now-assignment button[data-answer]').count() === 2, 'home card: "You are scheduled: Chitară" with I’m in / I can’t');
    await m.goto(`${app.url}/events/${E}`);
    await m.waitForSelector('#tab-team:not([hidden])');
    await m.click('#tab-team');
    await m.waitForSelector('#team-card .team-card');
    const mineRow = m.locator('#team-card .assign-row.mine');
    check(await mineRow.count() === 1 && await m.locator('#team-card .assign-row').count() === 3 && await m.locator('#team-edit .team-position').count() === 0, 'event page: the Echipa tab with the card (3 rows, my row marked), no assigning for a member');
    await mineRow.locator('.assign-note').fill('Only until 11');
    await mineRow.locator('button[data-answer="accepted"]').click();
    await m.waitForFunction(() => /Your answer was sent/.test(document.querySelector('#team-card .assign-message').textContent));
    check(/confirmed/.test(await m.locator('#team-card .assign-row.mine .assign-pill').textContent()), 'member: "I’m in" -> confirmed');
    const am = await layoutAudit(m, '#team-card');
    check(!am.overflow && !am.small.length, 'team card 1024: targets >= 44 px', am);
    // the presenter declines with a note from the home card + event page
    const pr = await signIn('presenter', { width: 375, lang: 'ro' });
    await pr.goto(`${app.url}/events/${E}`);
    await pr.click('#tab-team');
    await pr.waitForSelector('#team-card .assign-row.mine');
    await pr.locator('#team-card .assign-row.mine .assign-note').fill('Sunt plecat');
    await pr.locator('#team-card .assign-row.mine button[data-answer="declined"]').click();
    await pr.waitForFunction(() => /nu poate/.test(document.querySelector('#team-card .assign-row.mine .assign-pill').textContent));
    check(true, 'presenter: "Nu pot" with a note');
    // the operator: the card, the summary, no tab
    const op = await signIn('operator', { width: 1024 });
    await op.goto(`${app.url}/events/${E}/edit`);
    await op.waitForSelector('#team-summary:not([hidden])');
    await op.click('#team-summary'); // the summary opens the Echipa tab
    await op.waitForSelector('#team-card .team-card');
    check(await op.locator('#team-edit .team-position').count() === 0 && /1 confirmați · 1 așteaptă · 1 nu poate/.test(await op.textContent('#team-summary')), 'operator in the editor: the Echipa tab shows the card (no assigning) and the summary "1 confirmați · 1 așteaptă · 1 nu poate"', await op.textContent('#team-summary'));
    check((await app.api(app.cookies.operator, 'PUT', `/api/events/${E}/assignments`, { assignments: [] })).status === 403, 'operator: cannot assign (403)');
    // the leader: the declined row stands out with the note; the home summary
    await l.reload();
    await l.waitForSelector('#editor-tabs:not([hidden])');
    await l.click('#tab-team');
    await l.waitForSelector('.assign-row-declined');
    const declined = await l.evaluate(() => { const r = document.querySelector('.assign-row-declined'); return { text: r.textContent, red: getComputedStyle(r).borderTopColor }; });
    check(/Prezentator/.test(declined.text) && /Sunt plecat/.test(declined.text) && /alege pe altcineva/.test(declined.text), 'leader: the declined row is highlighted with the note and "alege pe altcineva"', declined);
    check(/1 confirmați · 1 așteaptă · 1 nu poate/.test(await l.textContent('#team-edit-summary')), 'leader summary "1 confirmați · 1 așteaptă · 1 nu poate"');
    await l.goto(`${app.url}/app`);
    await l.waitForSelector('.now-team-summary');
    check(/1 confirmați · 1 așteaptă · 1 nu poate/.test(await l.textContent('.now-team-summary')), 'home card (leader): the team summary');
  },
};
