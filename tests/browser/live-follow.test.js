'use strict';

// "Urmăresc: Echipa · Operatorul" on the leader / presenter live page (split only, kept on the
// device): following the operator, the page shows the projector's position and its moves move
// the projector (the team stays put); the card says where the team is, with "Adu echipa aici";
// the big lyrics follow too. Together: no choice. RO 375 leader / EN 1024 presenter.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'live-follow',
  timeout: 240000,
  async run({ app, signIn, check }) {
    const { eventId: E, items } = app.seed;
    check((await app.command({ type: 'event.start' })).ok, 'the event is live');
    const at = async () => { const s = await app.state(); return { team: [s.worship.itemId, s.worship.step], projector: [s.projector.itemId, s.projector.step], mode: s.mode }; };
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    for (const [lang, width, role] of [['ro', 375, 'leader'], ['en', 1024, 'presenter']]) {
      const tag = `[${lang} ${width} ${role}]`;
      await app.takeProjector('owner');
      await app.command({ type: 'worship.goto', itemId: items[0], step: 1 });
      await app.takeProjector('operator');
      await app.command({ type: 'projector.goto', itemId: items[2], step: 0 }, 'operator');
      const p = await signIn(role, { width, lang });
      await p.goto(`${app.url}/events/${E}/live?view=full`);
      await p.waitForSelector('#live:not([hidden])');
      await p.waitForFunction(() => document.body.classList.contains('split-mode'));
      await p.waitForSelector('#live-follow-row:not([hidden])');
      const title = () => p.textContent('.current-title');
      const pressed = () => p.$eval('#live-follow [aria-pressed=true]', (b) => b.dataset.follow);
      check(await pressed() === 'team' && /Sfânt în G/.test(await title()), `${tag} split: "Urmăresc" shows, the team by default`);
      const labels = await p.$$eval('#live-follow button', (bs) => bs.map((b) => b.textContent));
      check(lang === 'ro' ? /^Echipa \(Lider/.test(labels[0]) && labels[1] === 'Operatorul (Operator)' : /^The team \(Leader/.test(labels[0]) && labels[1] === 'The operator (Operator)', `${tag} the labels`, labels);
      await p.click('#live-follow [data-follow=projector]');
      await p.waitForFunction(() => /Șase rânduri/.test(document.querySelector('.current-title').textContent));
      check(/(Echipa e la|The team is at) Sfânt în G/.test(await p.textContent('#cross-text')) && /(Adu echipa aici|Bring the team here)/.test(await p.textContent('#cross-jump')), `${tag} following the operator: the projector's song; the card says where the team is`, await p.textContent('#cross-text'));
      const a = await layoutAudit(p, '.live-info');
      check(!a.overflow && !a.small.length, `${tag} no overflow, targets >= 44 px`, a);
      await p.click('#next-button');
      await wait(400);
      let now = await at();
      check(same(now.projector, [items[3], 0]) && same(now.team, [items[0], 1]), `${tag} "Înainte" moves the projector, the team stays`, now);
      // kept on this device
      await p.reload();
      await p.waitForSelector('#live-follow-row:not([hidden])');
      check(await pressed() === 'projector', `${tag} the choice is kept after a reload`);
      // the big lyrics follow the projector; their status says where the team is
      await p.keyboard.press('f');
      await p.waitForSelector('dialog.big-lyrics[open]');
      await wait(300);
      check(/(Echipa e la|The team is at)/.test(await p.textContent('dialog.big-lyrics .big-status')), `${tag} big lyrics: "Echipa e la …"`, await p.textContent('dialog.big-lyrics .big-status'));
      await p.keyboard.press('ArrowLeft');
      await wait(400);
      now = await at();
      check(same(now.projector, [items[2], 0]) && same(now.team, [items[0], 1]), `${tag} ← in the big lyrics moves the projector`, now);
      await p.keyboard.press('Escape');
      await wait(200);
      // "Adu echipa aici"
      await p.click('#cross-jump');
      await wait(400);
      now = await at();
      check(same(now.team, [items[2], 0]), `${tag} "Adu echipa aici": the team goes to the projector`, now);
      // together: no choice, the one position
      await app.takeProjector('owner');
      await p.waitForSelector('#live-follow-row', { state: 'hidden' });
      check(!(await p.evaluate(() => document.body.classList.contains('split-mode'))), `${tag} together: no "Urmăresc"`);
      await p.evaluate(() => localStorage.removeItem('wa_live_follow'));
      await p.context().close();
    }
  },
};
