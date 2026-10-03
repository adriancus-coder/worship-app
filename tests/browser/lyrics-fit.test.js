'use strict';

// The lyrics auto-fit: a song with long Romanian lines on /screen at 1920x1080, 1280x720 and
// 1024x768 (4:3): every stored line is its own line, no line wraps while the size stays
// above 60 % of the maximum, else wrapped lines are balanced rows of whole words with no
// row under 3 words; everything inside the 5 % margins; a short-line song never wraps. The
// leader's preview and the big-lyrics view ("Doar text") follow the same rule.

const { wait } = require('./harness');

const LONG = [
  'Și dacă toate cerurile s-ar deschide deodată peste noi cu slava Ta cea mare și nesfârșită',
  'Noi tot am cânta cu inimile pline de recunoștință și cu ochii ridicați spre Tine, Doamne',
  'Amin',
];

// Every visible row inside the fitted lines: [{ text, words, right, left }] plus the box.
const rowsOf = (page, root, lineSelector) => page.evaluate(({ root, lineSelector }) => {
  const box = document.querySelector(`${root} .projector-text, ${root} .big-text`);
  const lines = [...document.querySelectorAll(`${root} ${lineSelector}`)];
  const rows = lines.flatMap((line) => (line.classList.contains('fit-wrapped') ? [...line.querySelectorAll('.fit-row')] : [line])
    .map((node) => { const r = node.getBoundingClientRect(); return { text: node.textContent.trim(), words: node.textContent.trim().split(/\s+/).length, wrapped: line.classList.contains('fit-wrapped'), height: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right) }; }));
  const b = box ? box.getBoundingClientRect() : null;
  return { lines: lines.length, rows, font: box ? parseFloat(getComputedStyle(box).fontSize) : 0, box: b ? { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), scrollW: box.scrollWidth, clientW: box.clientWidth, scrollH: box.scrollHeight, clientH: box.clientHeight } : null };
}, { root, lineSelector });

