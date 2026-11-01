'use strict';

// Acasă -> "▶ Pornește live" in one tap (the operator, the owner: the 'screens' right): the
// event goes live and the console / live page opens; a member's phone follows at once; members
// have "Vezi programul" / "Urmărește live"; with another event already live (started
// elsewhere meanwhile) a confirmation offers to end it first. RO/EN; 375/1024.

const { layoutAudit } = require('./harness');

module.exports = {
  name: 'start-live',
  timeout: 240000,
  async run({ app, browser, signIn, check }) {
    let E = app.seed.eventId;
    const cardAction = (p) => p.evaluate(() => { const b = document.querySelector('#now .now-primary'); return b ? b.textContent : null; });

    for (const [lang, width, role, page] of [['ro', 375, 'operator', 'operator'], ['en', 1024, 'owner', 'live']]) {
      const tag = `[${lang} ${width} ${role}]`;
      const m = await signIn('member', { width: 375, lang });
      await m.reload(); // in the language just saved
      await m.waitForSelector('#now .now-card');
      check(await cardAction(m) === (lang === 'ro' ? 'Vezi programul' : 'See the programme'), `${tag} member: "Vezi programul" before the start`);
      await m.goto(`${app.url}/events/${E}/follow`);
      await m.waitForSelector('#follow:not([hidden])');
      const p = await signIn(role, { width, lang });
      await p.reload();
      await p.waitForSelector('#now .now-card');
      // the operator prepares first and starts second (secondary); the owner starts first
      const expected = role === 'operator' ? (lang === 'ro' ? 'Pregătește' : 'Prepare') : (lang === 'ro' ? 'Pornește live' : 'Start live');
      check(await cardAction(p) === expected && await p.locator(role === 'operator' ? '#start-live.secondary' : '#start-live:not(.secondary)').count() === 1, `${tag} Acasă on the event day: primary "${expected}", "Pornește live" ${role === 'operator' ? 'as the secondary button' : 'primary'}`, await cardAction(p));
      const a = await layoutAudit(p, 'main');
      check(!a.overflow && !a.small.length, `${tag} Acasă: no overflow, targets >= 44 px`, a);
      const t0 = Date.now();
      await p.click('#start-live');
      await p.waitForURL(`**/events/${E}/${page}**`);
      await p.waitForSelector(page === 'live' ? '#live:not([hidden])' : '#console:not([hidden])');
      check((await app.state(E)).status === 'live', `${tag} one tap: the event is live and the ${page === 'live' ? 'live page' : 'console'} is open (${Date.now() - t0} ms)`);
      const follows = await m.waitForFunction(() => (document.querySelector('#slide h1') || {}).textContent === 'Sfânt în G', null, { timeout: 3000 }).then(() => true, () => false);
      check(follows, `${tag} the member phone follows at once`);
      await m.goto(`${app.url}/app`);
      await m.waitForSelector('#now .now-card.live');
      check(await cardAction(m) === (lang === 'ro' ? 'Urmărește live' : 'Follow live'), `${tag} member Acasă: "Urmărește live"`);
      await p.goto(`${app.url}/app`);
      await p.waitForSelector('#now .now-card.live');
      const liveLabel = role === 'operator' ? (lang === 'ro' ? 'Consolă operator' : 'Operator console') : (lang === 'ro' ? 'Intră live' : 'Go live');
      check(await cardAction(p) === liveLabel, `${tag} already live: "${liveLabel}"`, await cardAction(p));
      await app.command({ type: 'event.end', eventId: E });
      // the next round starts from a fresh planned event today (a copy of this one)
      E = (await app.api(app.cookies.owner, 'POST', '/api/events', { name: 'Serviciu duminică', eventDate: app.seed.today, startTime: '10:00', fromEventId: E })).body.event.id;
      await p.context().close();
      await m.context().close();
    }

    // Another event started meanwhile (this home page is cut off, so it still offers "Pornește
    // live"): the confirmation offers to end it, then starts this one.
    const current = E;
    const other = (await app.api(app.cookies.owner, 'POST', '/api/events', { name: 'Repetiție de seară', eventDate: app.seed.today, startTime: '19:00' })).body.event;
    const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
    let blocked = false;
    const links = [];
    await ctx.routeWebSocket(/\/socket\.io\//, (ws) => { if (blocked) return ws.close(); links.push([ws, ws.connectToServer()]); });
    await ctx.route('**/socket.io/**', (route) => (blocked ? route.abort() : route.continue()));
    const p = await ctx.newPage();
    await p.goto(`${app.url}/login`);
    await p.fill('[name=email]', 'op@x.ro'); // starting is the operator's (the leader has no "Pornește live")
    await p.fill('[name=password]', 'parola-lunga-1');
    await p.click('button[type=submit]');
    await p.waitForURL('**/app');
    await p.waitForSelector('#start-live');
    blocked = true;
    for (const [ws, server] of links.splice(0)) { await ws.close().catch(() => {}); await server.close().catch(() => {}); }
    const lead = await app.api(app.cookies.operator, 'POST', `/api/events/${other.id}/start`, {});
    check(lead.status === 200 && lead.body.event.status === 'live', 'another event goes live elsewhere');
    await p.click('#start-live');
    await p.waitForSelector('#switch-dialog[open]');
    check(/Repetiție de seară/.test(await p.textContent('#switch-heading')), 'a confirmation names the live event', await p.textContent('#switch-heading'));
    blocked = false;
    await p.click('#switch-yes');
    await p.waitForURL(`**/events/${current}/operator**`);
    const statuses = await Promise.all([current, other.id].map((id) => app.api(app.cookies.owner, 'GET', `/api/events/${id}`).then((r) => r.body.event.status)));
    check(statuses[0] === 'live' && statuses[1] === 'finished', '"Încheie și pornește": the other one ended, this one live, the console open', statuses);
  },
};
