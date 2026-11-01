'use strict';

// The backing track ("negativ", migration 062): the song's editors upload an audio file on
// the song page (POST /api/songs/:id/audio, the body is the file; MP3 / M4A / WAV / OGG by
// their first bytes), everyone plays it there; the operator console shows the player for
// the song on the projector and marks such songs in the list; DELETE removes the file. The
// school right sets it on the school's songs only. 375 and 1024.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { layoutAudit, PASSWORD } = require('./harness');

// a short 16-bit mono WAV (0.3 s of a sine)
function wav() {
  const sr = 8000;
  const count = Math.round(sr * 0.3);
  const buffer = Buffer.alloc(44 + count * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + count * 2, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sr, 24); buffer.writeUInt32LE(sr * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i += 1) buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sr) * 12000), 44 + i * 2);
  return buffer;
}
// the first bytes of an MP3 with an ID3 tag, padded
const mp3 = () => Buffer.concat([Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00'), Buffer.alloc(2000)]);

module.exports = {
  name: 'song-audio',
  timeout: 240000,
  async run({ app, signIn, check, browser }) {
    const owner = app.cookies.owner;
    const { songs, eventId: E } = app.seed;
    const raw = (cookie, method, url, body, type) => fetch(`${app.url}${url}`, { method, headers: { Cookie: cookie, 'Content-Type': type }, body }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

    // --- the API ----------------------------------------------------------------------------
    const bad = await raw(owner, 'POST', `/api/songs/${songs.G}/audio`, Buffer.from('not audio at all, just text that is long enough'), 'audio/mpeg');
    check(bad.status === 400 && /MP3/.test(bad.body.error), 'a file that is no audio: 400', bad);
    check((await raw(app.cookies.member, 'POST', `/api/songs/${songs.G}/audio`, wav(), 'audio/wav')).status === 403, 'a member: 403');
    const up = await raw(owner, 'POST', `/api/songs/${songs.G}/audio`, mp3(), 'audio/mpeg');
    check(up.status === 201 && up.body.audio && up.body.audio.mime === 'audio/mpeg' && /^\/api\/media\/\d+\/file$/.test(up.body.audio.src), 'an MP3 (by its ID3 tag) saved as the track', up.body);
    const first = up.body.audio.id;
    const song = (await app.api(owner, 'GET', `/api/songs/${songs.G}`)).body.song;
    check(song.audioMediaId === first && song.audio && song.audio.id === first, 'GET song: the track', { audioMediaId: song.audioMediaId, audio: song.audio });
    const served = await fetch(`${app.url}${song.audio.src}`, { headers: { Cookie: app.cookies.member } });
    check(served.status === 200 && served.headers.get('content-type') === 'audio/mpeg', 'the file is served to a signed-in member', served.status);
    check(!(await app.api(owner, 'GET', '/api/media')).body.media.some((m) => m.id === first), 'the media page does not list it (it belongs to the song)');
    const again = await raw(owner, 'POST', `/api/songs/${songs.G}/audio`, wav(), 'audio/wav');
    check(again.status === 201 && again.body.audio.id !== first && again.body.audio.mime === 'audio/wav' && (await fetch(`${app.url}/api/media/${first}/file`, { headers: { Cookie: owner } })).status === 404, 'a second upload replaces the first (the old file goes)', again.body);
    // the school right: its own songs only
    const role = (await app.api(owner, 'POST', '/api/roles', { name: 'Școala', emoji: '🎒', base: 'member', perms: ['school'] })).body.role;
    const maria = (await app.api(owner, 'POST', '/api/team', { name: 'Maria', email: 'maria@x.ro', role: `custom:${role.id}` })).body.user;
    const db = new Database(path.join(app.dataDir, 'worship.db'));
    db.prepare("UPDATE users SET password_hash = (SELECT password_hash FROM users WHERE email = 'ana@example.ro'), must_change_password = 0 WHERE id = ?").run(maria.id);
    db.close();
    const school = await app.login('maria@x.ro');
    const kids = (await app.api(school, 'POST', '/api/songs', { title: 'Isus mă iubește', sections: [{ type: 'verse', content: 'x' }] })).body.song;
    check((await raw(school, 'POST', `/api/songs/${songs.G}/audio`, wav(), 'audio/wav')).status === 403 && (await raw(school, 'POST', `/api/songs/${kids.id}/audio`, wav(), 'audio/wav')).status === 201, 'the school right: 403 on a church song, 201 on its own');

    // --- the song page: a member plays, the owner replaces / removes ---------------------
    const m = await signIn('member', { width: 375, lang: 'ro' });
    await m.goto(`${app.url}/songs/${songs.G}`);
    await m.waitForSelector('#song-audio-player');
    const member = await m.evaluate(() => ({ src: document.getElementById('song-audio-player').getAttribute('src'), controls: document.getElementById('song-audio-player').controls, add: Boolean(document.getElementById('song-audio-add')), label: document.getElementById('song-audio-label').textContent }));
    check(/\/api\/media\/\d+\/file/.test(member.src) && member.controls && !member.add && member.label === 'Negativ', 'a member: the player, no upload', member);
    const a = await layoutAudit(m, '#song-audio');
    check(!a.overflow, 'the box 375: no overflow', a);
    const o = await signIn('owner', { width: 1024, lang: 'ro' });
    await o.goto(`${app.url}/songs/${songs.SIX}`);
    await o.waitForSelector('#song-audio-add');
    check((await o.textContent('#song-audio-add')).trim() === 'Adaugă negativ' && !(await o.locator('#song-audio-player').count()), 'the owner on a song without a track: "Adaugă negativ", no player');
    await o.setInputFiles('#song-audio-file', { name: 'negativ.wav', mimeType: 'audio/wav', buffer: wav() });
    await o.waitForSelector('#song-audio-player');
    check((await o.textContent('#song-audio-add')).trim() === 'Înlocuiește negativul' && (await o.locator('#song-audio-remove').count()) === 1 && (await app.api(owner, 'GET', `/api/songs/${songs.SIX}`)).body.song.audio !== null, 'uploaded from the page: the player, "Înlocuiește" and "Șterge"');
    o.once('dialog', (d) => d.accept());
    await o.click('#song-audio-remove');
    await o.waitForSelector('#song-audio-player', { state: 'detached' });
    check((await app.api(owner, 'GET', `/api/songs/${songs.SIX}`)).body.song.audio === null, '"Șterge negativul" (confirmed): gone');

    // --- the operator console: the player for the song on the projector, ♪ in the list -----
    check((await app.command({ type: 'event.start' })).ok && (await app.command({ type: 'worship.goto', itemId: app.seed.items[0], step: 0 })).ok, 'the event is live, on the first song');
    const op = await signIn('operator', { width: 1024, lang: 'ro' });
    await op.goto(`${app.url}/events/${E}/operator`);
    await op.waitForSelector('#op-list li');
    await op.waitForFunction(() => !document.getElementById('op-audio').hidden, null, { timeout: 8000 });
    const console1 = await op.evaluate(() => ({ src: document.getElementById('op-audio-player').getAttribute('src'), tags: [...document.querySelectorAll('#op-list .tag-audio')].length, label: document.getElementById('op-audio-label').textContent }));
    check(/\/api\/media\/\d+\/file/.test(console1.src) && console1.tags === 1 && /Negativ/.test(console1.label), 'the operator: the player for the first song (on the projector), ♪ on that song only', console1);
    check((await app.command({ type: 'worship.goto', itemId: app.seed.items[1], step: 0 })).ok, 'the team moves to the verse');
    await op.waitForFunction(() => document.getElementById('op-audio').hidden, null, { timeout: 8000 });
    check(await op.evaluate(() => !document.getElementById('op-audio-player').getAttribute('src')), 'the next item (a verse): no player');
    await app.command({ type: 'event.end' });
  },
};
