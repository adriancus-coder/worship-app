'use strict';

// "Urmăresc:" on the follow page. With an operator on the console the projector is theirs and
// moves on its own (split); each member chooses whom to follow: the projector (the operator,
// the default) or the leader / presenter. The choice stays on the phone (a reload keeps it);
// together (no operator holding) there is one position and no choice. RO 390 / EN 1024.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'follow-source',
  timeout: 200000,
  async run({ app, signIn, check }) {
    const { eventId: E } = app.seed;
    const op = await signIn('operator', { width: 1280 });
    await op.goto(`${app.url}/events/${E}/operator`);
    await wait(500);
    check((await app.command({ type: 'event.start' }, 'operator')).ok, 'started with the operator on the console');
    const st = await app.state();
    check(st.mode === 'split' && st.holder.role === 'operator', 'the operator holds the projector: split', { mode: st.mode, holder: st.holder });
    const slideText = (p) => p.evaluate(() => document.getElementById('slide').textContent.replace(/\s+/g, ' ').slice(0, 80));

    for (const [lang, width] of [['ro', 390], ['en', 1024]]) {
      const tag = `[${lang} ${width}]`;
      await app.command({ type: 'worship.goto', itemId: app.seed.items[0], step: 0 }, 'leader');
      await app.command({ type: 'projector.goto', itemId: app.seed.items[0], step: 0 }, 'operator');
      const m = await signIn('member', { width, lang });
      await m.goto(`${app.url}/events/${E}/follow`);
      await m.waitForSelector('#follow-source-row:not([hidden])');
      const pressed = () => m.$eval('#follow-source [aria-pressed="true"]', (b) => b.dataset.source);
      check(await pressed() === 'projector' && /Operator/.test(await m.textContent('#follow-source [data-source="projector"]')), `${tag} split: the choice shows, "Proiectorul (Operator)" by default`);
      const a = await layoutAudit(m, '#follow');
      check(!a.overflow && !a.small.length, `${tag} the choice: no overflow, targets >= 44 px`, a);
      // the operator moves: the member follows the projector
      const before = await slideText(m);
      await app.command({ type: 'projector.next' }, 'operator');
      await m.waitForFunction((b) => document.getElementById('slide').textContent.replace(/\s+/g, ' ').slice(0, 80) !== b, before, { timeout: 5000 }).catch(() => {});
      const afterOp = await slideText(m);
      check(afterOp !== before, `${tag} the operator moves: the member sees it`, { before, afterOp });
      // the leader moves: nothing changes while following the projector
      await app.command({ type: 'worship.next' }, 'leader');
      await app.command({ type: 'worship.next' }, 'leader');
      await wait(600);
      check(await slideText(m) === afterOp, `${tag} the leader's moves do not move a phone following the projector`);
      // the member chooses the leader: straight to the leader's place, then follows the leader
      await m.click('#follow-source [data-source="worship"]');
      await wait(300);
      const atLeader = await slideText(m);
      check(atLeader !== afterOp && await pressed() === 'worship', `${tag} "Liderul / Prezentatorul": the phone jumps to the leader's place`, { atLeader });
      await app.command({ type: 'projector.next' }, 'operator');
      await wait(600);
      check(await slideText(m) === atLeader, `${tag} now the operator's moves do not move it`);
      await app.command({ type: 'worship.prev' }, 'leader');
      await m.waitForFunction((b) => document.getElementById('slide').textContent.replace(/\s+/g, ' ').slice(0, 80) !== b, atLeader, { timeout: 5000 }).catch(() => {});
      check(await slideText(m) !== atLeader, `${tag} and the leader's do`);
      await m.reload();
      await m.waitForSelector('#follow-source-row:not([hidden])');
      check(await pressed() === 'worship', `${tag} the choice stays on the phone after a reload`);
      await m.click('#follow-source [data-source="projector"]'); // back to the default for the next round
      await m.context().close();
    }

    // together (the leader takes the projector): one position, no choice
    await app.takeProjector('leader');
    const m2 = await signIn('member', { width: 390 });
    await m2.goto(`${app.url}/events/${E}/follow`);
    await m2.waitForSelector('#follow:not([hidden])');
    await wait(400);
    check(await m2.isHidden('#follow-source-row'), 'together: no choice (one position)');
    await m2.context().close();
  },
};
