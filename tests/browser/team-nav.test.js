'use strict';

// Echipa is a main section: Acasă · Echipa · Evenimente · Bibliotecă · Mai mult (five items
// that fit at 320 / 375 with no truncation, >= 44 px each; the rail from 900 px). /team for
// every role: the owner gets Persoane · Poziții · Indisponibilități (positions management
// moved here from Setări / "Mai mult"); presenter / leader / operator / member get a
// read-only directory (name, role, positions, own unavailability, no emails / phones) with
// a "Profilul meu" shortcut. "Mai mult" no longer lists Echipa / Poziții. RO / EN.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'team-nav',
  timeout: 240000,
  async run({ app, signIn, check }) {
    const owner = app.cookies.owner;
    // a member with a position and an unavailable period, so the directory has something to show
    const positions = (await app.api(owner, 'GET', '/api/positions')).body.positions;
    const memberId = (await app.api(owner, 'GET', '/api/team')).body.users.find((u) => u.email === 'm@x.ro').id;
    await app.api(owner, 'PUT', `/api/team/${memberId}/positions`, { positionIds: [positions[0].id] });
    await app.api(app.cookies.member, 'POST', '/api/me/unavailability', { dateFrom: app.seed.today, dateTo: app.seed.today, note: 'Concediu' });

    // the phone tab bar: five items, no truncation
    for (const [lang, width] of [['ro', 320], ['en', 320], ['ro', 375], ['en', 375]]) {
      const tag = `[${lang} ${width}]`;
      const p = await signIn('member', { width, lang });
      await p.goto(`${app.url}/app`); // the labels in the chosen language
      await p.waitForSelector('#app-shell .shell-label:not(:empty)');
      const bar = await p.evaluate(() => [...document.querySelectorAll('#app-shell .shell-list > li')].map((li) => {
        const item = li.querySelector('.shell-item');
        const label = li.querySelector('.shell-label');
        const r = item.getBoundingClientRect();
        return { text: label.textContent, w: Math.round(r.width), h: Math.round(r.height), clipped: label.scrollWidth > label.clientWidth + 1 || label.scrollWidth > r.width, font: parseFloat(getComputedStyle(item).fontSize) };
      }));
      check(bar.length === 5 && bar.map((b) => b.text).join(' · ') === (lang === 'ro' ? 'Acasă · Echipa · Evenimente · Bibliotecă · Mai mult' : 'Home · Team · Events · Library · More'), `${tag} five tabs: ${bar.map((b) => b.text).join(' · ')}`, bar);
      check(bar.every((b) => b.w >= 44 && b.h >= 44 && !b.clipped && b.font >= 11), `${tag} every tab >= 44 px, labels not truncated (font ${bar[0].font}px)`, bar);
      await p.context().close();
    }

    // the owner: three tabs, positions managed here, everyone's unavailability
    for (const [lang, width] of [['ro', 375], ['en', 1024]]) {
      const tag = `[${lang} ${width}]`;
      const o = await signIn('owner', { width, lang });
      await o.goto(`${app.url}/team`);
      await o.waitForSelector('#team .team-row');
      const head = await o.evaluate(() => ({
        current: (document.querySelector('#app-shell .shell-item[aria-current="page"]') || {}).dataset && document.querySelector('#app-shell .shell-item[aria-current="page"]').dataset.section,
        tabs: [...document.querySelectorAll('#team-tabs [role="tab"]')].map((b) => b.textContent), add: !document.getElementById('add-person').hidden,
        emails: document.querySelectorAll('#team .team-email').length,
      }));
      check(head.current === 'team' && head.tabs.length === 3 && head.add && head.emails > 0, `${tag} owner: Echipa marked in the nav, tabs ${head.tabs.join(' · ')}, accounts with emails`, head);
      await o.click('#tab-positions');
      await o.waitForSelector('#positions-panel:not([hidden]) .position-row');
      await o.fill('.positions-add input', 'Vioară');
      await o.click('.positions-add button');
      await o.waitForSelector('.position-row:has-text("Vioară")');
      check(/tab=positions/.test(o.url()), `${tag} owner: a position added on the Poziții tab (the tab is in the URL)`);
      await o.click('#tab-unavail');
      await o.waitForSelector('#unavail-panel:not([hidden])');
      const un = await o.evaluate(() => ({ rows: [...document.querySelectorAll('#unavail-all .unavail-all-row')].map((r) => r.textContent), mine: Boolean(document.getElementById('u-add')) }));
      check(un.rows.some((r) => /Membru/.test(r) && /Concediu/.test(r)) && un.mine, `${tag} owner: everyone's periods (read-only) + add for self`, un);
      const a = await layoutAudit(o, 'main');
      check(!a.overflow && !a.small.length, `${tag} owner Echipa: no overflow, targets >= 44 px`, a);
      // "Mai mult" no longer lists Echipa / Poziții; Setări has no positions section
      await o.click('.shell-more');
      await o.waitForSelector('#shell-panel:not([hidden])');
      const more = await o.$$eval('#shell-panel li:not([hidden]) .shell-row[data-page]', (l) => l.map((x) => x.dataset.page));
      check(!more.includes('team') && !more.includes('positions') && more.includes('settings') && more.includes('profile'), `${tag} "Mai mult": no Echipa / Poziții; Setări and Profilul meu stay`, more);
      await o.keyboard.press('Escape');
      await o.goto(`${app.url}/settings`);
      await o.waitForSelector('.settings-section');
      check(await o.evaluate(() => !document.getElementById('positions-editor')), `${tag} Setări: no positions section`);
      await o.context().close();
    }

    // every other role: the read-only directory
    for (const [role, lang, width] of [['member', 'ro', 375], ['leader', 'en', 1024], ['operator', 'ro', 1180], ['presenter', 'en', 375]]) {
      const tag = `[${role} ${lang} ${width}]`;
      const p = await signIn(role, { width, lang });
      await p.click('#app-shell .shell-item[data-section="team"]');
      await p.waitForSelector('#directory .directory-row');
      const d = await p.evaluate(() => ({
        current: document.querySelector('#app-shell .shell-item[aria-current="page"]').dataset.section,
        rows: document.querySelectorAll('#directory .directory-row').length, buttons: document.querySelectorAll('#directory button').length,
        text: document.getElementById('directory').innerText, tabs: document.getElementById('team-tabs').hidden, add: document.getElementById('add-person').hidden,
        profile: !document.getElementById('my-profile').hidden && document.getElementById('my-profile').getAttribute('href') === '/profile',
        emails: /@/.test(document.querySelector('main').innerText), phones: /\+40|\d{3} \d{3}/.test(document.getElementById('directory').innerText),
      }));
      check(d.current === 'team' && d.rows >= 5 && d.buttons === 0 && d.tabs && d.add && d.profile && !d.emails && !d.phones, `${tag} the directory: every person, no actions, no emails / phones, "Profilul meu" on top`, d);
      const memberRow = await p.evaluate(() => ([...document.querySelectorAll('#directory .directory-row')].find((r) => /^Membru/.test(r.querySelector('.team-name').textContent)) || {}).innerText || '');
      check(memberRow.includes(positions[0].name) && /Indisponibil|Unavailable/.test(memberRow), `${tag} the member's position and own unavailability are shown`, memberRow);
      const a = await layoutAudit(p, 'main');
      check(!a.overflow && !a.small.length, `${tag} directory: no overflow, targets >= 44 px`, a);
      await p.context().close();
    }
    void wait;
  },
};
