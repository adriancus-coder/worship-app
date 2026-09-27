'use strict';

// The event editor's song panel sets the library song's original key: a keyless song shows
// "Tonul original: [selector] · Setează" instead of "Fără transpunere (cântarea nu are ton)";
// Setează saves song_key on the library song (sections untouched, the editor stays clean)
// and the −/+ row shows key names at once ("A · original G · +2"); with a key the row
// "Original: Sol · Schimbă" changes it the same way; members / read-only see text only.
// RO 375 / EN 1024 / RO 1180.

const { layoutAudit } = require('./harness');

module.exports = {
  name: 'panel-key',
  timeout: 240000,
  async run({ app, signIn, check }) {
    const owner = app.cookies.owner;
    const song = async (id) => (await app.api(owner, 'GET', `/api/songs/${id}`)).body.song;
    const hashes = (s) => JSON.stringify(s.sections.map((x) => x.content_hash));
    for (const [lang, width] of [['ro', 375], ['en', 1024], ['ro', 1180]]) {
      const tag = `[${lang} ${width}]`;
      // a fresh keyless song in a fresh planned event
      const songId = (await app.api(owner, 'POST', '/api/songs', { title: `Fără ton ${width}`, sections: [{ type: 'verse', content: '[C]Un [G]rând\n[Am]Alt [F]rând' }, { type: 'chorus', content: '[F]Refren' }] })).body.song.id;
      const eventId = (await app.api(owner, 'POST', '/api/events', { name: `Test ${width}`, eventDate: app.seed.today, startTime: '18:00' })).body.event.id;
      await app.api(owner, 'PUT', `/api/events/${eventId}/items`, { items: [{ type: 'song', songId }] });
      const before = await song(songId);

      const p = await signIn('presenter', { width, lang });
      await p.goto(`${app.url}/events/${eventId}/edit`);
      await p.waitForSelector('#items .item-main');
      await p.locator('#items .item-main').first().click();
      await p.waitForSelector('#opt-original-key select.key-pick');
      const notation = await p.evaluate((keys) => Object.fromEntries(keys.map((k) => [k, window.NOTATION.chord(k)])), ['G', 'A', 'D', 'E']);
      const unset = await p.evaluate(() => { const box = document.getElementById('opt-original-key'); return { label: box.querySelector('.song-key-label').textContent, select: Boolean(box.querySelector('select.key-pick')), save: box.querySelector('.song-key-save').textContent, display: Boolean(document.getElementById('opt-key-display')), cancel: Boolean(box.querySelector('.song-key-cancel')) }; });
      check(/^(Tonul original|Original key):$/.test(unset.label) && unset.select && /^(Setează|Set it)$/.test(unset.save) && !unset.display && !unset.cancel, `${tag} no key: "Tonul original: [selector] · Setează" replaces "Fără transpunere", no −/+ row`, unset);
      await p.selectOption('#opt-original-key select.key-pick', 'G');
      await p.click('#opt-original-key .song-key-save');
      await p.waitForSelector('#opt-key-display');
      const saved = await song(songId);
      check(saved.song_key === 'G' && hashes(saved) === hashes(before), `${tag} Setează: the library song has key G, sections and hashes untouched`);
      check(!(await p.$eval('#save-bar', (x) => x.classList.contains('dirty'))), `${tag} setting the key does not mark the event unsaved`);
      const orig = (await p.textContent('#opt-original-key')).replace(/\s+/g, ' ').trim();
      check(new RegExp(`^Original:\\s*${notation.G}\\s*·\\s*(Schimbă|Change)$`).test(orig), `${tag} then "Original: ${notation.G} · Schimbă" above the −/+ row`, orig);
      await p.click('#opt-key-up');
      await p.click('#opt-key-up');
      const display = await p.textContent('#opt-key-display');
      check(display === `${notation.A} · original ${notation.G} · +2`, `${tag} −/+ shows key names at once: "${notation.A} · original ${notation.G} · +2"`, display);
      // Schimbă: an existing key
      await p.click('#opt-original-key .song-key-change');
      await p.selectOption('#opt-original-key select.key-pick', 'D');
      await p.click('#opt-original-key .song-key-save');
      await p.waitForFunction((k) => document.getElementById('opt-key-display').textContent === k, `${notation.E} · original ${notation.D} · +2`);
      check((await song(songId)).song_key === 'D', `${tag} Schimbă: the key is D, the transposition follows ("${notation.E} · original ${notation.D} · +2")`);
      const a = await layoutAudit(p, '#detail');
      check(!a.overflow && !a.small.length, `${tag} the panel: no overflow, targets >= 44 px`, a);
      await p.context().close();

      // a member: text only
      const m = await signIn('member', { width, lang });
      await m.goto(`${app.url}/events/${eventId}`);
      await m.waitForSelector('#items .item-main');
      await m.locator('#items .item-main').first().click();
      await m.waitForSelector('#detail .key-display');
      const ro = await m.evaluate(() => ({ text: document.querySelector('#detail .key-display').textContent, controls: document.querySelectorAll('#detail select.key-pick, #detail .song-key-change, #opt-key-up').length }));
      check(ro.controls === 0 && new RegExp(`^${notation.D} `).test(ro.text), `${tag} member: the key as text only`, ro);
      await m.context().close();
    }
  },
};
