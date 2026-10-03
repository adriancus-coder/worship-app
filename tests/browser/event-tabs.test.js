'use strict';

// The event page's tabs: the Program holds only the setlist; Echipa, Propuneri, Proiector and
// Traducere are tabs of their own, each shown only to whoever has that panel. The owner
// editing sees all five, fitting on a phone (320 / 375) without clipping; a member sees
// Program, Echipa and Propuneri. The Program pane has no team / proposals / projector /
// translation content in it.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'event-tabs',
  async run({ app, signIn, check }) {
    const { eventId: E } = app.seed;
    const visibleTabs = (p) => p.$$eval('#editor-tabs [role="tab"]', (l) => l.filter((b) => !b.hidden).map((b) => b.id.replace('tab-', '')));
    for (const width of [320, 375, 1280]) {
      const p = await signIn('owner', { width });
      await p.goto(`${app.url}/events/${E}/edit`);
      await p.waitForSelector('#editor-tabs:not([hidden])');
      await p.waitForSelector('#tab-bridge:not([hidden])');
      await wait(300);
      check(JSON.stringify(await visibleTabs(p)) === JSON.stringify(['program', 'team', 'proposals', 'projector', 'bridge']), `[${width}] owner editing: Program · Echipa · Propuneri · Proiector · Traducere`, await visibleTabs(p));
      const program = await p.evaluate(() => {
        const pane = document.getElementById('editor-program');
        return { team: Boolean(pane.querySelector('#team-card, #team-edit')), proposals: Boolean(pane.querySelector('#proposals')), bridge: Boolean(pane.querySelector('#bridge-card')), projector: Boolean(pane.querySelector('#projector-card')) };
      });
      check(!program.team && !program.proposals && !program.bridge && !program.projector, `[${width}] the Program pane holds only the setlist`, program);
      const tabs = await p.evaluate(() => [...document.querySelectorAll('#editor-tabs [role="tab"]')].filter((b) => !b.hidden).map((b) => ({ id: b.id, clipped: b.scrollWidth > b.clientWidth + 1 })));
      const a = await layoutAudit(p, '#editor-tabs');
      check(!a.overflow && !a.small.length && tabs.every((x) => !x.clipped), `[${width}] the tabs fit: no overflow, no clipped label, targets >= 44 px`, { a, tabs });
      for (const [tab, panel, probe] of [['team', 'team-panel', '#team-edit, #team-card'], ['proposals', 'proposals-panel', '#proposals'], ['projector', 'projector-panel', '#projector-prep-link'], ['bridge', 'bridge-panel', '#bridge-card']]) {
        await p.click(`#tab-${tab}`);
        await p.waitForSelector(`#${panel}:not([hidden])`);
        const shown = await p.evaluate(({ panel, probe }) => ({ program: !document.getElementById('editor-program').hidden, panel: !document.getElementById(panel).hidden, content: Boolean(document.getElementById(panel).querySelector(probe)), selected: document.querySelector('[role="tab"][aria-selected="true"]').id }), { panel, probe });
        check(!shown.program && shown.panel && shown.content && shown.selected === `tab-${tab}`, `[${width}] "${tab}": its panel alone, the tab selected`, shown);
      }
      await p.click('#tab-program');
      check(!(await p.isHidden('#items')) && await p.isHidden('#bridge-panel'), `[${width}] back to Program`);
      await p.context().close();
    }
    // "Detalii" never repeats the header as a collapsed row: only the "Detalii" button opens it
    const o = await signIn('owner', { width: 1280 });
    await o.goto(`${app.url}/events/${E}/edit`);
    await o.waitForSelector('#editor-tabs:not([hidden])');
    check(await o.isHidden('#quick-details'), 'no "Detalii · name · date" row under Program');
    await o.click('#details-button');
    await o.waitForSelector('#quick-details[open]:not([hidden])');
    await o.evaluate(() => { document.getElementById('quick-details').open = false; });
    await o.waitForFunction(() => document.getElementById('quick-details').hidden);
    check(true, '"Detalii" opens the form; closed again, it goes');
    // "Retrage din live": the event page's tool, back to planned (not finished)
    check((await app.command({ type: 'event.start' })).ok, 'the event is live');
    await o.reload();
    await o.waitForSelector('#withdraw-button:not([hidden])');
    o.once('dialog', (d) => d.accept());
    await o.click('#withdraw-button');
    await o.waitForFunction(() => /planificat|Planificat/.test(document.getElementById('event-status').textContent), null, { timeout: 5000 });
    check((await app.state()).status === 'planned' && /retras din live/.test(await o.textContent('#action-message')) && await o.isHidden('#withdraw-button'), 'the event page: "Retrage din live" -> planned again, said so, the tool goes');
    // the live page's end dialog offers it too
    check((await app.command({ type: 'event.start' })).ok, 'live again');
    await o.goto(`${app.url}/events/${E}/live`);
    await o.waitForSelector('#end-button:not([hidden])');
    await o.click('#end-button');
    await o.waitForSelector('#end-dialog[open]');
    check(/Retrage din live/.test(await o.textContent('#end-dialog')), 'the end dialog: "Încheie evenimentul" or "Retrage din live"');
    await o.click('#end-dialog button[value="withdraw"]');
    await o.waitForSelector('#start-button:not([hidden])', { timeout: 5000 });
    check((await app.state()).status === 'planned' && new URL(o.url()).pathname.endsWith('/live'), 'withdrawn from the live page: it stays, "Pornește" is back');
    await o.context().close();

    const m = await signIn('member', { width: 375 });
    await m.goto(`${app.url}/events/${E}`);
    await m.waitForSelector('#editor-tabs:not([hidden])');
    await wait(300);
    check(JSON.stringify(await visibleTabs(m)) === JSON.stringify(['program', 'team', 'proposals']), 'a member: Program · Echipa · Propuneri', await visibleTabs(m));
  },
};
