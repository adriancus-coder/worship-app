'use strict';

// "+ Eveniment nou" in one tap: the event is created at once with the defaults (the next
// usual service day and time, ten random songs) and the editor opens with the "Detalii" row
// open; name / date / time change inline; a member sees the new event at once; the church's
// usual day and time in the settings.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'quick-create',
  async run({ app, signIn, check }) {
    const nextSunday = (today) => {
      const d = new Date(`${today}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7));
      return d.toISOString().slice(0, 10);
    };
    for (const [lang, width] of [['ro', 375], ['en', 1024]]) {
      const tag = `[${lang} ${width}]`;
      // songs the random ideas can draw from (the seed's three, and the previous round's, are in recent events)
      for (let i = 1; i <= 4; i += 1) await app.api(app.cookies.owner, 'POST', '/api/songs', { title: `Nouă ${lang} ${i}`, song_key: 'G', sections: [{ type: 'verse', content: `Rând ${i}` }] });
      const m = await signIn('member', { width: 375, lang });
      await m.goto(`${app.url}/events`);
      await m.waitForSelector('#events li');
      const before = await m.locator('#events li').count();
      const p = await signIn('leader', { width, lang });
      await p.goto(`${app.url}/events`);
      await p.waitForSelector('#new-event:not([hidden])');
      await p.click('#new-event');
      await p.waitForURL(/\/events\/\d+\/edit$/);
      await p.waitForSelector('#quick-details[open]:not([hidden])');
      const id = Number(new URL(p.url()).pathname.split('/')[2]);
      const ev = (await app.api(app.cookies.owner, 'GET', `/api/events/${id}`)).body;
      const sunday = nextSunday(ev.today);
      check((lang === 'ro' ? ev.event.name === 'Serviciu de duminică' : /service/i.test(ev.event.name)) && ev.event.eventDate >= ev.today && new Date(`${ev.event.eventDate}T12:00:00Z`).getUTCDay() === 0 && ev.items.length >= 1 && ev.items.every((it) => it.type === 'song'),
        `${tag} one tap: "${ev.event.name}" on Sunday ${ev.event.eventDate} (next Sunday ${sunday}), ${ev.items.length} random songs`);
      check(await p.evaluate(() => !document.querySelector('#quick-details [data-source="template"]') && !document.getElementById('q-template')), `${tag} the editor opens with "Detalii" open, no template picker`);
      const a = await layoutAudit(p, '#quick-details');
      check(!a.overflow && !a.small.length, `${tag} "Detalii": no overflow, targets >= 44 px`, a);
      await p.fill('#q-name', `Seară ${lang}`);
      await p.press('#q-name', 'Tab');
      await p.waitForFunction(() => /Salvat|Saved/.test(document.getElementById('quick-message').textContent), null, { timeout: 4000 });
      check((await app.api(app.cookies.owner, 'GET', `/api/events/${id}`)).body.event.name === `Seară ${lang}`, `${tag} the name changes inline (saved)`);
      await p.fill('#q-time', '18:00');
      await p.press('#q-time', 'Tab');
      await wait(500);
      check((await app.api(app.cookies.owner, 'GET', `/api/events/${id}`)).body.event.startTime === '18:00', `${tag} the time changes inline`);
      await m.reload();
      await m.waitForSelector('#events li');
      check(await m.locator('#events li').count() === before + 1, `${tag} the member sees the new event at once`);
      await p.context().close();
      await m.context().close();
    }
    // The church's usual day and time
    const o = await signIn('owner', { width: 1024 });
    await o.goto(`${app.url}/settings`);
    await o.waitForSelector('#service-day option', { state: 'attached' });
    await o.selectOption('#service-day', '3');
    await o.waitForFunction(() => /salvat/i.test(document.getElementById('service-message').textContent), null, { timeout: 4000 });
    await o.fill('#service-time', '18:30');
    await o.press('#service-time', 'Tab');
    await wait(500);
    check(JSON.stringify((await app.api(app.cookies.owner, 'GET', '/api/settings')).body.service) === '{"weekday":3,"time":"18:30"}', 'settings: the usual service day and time are saved');
  },
};
