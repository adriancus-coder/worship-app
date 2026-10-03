'use strict';

// Church pairing with Sanctuary Voice (docs/BRIDGE.md): the owner pairs once in Settings with a
// code from SV's admin; the event page / live page / console then connect with ONE tap
// ("Conectează la Serviciu duminică (live)"), the code form behind "Conectează cu cod"; a
// non-owner sees no pairing card; "Desparte" forgets it; the token never reaches a browser.
// Against the SV stand-in in fixtures/mock-sv.js (https://sv.test).

const path = require('path');
const { FIXTURES, layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'bridge-pairing',
  app: { preload: [path.join(FIXTURES, 'mock-sv.js')] },
  timeout: 180000,
  async run({ app, signIn, check }) {
    const { eventId: E } = app.seed;
    const owner = app.cookies.owner;
    // not paired: the event page offers the code form and the hint; the API agrees
    const lp = await signIn('leader', { width: 1024 });
    await lp.goto(`${app.url}/events/${E}`);
    await lp.click('#tab-bridge'); // translation has its own tab
    await lp.waitForSelector('#bridge-card .bridge-connect');
    check(/(Setări|Settings)/.test(await lp.textContent('#bridge-card')) && !(await lp.isHidden('#bridge-code')), 'not paired: the code form with the hint about pairing in Settings');
    check((await app.api(app.cookies.leader, 'GET', '/api/bridge/pairing')).status === 403, 'the pairing API is the owner\'s');
    // the owner pairs in Settings
    const p = await signIn('owner', { width: 1024 });
    await p.goto(`${app.url}/settings`);
    await p.waitForSelector('#sv-form:not([hidden])');
    check(/(Neîmperecheată|Not paired)/.test(await p.textContent('#sv-status')), 'Settings: "Neîmperecheată", the pairing form');
    await p.click('#sv-form summary');
    await p.fill('#sv-url', 'https://sv.test');
    await p.fill('#sv-code', 'wrong1');
    await p.click('#sv-pair');
    await p.waitForFunction(() => /\S/.test(document.getElementById('sv-message').textContent));
    check(/(greșit|not valid|wrong)/i.test(await p.textContent('#sv-message')), 'a wrong code: "Cod de conectare greșit"', await p.textContent('#sv-message'));
    await p.fill('#sv-code', 'k7mnpq');
    await p.click('#sv-pair');
    await p.waitForFunction(() => document.getElementById('sv-form').hidden, null, { timeout: 5000 });
    check(/Biserica Harul \(SV\)/.test(await p.textContent('#sv-status')) && !(await p.isHidden('#sv-unpair')), 'paired: "Împerecheată cu „Biserica Harul (SV)”", "Desparte"', await p.textContent('#sv-status'));
    const pairing = (await app.api(owner, 'GET', '/api/bridge/pairing')).body.pairing;
    check(pairing.paired && pairing.svOrgName === 'Biserica Harul (SV)' && !JSON.stringify(pairing).includes('pt-test'), 'the API shows the pairing without the token');
    const a = await layoutAudit(p, '#sv-card');
    check(!a.overflow && !a.small.length, 'the card: no overflow, targets >= 44 px', a);
    // the event page: one tap
    await lp.reload();
    await lp.click('#tab-bridge');
    await lp.waitForSelector('#bridge-card .bridge-paired');
    await lp.waitForSelector('#bridge-card [data-sv-event]', { timeout: 5000 });
    const buttons = await lp.$$eval('#bridge-card [data-sv-event]', (l) => l.map((b) => `${b.dataset.svEvent}:${b.classList.contains('secondary') ? 'secondary' : 'primary'}:${b.textContent.trim()}`));
    check(buttons.length === 2 && /^sv-live:primary:Conectează la Serviciu duminică.*\(live\)$/.test(buttons[0]) && /^sv-next:secondary:Conectează la Seara/.test(buttons[1]), 'paired: "Conectează la …" per SV event, the live one primary', buttons);
    check(await lp.isHidden('#bridge-code') && /Biserica Harul \(SV\)/.test(await lp.textContent('#bridge-card')), 'no code field until "Conectează cu cod"; the organisation named');
    await lp.click('#bridge-with-code');
    await lp.waitForSelector('#bridge-code');
    check(!(await lp.isHidden('#bridge-code')), '"Conectează cu cod" opens the code form');
    await lp.click('#bridge-card [data-sv-event="sv-live"]');
    await lp.waitForSelector('#bridge-card .bridge-connected', { timeout: 5000 });
    check(/(Limbi|Languages): en, no/.test(await lp.textContent('#bridge-card')), 'one tap: connected to the live SV event (languages en, no)', await lp.textContent('#bridge-card'));
    const status = (await app.api(app.cookies.leader, 'GET', `/api/events/${E}/bridge`)).body;
    check(status.connected && status.connection.svEventId === 'sv-live' && status.pairing.paired && !JSON.stringify(status).includes('bt-sv-live'), 'the event bridge: SV event sv-live, no token in the API');
    // the console shows the same connection; disconnect there
    const op = await signIn('operator', { width: 1280 });
    await op.goto(`${app.url}/events/${E}/operator`);
    await op.waitForSelector('#bridge-panel .bridge-connected', { timeout: 5000 });
    op.on('dialog', (d) => d.accept());
    await op.click('#bridge-panel button:has-text("Deconectează")');
    await op.waitForSelector('#bridge-panel .bridge-paired', { timeout: 5000 });
    await op.waitForSelector('#bridge-panel [data-sv-event]', { timeout: 5000 });
    check(true, 'the console: disconnected, the one-tap list is back');
    // unpair: the event page falls back to the code form
    p.on('dialog', (d) => d.accept());
    await p.click('#sv-unpair');
    await p.waitForSelector('#sv-form:not([hidden])', { timeout: 5000 });
    check(/(Neîmperecheată|Not paired)/.test(await p.textContent('#sv-status')), 'unpaired: "Neîmperecheată" again');
    await lp.reload();
    await lp.click('#tab-bridge');
    await lp.waitForSelector('#bridge-card .bridge-connect');
    check(!(await lp.isHidden('#bridge-code')), 'unpaired: the event page offers the code form again');
    await wait(200);
  },
};
