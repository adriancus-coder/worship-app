'use strict';

// "Detectează gama" on the song page (public/key-detect-ui.js): for a song without a key the
// editor roles get the button next to "Tonul nu e setat"; the pop-up estimates the key from
// the chords (best key, two more, the confidence), the user picks and confirms, the key is
// saved. A song without chords gets the recording block: an uploaded WAV (generated here,
// G - C - D - G sine waves) comes out G. A key already set is replaced only after a second
// confirmation. The team sees no button. 375 and 1024.

const { layoutAudit } = require('./harness');

// A 16-bit PCM mono WAV of the chords G, C, D, G (2 s each) as sine waves.
function wav() {
  const sr = 22050;
  const seconds = 2;
  const notes = { G: [196, 246.94, 293.66], C: [261.63, 329.63, 392], D: [293.66, 369.99, 440] };
  const sequence = ['G', 'C', 'D', 'G'];
  const count = sr * seconds * sequence.length;
  const buffer = Buffer.alloc(44 + count * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + count * 2, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sr, 24); buffer.writeUInt32LE(sr * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(count * 2, 40);
  sequence.forEach((chord, c) => {
    for (let i = 0; i < sr * seconds; i += 1) {
      let v = 0;
      for (const hz of notes[chord]) v += Math.sin((2 * Math.PI * hz * i) / sr);
      buffer.writeInt16LE(Math.round((v / 3) * 0.5 * 32767), 44 + (c * sr * seconds + i) * 2);
    }
  });
  return buffer;
}

module.exports = {
  name: 'key-detect',
  timeout: 240000,
  async run({ app, signIn, check }) {
    const owner = app.cookies.owner;
    const withChords = (await app.api(owner, 'POST', '/api/songs', { title: 'Fără ton, cu acorduri', sections: [
      { type: 'verse', content: '[Am]Doamne, [F]Tu ești [C]bun, [G]mereu\n[Am]Doamne, [F]Tu ești [G]scut, [Am]mereu' }] })).body.song.id;
    const noChords = (await app.api(owner, 'POST', '/api/songs', { title: 'Fără ton, fără acorduri', sections: [
      { type: 'verse', content: 'Doar versuri aici\nȘi încă un rând' }] })).body.song.id;

    // --- from the chords, phone -----------------------------------------------------------
    const p = await signIn('owner', { width: 375, lang: 'ro' });
    await p.goto(`${app.url}/songs/${withChords}`);
    await p.waitForSelector('#song-key-box .song-key-detect');
    const row = await p.$eval('#song-key-box', (x) => x.textContent.replace(/\s+/g, ' ').trim());
    check(/Tonul nu e setat.*Setează.*Detectează gama/.test(row), 'without a key: "Tonul nu e setat · Setează · Detectează gama"', row);
    await p.click('#song-key-box .song-key-detect');
    await p.waitForSelector('#key-detect-dialog[open]');
    const d = await p.evaluate(() => ({
      key: document.getElementById('key-detect-key').textContent,
      confidence: document.getElementById('key-detect-confidence').textContent.trim(),
      choices: [...document.querySelectorAll('#key-detect-dialog .key-detect-choices button')].map((b) => [b.dataset.key, b.getAttribute('aria-pressed')]),
      source: document.querySelector('#key-detect-dialog .key-detect-source').textContent,
      save: document.getElementById('key-detect-save').textContent,
      audioOpen: Boolean(document.getElementById('key-detect-audio-open')),
      upload: Boolean(document.getElementById('key-detect-upload')),
    }));
    check(d.key === 'Am' && d.confidence === '· Sigur' && d.choices.length === 3 && d.choices[0][0] === 'Am' && d.choices[0][1] === 'true' && d.choices.slice(1).every((c) => c[1] === 'false'),
      'the pop-up: Am, "Sigur", three candidates with Am selected', d);
    check(/8 acorduri/.test(d.source) && /Salvează gama Am/.test(d.save) && d.audioOpen && !d.upload, 'from the chords (8); the recording block only on request', d);
    const a = await layoutAudit(p, '#key-detect-dialog');
    check(!a.overflow && !a.small.length, 'the pop-up 375: no overflow, targets >= 44 px', a);
    // choose the second candidate, then back to the first, and save
    await p.click('#key-detect-dialog .key-detect-choices button >> nth=1');
    const second = await p.$eval('#key-detect-save', (x) => x.textContent);
    check(second === `Salvează gama ${d.choices[1][0]}`, 'a chosen candidate goes into the save button', second);
    await p.click('#key-detect-dialog .key-detect-choices button >> nth=0');
    await p.click('#key-detect-save');
    await p.waitForSelector('#key-detect-dialog:not([open])', { state: 'attached' });
    await p.waitForSelector('#song-key-box .song-key-value');
    const saved = (await app.api(owner, 'GET', `/api/songs/${withChords}`)).body.song.song_key;
    const shown = await p.$eval('#song-key-box', (x) => x.textContent.replace(/\s+/g, ' ').trim());
    check(saved === 'Am' && /Ton:\s*Am/.test(shown) && !/Detectează/.test(shown), 'saved: Am on the server and on the page; the button gone once the key is set', { saved, shown });

    // --- replacing a key asks again ---------------------------------------------------------
    await p.click('#song-key-box .song-key-change');
    await p.waitForSelector('#song-key-box .song-key-detect');
    await p.click('#song-key-box .song-key-detect');
    await p.waitForSelector('#key-detect-dialog[open]');
    await p.click('#key-detect-dialog .key-detect-choices button >> nth=1');
    const warn = await p.$eval('#key-detect-dialog .key-detect-replace', (x) => x.textContent);
    await p.click('#key-detect-save');
    await p.waitForSelector('#key-detect-replace');
    const ask = await p.evaluate(() => ({ text: document.getElementById('key-detect-replace').textContent, button: document.getElementById('key-detect-save').textContent, open: document.getElementById('key-detect-dialog').open }));
    const still = (await app.api(owner, 'GET', `/api/songs/${withChords}`)).body.song.song_key;
    check(/are deja gama Am/.test(warn) && /Înlocuiești gama Am cu/.test(ask.text) && ask.button === 'Da, înlocuiește' && ask.open && still === 'Am',
      'another key over one already set: a warning, then "Înlocuiești…?" and nothing saved yet', { warn, ask, still });
    await p.click('#key-detect-save');
    await p.waitForSelector('#key-detect-dialog:not([open])', { state: 'attached' });
    const replaced = (await app.api(owner, 'GET', `/api/songs/${withChords}`)).body.song.song_key;
    check(replaced === d.choices[1][0], 'confirmed: the key replaced', replaced);

    // --- from a recording (an uploaded WAV), desktop -------------------------------------
    const o = await signIn('owner', { width: 1024, lang: 'ro' });
    await o.goto(`${app.url}/songs/${noChords}`);
    await o.waitForSelector('#song-key-box .song-key-detect');
    await o.click('#song-key-box .song-key-detect');
    await o.waitForSelector('#key-detect-dialog[open]');
    const audio = await o.evaluate(() => ({ result: Boolean(document.querySelector('#key-detect-dialog .key-detect-result')), upload: Boolean(document.getElementById('key-detect-upload')), record: Boolean(document.getElementById('key-detect-record')), intro: document.querySelector('#key-detect-dialog .key-detect-audio p').textContent }));
    check(!audio.result && audio.upload && audio.record && /nu are acorduri/.test(audio.intro), 'no chords: the recording block (upload + record), no result yet', audio);
    await o.setInputFiles('#key-detect-file', { name: 'refren.wav', mimeType: 'audio/wav', buffer: wav() });
    await o.waitForSelector('#key-detect-key', { timeout: 60000 });
    const fromAudio = await o.evaluate(() => ({ key: document.getElementById('key-detect-key').textContent, source: document.querySelector('#key-detect-dialog .key-detect-source').textContent, confidence: document.getElementById('key-detect-confidence').textContent.trim() }));
    check(fromAudio.key === 'G' && /fișierul/.test(fromAudio.source), 'the WAV of G - C - D - G: G, "from the uploaded file"', fromAudio);
    await o.click('#key-detect-save');
    await o.waitForSelector('#key-detect-dialog:not([open])', { state: 'attached' });
    const savedAudio = (await app.api(owner, 'GET', `/api/songs/${noChords}`)).body.song.song_key;
    check(savedAudio === 'G', 'saved from the recording: G', savedAudio);

    // --- the team: no button -----------------------------------------------------------------
    const m = await signIn('member', { width: 375, lang: 'ro' });
    const third = (await app.api(owner, 'POST', '/api/songs', { title: 'A treia fără ton', sections: [{ type: 'verse', content: '[C]a [G]b' }] })).body.song.id;
    await m.goto(`${app.url}/songs/${third}`);
    await m.waitForSelector('#song-key-box');
    const member = await m.evaluate(() => ({ detect: Boolean(document.querySelector('.song-key-detect')), text: document.getElementById('song-key-box').textContent.trim(), script: Boolean(window.KEY_DETECT_UI) }));
    check(!member.detect && member.text === 'Tonul nu e setat', 'a member: "Tonul nu e setat", no button', member);
  },
};