module.exports = {
  name: 'lyrics-fit',
  timeout: 300000,
  async run({ app, browser, signIn, check }) {
    const owner = app.cookies.owner;
    const { eventId: E } = app.seed;
    const longId = (await app.api(owner, 'POST', '/api/songs', { title: 'Rânduri lungi', song_key: 'G', sections: [{ type: 'verse', content: LONG.map((l, i) => (i ? l : `[G]${l}`)).join('\n') }] })).body.song.id;
    const items = (await app.api(owner, 'GET', `/api/events/${E}`)).body.items.map(({ id, type, songId, reference, body, title }) => ({ id, type, songId, reference, body, title }));
    items.push({ type: 'song', songId: longId });
    await app.api(owner, 'PUT', `/api/events/${E}/items`, { items });
    const all = (await app.api(owner, 'GET', `/api/events/${E}`)).body.items;
    const longItem = all.find((it) => it.songId === longId).id;
    const shortItem = all[0].id; // "Sfânt în G"
    check((await app.command({ type: 'event.start' })).ok, 'the event is live');

    const sp = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
    await sp.goto(`${app.url}/screen`);
    await sp.waitForFunction(() => /\d{3} \d{3}/.test(document.getElementById('pairing-code').textContent));
    await app.api(owner, 'POST', '/api/screens/claim', { code: (await sp.textContent('#pairing-code')).replace(' ', ''), name: 'Proiector' });
    await sp.waitForSelector('#output:not([hidden])', { timeout: 6000 });
    await app.command({ type: 'projector.source', source: 'content' });
    await app.command({ type: 'worship.goto', itemId: longItem, step: 0 });
    await sp.waitForFunction(() => /nesfârșită/.test(document.querySelector('#output .projector-stage').innerText), null, { timeout: 4000 });

    for (const [w, h] of [[1920, 1080], [1280, 720], [1024, 768]]) {
      const tag = `${w}x${h}`;
      await sp.setViewportSize({ width: w, height: h });
      await wait(400);
      const r = await rowsOf(sp, '#output', '.projector-line');
      const inside = r.box && r.box.left >= w * 0.05 - 1 && r.box.right <= w * 0.95 + 1 && r.box.top >= h * 0.05 - 1 && r.box.bottom <= h * 0.95 + 1 && r.box.scrollW <= r.box.clientW + 1 && r.box.scrollH <= r.box.clientH + 1;
      check(r.lines === 3 && inside, `${tag}: the three stored lines, the box inside the 5 % margins`, r);
      const wrappedRows = r.rows.filter((x) => x.wrapped);
      check(wrappedRows.length > 0 && wrappedRows.every((x) => x.words >= 3), `${tag}: the long lines wrap into ${wrappedRows.length} balanced rows, none under 3 words (${wrappedRows.map((x) => x.words).join('/')} words)`, wrappedRows.map((x) => x.text));
      check(r.rows.every((x) => x.left >= w * 0.05 - 1 && x.right <= w * 0.95 + 1) && r.rows[r.rows.length - 1].text === 'Amin', `${tag}: every row inside the width; "Amin" stays its own line`, r.rows.map((x) => x.text));
      const joined = r.rows.filter((x) => x.wrapped).map((x) => x.text).join(' ');
      check(joined === `${LONG[0]} ${LONG[1]}`, `${tag}: every word kept, in order`, joined);
      check(r.font >= h * 0.12 * 0.6 - 0.5 || r.rows.length >= 4, `${tag}: size ${Math.round(r.font)} px (max ${Math.round(h * 0.12)}; wrapping only below 60 %)`, r.font);
    }
    // the short-line song: nothing wraps, the largest size
    await app.command({ type: 'worship.goto', itemId: shortItem, step: 0 });
    await sp.waitForFunction(() => /Ne ridici/.test(document.querySelector('#output .projector-stage').innerText), null, { timeout: 4000 });
    await wait(300);
    const s = await rowsOf(sp, '#output', '.projector-line');
    check(s.lines === 2 && s.rows.every((x) => !x.wrapped) && s.font >= 768 * 0.12 * 0.6 && s.box.scrollW <= s.box.clientW + 1, `short lines at 1024x768: no wrapping, the largest size that fits the width (${Math.round(s.font)} px)`, s);

    // the leader's preview (1280 wide page): the same rule
    await app.command({ type: 'worship.goto', itemId: longItem, step: 0 });
    const lp = await signIn('leader', { width: 1280 });
    await lp.evaluate(() => { try { localStorage.setItem('wa_text_only', '1'); localStorage.removeItem('wa_big_scale'); } catch (e) {} }); // read when the page loads
    await lp.goto(`${app.url}/events/${E}/live?view=full`);
    await lp.waitForSelector('#live:not([hidden])');
    await lp.waitForFunction(() => /nesfârșită/.test(document.querySelector('#projector-preview .projector-stage').innerText), null, { timeout: 5000 });
    await wait(300);
    const pv = await rowsOf(lp, '#projector-preview', '.projector-line');
    check(pv.lines === 3 && pv.rows.filter((x) => x.wrapped).every((x) => x.words >= 3) && pv.box.scrollW <= pv.box.clientW + 1, 'the preview: balanced rows, no short tails, no overflow', pv.rows.map((x) => `${x.words}:${x.text}`));
    // the big lyrics, "Doar text": the same rule (with chords the columns never wrap)
    await lp.click('#big-open');
    await lp.waitForSelector('dialog.big-lyrics[open]');
    await lp.waitForFunction(() => document.querySelector('dialog.big-lyrics .big-line'), null, { timeout: 4000 });
    await wait(300);
    const bl = await rowsOf(lp, 'dialog.big-lyrics', '.big-line');
    check(bl.lines === 3 && bl.rows.filter((x) => x.wrapped).every((x) => x.words >= 3) && bl.rows[bl.rows.length - 1].text === 'Amin' && bl.box.scrollW <= bl.box.clientW + 1, 'big lyrics (Doar text, 1280): balanced rows, no short tails, "Amin" alone', bl.rows.map((x) => `${x.words}:${x.text}`));
    await lp.context().close();
    const m = await signIn('member', { width: 375 });
    await m.evaluate(() => { try { localStorage.setItem('wa_text_only', '1'); } catch (e) {} });
    await m.goto(`${app.url}/events/${E}/follow`);
    await m.waitForSelector('#big-open:not([hidden])');
    await m.click('#big-open');
    await m.waitForSelector('dialog.big-lyrics[open]');
    await m.waitForFunction(() => document.querySelector('dialog.big-lyrics .big-line'), null, { timeout: 4000 });
    await wait(300);
    const bm = await rowsOf(m, 'dialog.big-lyrics', '.big-line');
    check(bm.rows.filter((x) => x.wrapped).every((x) => x.words >= 3) && bm.box.scrollW <= bm.box.clientW + 1, 'big lyrics on a phone (375): balanced rows, no short tails, no overflow', bm.rows.map((x) => `${x.words}:${x.text}`));
  },
};
