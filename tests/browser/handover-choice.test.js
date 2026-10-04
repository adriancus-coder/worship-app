'use strict';

// When the projector leaves an operator, the projection continues where it was (the screen
// does not jump to the new holder's place) and the one who got it chooses: "Continui de aici"
// (primary, keeps it) or "Încep de unde eram: <their place>" (back to where they were, the
// screen follows). RO 375 / EN 1024.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'handover-choice',
  timeout: 240000,
  async run({ app, signIn, check }) {
    const { eventId: E, items } = app.seed;
    check((await app.command({ type: 'event.start' })).ok, 'the event is live');
    const pos = async () => { const s = await app.state(); return [s.worship.itemId, s.worship.step, s.mode]; };
    for (const [lang, width, answer] of [['ro', 375, 'restart'], ['en', 1024, 'keep']]) {
      const tag = `[${lang} ${width}]`;
      await app.takeProjector('owner');
      await app.command({ type: 'worship.goto', itemId: items[0], step: 0 });
      await app.takeProjector('operator'); // split: the operator moves the projector, the leader the team
      const moved = await app.command({ type: 'projector.goto', itemId: items[2], step: 0 }, 'operator');
      check(moved.ok, `${tag} the operator moves the projector`, moved);
      await app.command({ type: 'worship.goto', itemId: items[0], step: 1 }, 'leader');
      const p = await signIn('leader', { width, lang });
      await p.goto(`${app.url}/events/${E}/live?view=full`);
      await p.waitForSelector('#live:not([hidden])');
      await p.waitForFunction(() => document.body.classList.contains('split-mode'));
      await p.click('#projector-action'); // the operator is away: taken at once
      await p.waitForSelector('.handover-choice:not([hidden])');
      check(JSON.stringify(await pos()) === JSON.stringify([items[2], 0, 'together']), `${tag} the projection continues where the projector was (no jump)`, await pos());
      const text = await p.evaluate(() => ({
        ask: document.querySelector('.handover-choice p').textContent,
        keep: document.getElementById('handover-keep').textContent,
        restart: document.getElementById('handover-restart').textContent,
        notice: !document.querySelector('#mode-controls .handover-line:not(.handover-choice)').hidden,
      }));
      check((lang === 'ro' ? /Ai proiectorul.*de unde a rămas: Șase rânduri/.test(text.ask) && text.keep === 'Continui de aici' && /^Încep de unde eram: Sfânt în G · /.test(text.restart)
        : /projector is yours.*where it was: Șase rânduri/.test(text.ask) && text.keep === 'Continue from here' && /^Start from where I was: Sfânt în G · /.test(text.restart)) && !text.notice,
      `${tag} the question names both places`, text);
      const a = await layoutAudit(p, '#mode-controls');
      check(!a.overflow && !a.small.length, `${tag} no overflow, targets >= 44 px`, a);
      await p.click(answer === 'keep' ? '#handover-keep' : '#handover-restart');
      await p.waitForSelector('.handover-choice', { state: 'hidden' });
      await wait(300);
      const want = answer === 'keep' ? [items[2], 0, 'together'] : [items[0], 1, 'together'];
      check(JSON.stringify(await pos()) === JSON.stringify(want), `${tag} "${answer === 'keep' ? 'Continui de aici' : 'Încep de unde eram'}": ${answer === 'keep' ? 'stays' : 'back to the leader\'s place'}`, await pos());
      await p.context().close();
    }
  },
};
