'use strict';

// The home card as a programme sheet: the Program with each song's key on the right (in the
// reader's notation), the team as circles with initials and a dot with each answer (Vin /
// Poate / Nu pot / none), and, for the editors, "Gamă": tap a song, pick a key, the song is
// transposed for this event in one tap. Members see the keys and the team, no choice.

const { layoutAudit, laterAnswers } = require('./harness');

module.exports = {
  name: 'home-card',
  timeout: 180000,
  async run({ app, signIn, check }) {
    const owner = app.cookies.owner;
    const { eventId: E, songs } = app.seed;
    const users = (await app.api(owner, 'GET', '/api/team')).body.users;
    const positions = (await app.api(owner, 'GET', '/api/positions')).body.positions;
    const uid = (email) => users.find((u) => u.email === email).id;
    await app.api(owner, 'PUT', `/api/events/${E}/assignments`, { assignments: [{ userId: uid('m@x.ro'), positionId: positions[0].id }, { userId: uid('op@x.ro'), positionId: positions[1].id }] });
    await app.api(owner, 'POST', `/api/events/${E}/attendance/send`, {});
    await app.api(app.cookies.member, 'POST', `/api/events/${E}/attendance/respond`, { status: 'accepted', note: '' });
    await app.api(app.cookies.leader, 'POST', `/api/events/${E}/attendance/respond`, { status: 'maybe', note: '' });
    await app.api(app.cookies.operator, 'POST', `/api/events/${E}/attendance/respond`, { status: 'declined', note: '' });

    // the member (375): the Program with the keys, the team, no key choice
    const m = await signIn('member', { width: 375, lang: 'ro' });
    await m.waitForSelector('#now .now-items');
    const card = await m.evaluate(() => ({
      items: [...document.querySelectorAll('#now .now-item')].map((li) => ({ title: li.querySelector('.now-item-title').textContent, key: li.querySelector('.now-item-key') ? li.querySelector('.now-item-key').textContent : null, button: Boolean(li.querySelector('button')) })),
      people: [...document.querySelectorAll('#now .now-person')].map((p) => ({ initials: p.querySelector('.now-avatar').textContent, status: [...p.classList].find((c) => /^now-person-/.test(c)).replace('now-person-', '') })),
      keys: Boolean(document.querySelector('#now .now-keys')), hint: Boolean(document.querySelector('#now .now-key-hint')),
    }));
    check(card.items.length === 5 && card.items[0].title === 'Sfânt în G' && card.items[0].key === 'G' && card.items[1].key === null && card.items.every((it) => !it.button), 'member: the Program, the songs with their key on the right, nothing to tap', card.items);
    check(card.people.length >= 4 && card.people.some((p) => p.status === 'accepted') && card.people.some((p) => p.status === 'maybe') && card.people.some((p) => p.status === 'declined') && card.people.every((p) => /^[A-ZĂÂÎȘȚ?]{1,2}$/.test(p.initials)), 'member: the team as initials with a dot per answer (Vin / Poate / Nu pot)', card.people);
    check(!card.keys && !card.hint, 'member: no key choice');
    const a = await layoutAudit(m, '#now');
    check(!a.overflow && !a.small.length, 'the card 375: no overflow, targets >= 44 px', a);
    await m.context().close();

    // the owner (1024): tap the song, pick A -> transposed by 2 for this event; the badge follows
    const o = await signIn('owner', { width: 1024, lang: 'ro' });
    await laterAnswers(o); // the owner's own invitation pop-up is not this test's
    await o.waitForSelector('#now .now-items');
    check(await o.isVisible('#now .now-key-hint') && !(await o.$('#now .now-keys')), 'owner: "Atinge o cântare…", the choice waits for a song');
    await o.click('#now .now-item button >> nth=0');
    await o.waitForSelector('#now .now-keys');
    const keys = await o.$$eval('#now .now-keys button', (l) => ({ labels: l.map((b) => b.dataset.key), pressed: l.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.key) }));
    check(keys.labels.length === 12 && keys.labels[0] === 'C' && keys.labels.includes('G') && keys.pressed.join() === 'G', 'the 12 keys from C, the song\'s own (G) selected', keys);
    await o.click('#now .now-keys [data-key="A"]');
    await o.waitForFunction(() => document.querySelector('#now .now-item .now-item-key') && document.querySelector('#now .now-item .now-item-key').textContent === 'A', null, { timeout: 5000 });
    const item = (await app.api(owner, 'GET', `/api/events/${E}`)).body.items[0];
    check(item.transpose === 2 && item.displayKey === 'A', 'A: the song is transposed by 2 for this event (the badge says A)', { transpose: item.transpose, displayKey: item.displayKey });
    check((await o.$eval('#now .now-keys [aria-pressed="true"]', (b) => b.dataset.key)) === 'A' && (await o.$eval('#now .now-item button >> nth=0', (b) => b.getAttribute('aria-pressed'))) === 'true', 'the choice shows A selected, the song still picked');
    await o.click('#now .now-keys [data-key="G"]');
    await o.waitForFunction(() => document.querySelector('#now .now-item .now-item-key').textContent === 'G', null, { timeout: 5000 });
    check((await app.api(owner, 'GET', `/api/events/${E}`)).body.items[0].transpose === 0, 'back to G: no transposition');
    const verse = (await app.api(owner, 'GET', `/api/events/${E}`)).body.items[1];
    check(verse.reference === 'Luca 2:1-7' && verse.body.startsWith('În zilele'), 'the other items are untouched by the save');
    await o.screenshot({ path: process.env.WA_SHOT || '/dev/null' }).catch(() => {});
    await o.context().close();
  },
};
