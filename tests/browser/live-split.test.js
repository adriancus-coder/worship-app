'use strict';

// "Doar operatorul" (split) on the leader / presenter (and owner) live page: the whole projector panel
// goes (preview, sources, background, clock, video, "Ecrane conectate"); only the dashed
// "Proiectorul e la … · Sari acolo" card and the Control comun / Doar operatorul + Echipa switches stay;
// the step grid takes the width (5 columns from 1180 px); B / L / K do nothing (a hint says
// so); the big lyrics' status line keeps "Proiectorul e la …"; back to Control comun restores the
// panel without a reload; the console is unaffected. RO / EN; 375 / 1024 / 1180 / 1440.

const { wait } = require('./harness');

module.exports = {
  name: 'live-split',
  timeout: 300000,
  async run({ app, signIn, check }) {
    const { eventId: E, items } = app.seed;
    check((await app.command({ type: 'event.start' })).ok, 'the event is live');
    const layout = (p) => p.evaluate(() => {
      const panel = document.querySelector('.projector-panel');
      const grid = document.querySelector('.step-grid');
      const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0;
      const current = document.querySelector('.live-current').getBoundingClientRect().width;
      return {
        panel: Boolean(panel.getClientRects().length), cross: !document.getElementById('cross').hidden, hint: !document.getElementById('split-keys-hint').hidden,
        modes: !document.getElementById('mode-controls').hidden && document.querySelectorAll('#mode-controls .mode-switch').length === 1 && !document.getElementById('projector-action').hidden,
        video: Boolean(document.querySelector('#video-panel') && document.querySelector('#video-panel').getClientRects().length),
        cols, current: Math.round(current), crossText: document.getElementById('cross-text').textContent,
      };
    });
    for (const [lang, width, role] of [['ro', 375, 'leader'], ['en', 1024, 'presenter'], ['ro', 1180, 'leader'], ['en', 1440, 'owner']]) {
      const tag = `[${lang} ${width} ${role}]`;
      await app.takeProjector('owner');
      await app.command({ type: 'projector.source', source: 'content' });
      await app.command({ type: 'worship.goto', itemId: items[0], step: 0 });
      const p = await signIn(role, { width, lang });
      await p.goto(`${app.url}/events/${E}/live${role === 'leader' ? '?view=full' : ''}`); // a leader lands in the lyrics otherwise
      await p.waitForSelector('#live:not([hidden])');
      await p.waitForSelector('.step[aria-current=step]');
      const together = await layout(p);
      check(together.panel && !together.cross && !together.hint, `${tag} together: the projector panel is there`, together);
      await app.takeProjector('operator');
      await p.waitForFunction(() => document.body.classList.contains('split-mode'));
      await wait(300);
      const split = await layout(p);
      check(!split.panel && !split.video && split.cross && split.hint && split.modes && /Sfânt în G/.test(split.crossText), `${tag} split: panel gone, "Proiectorul e la …" card + switches + hint remain`, split);
      if (width >= 900) check(split.current > together.current && (width < 1180 || split.cols === 5), `${tag} the step grid widens (${together.current} -> ${split.current} px${width >= 1180 ? ', 5 columns' : ''})`, split);
      // B / L / K do nothing
      const before = await app.state();
      for (const key of ['b', 'l', 'k']) await p.keyboard.press(key);
      await wait(400);
      const st = await app.state();
      check(st.projector.source === 'content' && st.clock.show === before.clock.show, `${tag} B / L / K are inert in split mode`, { source: st.projector.source, clock: st.clock.show, was: before.clock.show });
      // big lyrics: the status line keeps "Proiectorul e la …"
      await p.click('.step[aria-current=step]');
      await p.waitForSelector('dialog.big-lyrics[open]');
      await wait(300);
      const status = await p.textContent('dialog.big-lyrics .big-status');
      check(/(Proiectorul e la|The projector is at)/.test(status), `${tag} big lyrics status: "Proiectorul e la …"`, status);
      await p.keyboard.press('Escape');
      await wait(200);
      await app.takeProjector('owner');
      await p.waitForFunction(() => !document.body.classList.contains('split-mode'));
      await wait(300);
      const back = await layout(p);
      check(back.panel && !back.cross && !back.hint, `${tag} together again: the panel is back without a reload`, back);
      await p.context().close();
    }
    // the console keeps its projector controls in split mode
    await app.takeProjector('operator');
    const op = await signIn('operator', { width: 1180 });
    await op.goto(`${app.url}/events/${E}/operator`);
    await op.waitForSelector('#console:not([hidden])');
    await op.waitForFunction(() => document.getElementById('mode-banner').dataset.mode === 'split');
    const console_ = await op.evaluate(() => ({ preview: Boolean(document.getElementById('projector-preview').getClientRects().length), sources: document.querySelectorAll('.op-sources button').length }));
    check(console_.preview && console_.sources >= 3, 'console: preview and sources unaffected in split mode', console_);
    await op.keyboard.press('b');
    await wait(400);
    check((await app.state()).projector.source === 'black', 'console: B still works there');
  },
};
