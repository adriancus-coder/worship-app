'use strict';

// "Notă pentru echipă" on any Program item (not only songs) and the song page's history.
// The editor writes it on a verse; the team reads it at the rehearsal, on the phone (follow),
// on the live page and in the operator console; the projector never shows it. The song page
// says when the song was last sung and lists the events; a song never sung says so.

const { wait } = require('./harness');

module.exports = {
  name: 'team-note',
  timeout: 240000,
  async run({ app, browser, signIn, check }) {
    const owner = app.cookies.owner;
    const { eventId: E, items, songs } = app.seed;
    const NOTE = 'Citește rar, cu pauză după versetul 3';
    const ev = (await app.api(owner, 'GET', `/api/events/${E}`)).body;
    const payload = ev.items.map((it) => ({ id: it.id, type: it.type, songId: it.songId, title: it.title, body: it.body, reference: it.reference, url: it.url, who: it.who, mediaId: it.mediaId, durationMin: it.durationMin, teamNote: it.type === 'verse' ? NOTE : (it.teamNote || ''), ...(it.type === 'song' ? { transpose: it.transpose || 0, arrangement: it.arrangement || '', referenceUrl: it.referenceUrl || '' } : {}) }));
    const put = await app.api(owner, 'PUT', `/api/events/${E}/items`, { items: payload });
    check(put.status === 200 && put.body.items.find((it) => it.type === 'verse').teamNote === NOTE, 'the API keeps a team note on a verse', put.body);

    // the editor (owner): the field on a verse, the note in view mode
    const p = await signIn('owner', { width: 1024, lang: 'ro' });
    await p.goto(`${app.url}/events/${E}/edit`);
    await p.waitForSelector('#items .item-main');
    await p.click('#items li:nth-child(2) .item-main');
    await p.waitForSelector('#it-team-note');
    check((await p.inputValue('#it-team-note')) === NOTE, 'the editor: "Notă pentru echipă" on the verse');
    await p.goto(`${app.url}/events/${E}`);
    await p.waitForSelector('#items .item-main');
    await p.click('#items li:nth-child(2) .item-main');
    await p.waitForSelector('#detail .team-note');
    check((await p.textContent('#detail .team-note')).includes(NOTE), 'the event page: the note under the verse');
    // the rehearsal
    await p.goto(`${app.url}/events/${E}/rehearse`);
    await p.waitForSelector('.rehearse-slide, #slide-title');
    await p.keyboard.press('ArrowRight');
    const reh = await p.waitForFunction((n) => [...document.querySelectorAll('.team-note')].some((x) => x.textContent.includes(n)), NOTE, { timeout: 4000 }).then(() => true, () => false);
    check(reh, 'the rehearsal: the note on the verse');
    await p.context().close();

    // live: the screen never shows it; the console and the phone do
    const sp = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    await sp.goto(`${app.url}/screen`);
    await sp.waitForFunction(() => /\d{3} \d{3}/.test(document.getElementById('pairing-code').textContent));
    await app.api(owner, 'POST', '/api/screens/claim', { code: (await sp.textContent('#pairing-code')).replace(' ', ''), name: 'Proiector' });
    await sp.waitForSelector('#output:not([hidden])', { timeout: 6000 });
    check((await app.command({ type: 'event.start' })).ok, 'the event is live');
    await app.command({ type: 'worship.goto', itemId: items[1], step: 0 });
    await sp.waitForFunction(() => /Cezar/.test(document.querySelector('#output .projector-stage').innerText), null, { timeout: 5000 }).catch(() => {});
    check(!(await sp.evaluate(() => document.body.innerText)).includes(NOTE), 'the projector: never the note');
    const op = await signIn('operator', { width: 1024, lang: 'ro' });
    await op.goto(`${app.url}/events/${E}/operator`);
    await op.waitForSelector('#op-item-note:not([hidden])', { timeout: 6000 });
    check((await op.textContent('#op-item-note')).includes(NOTE), 'the console: the note under the item title');
    await op.context().close();
    const m = await signIn('member', { width: 375, lang: 'ro' });
    await m.goto(`${app.url}/events/${E}/follow`);
    const onPhone = await m.waitForFunction((n) => [...document.querySelectorAll('.team-note')].some((x) => x.textContent.includes(n)), NOTE, { timeout: 6000 }).then(() => true, () => false);
    check(onPhone, 'the phone (follow): the note under the verse');
    await m.context().close();
    await sp.context().close();

    // the song page: the history (member)
    const s = await signIn('member', { width: 375, lang: 'ro' });
    await s.goto(`${app.url}/songs/${songs.G}`);
    await s.waitForSelector('#song-history:not([hidden])');
    const h = await s.evaluate(() => ({ summary: document.querySelector('#song-history summary').textContent, links: [...document.querySelectorAll('#song-history a')].map((a) => a.getAttribute('href')) }));
    check(/^Cântată ultima dată: \S+, \d+ \S+ · \d+ evenimente/.test(h.summary) && h.links.includes(`/events/${E}`), 'the song page: "Cântată ultima dată: …" and the events it was sung at', h);
    const fresh = (await app.api(owner, 'POST', '/api/songs', { title: 'Nouă nouță', sections: [{ type: 'verse', content: 'Abc' }] })).body.song;
    await s.goto(`${app.url}/songs/${fresh.id}`);
    await s.waitForSelector('#song-history:not([hidden])');
    check((await s.textContent('#song-history summary')) === 'Nu a fost cântată încă la niciun eveniment.', 'a song never sung says so');
    await s.context().close();
  },
};
