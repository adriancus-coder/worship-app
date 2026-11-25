'use strict';

// The projector's defaults for the 'screens' right (routes/settings.js): an operator opens
// "Mai mult → Setări" and sees the Proiector group alone (no tab bar), can change the clock
// default, cannot touch the church's other settings; a member has no Setări at all. The
// owner's page is unchanged (three groups).

const { layoutAudit } = require('./harness');

module.exports = {
  name: 'settings-projector',
  async run({ app, signIn, check }) {
    const op = await signIn('operator', { width: 390, lang: 'ro' });
    await op.goto(`${app.url}/settings`);
    await op.waitForSelector('#settings-projector:not([hidden])');
    await op.waitForSelector('#clock-panel .clock-toggle');
    const view = await op.evaluate(() => ({ tabs: document.getElementById('settings-tabs').hidden, general: document.getElementById('settings-general').hidden, advanced: document.getElementById('settings-advanced').hidden, headings: [...document.querySelectorAll('#settings-projector h2')].map((h) => h.textContent) }));
    check(view.tabs && view.general && view.advanced && view.headings.length >= 4 && /Ceasul/.test(view.headings.join()), 'the operator: the Proiector group alone (margin, clock, backgrounds, logo), no tab bar', view);
    const a = await layoutAudit(op, 'main');
    check(!a.overflow && !a.small.length, 'operator settings 390: no overflow, targets >= 44 px', a);
    await op.click('[data-corner="top-left"]');
    await op.waitForFunction(() => document.querySelector('[data-corner="top-left"]').getAttribute('aria-pressed') === 'true');
    const clock = (await app.api(app.cookies.owner, 'GET', '/api/settings')).body.clock;
    check(clock.position === 'top-left', 'the operator changed the clock default (saved for the church)', clock);
    const api = await app.api(app.cookies.operator, 'GET', '/api/settings');
    check(api.status === 200 && api.body.scope === 'projector' && api.body.email === undefined && api.body.backup === undefined, 'GET /api/settings for the operator: the projector fields only', Object.keys(api.body));
    const denied = await Promise.all([
      app.api(app.cookies.operator, 'PUT', '/api/settings/theme-default', { theme: 'light' }),
      app.api(app.cookies.operator, 'PUT', '/api/settings/service', { weekday: 0, time: '10:00' }),
      app.api(app.cookies.operator, 'PUT', '/api/settings/chord-notation', { notation: 'solfege' }),
      app.api(app.cookies.operator, 'POST', '/api/settings/email/test'),
      app.api(app.cookies.operator, 'GET', '/api/backup'),
    ]);
    check(denied.every((r) => r.status === 403), 'the church settings, email test and backup stay the owner\'s (403)', denied.map((r) => r.status));
    const allowed = await app.api(app.cookies.operator, 'PUT', '/api/settings/await-section', { on: true });
    check(allowed.status === 200, 'PUT await-section: the projector right may', allowed.status);
    await app.api(app.cookies.owner, 'PUT', '/api/settings/await-section', { on: false });
    await op.click('.shell-more');
    const menu = await op.$$eval('#shell-panel li:not([hidden]) .shell-row[data-page]', (l) => l.map((x) => x.dataset.page));
    check(menu.includes('settings') && !menu.includes('team'), 'the operator\'s "Mai mult" lists Setări (not Echipa\'s owner tools)', menu);
    await op.context().close();

    const m = await signIn('member', { width: 390, lang: 'ro' });
    await m.goto(`${app.url}/settings`);
    await m.waitForURL('**/app');
    check(/\/app$/.test(m.url()) && (await app.api(app.cookies.member, 'GET', '/api/settings')).status === 403, 'a member: /settings leads to /app, the API says 403');
    await m.context().close();

    const o = await signIn('owner', { width: 1024, lang: 'ro' });
    await o.goto(`${app.url}/settings`);
    await o.waitForSelector('#settings-general:not([hidden])');
    check(!(await o.isHidden('#settings-tabs')) && (await o.locator('#settings-tabs [role="tab"]').count()) === 3, 'the owner: the three groups as before');
    await o.context().close();
  },
};
