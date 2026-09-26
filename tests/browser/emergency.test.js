'use strict';

// Emergency mode: with the server gone for more than 5 s the leader page keeps driving the
// projector windows of the same browser from the cached event (positions, black / logo,
// "end of item"); back online its position is pushed when nobody moved meanwhile, and the
// server wins when someone did. The member follow page navigates by hand while offline.

const fs = require('fs');
const path = require('path');
const { FIXTURES, layoutAudit } = require('./harness');

module.exports = {
  name: 'emergency',
  timeout: 240000,
  async run({ app, browser, check }) {
    const { eventId: E, items } = app.seed;
    await app.api(app.cookies.owner, 'PUT', '/api/settings/logo', fs.readFileSync(path.join(FIXTURES, 'logo.png')), { 'Content-Type': 'image/png' });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    // A switch that cuts this browser off the server (socket.io over WebSocket and polling).
    let blocked = false;
    const links = [];
    await ctx.routeWebSocket(/\/socket\.io\//, (ws) => { if (blocked) return ws.close(); links.push({ ws, srv: ws.connectToServer() }); });
    await ctx.route('**/socket.io/**', (route) => (blocked ? route.abort() : route.continue()));
    const cut = async (on) => {
      blocked = on;
      if (on) for (const l of links.splice(0)) { await l.ws.close().catch(() => {}); await l.srv.close().catch(() => {}); }
    };
    const errors = [];
    const lp = await ctx.newPage();
    lp.on('pageerror', (e) => errors.push(`live: ${e.message}`));
    await lp.goto(`${app.url}/login`);
    await lp.fill('[name=email]', 'ana@example.ro');
    await lp.fill('[name=password]', 'parola-lunga-1');
    await lp.click('button[type=submit]');
    await lp.waitForURL('**/app');
    const sp = await ctx.newPage();
    sp.on('pageerror', (e) => errors.push(`screen: ${e.message}`));
    await sp.setViewportSize({ width: 1280, height: 720 });
    await sp.goto(`${app.url}/screen`);
    await sp.waitForFunction(() => /\d{3} \d{3}/.test(document.getElementById('pairing-code').textContent));
    await app.api(app.cookies.owner, 'POST', '/api/screens/claim', { code: (await sp.textContent('#pairing-code')).replace(' ', ''), name: 'Proiector sală' });
    await sp.waitForSelector('#output:not([hidden])', { timeout: 6000 });
    await lp.goto(`${app.url}/events/${E}/live`);
    await lp.waitForSelector('#live:not([hidden])');
    await lp.click('#start-button');
    await sp.waitForFunction(() => /Ne ridici/.test(document.getElementById('output').innerText));
    let cached = false;
    for (let i = 0; i < 50 && !cached; i++) {
      cached = await lp.evaluate((id) => window.EVENT_CACHE.load(id).then((r) => Boolean(r && r.songs && r.songs.length === 3 && r.logo)), E);
      if (!cached) await lp.waitForTimeout(100);
    }
    check(cached, 'the event (songs, logo) is cached on the leader device');
    const scr = () => sp.evaluate(() => { const o = document.getElementById('output'); return o.innerText.trim().split('\n')[0] || (o.querySelector('img') ? 'LOGO' : 'BLACK'); });
    const until = (re) => sp.waitForFunction((re) => new RegExp(re).test(document.getElementById('output').innerText), re, { timeout: 3000 }).then(() => true, () => false);

    // 1. the server stops: emergency after ~5 s, the projector still moves
    await app.stop();
    const t0 = Date.now();
    await lp.waitForSelector('#emergency-banner:not([hidden])', { timeout: 12000 });
    check(Date.now() - t0 < 9000, `server gone: the emergency banner after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    await lp.click('#next-button');
    check(await until('Sfânt'), 'offline: next moves the projector (chorus)');
    await lp.click('#next-button');
    check(await until('Cezar'), 'offline: next moves to the verse');
    await lp.keyboard.press('b');
    await lp.waitForTimeout(250);
    check(await scr() === 'BLACK', 'offline: B -> black');
    await lp.keyboard.press('l');
    await lp.waitForTimeout(400);
    check(await scr() === 'LOGO', 'offline: L -> the cached logo');
    await lp.click('[data-source=content]');
    await lp.click('#end-item-button');
    await lp.waitForTimeout(300);
    check(await scr() === 'BLACK', 'offline: "■ Sfârșit" -> black (logo or not), the position stays');
    await lp.click('#next-button');
    check(await until('Primul'), 'offline: next after it -> the next song, content back');
    await lp.click('#setlist > li:nth-child(4) > .live-item');
    check(await until('Agapă|serviciu'), 'offline: a Program tap moves the projector');

    // 2. back, nobody else moved: this page's position goes to the server
    await app.start();
    const back = await lp.waitForFunction(() => /Reconectat/.test(document.getElementById('live-message').textContent), null, { timeout: 15000 }).then(() => true, () => false);
    check(back, 'back online: "Reconectat"');
    const server = await app.state();
    check(server.worship.itemId === items[3] && server.projector.source === 'content', 'nobody moved meanwhile: the offline position was pushed to the server', server.worship);

    // 3. cut off while another leader moves: the server wins
    await cut(true);
    await lp.waitForSelector('#emergency-banner:not([hidden])', { timeout: 12000 });
    await lp.click('#prev-button');
    const moved = await app.command({ type: 'worship.goto', itemId: items[2], step: 0 });
    check(moved.ok, 'another leader moves to "Șase rânduri" meanwhile');
    await cut(false);
    await lp.waitForFunction(() => /Reconectat/.test(document.getElementById('live-message').textContent) && document.getElementById('emergency-banner').hidden, null, { timeout: 20000 });
    check(await sp.waitForFunction(() => /Primul/.test(document.getElementById('output').innerText), null, { timeout: 20000 }).then(() => true, () => false), 'reconnected: the server position wins on the projector');

    // 4. the member follow page offline: manual navigation
    const mctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
    let mblocked = false;
    const mlinks = [];
    await mctx.routeWebSocket(/\/socket\.io\//, (ws) => { if (mblocked) return ws.close(); mlinks.push({ ws, srv: ws.connectToServer() }); });
    await mctx.route('**/socket.io/**', (route) => (mblocked ? route.abort() : route.continue()));
    const mp = await mctx.newPage();
    mp.on('pageerror', (e) => errors.push(`follow: ${e.message}`));
    await mp.goto(`${app.url}/login`);
    await mp.fill('[name=email]', 'm@x.ro');
    await mp.fill('[name=password]', 'parola-lunga-1');
    await mp.click('button[type=submit]');
    await mp.waitForURL('**/app');
    await mp.goto(`${app.url}/events/${E}/follow`);
    await mp.waitForSelector('#follow:not([hidden])');
    mblocked = true;
    for (const l of mlinks.splice(0)) { await l.ws.close().catch(() => {}); await l.srv.close().catch(() => {}); }
    check(await mp.waitForSelector('#offline-banner:not([hidden])', { timeout: 12000 }).then(() => true, () => false), 'member offline: the banner and manual navigation');
    const title = () => mp.evaluate(() => document.querySelector('#slide h1')?.textContent);
    const before = await title();
    await mp.click('#manual-prev');
    await mp.waitForTimeout(300);
    check(await title() !== before, `manual ← moves the member page (${before} -> ${await title()})`);
    const a = await layoutAudit(mp, '#manual-nav');
    check(!a.overflow && !a.small.length, 'member offline: no overflow, targets >= 44 px', a);
    mblocked = false;
    check(await mp.waitForFunction(() => document.getElementById('offline-banner').hidden, null, { timeout: 20000 }).then(() => true, () => false), 'member back online: follows the team again');
    check(errors.length === 0, 'no page errors on the leader, screen and follow pages', errors);
  },
};
