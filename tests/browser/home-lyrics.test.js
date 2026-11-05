'use strict';

// The home card's programme (public/app.js): a tap on a song opens the whole song under its
// row (transposed, sections in the event's order); a tap on a section opens "⤢ Versuri
// mari" (public/big-lyrics.js, standalone: its own place) with ← → / swipes through the
// song's steps and on into the next song; ✕ returns to the card, where another song can be
// opened. The editors change the key from the key badge now. A member at 375, the owner
// at 1024.

const { layoutAudit, laterAnswers, wait } = require('./harness');

module.exports = {
  name: 'home-lyrics',
  timeout: 180000,
  async run({ app, signIn, check }) {
    const owner = app.cookies.owner;
    const { eventId: E, songs } = app.seed;
    // the first song transposed by 2 for this event: the opened song shows the transposed chords
    await window_transpose(app, owner, E, 2);
    const m = await signIn('member', { width: 375, lang: 'ro' });
    await m.waitForSelector('#now .now-items');
    const rows = await m.evaluate(() => [...document.querySelectorAll('#now .now-item')].map((li) => ({ button: Boolean(li.querySelector('button.now-item-button')), expanded: li.querySelector('button.now-item-button') && li.querySelector('button.now-item-button').getAttribute('aria-expanded'), keyButton: Boolean(li.querySelector('button.now-item-key')) })));
    check(rows.length === 5 && rows[0].button && rows[0].expanded === 'false' && !rows[1].button && rows.every((r) => !r.keyButton), 'member: the songs are buttons (closed), the verse is not, no key button', rows);
    await m.click('#now .now-item:nth-child(1) .now-item-button');
    await m.waitForSelector('#now-song-' + app.seed.items[0] + ' .song-section');
    const opened = await m.evaluate(() => ({
      labels: [...document.querySelectorAll('#now .now-song h3')].map((h) => h.textContent),
      chord: document.querySelector('#now .now-song .chord-line') && document.querySelector('#now .now-song .chord-line').textContent.trim().split(/\s+/)[0],
      lyric: document.querySelector('#now .now-song .lyric-line') && document.querySelector('#now .now-song .lyric-line').textContent.trim(),
      expanded: document.querySelector('#now .now-item:nth-child(1) .now-item-button').getAttribute('aria-expanded'),
    }));
    check(opened.labels.length === 2 && /Strofa 1/.test(opened.labels[0]) && /Refren/.test(opened.labels[1]) && opened.chord === 'A' && /Ne ridici/.test(opened.lyric) && opened.expanded === 'true', 'a tap: the whole song under the row, in the event\'s key (A), its sections', opened);
    const a = await layoutAudit(m, '#now');
    check(!a.overflow && !a.small.length, 'the card with a song open 375: no overflow, targets >= 44 px', a);
    // a section: the big view at that step; → to the chorus, → on into the next song; ✕ back
    await m.click('#now .now-song .song-section >> nth=1');
    await m.waitForSelector('dialog.big-lyrics[open]');
    await m.waitForFunction(() => /Refren/.test(document.querySelector('dialog.big-lyrics .big-label').textContent));
    const big1 = await m.evaluate(() => ({ label: document.querySelector('dialog.big-lyrics .big-label').textContent, text: document.querySelector('dialog.big-lyrics .big-text').innerText.slice(0, 40), close: Boolean(document.querySelector('dialog.big-lyrics .big-close')), exit: Boolean(document.querySelector('dialog.big-lyrics .big-exit')), status: Boolean(document.querySelector('dialog.big-lyrics .big-status')) }));
    check(/Refren/.test(big1.label) && /Sfânt/.test(big1.text) && big1.close && big1.exit && !big1.status, 'the chorus tapped: the big view at the chorus, ✕ at the top and "Ieși" below, no live status line', big1);
    await m.click('dialog.big-lyrics .big-nav > button:last-child');
    await m.waitForFunction(() => /Șase rânduri/.test(document.querySelector('dialog.big-lyrics .big-label').textContent), null, { timeout: 5000 });
    check(await m.evaluate(() => document.querySelector('#now .now-item:nth-child(3)').classList.contains('is-open')), '"Înainte →" past the song: the next song, opened under its row too');
    await m.click('dialog.big-lyrics .big-nav .big-exit');
    await m.waitForSelector('dialog.big-lyrics[open]', { state: 'detached' }).catch(() => null);
    await wait(200);
    check(!(await m.locator('dialog.big-lyrics[open]').count()) && await m.evaluate(() => Boolean(document.querySelector('#now .now-item:nth-child(3) .now-song'))), '"Ieși": back on the card, the song still open');
    // another song: a tap closes the first and opens this one
    await m.click('#now .now-item:nth-child(5) .now-item-button');
    await m.waitForSelector('#now-song-' + app.seed.items[4] + ' .song-section');
    check(await m.evaluate(() => document.querySelectorAll('#now .now-song').length === 1 && document.querySelector('#now .now-item:nth-child(5)').classList.contains('is-open')), 'another song: the open one changes');
    await m.context().close();

    // the owner: the row opens the song too; the key badge is the key picker
    const o = await signIn('owner', { width: 1024, lang: 'ro' });
    await laterAnswers(o);
    await o.waitForSelector('#now .now-items');
    await o.click('#now .now-item:nth-child(1) .now-item-key');
    await o.waitForSelector('#now .now-keys');
    check((await o.$eval('#now .now-keys [aria-pressed="true"]', (b) => b.dataset.key)) === 'A', 'the owner: the key badge opens the key choice (A selected)');
    await o.click('#now .now-item:nth-child(1) .now-item-button');
    await o.waitForSelector('#now .now-song .song-section');
    check(await o.evaluate(() => Boolean(document.querySelector('#now .now-keys'))), 'the row opens the song; the key choice stays');
    // another song's row: the first song's key choice closes with its box (one current song)
    await o.click('#now .now-item:nth-child(3) .now-item-button');
    await o.waitForSelector('#now-song-' + app.seed.items[2] + ' .song-section');
    check(await o.evaluate(() => !document.querySelector('#now .now-keys') && document.querySelectorAll('#now .now-song').length === 1 && !document.querySelector('#now .now-item.is-picked')), 'another song tapped: the previous key choice and box close');
    // its key badge while the third is open: the box closes, the key choice is this song's
    await o.click('#now .now-item:nth-child(1) .now-item-key');
    await o.waitForSelector('#now .now-keys');
    check(await o.evaluate(() => document.querySelectorAll('#now .now-song').length === 0 && document.querySelector('#now .now-item:nth-child(1)').classList.contains('is-picked')), 'another song\'s key badge: the open box closes, the choice moves');
    await window_transpose(app, owner, E, 0);
  },
};

async function window_transpose(app, owner, E, transpose) {
  const res = await app.api(owner, 'GET', `/api/events/${E}`);
  const items = res.body.items.map((it) => ({ id: it.id, type: it.type, songId: it.songId, title: it.title, body: it.body, reference: it.reference, url: it.url, who: it.who, mediaId: it.mediaId, durationMin: it.durationMin, teamNote: it.teamNote || '', ...(it.type === 'song' ? { transpose: it.transpose || 0, arrangement: it.arrangementIsDefault ? '' : it.arrangement || '', referenceUrl: it.referenceUrl || '' } : {}) }));
  items[0].transpose = transpose;
  await app.api(owner, 'PUT', `/api/events/${E}/items`, { items });
}
