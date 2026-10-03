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
    const m = await signIn('member', { width: 375 });
    await m.goto(`${app.url}/events/${E}`);
    await m.waitForSelector('#editor-tabs:not([hidden])');
    await wait(300);
    check(JSON.stringify(await visibleTabs(m)) === JSON.stringify(['program', 'team', 'proposals']), 'a member: Program · Echipa · Propuneri', await visibleTabs(m));
  },
};
