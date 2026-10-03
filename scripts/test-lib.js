'use strict';

// Plain-node tests for the shared helpers (no framework). Run by npm run check.

const assert = require('assert');
const { normalizeForSearch, elisionVariants, titleMatches, lyricsMatches, searchSongs } = require('../lib/search');
const chords = require('../lib/chords');
const { sectionLabels } = require('../lib/sections');
const { t } = require('../lib/i18n');

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failures.push(`${name}\n    ${err.message.split('\n').join('\n    ')}`);
  }
}

const q = normalizeForSearch;

// --- search ---------------------------------------------------------------

test('normalizeForSearch: lowercase, diacritics, punctuation and hyphens', () => {
  assert.strictEqual(q('Dacă-ntr-o zi!'), 'daca ntr o zi');
  assert.strictEqual(q('  Sfânt, SFÂNT  ești Tu… '), 'sfant sfant esti tu');
  assert.strictEqual(q('Îți mulțumesc, Țara șesului'), 'iti multumesc tara sesului');
  assert.strictEqual(q('Mitt hjerte, Æ Ø Å'), 'mitt hjerte æ ø a');
  assert.strictEqual(q(null), '');
});

test('elisionVariants: de-elided forms after hyphen/apostrophe + consonant', () => {
  assert.strictEqual(elisionVariants('Dacă-ntr-o zi'), 'intr');
  assert.strictEqual(elisionVariants("Mi-s drag'le tale"), 'is ile');
  assert.strictEqual(elisionVariants('Isus'), '');
  assert.strictEqual(elisionVariants('Isus e-al meu'), '');
  assert.strictEqual(elisionVariants(''), '');
});

test('title: "daca intr-o" finds "Dacă-ntr-o zi"', () => {
  assert.ok(titleMatches(q('daca intr-o'), 'Dacă-ntr-o zi'));
  assert.ok(titleMatches(q('dacă într-o zi'), 'Dacă-ntr-o zi'));
});

test('title: word order does not matter, diacritics ignored', () => {
  assert.ok(titleMatches(q('zi daca'), 'Dacă-ntr-o zi'));
  assert.ok(titleMatches(q('minunat sfant'), 'Sfânt și minunat'));
  assert.ok(titleMatches(q('SFANT'), 'Sfânt și minunat'));
  assert.ok(!titleMatches(q('sfant noapte'), 'Sfânt și minunat'));
});

const LIBRARY = [
  { id: 1, title: 'Dacă-ntr-o zi', text: 'Dacă-ntr-o zi voi fi departe\nTu ești cu mine', updated_at: 10 },
  { id: 2, title: 'Sfânt și minunat', text: 'Ne ridici din noaptea grea\nTu ești lumina mea', updated_at: 30 },
  { id: 3, title: 'Aleluia', text: 'Cântăm aleluia\nSfânt e Domnul', updated_at: 20 },
  { id: 4, title: 'Lumina lumii', text: 'Isus, lumina lumii', updated_at: 5 },
];

test('lyrics: full normalized phrase matches', () => {
  const r = searchSongs(LIBRARY, 'noaptea grea');
  assert.deepStrictEqual(r.map((s) => [s.id, s.matchedIn]), [[2, 'lyrics']]);
  assert.ok(lyricsMatches(q('Ne ridici din noaptea'), LIBRARY[1].text));
});

test('lyrics: words out of order or a single word do not match lyrics', () => {
  assert.deepStrictEqual(searchSongs(LIBRARY, 'grea noaptea').map((s) => s.id), []);
  assert.deepStrictEqual(searchSongs(LIBRARY, 'noaptea').map((s) => s.id), []);
  assert.ok(!lyricsMatches(q('mine'), LIBRARY[0].text));
});

test('ranking: title hits before lyrics-only hits, then alphabetical', () => {
  const r = searchSongs(LIBRARY, 'lumina');
  assert.deepStrictEqual(r.map((s) => [s.id, s.matchedIn]), [[4, 'title']]);
  const r2 = searchSongs(LIBRARY, 'tu esti');
  assert.deepStrictEqual(r2.map((s) => s.id), [1, 2]);
  const lib = [...LIBRARY, { id: 5, title: 'Tu ești Domnul', text: '', updated_at: 1 }];
  assert.deepStrictEqual(searchSongs(lib, 'tu esti').map((s) => [s.id, s.matchedIn]),
    [[5, 'title'], [1, 'lyrics'], [2, 'lyrics']]);
});

test('sorting without a query: az, za, recent', () => {
  assert.deepStrictEqual(searchSongs(LIBRARY, '', 'az').map((s) => s.id), [3, 1, 4, 2]);
  assert.deepStrictEqual(searchSongs(LIBRARY, '', 'za').map((s) => s.id), [2, 4, 1, 3]);
  assert.deepStrictEqual(searchSongs(LIBRARY, '', 'recent').map((s) => s.id), [2, 3, 1, 4]);
});

// --- chords ---------------------------------------------------------------

test('isChord: common chord spellings', () => {
  for (const c of ['G', 'D/F#', 'Em7', 'Bbmaj7', 'Csus4', 'N.C.', 'Am7b5', 'C(add9)', 'E7#9', 'Gm/Bb', 'F#m', 'Dsus2', 'Cadd9', 'A7', 'Ebdim7']) {
    assert.ok(chords.isChord(c), `${c} should be a chord`);
  }
  for (const w of ['Ne', 'Doamne', 'H', 'Gg', 'x2', 'Em7,', 'Tu', 'G/', '[G]', 'Amin', 'Amin!', 'Dmin']) {
    assert.ok(!chords.isChord(w), `${w} should not be a chord`);
  }
});

test('isChordLine', () => {
  assert.ok(chords.isChordLine('G    D/F#   Em7'));
  assert.ok(chords.isChordLine('  N.C.  '));
  assert.ok(chords.isChordLine('| G  D | Em  C |'));
  assert.ok(!chords.isChordLine('E bine să-L lăudăm'));
  assert.ok(!chords.isChordLine('Am venit la Tine'));
  assert.ok(!chords.isChordLine(''));
  assert.ok(!chords.isChordLine('[G]Ne ridici'));
  assert.ok(!chords.isChordLine('Amin'));
  assert.strictEqual(chords.chordsOverLyricsToInline('Aleluia\nAmin, amin\nAmin'), 'Aleluia\nAmin, amin\nAmin');
});

test('stripChords removes chords and chord-only lines', () => {
  assert.strictEqual(chords.stripChords('[G]Ne ridici din [D]noaptea grea'), 'Ne ridici din noaptea grea');
  assert.strictEqual(chords.stripChords('no[D]aptea'), 'noaptea');
  assert.strictEqual(chords.stripChords('[G]  [D]  [Em]\n[C]Aleluia\n\nAmin'), 'Aleluia\n\nAmin');
});

const ROUND_TRIP = [
  'G             D\nNe ridici din noaptea grea',
  'Em7      Bbmaj7   Csus4\nDoamne, ești sfânt și minunat',
  'D/F#  G\nAleluia',
  'C       G       Am\nTu ești',
  'G  D  Em  C',
  'N.C.\nCântăm fără instrumente',
  'G           D/F#\nSfânt, sfânt, sfânt\n\nFără acorduri aici\nAm7         D7    G\nDomnul e bun',
];

test('chordsOverLyricsToInline -> inlineToChordsOverLyrics round-trips', () => {
  for (const sample of ROUND_TRIP) {
    const inline = chords.chordsOverLyricsToInline(sample);
    assert.strictEqual(chords.inlineToChordsOverLyrics(inline), sample, `sample:\n${sample}\ninline:\n${inline}`);
  }
});

test('chord positions are kept', () => {
  assert.strictEqual(chords.chordsOverLyricsToInline('G             D\nNe ridici din noaptea grea'),
    '[G]Ne ridici din [D]noaptea grea');
  assert.strictEqual(chords.chordsOverLyricsToInline('D/F#  G\nAleluia'), '[D/F#]Alelui[G]a');
  assert.strictEqual(chords.chordsOverLyricsToInline('C       G\nTu'), '[C]Tu      [G]');
});

test('inline content is left unchanged (idempotent)', () => {
  const inline = '[G]Ne ridici din [D]noaptea grea\n\n[Em]Tu ești [C]Domnul';
  assert.strictEqual(chords.chordsOverLyricsToInline(inline), inline);
  assert.strictEqual(chords.chordsOverLyricsToInline('Fără acorduri\nDeloc'), 'Fără acorduri\nDeloc');
});

test('inline -> chords over lyrics -> inline round-trips', () => {
  for (const inline of ['[G]Ne ridici din [D]noaptea grea', '[Am]Tu [F]ești [C]Domnul [G]meu', '[D]Ale[A/C#]luia [Bm7]amin']) {
    assert.strictEqual(chords.chordsOverLyricsToInline(chords.inlineToChordsOverLyrics(inline)), inline);
  }
});

test('touching inline chords stay one space apart in display', () => {
  assert.strictEqual(chords.inlineToChordsOverLyrics('[G][D]Aleluia'), 'G D\nAleluia');
});

// --- songs ----------------------------------------------------------------

const { lyricsHash, validateSong, KEYS } = require('../lib/songs');
const tro = (k, v) => t(k, v, 'ro');
const tEn = (k, v) => t(k, v, 'en');

test('lyricsHash ignores chords and whitespace, not wording', () => {
  const plain = lyricsHash('Ne ridici din noaptea grea');
  assert.match(plain, /^[0-9a-f]{64}$/);
  assert.strictEqual(lyricsHash('[G]Ne ridici din [D]noaptea grea'), plain);
  assert.strictEqual(lyricsHash('  Ne ridici\n din   noaptea grea \n'), plain);
  assert.notStrictEqual(lyricsHash('Ne ridici din noaptea rea'), plain);
});

test('validateSong: cleans a valid song and converts chords over lyrics', () => {
  const { value, error } = validateSong({
    title: '  Dacă-ntr-o zi ', author: '', song_key: 'Em',
    sections: [{ type: 'verse', content: 'G          D\nDacă-ntr-o zi\n', label: ' ', note: '' }],
  }, tro);
  assert.strictEqual(error, undefined);
  assert.strictEqual(value.title, 'Dacă-ntr-o zi');
  assert.strictEqual(value.titleNorm, 'daca ntr o zi');
  assert.strictEqual(value.author, null);
  assert.strictEqual(value.songKey, 'Em');
  assert.deepStrictEqual(value.sections, [{ type: 'verse', label: null, content: '[G]Dacă-ntr-o [D]zi', note: null }]);
});

test('validateSong: limits and messages in both languages', () => {
  const ok = { title: 'T', sections: [{ type: 'verse', content: 'x' }] };
  const err = (patch, tf = tro) => validateSong({ ...ok, ...patch }, tf).error;
  assert.strictEqual(err({ title: ' ' }), 'Titlul este obligatoriu (max. 200 de caractere).');
  assert.strictEqual(err({ title: 'x'.repeat(201) }, tEn), 'The title is required (max. 200 characters).');
  assert.ok(err({ author: 'x'.repeat(201) }));
  assert.ok(err({ song_key: 'H' }));
  assert.ok(err({ song_key: 'Cmaj' }));
  assert.strictEqual(err({ song_key: '' }), undefined);
  assert.ok(err({ sections: [] }));
  assert.ok(err({ sections: Array(41).fill({ type: 'verse', content: 'x' }) }));
  assert.strictEqual(err({ sections: [{ type: 'verse', content: 'x' }, { type: 'rap', content: 'x' }] }, tEn), 'Section 2: unknown type.');
  assert.ok(err({ sections: [{ type: 'verse', content: '   ' }] }));
  assert.ok(err({ sections: [{ type: 'verse', content: 'x'.repeat(5001) }] }));
  assert.ok(err({ sections: [{ type: 'verse', content: 'x', note: 'x'.repeat(301) }] }));
  assert.strictEqual(KEYS.length, 34);
});

// --- resursecrestine / OpenSong (no network) -------------------------------

const resurse = require('../lib/resurse');

// Chords, standard markers, a comment, presentation and a valid key.
const OPENSONG_CHORDS = `<?xml version="1.0" encoding="UTF-8"?>
<song>
  <title>Isus, Tu ești lumina</title>
  <author>Autor &amp; Co</author>
  <key>G</key>
  <presentation>V1 C V2 C</presentation>
  <lyrics>[V1]
.G             D
 Ne ridici din noaptea grea
.Em      C
 Tu ești lumina mea
[C]
;Refrenul se cântă de două ori
.C       G/B    Am7
 Sfânt, sfânt e Domnul
[V2]
 A doua strofă fără acorduri
 pe două rânduri</lyrics>
</song>`;

// Multi-verse numbered block with a shared line, "||" splitter, unknown markers,
// a chord-only line and an invalid key.
const OPENSONG_NUMBERED = `<song>
<title>Cântec cu strofe numerotate</title>
<key>H</key>
<presentation>V  C   Coda</presentation>
<lyrics>
[V]
.D            A
1Prima strofă începe
2A doua strofă începe
3A treia strofă începe
 Toți cântăm aici
[C]
 Refren simplu || cu separator
|
[Coda]
.G  D  G
[X2]
 ultima linie
</lyrics>
</song>`;

// No marker at the start, CRLF, lines without a leading space, "|" inside a lyric line,
// every standard marker type, comments only in one block.
const OPENSONG_MIXED = '<song><title>Fără marcaje</title><author></author><key></key><lyrics>'
  + 'Primul rând fără marcaj\r\n'
  + '[P]\r\n.F\r\n Pre-refren | cu bară\r\n'
  + '[B1]\r\n Punte\r\n'
  + '[C]\r\nRefren:\r\n.C\r\n Aleluia\r\n'
  + '[I]\r\n.G   D\r\n'
  + '[O]\r\n Final\r\n'
  + '[T]\r\n Tag\r\n'
  + '[V9]\r\n;doar un comentariu\r\n'
  + '</lyrics></song>';

test('OpenSong: chords merged column-accurately, markers mapped, comments dropped', () => {
  const song = resurse.parseOpenSongXml(OPENSONG_CHORDS);
  assert.strictEqual(song.title, 'Isus, Tu ești lumina');
  assert.strictEqual(song.author, 'Autor & Co');
  assert.strictEqual(song.key, 'G');
  assert.strictEqual(song.presentation, 'V1 C V2 C');
  assert.deepStrictEqual(song.sections, [
    { type: 'verse', label: null, content: '[G]Ne ridici din [D]noaptea grea\n[Em]Tu ești [C]lumina mea' },
    { type: 'chorus', label: null, content: '[C]Sfânt, s[G/B]fânt e [Am7]Domnul' },
    { type: 'verse', label: null, content: 'A doua strofă fără acorduri\npe două rânduri' },
  ]);
  // Display puts every chord back on its original column.
  assert.strictEqual(chords.inlineToChordsOverLyrics(song.sections[0].content),
    'G             D\nNe ridici din noaptea grea\nEm      C\nTu ești lumina mea');
});

test('OpenSong: numbered multi-verse block split into verses, unknown markers kept as labels', () => {
  const song = resurse.parseOpenSongXml(OPENSONG_NUMBERED);
  assert.strictEqual(song.key, null);
  assert.strictEqual(song.author, null);
  assert.strictEqual(song.presentation, 'V C Coda');
  assert.strictEqual(chords.inlineToChordsOverLyrics('[G]   [D]   [G]'), 'G  D  G');
  assert.deepStrictEqual(song.sections, [
    { type: 'verse', label: null, content: '[D]Prima strofă [A]începe\nToți cântăm aici' },
    // Same chord columns for every numbered verse, as in OpenSong.
    { type: 'verse', label: null, content: '[D]A doua strofă[A] începe\nToți cântăm aici' },
    { type: 'verse', label: null, content: '[D]A treia strof[A]ă începe\nToți cântăm aici' },
    { type: 'chorus', label: null, content: 'Refren simplu cu separator' },
    { type: 'other', label: 'Coda', content: '[G]   [D]   [G]' },
    { type: 'other', label: 'X2', content: 'ultima linie' },
  ]);
});

test('OpenSong: text before the first marker, CRLF, "|" inside lines, all marker types', () => {
  const song = resurse.parseOpenSongXml(OPENSONG_MIXED);
  assert.deepStrictEqual(song.sections.map((s) => [s.type, s.label, s.content]), [
    ['verse', null, 'Primul rând fără marcaj'],
    ['pre_chorus', null, '[F]Pre-refren cu bară'],
    ['bridge', null, 'Punte'],
    ['chorus', null, '[C]Aleluia'], // the leftover "Refren:" line is dropped
    ['intro', null, '[G]    [D]'],
    ['outro', null, 'Final'],
    ['tag', null, 'Tag'],
  ]);
  assert.strictEqual(song.key, null);
  assert.strictEqual(song.presentation, null);
});

test('OpenSong: invalid documents are rejected', () => {
  const code = (fn) => { try { fn(); } catch (err) { return err.code; } return 'no error'; };
  assert.strictEqual(code(() => resurse.parseOpenSongXml('<html><body>Not found</body></html> padding padding')), 'bad_response');
  assert.strictEqual(code(() => resurse.parseOpenSongXml('<song><title>Fără versuri</title><lyrics>;doar comentariu</lyrics></song>')), 'bad_response');
  assert.strictEqual(code(() => resurse.parseOpenSongXml('short')), 'bad_response');
});

test('resursecrestine URLs: only https on the two allowed hosts', () => {
  const id = resurse.extractResurseCrestineSongId;
  assert.strictEqual(id('https://www.resursecrestine.ro/cantece/12345/isus-tu-esti'), '12345');
  assert.strictEqual(id('https://resursecrestine.ro/cantece/12345'), '12345');
  assert.strictEqual(id('https://WWW.ResurseCrestine.ro/cantece/7/x'), '7');
  for (const bad of [
    'http://www.resursecrestine.ro/cantece/1/x', 'https://evil.example/cantece/1/x',
    'https://www.resursecrestine.ro.evil.example/cantece/1', 'https://user:pw@www.resursecrestine.ro/cantece/1',
    'https://www.resursecrestine.ro:8443/cantece/1', 'https://www.resursecrestine.ro/poezii/1/x',
    'javascript:alert(1)', 'not a url', '',
  ]) {
    assert.strictEqual(id(bad), null, bad);
  }
});

function fakeResponse(status, body, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    body: null,
    text: async () => body,
  };
}

async function asyncCode(promise) {
  try {
    await promise;
    return 'no error';
  } catch (err) {
    return err.code || err.message;
  }
}

const asyncTests = [];
function testAsync(name, fn) {
  asyncTests.push([name, fn]);
}

testAsync('safeFetchText: redirects stay on the allowed hosts, body capped at 1 MB', async () => {
  const hops = [];
  const redirectTo = (target) => async (url) => {
    hops.push(url);
    return hops.length === 1 ? fakeResponse(302, '', { location: target }) : fakeResponse(200, 'ok');
  };
  assert.strictEqual(await resurse.safeFetchText('https://www.resursecrestine.ro/a', { fetchImpl: redirectTo('https://resursecrestine.ro/b') }), 'ok');
  assert.deepStrictEqual(hops, ['https://www.resursecrestine.ro/a', 'https://resursecrestine.ro/b']);
  hops.length = 0;
  assert.strictEqual(await asyncCode(resurse.safeFetchText('https://www.resursecrestine.ro/a', { fetchImpl: redirectTo('https://evil.example/x') })), 'blocked_host');
  assert.strictEqual(hops.length, 1);
  hops.length = 0;
  assert.strictEqual(await asyncCode(resurse.safeFetchText('https://www.resursecrestine.ro/a', { fetchImpl: redirectTo('http://www.resursecrestine.ro/x') })), 'blocked_host');
  assert.strictEqual(await asyncCode(resurse.safeFetchText('https://evil.example/', { fetchImpl: async () => fakeResponse(200, 'x') })), 'blocked_host');
  assert.strictEqual(await asyncCode(resurse.safeFetchText('https://www.resursecrestine.ro/a', {
    fetchImpl: async () => fakeResponse(200, 'x', { 'content-length': String(resurse.MAX_BODY_BYTES + 1) }),
  })), 'too_large');
  assert.strictEqual(await asyncCode(resurse.safeFetchText('https://www.resursecrestine.ro/a', {
    fetchImpl: async () => fakeResponse(200, 'x'.repeat(resurse.MAX_BODY_BYTES + 1)),
  })), 'too_large');
  assert.strictEqual(await asyncCode(resurse.safeFetchText('https://www.resursecrestine.ro/a', { fetchImpl: async () => fakeResponse(404, '') })), 'not_found');
  assert.strictEqual(await asyncCode(resurse.safeFetchText('https://www.resursecrestine.ro/a', {
    fetchImpl: async () => { const e = new Error('timeout'); e.name = 'TimeoutError'; throw e; },
  })), 'timeout');
  assert.strictEqual(await asyncCode(resurse.safeFetchText('https://www.resursecrestine.ro/a', {
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
  })), 'unreachable');
});

testAsync('search and import use the ported endpoints', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    if (url.includes('/web-api-search')) {
      return fakeResponse(200, JSON.stringify({ Results: [
        { id: '101', title: 'Isus e Domnul', title_slug: 'isus-e-domnul', author: 'X', slug: 'cantece' },
        { id: '5', title: 'Un verset', slug: 'versete' },
        { id: 'abc', title: 'Fără id numeric', slug: 'cantece' },
      ] }));
    }
    return fakeResponse(200, OPENSONG_CHORDS);
  };
  const results = await resurse.searchResurseCrestineSongs('Isus', { fetchImpl });
  assert.deepStrictEqual(results, [{ id: '101', title: 'Isus e Domnul', author: 'X', url: 'https://www.resursecrestine.ro/cantece/101/isus-e-domnul' }]);
  const search = new URL(seen[0]);
  assert.strictEqual(search.searchParams.get('output'), 'json2');
  assert.strictEqual(search.searchParams.get('search_in'), '2');
  assert.strictEqual(search.searchParams.get('search_by'), 'filtru-titlu');
  assert.strictEqual(await asyncCode(resurse.searchResurseCrestineSongs('I', { fetchImpl })), 'query_too_short');

  const song = await resurse.importFromUrl({ url: 'https://www.resursecrestine.ro/cantece/101/isus-e-domnul' }, { fetchImpl });
  assert.strictEqual(seen[1], 'https://www.resursecrestine.ro/cantece/opensong/101');
  assert.strictEqual(song.sourceProvider, 'resursecrestine');
  assert.strictEqual(song.sourceUrl, 'https://www.resursecrestine.ro/cantece/101');
  assert.strictEqual((await resurse.importFromUrl({ id: 7 }, { fetchImpl })).sourceUrl, 'https://www.resursecrestine.ro/cantece/7');
  assert.strictEqual(await asyncCode(resurse.importFromUrl({ url: 'https://evil.example/cantece/1' }, { fetchImpl })), 'invalid_url');
  assert.strictEqual(await asyncCode(resurse.importFromUrl({ id: '1; drop' }, { fetchImpl })), 'invalid_url');
});

// --- library file import ----------------------------------------------------

const libImport = require('../lib/library-import');

const OWN_FILE = {
  type: 'worship-app-library', version: 1, exportedAt: '2026-09-25T00:00:00.000Z', app: 'Worship App', count: 4,
  songs: [
    { title: 'Aleluia', author: 'X', key: 'Em', sourceLang: 'ro', sourceProvider: 'resursecrestine',
      sourceUrl: 'https://www.resursecrestine.ro/cantece/1', presentation: 'V1 C',
      sections: [{ type: 'verse', label: null, content: '[Em]Aleluia', note: 'încet' }, { type: 'chorus', label: null, content: 'Amin', note: null }] },
    { title: 'Fără secțiuni', sections: [] },
    { title: 'ALELUIA', sections: [{ type: 'verse', content: 'dublură' }] },
    { title: 'Nouă', key: 'D', sourceUrl: 'javascript:alert(1)', sections: [{ type: 'verse', content: 'text' }] },
  ],
};

const SV_FILE = {
  type: 'sanctuary-voice-library', version: 1, exportedAt: '2026-09-01T00:00:00.000Z', count: 2,
  songs: [
    {
      id: 'uuid-1', title: 'Sfânt e Domnul', key: 'H', sourceLang: 'ro',
      text: 'G             D\nNe ridici din noaptea grea\n\nRefren text\nal doilea rând\n\n\nPunte text',
      labels: ['Strofa 1', 'Refren', 'Pod special'],
      sections: ['verse', 'chorus', 'rap'],
      sectionNotes: ['', 'de două ori', ''],
      translationsByHash: { abc123: { en: 'Holy is the Lord' } },
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
    { id: 'uuid-2', title: 'Isus', key: 'D', sourceLang: 'en', text: 'Unu\n\nDoi', labels: ['Verse 1', 'Verse 2'], sections: ['verse', 'chorus'] },
  ],
};

test('library import: own format -> new, existing, invalid (validation + duplicate in file)', () => {
  const file = libImport.parseLibraryFile(OWN_FILE);
  assert.strictEqual(file.format, 'worship-app-library');
  const plan = libImport.planImport(file.entries, { t: tro, findIdByTitle: (title) => (q(title) === 'aleluia' ? 7 : null) });
  assert.deepStrictEqual(plan.add.map((x) => x.value.title), ['Nouă']);
  assert.deepStrictEqual(plan.existing.map((x) => [x.id, x.value.title]), [[7, 'Aleluia']]);
  assert.deepStrictEqual(plan.invalid.map((x) => x.title), ['Fără secțiuni', 'ALELUIA']);
  assert.match(plan.invalid[1].reason, /mai multe ori/);
  assert.deepStrictEqual(plan.existing[0].meta, { sourceLang: 'ro', sourceProvider: 'resursecrestine', sourceUrl: 'https://www.resursecrestine.ro/cantece/1', presentation: 'V1 C' });
  assert.strictEqual(plan.add[0].meta.sourceUrl, null);
  assert.ok(libImport.planImport(libImport.parseLibraryFile(OWN_FILE).entries, { t: tro, findIdByTitle: () => null }).invalid.every((x) => x.title !== 'Nouă'));
  // an invalid key in our own format is a validation error, like POST /api/songs
  const withBadKey = libImport.parseLibraryFile({ ...OWN_FILE, songs: [{ ...OWN_FILE.songs[3], key: 'H' }] });
  assert.strictEqual(libImport.planImport(withBadKey.entries, { t: tro, findIdByTitle: () => null }).invalid[0].reason, 'Tonalitate necunoscută.');
});

test('library import: Sanctuary Voice blocks, types, notes, labels, chords; ids and translations dropped', () => {
  const file = libImport.parseLibraryFile(SV_FILE);
  const [first, second] = file.entries;
  assert.strictEqual(first.body.song_key, '');
  assert.deepStrictEqual(first.body.sections, [
    { type: 'verse', label: '', content: '[G]Ne ridici din [D]noaptea grea', note: '' },
    { type: 'chorus', label: '', content: 'Refren text\nal doilea rând', note: 'de două ori' },
    { type: 'verse', label: 'Pod special', content: 'Punte text', note: '' },
  ]);
  assert.deepStrictEqual(first.meta, { sourceLang: 'ro' });
  assert.strictEqual(first.keepAuthor, true);
  assert.ok(!JSON.stringify(file).includes('translationsByHash') && !JSON.stringify(file).includes('uuid-1'));
  // "Verse 2" is Sanctuary Voice's own fallback label, not a custom one.
  assert.deepStrictEqual(second.body.sections.map((x) => [x.type, x.label]), [['verse', ''], ['chorus', '']]);
  assert.strictEqual(second.body.song_key, 'D');
  assert.strictEqual(second.meta.sourceLang, 'en');
  const plan = libImport.planImport(file.entries, { t: tro, findIdByTitle: () => null });
  assert.deepStrictEqual(plan.add.map((x) => x.value.title), ['Sfânt e Domnul', 'Isus']);
});

test('library import: anything else is rejected', () => {
  const code = (data) => { try { libImport.parseLibraryFile(data); } catch (err) { return err.code; } return 'accepted'; };
  assert.strictEqual(code(null), 'format');
  assert.strictEqual(code([]), 'format');
  assert.strictEqual(code({ type: 'playlist', version: 1, songs: [] }), 'format');
  assert.strictEqual(code({ type: 'worship-app-library', version: 2, songs: [] }), 'format');
  assert.strictEqual(code({ type: 'worship-app-library', version: 1 }), 'format');
  assert.strictEqual(code({ type: 'worship-app-library', version: 1, songs: Array(2001).fill({}) }), 'too_many');
  assert.strictEqual(code({ type: 'sanctuary-voice-library', version: 1, songs: [] }), 'accepted');
});

// --- dates and admin settings -------------------------------------------------

const dates = require('../lib/dates');
const { isValidTimezone } = require('../lib/admin-settings');

test('dates: validation and today in a timezone', () => {
  assert.ok(dates.isValidDate('2026-10-11'));
  assert.ok(dates.isValidDate('2028-02-29'));
  for (const bad of ['2026-02-30', '2026-13-01', '26-10-11', '2026-10-1', '', null, '2026-10-11T00:00']) {
    assert.ok(!dates.isValidDate(bad), String(bad));
  }
  assert.ok(dates.isValidTime('09:30') && dates.isValidTime('23:59') && dates.isValidTime('00:00'));
  for (const bad of ['24:00', '9:30', '09:60', '', 'noon']) assert.ok(!dates.isValidTime(bad), bad);
  // 22:30 UTC on 25 Sep is already 26 Sep in Oslo (UTC+2), still 25 Sep in New York.
  const at = new Date(Date.UTC(2026, 8, 25, 22, 30));
  assert.strictEqual(dates.todayIn('Europe/Oslo', at), '2026-09-26');
  assert.strictEqual(dates.todayIn('America/New_York', at), '2026-09-25');
  assert.strictEqual(dates.todayIn('Europe/Oslo', new Date(Date.UTC(2026, 11, 31, 22, 59))), '2026-12-31');
  assert.strictEqual(dates.todayIn('Europe/Oslo', new Date(Date.UTC(2026, 11, 31, 23, 0))), '2027-01-01');
  assert.ok(isValidTimezone('Europe/Oslo') && !isValidTimezone('Mars/Base'));
});

// --- events -------------------------------------------------------------------

const evs = require('../lib/events');

test('validateEventMeta: name, date, time, notes', () => {
  const ok = { name: ' Serviciu duminică ', eventDate: '2026-10-11', startTime: '10:00', notes: '' };
  assert.deepStrictEqual(evs.validateEventMeta(ok, tro).value, { name: 'Serviciu duminică', eventDate: '2026-10-11', startTime: '10:00', notes: null });
  assert.strictEqual(evs.validateEventMeta({ ...ok, startTime: '' }, tro).value.startTime, null);
  assert.strictEqual(evs.validateEventMeta({ ...ok, name: '' }, tEn).error, 'The event name is required (max. 120 characters).');
  assert.ok(evs.validateEventMeta({ ...ok, name: 'x'.repeat(121) }, tro).error);
  assert.ok(evs.validateEventMeta({ ...ok, eventDate: '2026-02-30' }, tro).error);
  assert.ok(evs.validateEventMeta({ ...ok, startTime: '25:00' }, tro).error);
  assert.ok(evs.validateEventMeta({ ...ok, notes: 'x'.repeat(2001) }, tro).error);
});

test('validateItems: one of each type, per-type fields, limits', () => {
  const findSong = (id) => (id === 5 ? { id: 5, title: 'Sfânt' } : null);
  const items = [
    { type: 'song', songId: 5, title: 'ignored', durationMin: 5 },
    { type: 'verse', reference: 'Psalmul 23:1-4', body: 'Domnul este Păstorul meu', url: 'https://x.ro' },
    { type: 'video', title: 'Clip', url: 'https://example.com/v.mp4', durationMin: '3' },
    { type: 'announcement', title: 'Anunț', body: 'Agapă după serviciu' },
    { type: 'sermon', title: 'Predica', durationMin: 40 },
    { type: 'other', body: 'Rugăciune' },
    { type: 'song', songId: null, title: 'Cântare veche' },
  ];
  const { value, error } = evs.validateItems(items, tro, findSong);
  assert.strictEqual(error, undefined);
  assert.deepStrictEqual(value.map((x) => [x.type, x.songId, x.title, x.reference, x.url, x.durationMin]), [
    ['song', 5, 'Sfânt', null, null, 5],
    ['verse', null, null, 'Psalmul 23:1-4', null, null],
    ['video', null, 'Clip', null, 'https://example.com/v.mp4', 3],
    ['announcement', null, 'Anunț', null, null, null],
    ['sermon', null, 'Predica', null, null, 40],
    ['other', null, null, null, null, null],
    ['song', null, 'Cântare veche', null, null, null],
  ]);
  const err = (item, tf = tro) => evs.validateItems([item], tf, findSong).error;
  assert.strictEqual(err({ type: 'song', songId: 6 }, tEn), 'Item 1: the song is not in the library.');
  assert.ok(err({ type: 'song' }));
  assert.ok(err({ type: 'dance', title: 'x' }));
  assert.ok(err({ type: 'video', url: 'http://example.com' }));
  assert.ok(err({ type: 'video', url: 'javascript:alert(1)' }));
  assert.ok(err({ type: 'video', title: 'fără link' }));
  assert.ok(err({ type: 'verse' }));
  assert.ok(err({ type: 'announcement', title: 'x', durationMin: 601 }));
  assert.ok(err({ type: 'announcement', title: 'x', durationMin: 1.5 }));
  assert.ok(err({ type: 'announcement', title: 'x'.repeat(201) }));
  assert.ok(err({ type: 'announcement', body: 'x'.repeat(5001) }));
  assert.ok(err({ type: 'verse', reference: 'x'.repeat(101) }));
  assert.ok(evs.validateItems(Array(61).fill({ type: 'other', title: 'x' }), tro, findSong).error);
  assert.strictEqual(evs.validateItems(Array(60).fill({ type: 'other', title: 'x' }), tro, findSong).error, undefined);
});

test('validateItems: song options (transpose, arrangement, team note, reference link)', () => {
  const sections = [{ type: 'verse' }, { type: 'chorus' }, { type: 'verse' }, { type: 'bridge' }];
  const findSong = (id) => (id === 5 ? { id: 5, title: 'Sfânt', sections } : null);
  const ok = evs.validateItems([{ type: 'song', songId: 5, transpose: -3, arrangement: 'v1, c c1 B', teamNote: ' încet ', referenceUrl: 'https://youtu.be/x' }], tro, findSong);
  assert.deepStrictEqual(ok.value[0], {
    id: null, type: 'song', songId: 5, mediaId: null, title: 'Sfânt', body: null, reference: null, url: null, durationMin: null,
    transpose: -3, arrangement: 'V1 C C B', teamNote: 'încet', referenceUrl: 'https://youtu.be/x', backgroundMediaId: null, backgroundNone: 0,
  });
  assert.deepStrictEqual(evs.validateItems([{ type: 'song', songId: 5 }], tro, findSong).value[0].transpose, 0);
  const err = (item, tf = tro) => evs.validateItems([item], tf, findSong).error;
  assert.strictEqual(err({ type: 'song', songId: 5, arrangement: 'V1 V9 C Q' }, tEn), 'Item 1: unknown sections in the order: V9, Q.');
  assert.ok(err({ type: 'song', songId: 5, transpose: 12 }));
  assert.ok(err({ type: 'song', songId: 5, transpose: 1.5 }));
  assert.ok(err({ type: 'song', songId: 5, arrangement: 'V1 '.repeat(70) }));
  assert.ok(err({ type: 'song', songId: 5, teamNote: 'x'.repeat(501) }));
  assert.ok(err({ type: 'song', songId: 5, referenceUrl: 'http://youtu.be/x' }));
  for (const field of [{ transpose: 2 }, { transpose: 0 }, { arrangement: 'V1' }, { teamNote: 'x' }, { referenceUrl: 'https://x.ro' }]) {
    assert.strictEqual(err({ type: 'announcement', title: 'x', ...field }, tEn), 'Item 1: key, section order, team note and reference link are only for songs.', JSON.stringify(field));
  }
  // A deleted song keeps its options (nothing to check the arrangement against).
  assert.strictEqual(evs.validateItems([{ type: 'song', songId: null, title: 'Veche', arrangement: 'V1 C', transpose: 2 }], tro, findSong).value[0].arrangement, 'V1 C');
});

// --- transposition and section codes -------------------------------------------

test('keyAfter: all 12 major and minor keys one semitone up and down', () => {
  const up = { C: 'Db', Db: 'D', D: 'Eb', Eb: 'E', E: 'F', F: 'Gb', Gb: 'G', G: 'Ab', Ab: 'A', A: 'Bb', Bb: 'B', B: 'C' };
  for (const [from, to] of Object.entries(up)) {
    assert.strictEqual(chords.keyAfter(from, 1), to, `${from} +1`);
    assert.strictEqual(chords.keyAfter(to, -1), from === 'Gb' ? 'Gb' : from, `${to} -1`);
  }
  assert.strictEqual(chords.keyAfter('F#', 1), 'G');
  assert.strictEqual(chords.keyAfter('C#', 0), 'Db');
  const minorUp = { Am: 'Bbm', Bbm: 'Bm', Bm: 'Cm', Cm: 'C#m', 'C#m': 'Dm', Dm: 'Ebm', Ebm: 'Em', Em: 'Fm', Fm: 'F#m', 'F#m': 'Gm', Gm: 'G#m', 'G#m': 'Am' };
  for (const [from, to] of Object.entries(minorUp)) assert.strictEqual(chords.keyAfter(from, 1), to, `${from} +1`);
  assert.strictEqual(chords.keyAfter('G', 2), 'A');
  assert.strictEqual(chords.keyAfter('G', -7), 'C');
  assert.strictEqual(chords.keyAfter('G', 12), 'G');
  assert.strictEqual(chords.keyAfter(null, 2), null);
  assert.strictEqual(chords.keyAfter('', 2), null);
});

test('transposeChord: every semitone from C, with sharps and with flats', () => {
  const sharps = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const flats = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  for (let n = -11; n <= 11; n++) {
    const i = ((n % 12) + 12) % 12;
    assert.strictEqual(chords.transposeChord('C', n, false), sharps[i], `C ${n} sharps`);
    assert.strictEqual(chords.transposeChord('C', n, true), flats[i], `C ${n} flats`);
  }
});

test('transposeContent: sharps or flats chosen by the target key', () => {
  const g = '[G]Ne ridici [D/F#]din [Em7]noaptea [C]grea';
  assert.strictEqual(chords.transposeContent(g, 2, chords.keyAfter('G', 2)), '[A]Ne ridici [E/G#]din [F#m7]noaptea [D]grea');
  assert.strictEqual(chords.transposeContent('[F]Sfânt [Bb]e [C7]Domnul', -1, chords.keyAfter('F', -1)), '[E]Sfânt [A]e [B7]Domnul');
  assert.strictEqual(chords.transposeContent('[C]Aleluia [F]amin [G7]', 1, chords.keyAfter('C', 1)), '[Db]Aleluia [Gb]amin [Ab7]');
  assert.strictEqual(chords.transposeContent('[D]Tu [F#m]ești', 1, 'Eb'), '[Eb]Tu [Gm]ești');
  assert.strictEqual(chords.transposeContent('[A]fără ton [C#m]', 1, null), '[A#]fără ton [Dm]');
  assert.strictEqual(chords.transposeContent(g, 0, 'G'), g);
  assert.strictEqual(chords.transposeContent(g, 12, 'G'), g);
});

test('transposeChord: slash and complex chords, N.C. and non-chords untouched', () => {
  const cases = [
    ['D/F#', 2, false, 'E/G#'], ['Bbmaj7', 2, false, 'Cmaj7'], ['Csus4', -1, false, 'Bsus4'],
    ['Am7b5', 3, false, 'Cm7b5'], ['E7#9', 1, true, 'F7#9'], ['C(add9)', 2, false, 'D(add9)'],
    ['Gm/Bb', 2, false, 'Am/C'], ['Ebdim7', -3, false, 'Cdim7'], ['Dsus2', 5, false, 'Gsus2'],
    ['F#m', -6, false, 'Cm'], ['Cadd9/E', 5, true, 'Fadd9/A'],
  ];
  for (const [chord, n, flats, expected] of cases) assert.strictEqual(chords.transposeChord(chord, n, flats), expected, `${chord} ${n}`);
  assert.strictEqual(chords.transposeChord('N.C.', 3, false), 'N.C.');
  assert.strictEqual(chords.transposeChord('NC', 3, false), 'NC');
  assert.strictEqual(chords.transposeContent('[x2] [G]Da [N.C.] [Amin]', 2, 'A'), '[x2] [A]Da [N.C.] [Amin]');
});

test('transposeContent: +n then -n returns the original on 5 samples', () => {
  const samples = [
    ['G', '[G]Ne ridici din [D/F#]noaptea [Em]grea\n[C]Tu ești [D]lumina [G]mea'],
    ['F', '[F]Sfânt, [Bb]sfânt, [C7]sfânt\n[Dm]e [Gm7]Domnul [C]nostru'],
    ['D', '[D]Aleluia [A/C#]amin [Bm]cântăm [G]Ție [Em7]Doamne'],
    ['Eb', '[Eb]Mare [Ab]ești [Bb]Tu, [Cm]Doamne [Fm7]al [Bb7]meu'],
    ['Am', '[Am]În [Dm]noaptea [E7]grea [G/B]Tu [C]vii [F]la [Am]noi'],
  ];
  for (const [key, content] of samples) {
    for (const n of [1, 2, 5, -3, 7, -11]) {
      const up = chords.transposeContent(content, n, chords.keyAfter(key, n));
      assert.strictEqual(chords.transposeContent(up, -n, key), content, `${key} ${n}: ${up}`);
    }
  }
});

test('chord spelling by scale degree in the target key', () => {
  // C -> D: the b6 chord Ab becomes Bb (not A#); b7 and b3 stay flat, #4 stays sharp.
  assert.strictEqual(chords.transposeContent('[C]Da [Ab]și [Bb]amin [Eb]Tu [F#dim]o', 2, 'D'), '[D]Da [Bb]și [C]amin [F]Tu [G#dim]o');
  // A Bb chord in G, up 2 and back down 2, is Bb again (never A#).
  const g = '[G]Tu [Bb]ești [C]Domn [D/F#]mare';
  const up = chords.transposeContent(g, 2, chords.keyAfter('G', 2));
  assert.strictEqual(up, '[A]Tu [C]ești [D]Domn [E/G#]mare');
  assert.strictEqual(chords.transposeContent(up, -2, 'G'), g);
  // Minor keys use the relative major; the leading tone stays sharp.
  assert.strictEqual(chords.transposeContent('[Am]În [F]noaptea [C]grea [G]Tu [E/G#]vii [Dm]la [E7]noi', 2, 'Bm'),
    '[Bm]În [G]noaptea [D]grea [A]Tu [F#/A#]vii [Em]la [F#7]noi');
  assert.strictEqual(chords.transposeChord('D/F#', 2, 'A'), 'E/G#');
  assert.strictEqual(chords.transposeChord('Ab', 2, 'D'), 'Bb');
  // Flat keys spell diatonic notes with flats; #4 is written sharp or natural.
  assert.strictEqual(chords.transposeContent('[C]a [F]b [G]c [F#m7b5]d [Bb]e', 5, 'F'), '[F]a [Bb]b [C]c [Bm7b5]d [Eb]e');
  // No key: plain sharps, as before; transpose 0 never changes the text.
  assert.strictEqual(chords.transposeContent('[Ab]x', 2, null), '[A#]x');
  assert.strictEqual(chords.transposeContent('[Ab]x [A#]y', 0, 'D'), '[Ab]x [A#]y');
});

test('migration 007: live_state defaults, checks and cascade', () => {
  const Database = require('better-sqlite3');
  const { runMigrations } = require('../lib/db');
  const mem = new Database(':memory:');
  mem.pragma('foreign_keys = ON');
  runMigrations(mem);
  mem.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'A', 0)").run();
  mem.prepare(`INSERT INTO events (id, admin_id, name, event_date, created_at, updated_at)
    VALUES (1, 1, 'E', '2026-10-04', 0, 0)`).run();
  mem.prepare('INSERT INTO live_state (event_id, admin_id, version, updated_at) VALUES (1, 1, 0, 0)').run();
  const row = mem.prepare('SELECT * FROM live_state WHERE event_id = 1').get();
  assert.deepStrictEqual(
    [row.worship_item_id, row.worship_step, row.projector_follows, row.projector_item_id, row.projector_step, row.projector_source, row.started_at],
    [null, 0, 'worship', null, 0, 'content', null]);
  assert.throws(() => mem.prepare("UPDATE live_state SET projector_follows = 'nobody'").run(), /CHECK/);
  assert.throws(() => mem.prepare("UPDATE live_state SET projector_source = 'slides'").run(), /CHECK/);
  mem.prepare('DELETE FROM events WHERE id = 1').run();
  assert.strictEqual(mem.prepare('SELECT COUNT(*) FROM live_state').pluck().get(), 0);
  mem.close();
});

test('validateItems: an item id is kept only when it is a positive integer', () => {
  const ids = [7, '7', -1, 0, 1.5, null].map((id) => evs.validateItems([{ id, type: 'other', title: 'x' }], tro, () => null).value[0].id);
  assert.deepStrictEqual(ids, [7, null, null, null, null, null]);
});

// --- live position engine ---------------------------------------------------------

test('live: next / prev across songs with repeats and non-song items, stopping at the ends', () => {
  const L = require('../lib/live');
  const song = (id, codes) => ({ id, type: 'song', songId: id, arrangementResolved: codes.map((code) => ({ code })) });
  const items = [song(1, ['V1', 'C', 'V2', 'C', 'B', 'C']), { id: 2, type: 'verse' }, song(3, ['V1', 'C']),
    { id: 4, type: 'song', songId: null }, { id: 5, type: 'video' }];
  const lay = L.layoutOf(items);
  assert.deepStrictEqual(lay.map((x) => x.steps), [6, 1, 2, 1, 1]);
  let pos = L.firstPosition(lay);
  const walk = [];
  for (let i = 0; i < 11; i++) {
    walk.push(`${pos.itemId}.${pos.step}`);
    pos = L.nextPosition(lay, pos);
  }
  assert.deepStrictEqual(walk, ['1.0', '1.1', '1.2', '1.3', '1.4', '1.5', '2.0', '3.0', '3.1', '4.0', '5.0']);
  assert.deepStrictEqual(pos, { itemId: 5, step: 0 }, 'next on the last step stays');
  const back = [];
  for (let i = 0; i < 11; i++) {
    back.push(`${pos.itemId}.${pos.step}`);
    pos = L.prevPosition(lay, pos);
  }
  assert.deepStrictEqual(back, ['5.0', '4.0', '3.1', '3.0', '2.0', '1.5', '1.4', '1.3', '1.2', '1.1', '1.0']);
  assert.deepStrictEqual(pos, { itemId: 1, step: 0 }, 'prev on the first step stays');
  assert.deepStrictEqual(L.firstPosition([]), { itemId: null, step: 0 });
  assert.deepStrictEqual(L.nextPosition([], { itemId: null, step: 0 }), { itemId: null, step: 0 });
  // An unknown position (item gone) restarts at the first item.
  assert.deepStrictEqual(L.nextPosition(lay, { itemId: 99, step: 3 }), { itemId: 1, step: 0 });
  // "End of this item": the next item's first step from any step; none after the last.
  assert.deepStrictEqual(L.nextItemPosition(lay, { itemId: 1, step: 2 }), { itemId: 2, step: 0 });
  assert.deepStrictEqual(L.nextItemPosition(lay, { itemId: 3, step: 0 }), { itemId: 4, step: 0 });
  assert.strictEqual(L.nextItemPosition(lay, { itemId: 5, step: 0 }), null);
  assert.strictEqual(L.nextItemPosition([], { itemId: null, step: 0 }), null);
});

test('live: goto validation', () => {
  const L = require('../lib/live');
  const lay = [{ id: 1, steps: 6 }, { id: 2, steps: 1 }];
  assert.deepStrictEqual(L.gotoPosition(lay, 1, 5), { itemId: 1, step: 5 });
  assert.deepStrictEqual(L.gotoPosition(lay, 2, 0), { itemId: 2, step: 0 });
  for (const [id, step] of [[1, 6], [1, -1], [2, 1], [3, 0], [1, 1.5], [1, '2']]) {
    assert.strictEqual(L.gotoPosition(lay, id, step), null, `${id}.${step}`);
  }
});

test('live: clamp after setlist and song changes', () => {
  const L = require('../lib/live');
  const old = [{ id: 1, steps: 6 }, { id: 2, steps: 1 }, { id: 3, steps: 2 }, { id: 4, steps: 1 }];
  // Same item still there: step clamped to its new count.
  assert.deepStrictEqual(L.clampPosition(old, [{ id: 1, steps: 3 }, { id: 2, steps: 1 }], { itemId: 1, step: 5 }), { itemId: 1, step: 2 });
  assert.deepStrictEqual(L.clampPosition(old, [{ id: 2, steps: 1 }, { id: 1, steps: 6 }], { itemId: 1, step: 4 }), { itemId: 1, step: 4 });
  // Current item removed: the nearest following item that still exists.
  assert.deepStrictEqual(L.clampPosition(old, [{ id: 1, steps: 6 }, { id: 4, steps: 1 }], { itemId: 2, step: 0 }), { itemId: 4, step: 0 });
  // Nothing follows: the last item.
  assert.deepStrictEqual(L.clampPosition(old, [{ id: 1, steps: 6 }, { id: 2, steps: 1 }], { itemId: 4, step: 0 }), { itemId: 2, step: 0 });
  // Replaced by new items only: the last one.
  assert.deepStrictEqual(L.clampPosition(old, [{ id: 9, steps: 1 }, { id: 10, steps: 2 }], { itemId: 3, step: 1 }), { itemId: 10, step: 0 });
  // Empty setlist: no position; a setlist that gains items starts at the first.
  assert.deepStrictEqual(L.clampPosition(old, [], { itemId: 1, step: 2 }), { itemId: null, step: 0 });
  // a re-arranged song keeps the same section (the nearest occurrence); a removed one clamps
  const before = [{ id: 1, steps: 4, sections: [10, 11, 12, 11] }];
  assert.deepStrictEqual(L.clampPosition(before, [{ id: 1, steps: 4, sections: [12, 10, 11, 11] }], { itemId: 1, step: 2 }), { itemId: 1, step: 0 });
  assert.deepStrictEqual(L.clampPosition(before, [{ id: 1, steps: 5, sections: [10, 11, 12, 13, 11] }], { itemId: 1, step: 3 }), { itemId: 1, step: 4 });
  assert.deepStrictEqual(L.clampPosition(before, [{ id: 1, steps: 2, sections: [10, 11] }], { itemId: 1, step: 2 }), { itemId: 1, step: 1 });
  assert.deepStrictEqual(L.clampPosition([], [{ id: 7, steps: 2 }], { itemId: null, step: 0 }), { itemId: 7, step: 0 });
});

test('migration 008 and screen tokens: only the hash is stored, unique', () => {
  const Database = require('better-sqlite3');
  const { runMigrations } = require('../lib/db');
  const S = require('../lib/screens');
  const token = S.newToken();
  assert.ok(S.isToken(token) && token !== S.newToken());
  assert.strictEqual(S.hashToken(token), require('crypto').createHash('sha256').update(token).digest('hex'));
  assert.ok(!S.isToken('abc') && !S.isToken(token.toUpperCase()) && !S.isToken(null));
  const mem = new Database(':memory:');
  mem.pragma('foreign_keys = ON');
  runMigrations(mem);
  mem.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'A', 0)").run();
  const add = mem.prepare("INSERT INTO screens (admin_id, name, token_hash, created_at) VALUES (1, 'Proiector', ?, 0)");
  add.run(S.hashToken(token));
  assert.throws(() => add.run(S.hashToken(token)), /UNIQUE/);
  mem.prepare("INSERT INTO screen_pairings (id, code, admin_id, screen_id, created_at, expires_at) VALUES ('p1', '123456', 1, 1, 0, 1)").run();
  mem.prepare('DELETE FROM screens WHERE id = 1').run();
  assert.strictEqual(mem.prepare('SELECT COUNT(*) FROM screen_pairings').pluck().get(), 0);
  mem.close();
});

test('projector frames: sources, items, no chords, idle', () => {
  const { projectorFrame } = require('../lib/projector');
  const items = [
    { id: 1, type: 'song', songId: 9, title: 'Sfânt' },
    { id: 2, type: 'verse', reference: 'Psalmul 23:1', body: 'Domnul este Păstorul meu.' },
    { id: 3, type: 'announcement', title: 'Agapă', body: 'După serviciu' },
    { id: 4, type: 'sermon', title: 'Predica' },
    { id: 5, type: 'other', body: 'Rugăciune\npentru țară' },
    { id: 6, type: 'video', title: 'Clip', url: 'https://x.ro/v.mp4' },
    { id: 7, type: 'song', songId: null, title: 'Cântare ștearsă' },
  ];
  const song = {
    sections: [{ id: 11, content: '[A]Ne ridici din [E]noaptea grea\n[F#m]Tu ești [D]lumina mea\n' }, { id: 12, content: '[D]Sfânt, [A/C#]sfânt' }],
    arrangement: [{ sectionId: 11 }, { sectionId: 12 }, { sectionId: 11 }],
  };
  const state = (itemId, step, source = 'content') => ({ version: 7, eventId: 3, status: 'live',
    worship: { itemId, step }, projector: { follows: 'worship', itemId: null, step: 0, source } });
  const frame = (itemId, step, source, logoUrl) => projectorFrame(state(itemId, step, source), { items }, new Map([[1, song]]), { logoUrl });
  assert.deepStrictEqual(frame(1, 0), { kind: 'lyrics', lines: ['Ne ridici din noaptea grea', 'Tu ești lumina mea'], version: 7, eventId: 3, background: null, clock: null, safeMargin: 5, fitMin: 60 });
  assert.deepStrictEqual(frame(1, 1).lines, ['Sfânt, sfânt']);
  assert.ok(!/\[[A-G]/.test(frame(1, 2).lines.join('\n')), 'no chords reach the projector');
  assert.deepStrictEqual(frame(2, 0), { kind: 'verse', reference: 'Psalmul 23:1', text: 'Domnul este Păstorul meu.', version: 7, eventId: 3, background: null, clock: null, safeMargin: 5, fitMin: 60 });
  assert.deepStrictEqual(frame(3, 0), { kind: 'announcement', title: 'Agapă', body: 'După serviciu', version: 7, eventId: 3, background: null, clock: null, safeMargin: 5, fitMin: 60 });
  assert.strictEqual(frame(4, 0).title, 'Predica');
  assert.deepStrictEqual([frame(5, 0).kind, frame(5, 0).title], ['title', 'Rugăciune']);
  assert.strictEqual(frame(6, 0).kind, 'black', 'video: black until stage 5b');
  assert.deepStrictEqual([frame(7, 0).kind, frame(7, 0).title], ['title', 'Cântare ștearsă']);
  assert.deepStrictEqual(frame(1, 0, 'black'), { kind: 'black', version: 7, eventId: 3, background: null, clock: null, safeMargin: 5, fitMin: 60 });
  assert.deepStrictEqual(frame(1, 0, 'logo', '/api/logo/x.png'), { kind: 'logo', logoUrl: '/api/logo/x.png', version: 7, eventId: 3, background: null, clock: null, safeMargin: 5, fitMin: 60 });
  assert.strictEqual(frame(1, 0, 'logo').logoUrl, null);
  assert.strictEqual(frame(99, 0).kind, 'black', 'no item at the position');
  assert.deepStrictEqual(projectorFrame(null, null, null, { logoUrl: '/api/logo/x.png' }), { kind: 'idle', logoUrl: '/api/logo/x.png', version: 0, eventId: null, background: null, clock: null, safeMargin: 5, fitMin: 60 });
  assert.strictEqual(projectorFrame({ ...state(1, 0), status: 'finished' }, { items }, new Map()).kind, 'idle');
});

test('projector frames: translation source (bridge SV -> worship)', () => {
  const { projectorFrame } = require('../lib/projector');
  const base = { version: 4, eventId: 3, status: 'live', worship: { itemId: 1, step: 0 },
    projector: { follows: 'worship', itemId: null, step: 0, source: 'translation', translationLang: 'en' } };
  // The live translated text is merged in from the bridge; the clock is hidden (like lyrics).
  assert.deepStrictEqual(projectorFrame(base, { items: [] }, new Map(), { translation: { lines: ['Holy', 'is the Lord'], partial: false } }),
    { kind: 'translation', lang: 'en', lines: ['Holy', 'is the Lord'], partial: false, version: 4, eventId: 3, background: null, clock: null, safeMargin: 5, fitMin: 60 });
  // A partial is flagged; nothing translated yet (or the bridge dropped) is an empty frame.
  assert.deepStrictEqual(projectorFrame(base, { items: [] }, new Map(), { translation: { lines: ['Holy'], partial: true } }).partial, true);
  assert.deepStrictEqual(projectorFrame(base, { items: [] }, new Map(), {}), { kind: 'translation', lang: 'en', lines: [], partial: false, version: 4, eventId: 3, background: null, clock: null, safeMargin: 5, fitMin: 60 });
});

test('live store: translation projector source keeps the picked language', () => {
  const Database = require('better-sqlite3');
  const { runMigrations } = require('../lib/db');
  const L = require('../lib/live');
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  db.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'A', 0)").run();
  const songId = Number(db.prepare("INSERT INTO songs (admin_id, title, title_norm, created_at, updated_at) VALUES (1, 'S', 's', 0, 0)").run().lastInsertRowid);
  db.prepare("INSERT INTO song_sections (song_id, admin_id, position, type, content, content_hash) VALUES (?, 1, 0, 'verse', 'x', 'h')").run(songId);
  const eventId = Number(db.prepare("INSERT INTO events (admin_id, name, event_date, status, created_at, updated_at) VALUES (1, 'E', '2026-10-04', 'planned', 0, 0)").run().lastInsertRowid);
  db.prepare("INSERT INTO setlist_items (event_id, admin_id, position, type, song_id) VALUES (?, 1, 0, 'song', ?)").run(eventId, songId);
  const store = L.createLiveStore(db);
  store.command(1, eventId, { type: 'event.start' }, undefined, 'owner');
  store.command(1, eventId, { type: 'projector.source', source: 'translation', lang: 'EN' }, undefined, 'owner');
  let snap = store.snapshot(1, eventId);
  assert.strictEqual(snap.projector.source, 'translation');
  assert.strictEqual(snap.projector.translationLang, 'en', 'lower-cased and kept');
  assert.throws(() => store.command(1, eventId, { type: 'projector.source', source: 'translation', lang: '??' }, undefined, 'owner'), /badCommand/);
  // Leaving translation keeps the last language stored (re-picking is easy); source changes.
  store.command(1, eventId, { type: 'projector.source', source: 'black' }, undefined, 'owner');
  snap = store.snapshot(1, eventId);
  assert.deepStrictEqual([snap.projector.source, snap.projector.translationLang], ['black', 'en']);
  db.close();
});

test('logo: type from magic bytes only (PNG, JPEG, WebP; never SVG)', () => {
  const { sniff, isLogoFile } = require('../lib/logo');
  const pad = (bytes) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(16)]);
  assert.strictEqual(sniff(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png');
  assert.strictEqual(sniff(pad([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.strictEqual(sniff(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(8)])), 'webp');
  assert.strictEqual(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.strictEqual(sniff(Buffer.from('not really a png, just text......')), null);
  assert.strictEqual(sniff(Buffer.alloc(3)), null);
  assert.ok(isLogoFile('logo-0123456789abcdef.png'));
  for (const bad of ['../x.png', 'logo-0123456789abcdef.svg', 'logo-xyz.png', 'logo-0123456789abcdef.png/..']) assert.ok(!isLogoFile(bad), bad);
});

test('chord notation: letters <-> Romanian solfège', () => {
  const pairs = [['C', 'Do'], ['C#', 'Do#'], ['Db', 'Reb'], ['D', 'Re'], ['D#', 'Re#'], ['Eb', 'Mib'], ['E', 'Mi'], ['F', 'Fa'],
    ['F#', 'Fa#'], ['Gb', 'Solb'], ['G', 'Sol'], ['G#', 'Sol#'], ['Ab', 'Lab'], ['A', 'La'], ['A#', 'La#'], ['Bb', 'Sib'], ['B', 'Si']];
  for (const [letters, solfege] of pairs) {
    assert.strictEqual(chords.toNotation(letters, 'solfege'), solfege, letters);
    assert.strictEqual(chords.fromSolfege(solfege), letters, solfege);
    assert.strictEqual(chords.toNotation(letters, 'letters'), letters);
  }
  const suffixes = [['Am', 'Lam'], ['F#m', 'Fa#m'], ['Bbm', 'Sibm'], ['G7', 'Sol7'], ['Dmaj7', 'Remaj7'], ['Asus4', 'Lasus4'],
    ['Cdim', 'Dodim'], ['Em7', 'Mim7'], ['D/F#', 'Re/Fa#'], ['G/B', 'Sol/Si'], ['Am7b5', 'Lam7b5'], ['C(add9)', 'Do(add9)']];
  for (const [letters, solfege] of suffixes) {
    assert.strictEqual(chords.toNotation(letters, 'solfege'), solfege, letters);
    assert.strictEqual(chords.fromSolfege(solfege), letters, solfege);
  }
  assert.strictEqual(chords.toNotation('N.C.', 'solfege'), 'N.C.');
  assert.strictEqual(chords.toNotation('x2', 'solfege'), 'x2');
  for (const word of ['Mi-e', 'Si-am', 'Do-mnul', 'Domnul', 'La-nceput', 'la', 'mi', 'Lamin']) assert.strictEqual(chords.fromSolfege(word), word, word);
  // Round trip letters -> solfège -> letters on 10 samples.
  const samples = ['[G]Ne ridici din [D/F#]noaptea [Em7]grea', '[Am]În [F]noaptea [C]grea [G]Tu', '[Bb]Mare [Eb]ești [F7]Tu',
    '[C#m]Sfânt [A]e [E/G#]Domnul', '[Dmaj7]Pace [Gsus4]Ție', '[F#m7b5]A [B7]doua', '[Ab]Isus [Db/F]Hristos [Eb]Domn',
    '[N.C.]Aleluia [x2]', '[Cdim]Har [C(add9)]și', '[Gm/Bb]Tu [A7sus4]ești'];
  for (const content of samples) {
    const shown = chords.renderContent(content, 'solfege');
    assert.ok(shown !== content || !/\[[A-G]/.test(content));
    assert.strictEqual(chords.chordsOverLyricsToInline(shown), content, shown);
  }
  assert.strictEqual(chords.renderContent('[G]Ne [D/F#]ridici', 'solfege'), '[Sol]Ne [Re/Fa#]ridici');
  assert.strictEqual(chords.renderContent('[G]Ne', 'letters'), '[G]Ne');
});

test('chord notation: Romanian lyric lines are never chord lines; solfège chord lines are', () => {
  const lyrics = ['La mulți ani', 'Mi-e dor de Tine', 'Si-am cântat', 'Do-mnul e bun', 'La la la', 'La La La', 'Do Re Mi',
    'Sol și ploaie', 'Re-nviere', 'Mi se pare', 'Fa ce vrei', 'Am cântat', 'Si', 'la'];
  for (const line of lyrics.slice(0, -2)) assert.strictEqual(chords.isChordLine(line), false, line);
  assert.strictEqual(chords.isChordLine('la'), false);
  const chordLines = ['Sol   Re/Fa#   Mim7', 'Lam  Fa  Do  Sol', 'Sol', '  Re', 'Do#m7 Fa#', 'Sol Re Mi7 La', 'G D Em C'];
  for (const line of chordLines) assert.strictEqual(chords.isChordLine(line), true, line);
  // Lyrics pass through untouched (they are not chord lines).
  const song = 'La mulți ani\nMi-e dor de Tine\nSi-am cântat\nDo-mnul e bun\nLa La La';
  assert.strictEqual(chords.chordsOverLyricsToInline(song), song);
  // A real solfège chord-over-lyrics block becomes inline letters.
  const pasted = ['Sol        Re/Fa#     Mim7', 'Ne ridici din noaptea grea', 'Do          Re', 'Tu ești lumina mea', 'La mulți ani'].join('\n');
  assert.strictEqual(chords.chordsOverLyricsToInline(pasted),
    '[G]Ne ridici d[D/F#]in noaptea [Em7]grea\n[C]Tu ești lumi[D]na mea\nLa mulți ani');
  // Inline solfège chords are stored as letters too.
  assert.strictEqual(chords.chordsOverLyricsToInline('[Sol]Ne [Re/Fa#]ridici [x2]'), '[G]Ne [D/F#]ridici [x2]');
});

test('migration 009: users.chord_notation is letters, solfege or NULL', () => {
  const Database = require('better-sqlite3');
  const { runMigrations } = require('../lib/db');
  const { createAdminSettings } = require('../lib/admin-settings');
  const mem = new Database(':memory:');
  runMigrations(mem);
  mem.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'A', 0)").run();
  const add = mem.prepare("INSERT INTO users (admin_id, email, name, password_hash, role, created_at, chord_notation) VALUES (1, ?, 'U', 'x', 'member', 0, ?)");
  add.run('a@x.ro', null);
  add.run('b@x.ro', 'solfege');
  assert.throws(() => add.run('c@x.ro', 'german'), /CHECK/);
  const settings = createAdminSettings(mem);
  assert.strictEqual(settings.chordNotationDefault(1), 'letters');
  settings.set(1, 'chord_notation_default', 'solfege');
  assert.strictEqual(settings.chordNotationDefault(1), 'solfege');
  mem.close();
});

test('media: video type from magic bytes, allowed video links', () => {
  const M = require('../lib/media');
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(52)]);
  const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]), Buffer.from('B\u0082\u0084webm'), Buffer.alloc(40)]);
  const mkv = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from('matroska'), Buffer.alloc(52)]);
  assert.strictEqual(M.sniffVideo(mp4), 'video/mp4');
  assert.strictEqual(M.sniffVideo(webm), 'video/webm');
  assert.strictEqual(M.sniffVideo(mkv), null, 'Matroska that is not WebM');
  assert.strictEqual(M.sniffVideo(Buffer.from('not a video file, only text......')), null);
  const ok = {
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ': { kind: 'youtube', id: 'dQw4w9WgXcQ' },
    'https://youtu.be/dQw4w9WgXcQ?t=10': { kind: 'youtube', id: 'dQw4w9WgXcQ' },
    'https://m.youtube.com/shorts/dQw4w9WgXcQ': { kind: 'youtube', id: 'dQw4w9WgXcQ' },
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ': { kind: 'youtube', id: 'dQw4w9WgXcQ' },
    'https://vimeo.com/76979871': { kind: 'vimeo', id: '76979871' },
    'https://player.vimeo.com/video/76979871?h=abc': { kind: 'vimeo', id: '76979871' },
    'https://cdn.example.org/clips/anunt.MP4': { kind: 'file', url: 'https://cdn.example.org/clips/anunt.MP4' },
    'https://cdn.example.org/a.webm?x=1': { kind: 'file', url: 'https://cdn.example.org/a.webm?x=1' },
  };
  for (const [url, parsed] of Object.entries(ok)) assert.deepStrictEqual(M.parseVideoUrl(url), parsed, url);
  for (const bad of ['http://youtu.be/dQw4w9WgXcQ', 'https://youtube.com/watch?v=short', 'https://example.com/page', 'https://vimeo.com/channels/x',
    'https://example.com/v.mov', 'javascript:alert(1)', 'https://user:pw@example.com/a.mp4', '']) {
    assert.strictEqual(M.parseVideoUrl(bad), null, bad);
  }
  assert.deepStrictEqual(M.sourceOf({ kind: 'url', url: 'youtube:dQw4w9WgXcQ' }), { type: 'youtube', id: 'dQw4w9WgXcQ' });
  assert.deepStrictEqual(M.sourceOf({ kind: 'upload', mime: 'video/webm' }), { type: 'upload', mime: 'video/webm' });
});

test('validateItems: a video item from the media library', () => {
  const findMedia = (id) => (id === 3 ? { id: 3, title: 'Anunț tabără' } : null);
  const v = (item) => evs.validateItems([{ type: 'video', ...item }], tro, () => null, findMedia);
  assert.deepStrictEqual([v({ mediaId: 3 }).value[0].mediaId, v({ mediaId: 3 }).value[0].title, v({ mediaId: 3 }).value[0].url], [3, 'Anunț tabără', null]);
  assert.strictEqual(v({ mediaId: 3, title: 'Clip' }).value[0].title, 'Clip');
  assert.ok(v({ mediaId: 9 }).error);
  assert.strictEqual(v({ url: 'https://x.ro/v.mp4' }).value[0].mediaId, null);
  assert.ok(v({}).error);
});

test('projector frames: a prepared video rides along, plays only on the video source', () => {
  const { projectorFrame } = require('../lib/projector');
  const items = [{ id: 1, type: 'verse', reference: 'Ps 1', body: 'Ferice' }];
  const media = { type: 'upload', src: '/api/media/4/file?exp=1&sig=x', mime: 'video/mp4', title: 'Clip' };
  const st = (source, videoState) => ({ version: 3, eventId: 2, status: 'live', worship: { itemId: 1, step: 0 },
    projector: { follows: 'worship', itemId: null, step: 0, source },
    video: { state: videoState, seq: 5, volume: 0.8, position: 0 } });
  const f = (source, videoState, m = media) => projectorFrame(st(source, videoState), { items }, new Map(), { videoMedia: m });
  assert.deepStrictEqual(f('content', 'prepared'), { kind: 'verse', reference: 'Ps 1', text: 'Ferice', version: 3, eventId: 2, background: null, clock: null, safeMargin: 5, fitMin: 60,
    video: { state: 'prepared', seq: 5, volume: 0.8, position: 0, media } });
  assert.strictEqual(f('video', 'playing').kind, 'video');
  assert.strictEqual(f('video', 'paused').kind, 'video');
  assert.strictEqual(f('video', 'prepared').kind, 'black');
  assert.strictEqual(f('black', 'ended').kind, 'black');
  assert.strictEqual(f('content', 'none', null).video, undefined);
  assert.strictEqual(f('video', 'playing', null).kind, 'black', 'nothing playable');
});

test('section codes, arrangements and defaults', () => {
  const S = require('../lib/sections');
  const mixed = [{ type: 'intro' }, { type: 'verse' }, { type: 'chorus' }, { type: 'verse' }, { type: 'pre_chorus' },
    { type: 'chorus' }, { type: 'bridge' }, { type: 'outro' }, { type: 'tag' }, { type: 'other' }, { type: 'verse' }];
  assert.deepStrictEqual(S.sectionCodes(mixed), ['I', 'V1', 'C1', 'V2', 'P', 'C2', 'B', 'O', 'T', 'X', 'V3']);
  assert.deepStrictEqual(S.sectionCodes([{ type: 'verse' }, { type: 'chorus' }]), ['V1', 'C']);
  const song = [{ type: 'verse' }, { type: 'chorus' }, { type: 'verse' }, { type: 'bridge' }];
  const parsed = S.parseArrangement('v1, c1  V2 C b V9 zz C3', song);
  assert.deepStrictEqual(parsed.codes, ['V1', 'C', 'V2', 'C', 'B']);
  assert.deepStrictEqual(parsed.indexes, [0, 1, 2, 1, 3]);
  assert.deepStrictEqual(parsed.unknown, ['V9', 'zz', 'C3']);
  assert.strictEqual(S.codeIndex('V', song), 0);
  assert.deepStrictEqual(S.defaultArrangement({ presentation: 'V1 C V2 C B C', sections: song }), ['V1', 'C', 'V2', 'C', 'B', 'C']);
  assert.deepStrictEqual(S.defaultArrangement({ presentation: 'V1 C V3', sections: song }), ['V1', 'C', 'V2', 'B']);
  assert.deepStrictEqual(S.defaultArrangement({ presentation: null, sections: song }), ['V1', 'C', 'V2', 'B']);
  assert.deepStrictEqual(S.defaultArrangement({ presentation: 'V C', sections: [{ type: 'verse' }, { type: 'verse' }, { type: 'chorus' }] }), ['V1', 'C']);
});

// --- sections -------------------------------------------------------------

test('sectionLabels: numbered verses, repeated types, custom labels, both languages', () => {
  const secs = [{ type: 'verse' }, { type: 'chorus' }, { type: 'verse' }, { type: 'bridge' }, { type: 'tag', label: 'Final lent' }];
  assert.deepStrictEqual(sectionLabels(secs, (k, v) => t(k, v, 'ro')), ['Strofa 1', 'Refren', 'Strofa 2', 'Punte', 'Final lent']);
  assert.deepStrictEqual(sectionLabels(secs, (k, v) => t(k, v, 'en')), ['Verse 1', 'Chorus', 'Verse 2', 'Bridge', 'Final lent']);
  assert.deepStrictEqual(sectionLabels([{ type: 'chorus' }, { type: 'chorus' }], (k, v) => t(k, v, 'ro')), ['Refren 1', 'Refren 2']);
});

// A live event in a fresh in-memory database: a song V1 C V1 (3 steps) and two verses.
function liveFixture() {
  const Database = require('better-sqlite3');
  const { runMigrations } = require('../lib/db');
  const { createEventStore, validateItems } = require('../lib/events');
  const { createLiveStore } = require('../lib/live');
  const mem = new Database(':memory:');
  mem.pragma('foreign_keys = ON');
  runMigrations(mem);
  mem.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'A', 0)").run();
  mem.prepare("INSERT INTO users (id, admin_id, email, name, password_hash, role, created_at) VALUES (1, 1, 'a@x.ro', 'A', 'x', 'owner', 0)").run();
  mem.prepare("INSERT INTO songs (id, admin_id, title, title_norm, created_at, updated_at) VALUES (1, 1, 'Sfânt', 'sfant', 0, 0)").run();
  const section = mem.prepare("INSERT INTO song_sections (song_id, admin_id, position, type, content, content_hash) VALUES (1, 1, ?, ?, ?, 'h')");
  section.run(0, 'verse', '[G]Strofa');
  section.run(1, 'chorus', '[C]Refren');
  const evs = createEventStore(mem);
  const eventId = evs.create(1, 1, { name: 'E', eventDate: '2026-10-04', startTime: null, notes: null });
  const tro = (k, v) => t(k, v, 'ro');
  const save = (items) => {
    const { error, value } = validateItems(items, tro, (id) => evs.findSong(1, id));
    assert.ok(!error, error);
    evs.replaceItems(1, eventId, value);
    return evs.get(1, eventId).items;
  };
  const items = save([{ type: 'song', songId: 1, arrangement: 'V1 C V1' }, { type: 'verse', reference: 'Ps 1' }, { type: 'verse', reference: 'Ps 2' }]);
  const live = createLiveStore(mem);
  return { mem, evs, live, eventId, items, save };
}

test('live permissions: the event roles alike in both modes; member nothing', () => {
  const { permission } = require('../lib/live');
  const E = ['owner', 'presenter', 'leader', 'operator'];
  const together = {
    'worship.next': E, 'worship.goto': E, 'event.start': E, 'event.end': E, 'projector.request': E, 'team.mode': E,
    'projector.next': [], 'projector.goto': [], 'projector.syncToWorship': [],
    'projector.source': E, 'video.play': E, 'operator.addItem': E,
  };
  const split = { ...together, 'projector.next': E, 'projector.goto': E, 'projector.syncToWorship': E };
  for (const [mode, table] of [['together', together], ['split', split]]) {
    for (const [type, allowed] of Object.entries(table)) {
      for (const role of ['owner', 'presenter', 'leader', 'operator', 'member']) {
        const code = permission(role, type, mode);
        assert.strictEqual(code === null, allowed.includes(role), `${role} ${type} (${mode}): ${code}`);
      }
    }
  }
  assert.strictEqual(permission('operator', 'projector.next', 'together'), 'notSplitMode');
  assert.strictEqual(permission('member', 'projector.next', 'split'), 'forbidden');
  assert.strictEqual(permission('member', 'team.mode', 'together'), 'forbidden');
  assert.strictEqual(permission(undefined, 'video.ended', 'together'), null, 'the server itself');
});

test('live store: together and split; switching keeps positions; team mode', () => {
  const { mem, live, eventId, items } = liveFixture();
  const [song, v1, v2] = items.map((it) => it.id);
  const cmd = (c, role = 'leader') => live.command(1, eventId, c, undefined, role);
  const code = (c, role) => { try { cmd(c, role); return 'ok'; } catch (err) { return err.code; } };
  const snap = () => live.snapshot(1, eventId);
  const pos = (p) => [p.itemId, p.step];
  assert.strictEqual(code({ type: 'projector.request' }, 'operator'), 'notLive');
  cmd({ type: 'event.start' }, 'leader'); // the leader starts (no operator connected): the leader holds the projector
  assert.deepStrictEqual([snap().mode, snap().teamMode, snap().projector.follows, snap().holder.role], ['together', 'follow', 'worship', 'leader']);
  // together: leader and operator move the same main position; projector commands refused
  cmd({ type: 'worship.next' }, 'leader');
  cmd({ type: 'worship.next' }, 'operator');
  assert.deepStrictEqual(pos(snap().worship), [song, 2]);
  cmd({ type: 'worship.prev' }, 'operator');
  assert.deepStrictEqual(pos(snap().worship), [song, 1]);
  for (const role of ['leader', 'operator', 'owner']) assert.strictEqual(code({ type: 'projector.next' }, role), 'notSplitMode');
  assert.strictEqual(code({ type: 'projector.source', source: 'content' }, 'operator'), 'ok');
  // the operator takes the projector (the holder is not connected: at once): split, and the
  // projector starts at the main position; then the two move on their own
  cmd({ type: 'projector.request' }, 'operator');
  assert.deepStrictEqual([snap().mode, snap().projector.follows, ...pos(snap().projector)], ['split', 'operator', song, 1]);
  cmd({ type: 'projector.next' }, 'operator');
  cmd({ type: 'projector.next' }, 'leader');
  assert.deepStrictEqual([pos(snap().projector), pos(snap().worship)], [[v1, 0], [song, 1]]);
  cmd({ type: 'worship.prev' }, 'operator');
  assert.deepStrictEqual([pos(snap().projector), pos(snap().worship)], [[v1, 0], [song, 0]], 'the main position alone');
  cmd({ type: 'projector.goto', itemId: v2, step: 0 }, 'leader');
  assert.strictEqual(code({ type: 'projector.goto', itemId: v2, step: 3 }, 'operator'), 'badPosition');
  assert.strictEqual(code({ type: 'projector.next' }, 'member'), 'forbidden');
  // "Sari acolo": the projector jumps to the team, or the team to the projector
  cmd({ type: 'projector.syncToWorship' }, 'operator');
  assert.deepStrictEqual(pos(snap().projector), [song, 0]);
  const v = snap().version;
  cmd({ type: 'projector.syncToWorship' }, 'operator');
  assert.strictEqual(snap().version, v, 'already there: no-op');
  cmd({ type: 'projector.goto', itemId: v1, step: 0 }, 'operator');
  cmd({ type: 'worship.goto', itemId: v1, step: 0 }, 'leader');
  assert.deepStrictEqual(pos(snap().worship), [v1, 0]);
  // the frame shows the projector position in split, the main one together
  const { projectorFrame } = require('../lib/projector');
  const events = require('../lib/events').createEventStore(mem);
  cmd({ type: 'worship.goto', itemId: song, step: 0 });
  cmd({ type: 'projector.goto', itemId: v1, step: 0 }, 'operator');
  assert.strictEqual(projectorFrame(snap(), events.get(1, eventId), new Map()).reference, 'Ps 1');
  // the leader takes it back: together, the projector shows the main position at once; the position is kept
  cmd({ type: 'projector.request' }, 'leader');
  assert.deepStrictEqual([snap().mode, ...pos(snap().worship)], ['together', song, 0]);
  assert.strictEqual(projectorFrame(snap(), events.get(1, eventId), new Map()).kind, 'title', 'the song item (no song map here)');
  assert.strictEqual(code({ type: 'projector.next' }, 'operator'), 'notSplitMode');
  // team mode: any event role; same mode = no-op
  assert.strictEqual(code({ type: 'team.mode', mode: 'loose' }), 'badCommand');
  assert.strictEqual(code({ type: 'team.mode', mode: 'free' }, 'member'), 'forbidden');
  cmd({ type: 'team.mode', mode: 'free' }, 'operator');
  assert.strictEqual(snap().teamMode, 'free');
  const w = snap().version;
  cmd({ type: 'team.mode', mode: 'free' }, 'leader');
  assert.strictEqual(snap().version, w);
  // a restart (new store, same database) keeps modes and positions
  cmd({ type: 'projector.request' }, 'operator');
  cmd({ type: 'projector.goto', itemId: v2, step: 0 }, 'operator');
  const again = require('../lib/live').createLiveStore(mem).snapshot(1, eventId);
  assert.deepStrictEqual([again.mode, again.teamMode, again.worship, again.projector], ['split', 'free', snap().worship, snap().projector]);
  // a new start begins together, following
  cmd({ type: 'event.end' }, 'operator');
  mem.close();
});

test('live store: "Pe ce ecrane" (migration 040): null = every screen; chosen ids distinct and sorted, existing screens of this admin only; persisted; reset at a new start', () => {
  const { mem, live, eventId } = liveFixture();
  mem.prepare("INSERT INTO admins (id, name, created_at) VALUES (2, 'B', 0)").run();
  const screens = require('../lib/screens').createScreenStore(mem);
  const a = screens.create(1, 1, 'Sală').id;
  const b = screens.create(1, 1, 'Hol').id;
  const foreign = screens.create(2, null, 'Al altuia').id;
  const cmd = (c, role = 'leader') => live.command(1, eventId, c, undefined, role);
  const code = (c, role) => { try { cmd(c, role); return 'ok'; } catch (err) { return err.code; } };
  const snap = () => live.snapshot(1, eventId);
  assert.strictEqual(snap().screens, null, 'before any start: every screen');
  cmd({ type: 'event.start' });
  assert.strictEqual(snap().screens, null);
  for (const role of ['owner', 'presenter', 'leader', 'operator']) assert.strictEqual(code({ type: 'projector.screens', screenIds: [b, a, b] }, role), 'ok', role);
  assert.deepStrictEqual(snap().screens, [a, b], 'distinct, sorted');
  assert.strictEqual(code({ type: 'projector.screens', screenIds: [a] }, 'member'), 'forbidden');
  const v = snap().version;
  cmd({ type: 'projector.screens', screenIds: [a, b] });
  assert.strictEqual(snap().version, v, 'the same choice: no-op');
  assert.strictEqual(code({ type: 'projector.screens', screenIds: [a, foreign] }), 'screenNotFound', 'another admin\'s screen');
  assert.strictEqual(code({ type: 'projector.screens', screenIds: [a, 12345] }), 'screenNotFound');
  assert.strictEqual(code({ type: 'projector.screens', screenIds: 'all' }), 'badCommand');
  assert.strictEqual(code({ type: 'projector.screens', screenIds: [1.5] }), 'badCommand');
  cmd({ type: 'projector.screens', screenIds: [] });
  assert.deepStrictEqual(snap().screens, [], 'nobody: allowed (every screen idle)');
  cmd({ type: 'projector.screens', screenIds: [b] });
  cmd({ type: 'worship.next' });
  assert.deepStrictEqual(snap().screens, [b], 'a move keeps the choice');
  cmd({ type: 'projector.request' }, 'operator');
  assert.deepStrictEqual(snap().screens, [b], 'a change of hands too');
  assert.deepStrictEqual(require('../lib/live').createLiveStore(mem).snapshot(1, eventId).screens, [b], 'persisted');
  screens.revoke(1, b);
  assert.deepStrictEqual(snap().screens, [b], 'a revoked screen stays in the stored choice (harmless: it is gone)');
  assert.strictEqual(code({ type: 'projector.screens', screenIds: [b] }), 'screenNotFound', 'but cannot be chosen again');
  cmd({ type: 'projector.screens', screenIds: null });
  assert.strictEqual(snap().screens, null);
  cmd({ type: 'projector.screens', screenIds: [a] });
  cmd({ type: 'event.end' });
  mem.prepare("UPDATE events SET status = 'planned' WHERE id = ?").run(eventId);
  cmd({ type: 'event.start' });
  assert.strictEqual(snap().screens, null, 'a new start: every screen again');
  mem.close();
});

test('live store: projector preparation before the start (migration 043): clock, background, screens, video while planned; the start keeps them; nothing else; not on a template', () => {
  const { mem, live, eventId } = liveFixture();
  const { PREPARE_COMMANDS } = require('../lib/live');
  assert.deepStrictEqual(PREPARE_COMMANDS, ['clock.set', 'background.set', 'projector.screens', 'video.prepare', 'video.volume']);
  const screens = require('../lib/screens').createScreenStore(mem);
  const a = screens.create(1, 1, 'Sală').id;
  screens.create(1, 1, 'Hol');
  mem.prepare("INSERT INTO media (id, admin_id, kind, title, created_at) VALUES (50, 1, 'image', 'Cer', 0)").run();
  mem.prepare("INSERT INTO media (id, admin_id, kind, title, created_at) VALUES (51, 1, 'upload', 'Intro', 0)").run();
  const cmd = (c, role = 'leader') => live.command(1, eventId, c, undefined, role);
  const code = (c, role) => { try { cmd(c, role); return 'ok'; } catch (err) { return err.code; } };
  const snap = () => live.snapshot(1, eventId);
  assert.deepStrictEqual([snap().status, snap().prepared], ['planned', false]);
  // allowed while planned
  cmd({ type: 'clock.set', show: false, position: 'top-left', scale: 1.2 });
  cmd({ type: 'background.set', background: 50 }, 'presenter');
  cmd({ type: 'projector.screens', screenIds: [a] }, 'operator');
  cmd({ type: 'video.prepare', mediaId: 51 }, 'owner');
  cmd({ type: 'video.volume', volume: 0.5 });
  let s = snap();
  assert.deepStrictEqual([s.status, s.prepared, s.clock.show, s.clock.position, s.clock.scale, s.backgroundOverride, s.screens, s.video.state, s.video.mediaId, s.video.volume],
    ['planned', true, false, 'top-left', 1.2, 50, [a], 'prepared', 51, 0.5], 'stored, still planned, marked prepared');
  // everything else still waits for the start
  for (const c of [{ type: 'video.play' }, { type: 'projector.source', source: 'black' }, { type: 'worship.next' }, { type: 'team.mode', mode: 'free' }, { type: 'projector.request' }]) {
    assert.strictEqual(code(c), 'notLive', c.type);
  }
  assert.strictEqual(code({ type: 'clock.set', show: true }, 'member'), 'forbidden');
  // the start keeps the preparation (and clears the mark), positions start as usual
  cmd({ type: 'event.start' }, 'leader');
  s = snap();
  assert.deepStrictEqual([s.status, s.prepared, s.clock.show, s.clock.position, s.backgroundOverride, s.screens, s.video.state, s.video.mediaId, s.video.volume, s.projector.source, s.worship.step],
    ['live', false, false, 'top-left', 50, [a], 'prepared', 51, 0.5, 'content', 0]);
  assert.strictEqual(code({ type: 'video.play' }), 'ok', 'the prepared video plays live');
  // a second run of the same event (reopened) without preparation starts from the defaults
  cmd({ type: 'event.end' }, 'leader');
  mem.prepare("UPDATE events SET status = 'planned' WHERE id = ?").run(eventId);
  cmd({ type: 'event.start' }, 'leader');
  s = snap();
  assert.deepStrictEqual([s.clock.show, s.backgroundOverride, s.screens, s.video.state], [true, null, null, 'none'], 'not prepared: the church defaults');
  // finished events and templates are never prepared
  cmd({ type: 'event.end' }, 'leader');
  assert.strictEqual(code({ type: 'clock.set', show: false }), 'notLive', 'finished');
  mem.prepare("UPDATE events SET status = 'planned', is_template = 1 WHERE id = ?").run(eventId);
  assert.strictEqual(code({ type: 'clock.set', show: false }), 'notLive', 'a template');
  mem.close();
});

test('live store: "Retrage din live" (event.withdraw): back to planned, not finished; the preparation stays for the next start, which begins at the first item', () => {
  const { mem, live, eventId } = liveFixture();
  const cmd = (c, role = 'leader', ctx = {}) => live.command(1, eventId, c, undefined, role, ctx);
  const code = (c, role) => { try { cmd(c, role); return 'ok'; } catch (err) { return err.code; } };
  const snap = () => live.snapshot(1, eventId);
  assert.strictEqual(code({ type: 'event.withdraw' }), 'notLive', 'only a live event');
  cmd({ type: 'event.start' }, 'operator', { userId: 7, online: [{ userId: 7, role: 'operator' }] });
  cmd({ type: 'clock.set', show: false });
  cmd({ type: 'worship.next' });
  cmd({ type: 'projector.source', source: 'logo' });
  assert.strictEqual(code({ type: 'event.withdraw' }, 'member'), 'forbidden');
  cmd({ type: 'event.withdraw' }, 'presenter');
  let s = snap();
  assert.deepStrictEqual([s.status, s.prepared, s.holder, s.handover, s.projector.source, s.clock.show], ['planned', true, null, null, 'content', false], 'planned again, nobody holds the projector, the clock kept as preparation');
  assert.strictEqual(require('../lib/events').createEventStore(mem).get(1, eventId).event.status, 'planned', 'the event row too');
  assert.strictEqual(code({ type: 'worship.next' }), 'notLive', 'nothing moves while planned');
  cmd({ type: 'event.start' }, 'leader', { userId: 5, online: [{ userId: 5, role: 'leader' }] });
  s = snap();
  assert.deepStrictEqual([s.status, s.worship.step, s.clock.show, s.holder.role], ['live', 0, false, 'leader'], 'started again: the first item, the clock as left');
  cmd({ type: 'event.end' });
  assert.strictEqual(code({ type: 'event.withdraw' }), 'notLive', 'a finished event cannot be withdrawn');
  mem.close();
});

test('live store: both positions clamp on their own after a setlist change; persisted', () => {
  const { mem, live, eventId, items, save } = liveFixture();
  const [song, v1, v2] = items.map((it) => it.id);
  const cmd = (c, role = 'leader') => live.command(1, eventId, c, undefined, role);
  cmd({ type: 'event.start' });
  cmd({ type: 'worship.goto', itemId: song, step: 2 });
  cmd({ type: 'projector.request' }, 'operator');
  cmd({ type: 'projector.goto', itemId: v1, step: 0 }, 'operator');
  const before = live.layouts(1, eventId);
  // the song loses its repeat (V1 C V1 -> V1 C: the position on the 2nd V1 stays on V1) and Ps 1 is removed
  save([{ id: song, type: 'song', songId: 1, arrangement: 'V1 C' }, { id: v2, type: 'verse', reference: 'Ps 2' }]);
  live.setlistChanged(1, eventId, before);
  const s = live.snapshot(1, eventId);
  assert.deepStrictEqual([s.worship.itemId, s.worship.step], [song, 0], 'worship stays on the same section (V1)');
  assert.deepStrictEqual([s.projector.itemId, s.projector.step, s.mode], [v2, 0, 'split'], 'projector moved to the next item');
  // a new store on the same database (a server restart) reads the same state
  const again = require('../lib/live').createLiveStore(mem).snapshot(1, eventId);
  assert.deepStrictEqual([again.projector, again.worship], [s.projector, s.worship]);
  mem.close();
});

test('live store: additions go where the sender chooses, no approval; a notice for the others', () => {
  const { mem, evs, live, eventId } = liveFixture();
  const [song, v1] = evs.get(1, eventId).items.map((it) => it.id);
  const cmd = (c, role = 'operator') => live.command(1, eventId, c, undefined, role);
  const code = (c, role) => { try { cmd(c, role); return 'ok'; } catch (err) { return err.code; } };
  const shared = () => evs.get(1, eventId).items.map((it) => it.title || it.reference);
  const all = () => evs.get(1, eventId, { scope: 'all' }).items.map((it) => `${it.title || it.reference}${it.scope === 'projector' ? '*' : ''}`);
  cmd({ type: 'event.start' }, 'leader'); // the leader holds the projector: together
  const key = live.snapshot(1, eventId).setlistKey;
  // "Doar pe proiector": after what the projector shows (together: the main item); the team never sees it
  let r = cmd({ type: 'operator.addItem', target: 'projector', item: { type: 'verse', reference: 'Ioan 3:16', body: 'Fiindcă' } });
  assert.deepStrictEqual(r.notice, { type: 'itemAdded', title: 'Ioan 3:16', target: 'projector' });
  assert.deepStrictEqual(all(), ['Sfânt', 'Ioan 3:16*', 'Ps 1', 'Ps 2']);
  assert.deepStrictEqual(shared(), ['Sfânt', 'Ps 1', 'Ps 2']);
  assert.strictEqual(live.snapshot(1, eventId).setlistKey, key, 'team phones do not reload');
  // "În setlist": shared, right after the main item; team phones reload
  cmd({ type: 'worship.goto', itemId: v1, step: 0 }, 'leader');
  r = cmd({ type: 'operator.addItem', target: 'setlist', item: { type: 'song', songId: 1 } });
  assert.deepStrictEqual(r.notice, { type: 'itemAdded', title: 'Sfânt', target: 'setlist' });
  assert.deepStrictEqual(shared(), ['Sfânt', 'Ps 1', 'Sfânt', 'Ps 2']);
  assert.notStrictEqual(live.snapshot(1, eventId).setlistKey, key, 'team phones reload');
  assert.strictEqual(evs.get(1, eventId).event.itemCount, 4);
  // split, projector on the song: a projector-only item lands after the projector's item
  cmd({ type: 'projector.request' }, 'operator');
  cmd({ type: 'projector.goto', itemId: song, step: 0 });
  cmd({ type: 'operator.addItem', target: 'projector', item: { type: 'announcement', title: 'Agapă', body: 'Sala mică' } }, 'leader');
  assert.deepStrictEqual(all(), ['Sfânt', 'Agapă*', 'Ioan 3:16*', 'Ps 1', 'Sfânt', 'Ps 2']);
  // projector navigation walks all items, the main position only the shared ones
  cmd({ type: 'projector.goto', itemId: song, step: 2 });
  cmd({ type: 'projector.next' });
  assert.strictEqual(evs.get(1, eventId, { scope: 'all' }).items.find((it) => it.id === live.snapshot(1, eventId).projector.itemId).title, 'Agapă');
  cmd({ type: 'worship.goto', itemId: song, step: 2 });
  cmd({ type: 'worship.next' });
  assert.strictEqual(live.snapshot(1, eventId).worship.itemId, v1, 'the main position skips projector-only items');
  // bad input, permissions
  assert.strictEqual(code({ type: 'operator.addItem', item: { type: 'verse', reference: 'x' } }), 'badCommand', 'a target is required');
  assert.strictEqual(code({ type: 'operator.addItem', target: 'everywhere', item: { type: 'verse', reference: 'x' } }), 'badCommand');
  assert.strictEqual(code({ type: 'operator.addItem', target: 'setlist', item: { type: 'video', url: 'https://x.ro/a.mp4' } }), 'badItem');
  assert.strictEqual(code({ type: 'operator.addItem', target: 'setlist', item: { type: 'song', songId: 99 } }), 'badItem');
  assert.strictEqual(code({ type: 'operator.addItem', target: 'setlist', item: { type: 'verse', reference: 'x' } }, 'member'), 'forbidden');
  assert.strictEqual(code({ type: 'request.accept', itemId: v1, position: 'end' }, 'leader'), 'badCommand', 'no approval flow');
  mem.close();
});

test('migration 016: media rebuilt with image / loop kinds; references and data kept', () => {
  const Database = require('better-sqlite3');
  const fs = require('fs');
  const path = require('path');
  const { runMigrations } = require('../lib/db');
  const dir = path.join(__dirname, '..', 'lib', 'migrations');
  const before = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wa-mig-'));
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql') && x < '016')) fs.copyFileSync(path.join(dir, f), path.join(before, f));
  const mem = new Database(':memory:');
  mem.pragma('foreign_keys = ON');
  runMigrations(mem, before);
  mem.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'A', 0)").run();
  mem.prepare("INSERT INTO media (id, admin_id, kind, title, url, created_at) VALUES (7, 1, 'url', 'Clip', 'youtube:abcdefghijk', 0)").run();
  mem.prepare("INSERT INTO events (id, admin_id, name, event_date, created_at, updated_at) VALUES (1, 1, 'E', '2026-10-04', 0, 0)").run();
  mem.prepare("INSERT INTO setlist_items (event_id, admin_id, position, type, media_id) VALUES (1, 1, 0, 'video', 7)").run();
  mem.prepare("INSERT INTO live_state (event_id, admin_id, version, video_media_id, updated_at) VALUES (1, 1, 1, 7, 0)").run();
  assert.deepStrictEqual(runMigrations(mem, dir).filter((n) => n.startsWith('016')), ['016_media_backgrounds.sql']);
  assert.strictEqual(mem.pragma('foreign_keys', { simple: true }), 1, 'foreign keys back on');
  assert.strictEqual(mem.prepare('SELECT media_id FROM setlist_items').pluck().get(), 7, 'the setlist item keeps its video');
  assert.strictEqual(mem.prepare('SELECT video_media_id FROM live_state').pluck().get(), 7);
  assert.strictEqual(mem.prepare('SELECT title FROM media WHERE id = 7').pluck().get(), 'Clip');
  mem.prepare("INSERT INTO media (admin_id, kind, title, file, created_at) VALUES (1, 'image', 'Fundal', 'x.jpg', 0)").run();
  assert.throws(() => mem.prepare("INSERT INTO media (admin_id, kind, title, created_at) VALUES (1, 'gif', 'x', 0)").run(), /CHECK/);
  // the reference still cascades like before (ON DELETE SET NULL)
  mem.prepare('DELETE FROM media WHERE id = 7').run();
  assert.strictEqual(mem.prepare('SELECT media_id FROM setlist_items').pluck().get(), null);
  fs.rmSync(before, { recursive: true, force: true });
  mem.close();
});

test('backgrounds: resolution order, "none" stops lower levels, deleted media falls back', () => {
  const Database = require('better-sqlite3');
  const { runMigrations } = require('../lib/db');
  const B = require('../lib/backgrounds');
  const { projectorFrame } = require('../lib/projector');
  const mem = new Database(':memory:');
  mem.pragma('foreign_keys = ON');
  runMigrations(mem);
  mem.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'A', 0), (2, 'B', 0)").run();
  const media = mem.prepare("INSERT INTO media (id, admin_id, kind, title, file, created_at) VALUES (?, ?, ?, ?, 'f', 0)");
  media.run(10, 1, 'image', 'Biserica');
  media.run(11, 1, 'image', 'Cântare');
  media.run(12, 1, 'loop', 'Item');
  media.run(13, 1, 'image', 'Live');
  media.run(14, 1, 'image', 'Verset');
  media.run(15, 1, 'upload', 'Clip video');
  media.run(20, 2, 'image', 'Alt admin');
  mem.prepare("INSERT INTO songs (id, admin_id, title, title_norm, created_at, updated_at) VALUES (1, 1, 'S', 's', 0, 0)").run();
  mem.prepare("INSERT INTO events (id, admin_id, name, event_date, created_at, updated_at) VALUES (1, 1, 'E', '2026-10-04', 0, 0)").run();
  const item = mem.prepare('INSERT INTO setlist_items (id, event_id, admin_id, position, type, song_id, reference, title) VALUES (?, 1, 1, ?, ?, ?, ?, ?)');
  item.run(1, 0, 'song', 1, null, null);
  item.run(2, 1, 'verse', null, 'Ps 1', null);
  item.run(3, 2, 'announcement', null, null, 'Agapă');
  item.run(4, 3, 'sermon', null, null, 'Predica');
  const signer = { url: (a, id, now, v) => `/m/${id}/${v}` };
  const store = B.createBackgroundStore(mem, signer);
  const at = () => store.forEvent(1, 1).items;

  // 5) nothing set: none
  assert.deepStrictEqual(at(), { 1: null, 2: null, 3: null, 4: null });
  // 4) church defaults per item type (a sermon title uses the announcements' default)
  store.setDefaults(1, { song: 10, verse: 14, announcement: 11 });
  assert.deepStrictEqual(store.defaults(1), { song: 10, verse: 14, announcement: 11 });
  assert.deepStrictEqual(at(), { 1: 10, 2: 14, 3: 11, 4: 11 });
  // 3) the song's default beats the church's
  store.setSongBackground(1, 1, 11);
  assert.strictEqual(store.songBackground(1, 1), 11);
  assert.strictEqual(at()[1], 11);
  // 2) the item beats the song
  mem.prepare('UPDATE setlist_items SET background_media_id = 12 WHERE id = 1').run();
  const ev = store.forEvent(1, 1);
  assert.strictEqual(ev.items[1], 12);
  assert.deepStrictEqual(ev.inherited[1], { id: 11, level: 'song' }, 'what "Implicit" would be');
  assert.deepStrictEqual(ev.media[12], { id: 12, kind: 'loop', url: '/m/12/original', dim: 45, blur: 0, shadow: true });
  assert.strictEqual(ev.media[10].url, '/m/10/display', 'images use the display variant');
  // "none" on the item stops the lookup (no song / church fallback) ...
  mem.prepare('UPDATE setlist_items SET background_none = 1 WHERE id = 1').run();
  assert.strictEqual(at()[1], null);
  mem.prepare('UPDATE setlist_items SET background_none = 0, background_media_id = NULL WHERE id = 1').run();
  // ... and so does "none" on the song
  store.setSongBackground(1, 1, 'none');
  assert.strictEqual(store.songBackground(1, 1), 'none');
  assert.strictEqual(at()[1], null);
  store.setSongBackground(1, 1, null);
  assert.strictEqual(at()[1], 10, 'back to the church default');

  // deleted media falls through to the next level without an error
  store.setSongBackground(1, 1, 11);
  mem.prepare('UPDATE setlist_items SET background_media_id = 12 WHERE id = 1').run();
  mem.prepare('DELETE FROM media WHERE id = 12').run();
  assert.strictEqual(at()[1], 11, 'item media deleted -> song');
  mem.prepare('DELETE FROM media WHERE id = 11').run();
  assert.deepStrictEqual(at(), { 1: 10, 2: 14, 3: null, 4: null }, 'song media and a church default deleted -> church / none');
  // another admin's media or a video is never a background
  mem.prepare('UPDATE setlist_items SET background_media_id = 20 WHERE id = 2').run();
  assert.strictEqual(at()[2], 14);
  mem.prepare('UPDATE setlist_items SET background_media_id = 15 WHERE id = 2').run();
  assert.strictEqual(at()[2], 14);
  assert.strictEqual(store.find(1, 20), null);

  // 1) the live override beats everything, 'none' shows black; readability rides along
  store.setReadability(1, 13, { dim: 70, blur: 8, shadow: false });
  const items = [{ id: 1, type: 'song', songId: 1 }, { id: 2, type: 'verse', reference: 'Ps 1', body: 'Ferice' }];
  const song = { sections: [{ id: 5, type: 'verse', content: 'Sfânt' }], arrangement: [{ sectionId: 5 }] };
  const frame = (override, source = 'content', itemId = 1) => projectorFrame({ version: 1, eventId: 1, status: 'live', backgroundOverride: override,
    worship: { itemId, step: 0 }, projector: { follows: 'worship', itemId: null, step: 0, source }, video: { state: 'none' } },
  { items }, new Map([[1, song]]), { backgrounds: store.forEvent(1, 1, override) });
  assert.strictEqual(frame(null).background.url, '/m/10/display');
  assert.deepStrictEqual(frame(13).background, { id: 13, kind: 'image', url: '/m/13/display', dim: 70, blur: 8, shadow: false });
  // the next item's background rides along for preloading, only when another one
  assert.strictEqual(frame(null).nextBackground.url, '/m/14/display');
  assert.strictEqual(frame(13).nextBackground, undefined, 'the override covers the next item too');
  assert.strictEqual(frame(null, 'content', 2).nextBackground, undefined, 'the last item');
  assert.strictEqual(frame(13, 'content', 2).background.url, '/m/13/display', 'the override applies to every item');
  assert.strictEqual(frame('none').background, null);
  assert.strictEqual(frame(99).background.url, '/m/10/display', 'a deleted override falls back');
  // black and logo never show a background; the video source replaces it
  assert.strictEqual(frame(13, 'black').background, null);
  assert.strictEqual(frame(13, 'logo').background, null);
  assert.strictEqual(frame(13, 'video').background, null);

  // request parsing
  assert.deepStrictEqual([B.parseChoice(undefined), B.parseChoice(null), B.parseChoice('none'), B.parseChoice(12), B.parseChoice('x')],
    [{ value: undefined }, { value: null }, { value: 'none' }, { value: 12 }, { error: true }]);
  assert.deepStrictEqual(B.parseReadability({ dim: 80, blur: 0, shadow: true }), { value: { dim: 80, blur: 0, shadow: true } });
  assert.deepStrictEqual(B.parseReadability({ dim: 81 }), { error: 'dim' });
  assert.deepStrictEqual(B.parseReadability({ blur: -1 }), { error: 'blur' });
  assert.deepStrictEqual(B.parseReadability({ shadow: 'da' }), { error: 'shadow' });
  assert.throws(() => mem.prepare('UPDATE media SET bg_dim = 90 WHERE id = 10').run(), /CHECK/);
  mem.close();
});

test('arrange sheet: insert after the chosen row, move, remove, reset, key, flow with repeats', () => {
  const A = require('../public/arrange-sheet.js');
  const song = {
    song_key: 'G',
    sections: [
      { type: 'verse', content: '[G]Ne ridici din [D]noaptea grea\n[Em]Tu ești lumina mea' },
      { type: 'chorus', content: '\n[C]Sfânt, [G/B]sfânt, [D]sfânt' },
      { type: 'verse', content: '[G]A doua strofă' },
      { type: 'bridge', content: '[Em]Punte' },
    ],
  };
  const def = ['V1', 'C', 'V2', 'C', 'B', 'C'];
  // + Adaugă: after the chosen row (V2 = index 2), at the start (-1) or at the end
  assert.deepStrictEqual(A.insert(def, 'C', 2), ['V1', 'C', 'V2', 'C', 'C', 'B', 'C']);
  assert.deepStrictEqual(A.insert(def, 'B', -1), ['B', ...def]);
  assert.deepStrictEqual(A.insert(def, 'V1', null), [...def, 'V1']);
  assert.deepStrictEqual(A.insert([], 'C', null), ['C']);
  // "+ Adaugă" in the sheet appends; building an order from nothing
  assert.deepStrictEqual(['V1', 'C', 'V2', 'B'].reduce((codes, code) => A.insert(codes, code), []), ['V1', 'C', 'V2', 'B']);
  // reset: back to the default (a copy, equal to it)
  const edited = A.remove(A.move(A.insert(def, 'C', 2), 5, -1), 1);
  assert.strictEqual(A.sameCodes(edited, def), false);
  assert.strictEqual(A.sameCodes(def.slice(), def), true);
  // ↑ / ↓ / ✕; out of range changes nothing; the input is never modified
  assert.deepStrictEqual(A.move(def, 4, -1), ['V1', 'C', 'V2', 'B', 'C', 'C']);
  assert.deepStrictEqual(A.move(def, 0, -1), def);
  assert.deepStrictEqual(A.move(def, 5, 1), def);
  assert.deepStrictEqual(A.remove(def, 3), ['V1', 'C', 'V2', 'B', 'C']);
  assert.deepStrictEqual(def, ['V1', 'C', 'V2', 'C', 'B', 'C']);
  assert.strictEqual(A.sameCodes(def, def.slice()), true);
  assert.strictEqual(A.sameCodes(def, A.remove(def, 0)), false);
  // key −/+ stays within ±11 semitones; the offset reads "+2" / "-1" / "0"
  assert.deepStrictEqual([A.clampTranspose(14), A.clampTranspose(-12), A.clampTranspose('3'), A.clampTranspose('x')], [11, -11, 3, 0]);
  assert.deepStrictEqual([A.offsetText(2), A.offsetText(-1), A.offsetText(0)], ['+2', '-1', '0']);
  // "Cum va curge": arrangement order with repeats; unknown codes left out
  assert.deepStrictEqual(A.flow(song.sections, ['V1', 'C', 'X9', 'C', 'B']).map((x) => `${x.code}:${x.index}`), ['V1:0', 'C:1', 'C:1', 'B:3']);
  // the first lyric line of a row, chords stripped (empty lines skipped)
  assert.deepStrictEqual(song.sections.map((sec) => A.firstLine(sec.content)), ['Ne ridici din noaptea grea', 'Sfânt, sfânt, sfânt', 'A doua strofă', 'Punte']);
  // one helper everywhere: the step buttons (server), the sheet and the editor summary
  assert.strictEqual(A.firstLine('[G]  Doi   spații\n'), require('../lib/sections').firstLyricLine('[G]  Doi   spații\n'));
  assert.strictEqual(require('../lib/sections').firstLyricLine('\n[C]Sfânt, [G/B]sfânt'), 'Sfânt, sfânt');
  // a section-name label left in the lyrics is not the first line ("Urmează: Refren. Refren:")
  const S = require('../lib/sections');
  assert.strictEqual(S.firstLyricLine('Refren:\n[F]Aleluia, [C]aleluia'), 'Aleluia, aleluia');
  assert.strictEqual(S.firstLyricLine('Refren: [F]Aleluia'), 'Aleluia');
  assert.strictEqual(S.firstLyricLine('/: Refren :/\nAleluia'), 'Aleluia');
  assert.strictEqual(S.firstLyricLine('Chorus /:\nHallelujah'), 'Hallelujah');
  assert.strictEqual(S.firstLyricLine('Strofa 2\nA doua strofă'), 'A doua strofă');
  assert.strictEqual(S.firstLyricLine('Pre-refren:\nVino'), 'Vino');
  assert.strictEqual(S.firstLyricLine('Intro duce lumina\nMai departe'), 'Intro duce lumina', 'a name followed by words is lyrics');
  assert.strictEqual(S.firstLyricLine('Punte'), 'Punte', 'a section that is only the label keeps it');
  // stripLeadingLabel: only a label-only first line that names the section type
  assert.strictEqual(S.stripLeadingLabel('Refren:\n[F]Aleluia', 'chorus'), '[F]Aleluia');
  assert.strictEqual(S.stripLeadingLabel('Refren:\n[F]Aleluia', 'verse'), 'Refren:\n[F]Aleluia', 'another type: kept');
  assert.strictEqual(S.stripLeadingLabel('Refren: [F]Aleluia', 'chorus'), 'Refren: [F]Aleluia', 'label with lyrics on the line: kept');
  assert.strictEqual(S.stripLeadingLabel('Punte', 'bridge'), 'Punte', 'the whole section: kept');
  assert.strictEqual(S.stripLeadingLabel('Verse 1\n\nText', 'verse'), 'Text');
  // transposed sections: +2 moves G to A, the lyrics stay
  const up = A.transposed(song, 2);
  assert.strictEqual(up[0].content, '[A]Ne ridici din [E]noaptea grea\n[F#m]Tu ești lumina mea');
  assert.strictEqual(song.sections[0].content.startsWith('[G]'), true, 'the song itself is untouched');
});

test('backup reminder: never or older than 30 days, hidden for 30 days after "Nu acum"', () => {
  const Database = require('better-sqlite3');
  const { runMigrations } = require('../lib/db');
  const { createBackupLog, REMIND_AFTER_MS } = require('../lib/backup');
  const mem = new Database(':memory:');
  runMigrations(mem);
  mem.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'A', 0), (2, 'B', 0)").run();
  const log = createBackupLog(mem);
  const day = 24 * 60 * 60 * 1000;
  const t0 = Date.UTC(2026, 0, 1);
  assert.deepStrictEqual(log.reminder(1, t0), { lastAt: null }, 'never backed up');
  log.recordDownload(1, 1234, t0);
  assert.deepStrictEqual(log.lastBackup(1), { lastAt: t0, lastBytes: 1234 });
  assert.strictEqual(log.reminder(1, t0 + 29 * day), null);
  assert.deepStrictEqual(log.reminder(1, t0 + 31 * day), { lastAt: t0 });
  log.dismissReminder(1, t0 + 31 * day);
  assert.strictEqual(log.reminder(1, t0 + 40 * day), null, 'dismissed');
  assert.deepStrictEqual(log.reminder(1, t0 + 31 * day + REMIND_AFTER_MS + 1), { lastAt: t0 }, 'back 30 days later');
  assert.deepStrictEqual(log.reminder(2, t0), { lastAt: null }, 'per admin');
  mem.close();
});

test('storage guard: room keeps DISK_MIN_FREE_PCT free; usage of DATA_DIR; warning over 70 %', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { createStorageGuard } = require('../lib/storage');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-storage-'));
  fs.mkdirSync(path.join(dir, 'uploads', 'admin-1', 'media'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'worship.db'), Buffer.alloc(3000));
  fs.writeFileSync(path.join(dir, 'uploads', 'admin-1', 'media', 'a.webm'), Buffer.alloc(5000));
  const disk = { bsize: 1000, blocks: 100, bavail: 40 }; // 100 kB, 40 kB free
  const warnings = [];
  const guard = createStorageGuard({ dataDir: dir, minFreePct: 15, statfs: () => disk, logger: { warn: (m) => warnings.push(m) } });
  const u = guard.refresh();
  assert.deepStrictEqual([u.dbBytes, u.uploadsBytes, u.dataBytes, u.diskBytes, u.freeBytes, u.minFreePct], [3000, 5000, 8000, 100000, 40000, 15]);
  assert.strictEqual(guard.room(), 25000, '40 kB free - 15 kB kept');
  disk.bavail = 10;
  assert.strictEqual(guard.room(), 0, 'never negative');
  assert.strictEqual(warnings.length, 0);
  fs.writeFileSync(path.join(dir, 'uploads', 'admin-1', 'media', 'b.webm'), Buffer.alloc(70000));
  guard.refresh();
  assert.strictEqual(warnings.length, 1, 'db + uploads over 70 % of the disk');
  assert.match(warnings[0], /over 70 %/);
  guard.refresh();
  assert.strictEqual(warnings.length, 1, 'warned once until it drops again');
  const off = createStorageGuard({ dataDir: dir, minFreePct: 0, statfs: () => disk });
  assert.strictEqual(off.room(), 10000);
  fs.rmSync(dir, { recursive: true, force: true });
});

testAsync('media-fetch: https only, no private addresses, redirects checked, byte cap, temp file', async () => {
  const MF = require('../lib/media-fetch');
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  assert.strictEqual(MF.parseMediaUrl('https://cdn.example.org/a.jpg').hostname, 'cdn.example.org');
  for (const bad of ['http://cdn.example.org/a.jpg', 'https://user:pw@cdn.example.org/a.jpg', 'https://cdn.example.org:8443/a.jpg', 'https://localhost/a.jpg', 'https://printer.local/a.jpg', 'ftp://x/a', '']) {
    assert.strictEqual(MF.parseMediaUrl(bad), null, bad);
  }
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '172.31.255.1', '192.168.1.5', '169.254.1.1', '0.0.0.0', '100.64.0.1', '224.0.0.1', '::1', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:192.168.0.1', 'not-an-ip']) {
    assert.strictEqual(MF.isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['203.0.113.10', '8.8.8.8', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8']) assert.strictEqual(MF.isPrivateAddress(ip), false, ip);
  const lookup = async (host) => ({ 'cdn.example.org': [{ address: '203.0.113.10' }], 'private.example.org': [{ address: '192.168.1.5' }], 'mixed.example.org': [{ address: '203.0.113.10' }, { address: '10.0.0.1' }] }[host] || (() => { throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }); })());
  const body = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, 1)]);
  const hops = [];
  const fetchImpl = async (url, opts) => {
    hops.push(url);
    assert.strictEqual(opts.redirect, 'manual');
    const u = new URL(url);
    const res = (status, b, headers = {}) => new Response(b, { status, headers });
    if (u.pathname === '/r1') return res(302, '', { location: '/r2' });
    if (u.pathname === '/r2') return res(301, '', { location: 'https://cdn.example.org/a.jpg' });
    if (u.pathname === '/to-http') return res(302, '', { location: 'http://cdn.example.org/a.jpg' });
    if (u.pathname === '/to-private') return res(302, '', { location: 'https://private.example.org/a.jpg' });
    if (u.pathname === '/declared-big') return res(200, body, { 'content-length': String(100 * 1024 * 1024) });
    if (u.pathname === '/stream-big') return res(200, Buffer.alloc(5000, 2));
    if (u.pathname === '/missing') return res(404, '');
    if (u.pathname === '/broken') return res(500, '');
    if (u.pathname === '/empty') return res(200, '');
    return res(200, body);
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-mf-'));
  const temp = () => path.join(dir, `t-${Math.random().toString(16).slice(2)}`);
  const code = async (url, maxBytes = 4096) => { try { await MF.fetchToTemp(url, { temp: temp(), maxBytes, fetchImpl, lookup }); } catch (err) { return err.code; } return 'ok'; };
  const t1 = temp();
  const got = await MF.fetchToTemp('https://cdn.example.org/r1', { temp: t1, maxBytes: 4096, fetchImpl, lookup });
  assert.deepStrictEqual([got.size, got.finalUrl, fs.statSync(t1).size, got.head.subarray(0, 3)], [body.length, 'https://cdn.example.org/a.jpg', body.length, Buffer.from([0xff, 0xd8, 0xff])], 'two redirects followed, the body on disk, the head for the magic bytes');
  assert.strictEqual(hops.length, 3);
  assert.strictEqual(await code('http://cdn.example.org/a.jpg'), 'bad_url');
  assert.strictEqual(await code('https://private.example.org/a.jpg'), 'private_address');
  assert.strictEqual(await code('https://mixed.example.org/a.jpg'), 'private_address', 'one private address among the host\'s is enough to refuse');
  assert.strictEqual(await code('https://nowhere.example.org/a.jpg'), 'unreachable');
  assert.strictEqual(await code('https://cdn.example.org/to-http'), 'blocked_host', 'a redirect to http is refused');
  assert.strictEqual(await code('https://cdn.example.org/to-private'), 'private_address', 'a redirect to a private host is refused');
  assert.strictEqual(await code('https://cdn.example.org/declared-big'), 'too_large');
  assert.strictEqual(await code('https://cdn.example.org/stream-big'), 'too_large', 'stopped while streaming');
  assert.strictEqual(await code('https://cdn.example.org/missing'), 'not_found');
  assert.strictEqual(await code('https://cdn.example.org/broken'), 'upstream_error');
  assert.strictEqual(await code('https://cdn.example.org/empty'), 'upstream_error');
  assert.strictEqual(fs.readdirSync(dir).length, 1, 'only the successful download left a file');
  // a server that never answers: fetch rejects when the timeout signal fires
  const slow = (url, opts) => new Promise((resolve, reject) => opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))));
  // (AbortSignal.timeout's timer is unref'd: a real fetch keeps a socket open, here a timer keeps the loop alive)
  const keepAlive = setTimeout(() => {}, 1000);
  assert.strictEqual(await (async () => { try { await MF.fetchToTemp('https://cdn.example.org/a.jpg', { temp: temp(), maxBytes: 4096, fetchImpl: slow, lookup, timeoutMs: 50 }); } catch (err) { return err.code; } return 'ok'; })(), 'timeout');
  clearTimeout(keepAlive);
  fs.rmSync(dir, { recursive: true, force: true });
});

testAsync('pexels: disabled without a key; items, the HD file, the 10 minute cache, 60 searches an hour', async () => {
  const P = require('../lib/pexels');
  const off = P.createPexels({ config: {}, logger: null });
  assert.deepStrictEqual([off.enabled, off.status()], [false, { enabled: false }]);
  assert.strictEqual(await off.search(1, { query: 'sky', kind: 'photos' }).then(() => 'ok', (e) => e.code), 'disabled');
  const files = [{ quality: 'uhd', file_type: 'video/mp4', width: 3840, link: 'u' }, { quality: 'hd', file_type: 'video/mp4', width: 1920, link: 'h' }, { quality: 'sd', file_type: 'video/mp4', width: 960, link: 's' }, { quality: 'hd', file_type: 'video/webm', width: 1280, link: 'w' }];
  assert.strictEqual(P.pickVideoFile(files).link, 'h', 'the largest MP4 at most 1920 wide');
  assert.strictEqual(P.pickVideoFile(files.slice(0, 1)), null, 'a 4K-only video is left out');
  const photo = P.photoItem({ id: 1, width: 4, height: 3, url: 'p', photographer: 'A', photographer_url: 'pa', alt: 'Sky', src: { large2x: 'L2', large: 'L', medium: 'M' } });
  assert.deepStrictEqual([photo.id, photo.kind, photo.download, photo.thumb, photo.photographer], ['1', 'photos', 'L2', 'M', 'A']);
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(url);
    assert.strictEqual(opts.headers.Authorization, 'k');
    const u = new URL(url);
    if (u.pathname === '/v1/search') return new Response(JSON.stringify({ photos: [{ id: 7, src: { large: 'L' }, photographer: 'B' }] }), { status: 200 });
    if (u.pathname === '/videos/search') return new Response(JSON.stringify({ videos: [{ id: 9, duration: 3, image: 'i', user: { name: 'C' }, video_files: files }, { id: 10, image: 'i', video_files: files.slice(0, 1) }] }), { status: 200 });
    if (u.pathname === '/v1/photos/8') return new Response(JSON.stringify({ id: 8, src: { large: 'L8' } }), { status: 200 });
    return new Response('', { status: 404 });
  };
  const px = P.createPexels({ config: { PEXELS_API_KEY: 'k', PEXELS_API_URL: 'https://api.test/' }, logger: null, fetch: fetchImpl });
  assert.strictEqual(px.enabled, true);
  const first = await px.search(1, { query: '  Sky  ', kind: 'photos' });
  assert.deepStrictEqual([first.cached, first.items.length, first.items[0].photographer], [false, 1, 'B']);
  assert.ok(/query=Sky&per_page=24&orientation=landscape/.test(calls[0]), calls[0]);
  const again = await px.search(1, { query: 'sky', kind: 'photos' });
  assert.deepStrictEqual([again.cached, calls.length], [true, 1], 'the same query (case, spaces aside) is served from the cache');
  const videos = await px.search(1, { query: 'sky', kind: 'videos' });
  assert.deepStrictEqual([videos.items.length, videos.items[0].download, videos.items[0].duration], [1, 'h', 3], 'videos without a fitting file are left out');
  assert.strictEqual((await px.item(1, { id: 7, kind: 'photos' })).download, 'L', 'an item seen in a search needs no lookup');
  assert.strictEqual((await px.item(1, { id: 8, kind: 'photos' })).download, 'L8', 'else one lookup by id');
  assert.strictEqual(await px.item(1, { id: 99, kind: 'photos' }).then(() => 'ok', (e) => e.code), 'not_found');
  assert.strictEqual(await px.search(1, { query: 'a', kind: 'photos' }).then(() => 'ok', (e) => e.code), 'bad_query');
  for (let i = 0; i < 58; i++) await px.search(1, { query: `q${i}`, kind: 'photos' });
  assert.strictEqual(await px.search(1, { query: 'one more', kind: 'photos' }).then(() => 'ok', (e) => e.code), 'rate_limited', 'the 61st search of the hour (church 1)');
  assert.strictEqual(await px.search(2, { query: 'other church', kind: 'photos' }).then(() => 'ok', (e) => e.code), 'ok', 'another church is not limited');
  assert.strictEqual((await px.search(1, { query: 'sky', kind: 'photos' })).cached, true, 'cached queries still answer');
});

test('lyrics-fit: no wrap first, then balanced rows with no tail under 3 words, the song\'s own breaks kept', () => {
  const F = require('../lib/lyrics-fit');
  assert.deepStrictEqual(F.splitBalanced('a b c d e f g', 2), ['a b c d', 'e f g']);
  assert.deepStrictEqual(F.splitBalanced('a b c d e f g h i j k', 3), ['a b c d', 'e f g h', 'i j k']);
  assert.strictEqual(F.splitBalanced('a b c d e', 2), null, 'five words: a row would have 2');
  assert.deepStrictEqual(F.splitBalanced('a b c d e', 2, 2), ['a b c', 'd e'], 'the last-resort rule');
  assert.deepStrictEqual([F.maxChunks(5), F.maxChunks(6), F.maxChunks(14)], [1, 2, 4]);
  // a stand-in for text widths: 0.5 em per character (the long Romanian line below is ~90 chars)
  const measure = (text, size) => text.length * size * 0.5;
  const rowHeight = (size) => size * 1.22;
  const long = 'Și dacă toate cerurile s-ar deschide deodată peste noi cu slava Ta cea mare și nesfârșită';
  const base = { measure, rowHeight, minSize: 27, maxSize: 130, maxW: 1728, maxH: 972 }; // 1920x1080, 5 % margins
  // (a) short lines: the largest size with no wrapping, every line kept as it is
  const short = F.layout({ ...base, lines: ['Ne ridici din noaptea grea', 'Tu ești lumina mea'] });
  assert.deepStrictEqual([short.wrapped, short.rows, short.size], [false, [['Ne ridici din noaptea grea'], ['Tu ești lumina mea']], 130]);
  // (a) a long line that only fits unwrapped at a size above 60 % of the maximum: no wrapping
  const okNoWrap = F.layout({ ...base, lines: ['O linie de patruzeci de litere aici!'] });
  assert.deepStrictEqual([okNoWrap.wrapped, okNoWrap.rows.length, Math.round(okNoWrap.size)], [false, 1, 96], '1728 / (36 * 0.5) = 96 px >= 78');
  // (b) the ~90-character line would need 38 px unwrapped (< 78): balanced rows, no short tail
  const wrapped = F.layout({ ...base, lines: [long, 'Amin'] });
  assert.strictEqual(wrapped.wrapped, true);
  assert.deepStrictEqual(wrapped.rows[1], ['Amin'], 'the second stored line stays its own line');
  const rows = wrapped.rows[0];
  assert.ok(rows.length >= 2 && rows.every((r) => r.split(' ').length >= 3), `balanced rows of >= 3 words: ${JSON.stringify(rows)}`);
  assert.strictEqual(rows.join(' '), long, 'every word, in order, nothing joined with the next line');
  assert.ok(rows.every((r) => measure(r, wrapped.size) <= 1728) && (rows.length + 1) * rowHeight(wrapped.size) <= 972, 'the rows fit the box');
  assert.ok(wrapped.size > 38, `larger than the unwrapped size (${wrapped.size.toFixed(1)} px)`);
  // (b) a row that would end with 2 words is not allowed: 7 words -> 4 + 3, never 5 + 2
  const seven = F.layout({ ...base, maxW: 300, lines: ['unu doi trei patru cinci șase șapte'] });
  assert.ok(seven.rows[0].every((r) => r.split(' ').length >= 3), JSON.stringify(seven.rows[0]));
  // (c) the height limit shrinks the size instead of dropping rows; 4:3 and 720p boxes
  for (const [w, h] of [[1280, 720], [1024, 768]]) {
    const box = { ...base, maxW: w * 0.9, maxH: h * 0.9, minSize: h * 0.025, maxSize: h * 0.12 };
    const out = F.layout({ ...box, lines: [long, long, long] });
    const total = out.rows.reduce((n, r) => n + r.length, 0);
    assert.ok(total * rowHeight(out.size) <= h * 0.9 + 0.01 && out.rows.flat().every((r) => measure(r, out.size) <= w * 0.9), `${w}x${h}: fits`);
    assert.ok(out.rows.every((line) => line.length === 1 || line.every((r) => r.split(' ').length >= 3)), `${w}x${h}: no short tails`);
  }
  // a five-word line too wide even at the minimum: the last resort keeps whole words (2 per row)
  const tiny = F.layout({ ...base, maxW: 200, minSize: 20, maxSize: 130, lines: ['aaaaaaaaaaaa bbbbbbbbbbbb cccccccccccc dddddddddddd eeeeeeeeeeee'] });
  assert.ok(tiny.rows[0].length >= 2 && tiny.rows[0].join(' ').split(' ').length === 5, JSON.stringify(tiny.rows[0]));
  // the frame carries the config minimum (LYRICS_FIT_MIN_PCT), validated
  const { projectorFrame } = require('../lib/projector');
  assert.strictEqual(projectorFrame(null, null, null, { fitMin: 75 }).fitMin, 75);
  assert.strictEqual(projectorFrame(null, null, null, { fitMin: 5 }).fitMin, 60, 'out of range: the default');
});

test('media: image magic bytes; file names and kinds', () => {
  const M = require('../lib/media');
  assert.strictEqual(M.sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/jpeg');
  assert.strictEqual(M.sniffImage(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)])), 'image/png');
  assert.strictEqual(M.sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])), 'image/webp');
  assert.strictEqual(M.sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">')), null, 'never SVG');
  assert.strictEqual(M.sniffImage(Buffer.from('GIF89a......')), null);
  assert.deepStrictEqual([M.VIDEO_KINDS, M.BACKGROUND_KINDS], [['upload', 'url'], ['image', 'loop']]);
});

test('migration 014: projector_follows -> together / split; pending requests -> projector-only items', () => {
  const Database = require('better-sqlite3');
  const fs = require('fs');
  const path = require('path');
  const mem = new Database(':memory:');
  mem.pragma('foreign_keys = ON');
  const dir = path.join(__dirname, '..', 'lib', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files.filter((x) => x < '014')) mem.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
  mem.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'A', 0)").run();
  mem.prepare("INSERT INTO users (id, admin_id, email, name, password_hash, role, created_at) VALUES (1, 1, 'o@x.ro', 'O', 'x', 'operator', 0)").run();
  const ev = mem.prepare("INSERT INTO events (admin_id, name, event_date, status, created_at, updated_at) VALUES (1, ?, '2026-10-04', 'live', 0, 0)");
  const a = Number(ev.run('A').lastInsertRowid);
  const b = Number(ev.run('B').lastInsertRowid);
  const st = mem.prepare('INSERT INTO live_state (event_id, admin_id, version, projector_follows, updated_at) VALUES (?, 1, 1, ?, 0)');
  st.run(a, 'operator');
  st.run(b, 'worship');
  const item = mem.prepare("INSERT INTO setlist_items (event_id, admin_id, position, type, reference, scope, request_status, requested_by, requested_at) VALUES (?, 1, ?, 'verse', ?, ?, ?, ?, ?)");
  item.run(a, 0, 'Ps 1', 'shared', null, null, null);
  item.run(a, 1, 'Pending', 'projector', 'pending', 1, 5);
  item.run(a, 2, 'Accepted', 'shared', 'accepted', 1, 6);
  item.run(a, 3, 'Refused', 'projector', 'refused', 1, 7);
  mem.exec(fs.readFileSync(path.join(dir, files.find((f) => f.startsWith('014'))), 'utf8'));
  const modes = mem.prepare('SELECT lead_mode, team_mode FROM live_state ORDER BY event_id').all();
  assert.deepStrictEqual(modes.map((r) => [r.lead_mode, r.team_mode]), [['split', 'follow'], ['together', 'follow']]);
  const rows = mem.prepare('SELECT reference, scope, request_status, requested_by, requested_at FROM setlist_items ORDER BY position').all();
  assert.deepStrictEqual(rows.map((r) => [r.reference, r.scope, r.request_status, r.requested_by, r.requested_at]), [
    ['Ps 1', 'shared', null, null, null],
    ['Pending', 'projector', null, null, null],
    ['Accepted', 'shared', null, null, null],
    ['Refused', 'projector', null, null, null],
  ]);
  assert.throws(() => mem.prepare("UPDATE live_state SET lead_mode = 'operator'").run(), /CHECK/);
  assert.throws(() => mem.prepare("UPDATE live_state SET team_mode = 'loose'").run(), /CHECK/);
  mem.close();
});

test('events: the editor save keeps projector-only items where they were', () => {
  const { mem, evs, live, eventId, items, save } = liveFixture();
  const [song, v1, v2] = items.map((it) => it.id);
  live.command(1, eventId, { type: 'event.start' }, undefined, 'leader');
  live.command(1, eventId, { type: 'worship.goto', itemId: v1, step: 0 }, undefined, 'leader');
  live.command(1, eventId, { type: 'operator.addItem', target: 'projector', item: { type: 'verse', reference: 'Op 1' } }, undefined, 'operator');
  live.command(1, eventId, { type: 'worship.goto', itemId: v2, step: 0 }, undefined, 'leader');
  live.command(1, eventId, { type: 'operator.addItem', target: 'projector', item: { type: 'verse', reference: 'Op 2' } }, undefined, 'operator');
  const all = () => evs.get(1, eventId, { scope: 'all' }).items.map((it) => it.title || it.reference);
  assert.deepStrictEqual(all(), ['Sfânt', 'Ps 1', 'Op 1', 'Ps 2', 'Op 2']);
  // the editor reorders, edits, removes Ps 1 and adds Ps 3 (it only knows the shared items)
  save([{ id: v2, type: 'verse', reference: 'Ps 2 bis' }, { id: song, type: 'song', songId: 1 }, { type: 'verse', reference: 'Ps 3' }]);
  assert.deepStrictEqual(all(), ['Ps 2 bis', 'Op 2', 'Sfânt', 'Op 1', 'Ps 3'], 'Op 1 follows the item before Ps 1');
  assert.deepStrictEqual(evs.get(1, eventId).items.map((it) => it.title || it.reference), ['Ps 2 bis', 'Sfânt', 'Ps 3']);
  // history and "last sung": a song that was only on the projector in another event does not count
  const other = evs.create(1, 1, { name: 'E2', eventDate: '2026-09-01', startTime: null, notes: null });
  evs.setStatus(1, other, 'finished');
  mem.prepare("INSERT INTO setlist_items (event_id, admin_id, position, type, song_id, scope) VALUES (?, 1, 0, 'song', 1, 'projector')").run(other);
  assert.deepStrictEqual(evs.songHistory(1, 1).map((h) => h.eventId), [eventId]);
  assert.strictEqual(evs.lastSungMap(1, '2026-09-30').get(1), undefined, 'only the projector copy on 1 Sep');
  mem.close();
});

test('theme: browser colours match the CSS tokens; migration 015', () => {
  const fs = require('fs');
  const path = require('path');
  const theme = require('../lib/theme');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  const token = (selector) => {
    const start = css.indexOf(`${selector} {`);
    return /--background:\s*(#[0-9a-f]+)/i.exec(css.slice(start, css.indexOf('\n}', start)))[1].toLowerCase();
  };
  assert.strictEqual(theme.BROWSER_COLORS.dark, token(':root'));
  assert.strictEqual(theme.BROWSER_COLORS.light, token(':root[data-theme="light"]'));
  assert.deepStrictEqual(['dark', 'light', 'auto'].map(theme.browserColor), [token(':root'), token(':root[data-theme="light"]'), token(':root')]);
  assert.deepStrictEqual(['dark', 'light', 'auto'].map(theme.statusBarStyle), ['black-translucent', 'default', 'default']);
  assert.ok(theme.isTheme('auto') && !theme.isTheme('blue') && !theme.isTheme(null));
  const Database = require('better-sqlite3');
  const { runMigrations } = require('../lib/db');
  const mem = new Database(':memory:');
  runMigrations(mem);
  mem.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'A', 0)").run();
  const add = mem.prepare("INSERT INTO users (admin_id, email, name, password_hash, role, created_at, theme) VALUES (1, ?, 'U', 'x', 'member', 0, ?)");
  for (const [i, value] of [null, 'dark', 'light', 'auto'].entries()) add.run(`u${i}@x.ro`, value);
  assert.throws(() => add.run('bad@x.ro', 'blue'), /CHECK/);
  const settings = require('../lib/admin-settings').createAdminSettings(mem);
  assert.strictEqual(settings.themeDefault(1), 'dark', 'default dark');
  settings.set(1, 'theme_default', 'light');
  assert.strictEqual(settings.themeDefault(1), 'light');
  settings.set(1, 'theme_default', 'purple');
  assert.strictEqual(settings.themeDefault(1), 'dark', 'an invalid stored value falls back');
  mem.close();
});

test('team: temporary passwords, validation', () => {
  const T = require('../lib/team');
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const pw = T.temporaryPassword();
    assert.strictEqual(pw.length, 12);
    assert.ok(!/[0O1lI]/.test(pw), `readable: ${pw}`);
    assert.ok([...pw].every((c) => T.TEMP_ALPHABET.includes(c)));
    seen.add(pw);
  }
  assert.strictEqual(seen.size, 200, 'random');
  const tro = (k, v) => t(k, v, 'ro');
  assert.deepStrictEqual(T.validateEmail('  Ana@X.RO ', tro), { value: 'ana@x.ro' });
  assert.ok(T.validateEmail('ana@x', tro).error);
  assert.ok(T.validateName('   ', tro).error);
  assert.ok(T.validateName('x'.repeat(101), tro).error);
  assert.deepStrictEqual(T.validateRole('operator', tro), { value: 'operator' });
  assert.ok(T.validateRole('owner', tro).error, 'never a second owner');
  assert.ok(T.validateRole('admin', tro).error);
});

test('platform owner: the first admin (migration 018), its owner only, PLATFORM_ADMIN_ID wins', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const Database = require('better-sqlite3');
  const { runMigrations } = require('../lib/db');
  const { createAuth } = require('../lib/auth');
  const all = path.join(__dirname, '..', 'lib', 'migrations');
  const before = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-mig-'));
  for (const f of fs.readdirSync(all).filter((f) => f < '018')) fs.copyFileSync(path.join(all, f), path.join(before, f));
  const db = new Database(':memory:');
  runMigrations(db, before);
  // An existing server: two churches before the migration.
  db.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'Prima', 0), (2, 'A doua', 0)").run();
  runMigrations(db, all);
  assert.deepStrictEqual(db.prepare('SELECT id, platform_owner FROM admins ORDER BY id').raw().all(), [[1, 1], [2, 0]]);
  const owner = { role: 'owner' };
  const leader = { role: 'leader' };
  const auth = createAuth({ db, config: { PLATFORM_ADMIN_ID: null } });
  assert.strictEqual(auth.platformAdminId(), 1);
  assert.strictEqual(auth.isPlatformOwner(owner, { id: 1 }), true);
  assert.strictEqual(auth.isPlatformOwner(leader, { id: 1 }), false, 'a leader of the platform admin is not the platform owner');
  assert.strictEqual(auth.isPlatformOwner(owner, { id: 2 }), false, 'another church\'s owner is not');
  const pinned = createAuth({ db, config: { PLATFORM_ADMIN_ID: 2 } });
  assert.strictEqual(pinned.isPlatformOwner(owner, { id: 2 }), true);
  assert.strictEqual(pinned.isPlatformOwner(owner, { id: 1 }), false, 'the override replaces the database flag');
  const res = { code: 0, status(c) { this.code = c; return this; }, json() { return this; } };
  let passedOn = false;
  auth.requirePlatformOwner({ user: owner, admin: { id: 2 }, t: (k) => k }, res, () => { passedOn = true; });
  assert.deepStrictEqual([res.code, passedOn], [403, false]);
  auth.requirePlatformOwner({ user: owner, admin: { id: 1 }, t: (k) => k }, res, () => { passedOn = true; });
  assert.strictEqual(passedOn, true);
  db.close();
  fs.rmSync(before, { recursive: true, force: true });
});

test('events: upcoming / past split by status and date; the home never picks a finished event', () => {
  const Database = require('better-sqlite3');
  const { runMigrations } = require('../lib/db');
  const { createEventStore } = require('../lib/events');
  const { createHome } = require('../lib/home');
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  db.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'A', 0)").run();
  const add = db.prepare('INSERT INTO events (id, admin_id, name, event_date, start_time, status, is_template, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?, ?, 0, 0)');
  const today = '2026-09-26';
  add.run(1, 'finished today', today, '16:00', 'finished', 0);
  add.run(2, 'planned today', today, '18:00', 'planned', 0);
  add.run(3, 'live yesterday', '2026-09-25', '10:00', 'live', 0);
  add.run(4, 'planned yesterday', '2026-09-25', '10:00', 'planned', 0);
  add.run(5, 'planned next week', '2026-10-03', '10:00', 'planned', 0);
  add.run(6, 'finished last week', '2026-09-19', '10:00', 'finished', 0);
  add.run(7, 'template', '2026-09-20', null, 'planned', 1);
  db.prepare('INSERT INTO live_state (event_id, admin_id, version, started_at, updated_at) VALUES (3, 1, 2, ?, 0)').run(Date.UTC(2026, 8, 25, 8, 0));
  const evs = createEventStore(db);
  const names = (when) => evs.list(1, { when, today, teamOnly: false }).map((e) => e.name);
  assert.deepStrictEqual(names('upcoming'), ['live yesterday', 'planned today', 'planned next week'], 'upcoming: live first (forgotten yesterday), then ascending; never finished, never a template');
  assert.deepStrictEqual(names('past'), ['finished today', 'planned yesterday', 'finished last week'], 'past: finished (even today) and planned with the date passed, descending');
  assert.deepStrictEqual(names('templates'), ['template'], 'templates untouched');
  assert.deepStrictEqual(evs.list(1, { when: 'templates', today, teamOnly: true }), [], 'the team never sees templates');
  // the home: the live one with its start, the next planned one (never a finished one)
  const h = createHome(db).home(1, 'leader', today);
  assert.deepStrictEqual([h.live.name, h.live.startedAt, h.next.name, h.upcoming.map((e) => e.name)], ['live yesterday', Date.UTC(2026, 8, 25, 8, 0), 'planned today', ['planned next week']]);
  db.prepare("UPDATE events SET status = 'finished' WHERE id = 3").run();
  db.prepare("UPDATE events SET status = 'finished' WHERE id = 2").run();
  const h2 = createHome(db).home(1, 'member', today);
  assert.deepStrictEqual([h2.live, h2.next.name], [null, 'planned next week'], 'a finished event today is never "next"');
  assert.deepStrictEqual(names('past').slice(0, 4), ['planned today', 'finished today', 'planned yesterday', 'live yesterday'], 'descending; same date and time: newest id first');
  db.close();
});

test('events: draft and published migrate to planned (020); "Cântată ultima dată" rule', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const Database = require('better-sqlite3');
  const { runMigrations } = require('../lib/db');
  const { createEventStore } = require('../lib/events');
  const all = path.join(__dirname, '..', 'lib', 'migrations');
  const before = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-mig-'));
  for (const f of fs.readdirSync(all).filter((f) => f < '020')) fs.copyFileSync(path.join(all, f), path.join(before, f));
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, before);
  db.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'A', 0)").run();
  const add = db.prepare('INSERT INTO events (id, admin_id, name, event_date, status, is_template, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?, 0, 0)');
  add.run(1, 'ciornă', '2026-01-04', 'draft', 0);
  add.run(2, 'publicat', '2026-01-11', 'published', 0);
  add.run(3, 'încheiat', '2026-01-18', 'finished', 0);
  add.run(4, 'șablon', '2026-01-04', 'draft', 1);
  db.prepare("INSERT INTO songs (id, admin_id, title, title_norm, created_at, updated_at) VALUES (1, 1, 'S', 's', 0, 0), (2, 1, 'T', 't', 0, 0)").run();
  db.prepare("INSERT INTO setlist_items (event_id, admin_id, position, type, song_id) VALUES (1, 1, 0, 'song', 1), (4, 1, 0, 'song', 2)").run();
  runMigrations(db, all);
  assert.deepStrictEqual(db.prepare('SELECT id, status, is_template FROM events ORDER BY id').raw().all(),
    [[1, 'planned', 0], [2, 'planned', 0], [3, 'finished', 0], [4, 'planned', 1]]);
  assert.strictEqual(db.prepare('SELECT COUNT(*) FROM setlist_items').pluck().get(), 2, 'items kept');
  assert.deepStrictEqual(db.pragma('foreign_key_check'), []);
  const evs = createEventStore(db);
  // planned with its date passed counts; a template never; a future planned one does not
  assert.deepStrictEqual([...evs.lastSungMap(1, '2026-02-01').entries()], [[1, '2026-01-04']]);
  assert.deepStrictEqual([...evs.lastSungMap(1, '2026-01-04').entries()], [], 'not on the day itself until it goes live');
  assert.strictEqual(evs.get(1, 1, { teamOnly: true }).event.status, 'planned', 'the team sees it');
  assert.strictEqual(evs.get(1, 4, { teamOnly: true }), null, 'never a template');
  db.close();
  fs.rmSync(before, { recursive: true, force: true });
});

test('nextServiceDate: the next usual service day; today only until 2 h after it starts', () => {
  const { nextServiceDate, nowTimeIn } = require('../lib/dates');
  // 2026-09-27 is a Sunday
  assert.strictEqual(nextServiceDate('2026-09-27', '09:00', 0, '10:00'), '2026-09-27');
  assert.strictEqual(nextServiceDate('2026-09-27', '11:59', 0, '10:00'), '2026-09-27');
  assert.strictEqual(nextServiceDate('2026-09-27', '12:00', 0, '10:00'), '2026-10-04');
  assert.strictEqual(nextServiceDate('2026-09-28', '08:00', 0, '10:00'), '2026-10-04', 'Monday -> next Sunday');
  assert.strictEqual(nextServiceDate('2026-09-26', '23:59', 0, '10:00'), '2026-09-27');
  assert.strictEqual(nextServiceDate('2026-09-27', '09:00', 3, '18:30'), '2026-09-30', 'a Wednesday service');
  assert.strictEqual(nextServiceDate('2026-12-31', '10:00', 0, '10:00'), '2027-01-03', 'across the year');
  // timezone-aware "now": the same instant is a different local time
  const instant = new Date('2026-09-27T10:30:00Z');
  assert.deepStrictEqual([nowTimeIn('UTC', instant), nowTimeIn('Europe/Oslo', instant), nowTimeIn('America/New_York', instant)], ['10:30', '12:30', '06:30']);
});

test('"■ Sfârșit": moves after an ended item; the frame while ended', () => {
  const { movePosition } = require('../public/positions.js');
  const lay = [{ id: 1, steps: 4 }, { id: 2, steps: 1 }, { id: 3, steps: 2 }];
  const ended = (itemId, step) => ({ itemId, step, ended: true });
  assert.deepStrictEqual(movePosition(lay, ended(1, 1), 'next'), { itemId: 2, step: 0 }, 'next: the next item');
  assert.deepStrictEqual(movePosition(lay, ended(1, 1), 'prev'), { itemId: 1, step: 3 }, 'prev: the last step of the ended item');
  assert.deepStrictEqual(movePosition(lay, ended(3, 1), 'next'), { itemId: 3, step: 1 }, 'the last item: stays');
  assert.deepStrictEqual(movePosition(lay, ended(2, 0), 'goto', 1, 2), { itemId: 1, step: 2 });
  assert.deepStrictEqual(movePosition(lay, { itemId: 1, step: 1 }, 'next'), { itemId: 1, step: 2 }, 'not ended: step by step');
  const { projectorFrame } = require('../lib/projector');
  const snap = (worship, projector = {}) => ({
    status: 'live', version: 3, eventId: 9, video: null,
    worship, projector: { follows: 'worship', itemId: null, step: 0, ended: false, source: 'content', ...projector },
  });
  const event = { items: [{ id: 2, type: 'verse', reference: 'Ps 1', body: 'x' }] };
  assert.strictEqual(projectorFrame(snap({ itemId: 2, step: 0, ended: false }), event, new Map()).kind, 'verse');
  assert.strictEqual(projectorFrame(snap({ itemId: 2, step: 0, ended: true }), event, new Map()).kind, 'black');
  const withLogo = projectorFrame(snap({ itemId: 2, step: 0, ended: true }), event, new Map(), { logoUrl: '/api/logo/x.png' });
  assert.strictEqual(withLogo.kind, 'black', 'always black, even with a logo');
  const logoSource = projectorFrame(snap({ itemId: 2, step: 0, ended: true }, { source: 'logo' }), event, new Map(), { logoUrl: '/api/logo/x.png' });
  assert.strictEqual(logoSource.kind, 'logo', 'the explicit Logo source (key L) still shows the logo while ended');
  // split: the projector's own flag counts, not the team's
  const split = { follows: 'operator', itemId: 2, step: 0 };
  assert.strictEqual(projectorFrame(snap({ itemId: 2, step: 0, ended: true }, split), event, new Map()).kind, 'verse');
  assert.strictEqual(projectorFrame(snap({ itemId: 2, step: 0, ended: false }, { ...split, ended: true }), event, new Map()).kind, 'black');
});

test('corner clock: settings, the three fields on every frame, hidden while a video plays or a song section shows', () => {
  const CLOCK = require('../lib/clock');
  const { projectorFrame, clockFrame } = require('../lib/projector');
  assert.deepStrictEqual(CLOCK.DEFAULTS, { show: true, position: 'bottom-right', scale: 1.8 });
  assert.deepStrictEqual([CLOCK.clampScale(0.2), CLOCK.clampScale(5), CLOCK.clampScale(1.24), CLOCK.clampScale('x')], [0.7, 1.8, 1.2, 1.8]);
  assert.deepStrictEqual(CLOCK.normalize({ show: 0, position: 'middle', scale: 9 }), { show: false, position: 'bottom-right', scale: 1.8 });
  assert.deepStrictEqual(CLOCK.parsePatch({ show: 'yes', position: 'top-left', scale: 0.5, other: 1 }), { position: 'top-left', scale: 0.7 });
  assert.strictEqual(CLOCK.parsePatch({ show: 'yes' }), null, 'nothing usable');
  assert.deepStrictEqual([CLOCK.formatTime(new Date('2026-09-27T10:05:00Z'), 'Europe/Oslo'), CLOCK.formatTime(new Date('2026-09-27T23:05:00Z'), 'UTC')], ['12:05', '23:05'], '24 h, HH:MM');
  assert.strictEqual(CLOCK.formatTime(new Date('2026-09-27T10:05:00Z'), 'Not/AZone').length, 5, 'an unknown timezone falls back');
  assert.deepStrictEqual([CLOCK.formatTime(new Date('2026-09-27T10:05:00Z'), 'Europe/Oslo', '12'), CLOCK.formatTime(new Date('2026-09-27T00:05:00Z'), 'UTC', '12')], ['12:05 PM', '12:05 AM'], '12 h');
  assert.deepStrictEqual([CLOCK.formatDuration(0), CLOCK.formatDuration(3723000), CLOCK.formatDuration(65000, { seconds: true }), CLOCK.formatDuration(3723000, { seconds: true })], ['00:00', '01:02', '01:05', '1:02:03']);
  // frames: the clock of the live state on every kind, false on a video frame; idle: the defaults given
  const items = [{ id: 1, type: 'verse', reference: 'Ps 1', body: 'Ferice' }, { id: 2, type: 'announcement', title: 'A', body: 'b' }];
  const media = { type: 'upload', src: '/x.mp4', mime: 'video/mp4', title: 'Clip' };
  const clock = { show: true, position: 'top-left', scale: 1.2, timeZone: 'Europe/Oslo' };
  const st = (source, itemId = 1, videoState = 'none', c = clock) => ({ version: 3, eventId: 2, status: 'live', worship: { itemId, step: 0 },
    projector: { follows: 'worship', itemId: null, step: 0, source }, video: { state: videoState, seq: 1, volume: 1, position: 0 }, clock: c });
  const f = (source, itemId, videoState) => projectorFrame(st(source, itemId, videoState), { items }, new Map(), { videoMedia: media, logoUrl: '/api/logo/x.png' });
  const expected = { show: true, position: 'top-left', scale: 1.2, timeZone: 'Europe/Oslo', format: '24' };
  assert.deepStrictEqual(f('content', 1).clock, expected, 'verse');
  assert.deepStrictEqual(f('content', 2).clock, expected, 'announcement');
  assert.deepStrictEqual(f('logo').clock, expected, 'logo');
  assert.deepStrictEqual(f('black').clock, expected, 'black');
  assert.deepStrictEqual(f('content', 99).clock, expected, 'no item: black, the clock stays');
  assert.deepStrictEqual([f('video', 1, 'playing').kind, f('video', 1, 'playing').clock], ['video', { ...expected, show: false }], 'never over a playing video');
  assert.deepStrictEqual([f('video', 1, 'paused').kind, f('video', 1, 'paused').clock.show], ['video', false]);
  assert.deepStrictEqual([f('video', 1, 'prepared').kind, f('video', 1, 'prepared').clock.show], ['black', true], 'nothing plays: the clock is back');
  assert.strictEqual(f('content', 1, 'prepared').clock.show, true, 'a prepared video does not hide it');
  // a song section on the projector: no clock over the lyrics; a song title (no song / no
  // section), a verse and an announcement keep it; the settings ride along unchanged
  const song = { sections: [{ id: 11, content: '[A]Ne ridici\nTu ești' }], arrangement: [{ sectionId: 11 }] };
  const withSong = [...items, { id: 3, type: 'song', songId: 5, title: 'Cântare' }, { id: 4, type: 'song', songId: null, title: 'Ștearsă' }];
  const g = (itemId, songs = new Map([[3, song]])) => projectorFrame(st('content', itemId), { items: withSong }, songs, { logoUrl: '/api/logo/x.png' });
  assert.deepStrictEqual([g(3).kind, g(3).clock], ['lyrics', { ...expected, show: false }], 'lyrics: the clock is hidden, position / scale kept');
  assert.deepStrictEqual([g(4).kind, g(4).clock.show], ['title', true], 'a song title keeps the clock');
  assert.deepStrictEqual([g(3, new Map()).kind, g(3, new Map()).clock.show], ['title', true], 'a song not loaded yet: its title, the clock stays');
  assert.strictEqual(g(1).clock.show, true, 'a verse keeps it');
  assert.strictEqual(projectorFrame(st('black', 3), { items: withSong }, new Map([[3, song]])).clock.show, true, 'black over the same song: back');
  assert.strictEqual(projectorFrame(st('logo', 3), { items: withSong }, new Map([[3, song]])).clock.show, true, 'logo: back');
  const ended = { ...st('content', 3), worship: { itemId: 3, step: 0, ended: true } };
  assert.deepStrictEqual([projectorFrame(ended, { items: withSong }, new Map([[3, song]])).kind, projectorFrame(ended, { items: withSong }, new Map([[3, song]])).clock.show], ['black', true], 'after Sfârșit (black): the clock is back');
  assert.strictEqual(projectorFrame(st('content', 1, 'none', { ...clock, show: false }), { items }, new Map()).clock.show, false, 'hidden by the operator');
  const idle = projectorFrame(null, null, null, { logoUrl: null, clock: { show: true, position: 'bottom-left', scale: 0.7, timeZone: 'UTC' } });
  assert.deepStrictEqual([idle.kind, idle.clock], ['idle', { show: true, position: 'bottom-left', scale: 0.7, timeZone: 'UTC', format: '24' }], 'idle: the church defaults');
  assert.strictEqual(projectorFrame(null, null, null, { clock: { ...CLOCK.DEFAULTS, format: '12' } }).clock.format, '12', 'the 12 h format rides along');
  assert.deepStrictEqual(clockFrame({ show: true, position: 'nowhere', scale: 3 }, 'verse'), { show: true, position: 'bottom-right', scale: 1.8, timeZone: null, format: '24' }, 'normalised');
  assert.strictEqual(clockFrame({ show: true }, 'lyrics').show, false, 'lyrics: hidden');
  // the store: a new event starts from the church defaults; clock.set changes the running one
  const { mem, live, eventId } = liveFixture();
  const settings = require('../lib/admin-settings').createAdminSettings(mem);
  assert.deepStrictEqual(settings.clock(1), { show: true, position: 'bottom-right', scale: 1.8 }, 'the defaults');
  assert.deepStrictEqual(settings.setClock(1, { position: 'top-right', scale: 0.55 }), { show: true, position: 'top-right', scale: 0.7 }, 'clamped');
  const cmd = (c, role = 'leader') => live.command(1, eventId, c, undefined, role);
  const code = (c, role) => { try { cmd(c, role); return 'ok'; } catch (err) { return err.code; } };
  const snap = () => live.snapshot(1, eventId);
  assert.deepStrictEqual(snap().clock, { show: true, position: 'top-right', scale: 0.7, timeZone: 'Europe/Oslo', format: '24' }, 'not yet live: what it would start with');
  // (a clock set before the start is preparation, kept by the start: its own test)
  cmd({ type: 'event.start' }, 'operator');
  assert.deepStrictEqual(snap().clock, { show: true, position: 'top-right', scale: 0.7, timeZone: 'Europe/Oslo', format: '24' }, 'started from the church defaults');
  let v = snap().version;
  assert.strictEqual(code({ type: 'clock.set', show: false }, 'member'), 'forbidden');
  assert.strictEqual(code({ type: 'clock.set' }), 'badCommand', 'nothing to change');
  assert.strictEqual(code({ type: 'clock.set', position: 'centre' }), 'badCommand');
  cmd({ type: 'clock.set', show: false }, 'operator');
  assert.deepStrictEqual([snap().version, snap().clock.show], [v + 1, false], 'versioned');
  cmd({ type: 'clock.set', show: false });
  assert.strictEqual(snap().version, v + 1, 'unchanged: no-op');
  cmd({ type: 'clock.set', show: true, position: 'bottom-left', scale: 4 }, 'owner');
  assert.deepStrictEqual(snap().clock, { show: true, position: 'bottom-left', scale: 1.8, timeZone: 'Europe/Oslo', format: '24' }, 'all three at once, the scale clamped');
  assert.strictEqual(mem.prepare('SELECT show_clock || clock_position || clock_scale FROM live_state WHERE event_id = ?').pluck().get(eventId), '1bottom-left1.8', 'persisted');
  cmd({ type: 'worship.next' });
  assert.strictEqual(snap().clock.position, 'bottom-left', 'other commands leave it alone');
  // the church defaults changed meanwhile: the running event keeps its own; the next start takes them
  settings.setClock(1, { show: false });
  assert.strictEqual(snap().clock.show, true);
  cmd({ type: 'event.end' });
  const again = require('../lib/events').createEventStore(mem).create(1, 1, { name: 'E2', eventDate: '2026-10-11', startTime: null, notes: null });
  live.command(1, again, { type: 'event.start' }, undefined, 'leader');
  settings.set(1, 'time_format', '12');
  assert.deepStrictEqual(live.snapshot(1, again).clock, { show: false, position: 'top-right', scale: 0.7, timeZone: 'Europe/Oslo', format: '12' }, 'the time format is a church setting, read live');
  settings.set(1, 'time_format', 'x');
  assert.strictEqual(settings.timeFormat(1), '24', 'an unknown format falls back');
  v = live.snapshot(1, again).version;
  const frame = projectorFrame(live.snapshot(1, again), { items: [] }, new Map());
  assert.deepStrictEqual([frame.kind, frame.clock.show, frame.clock.position], ['black', false, 'top-right'], 'the frame carries the state clock');
  assert.throws(() => mem.prepare("UPDATE live_state SET clock_position = 'centre'").run(), /CHECK/);
  mem.close();
});

test('projector holder (migration 041): the start gives it to a connected operator, else the starter; requests wait for a connected holder (accept / refuse / cancel / timeout), apply at once otherwise; the holder hands it over; the mode follows the holder\'s role', () => {
  const { mem, live, eventId } = liveFixture();
  const { HANDOVER_TTL_MS } = require('../lib/live');
  const T = Date.now();
  const OP = { userId: 7, role: 'operator' };
  const LEAD = { userId: 5, role: 'leader' };
  const OWNER = { userId: 1, role: 'owner' };
  const cmd = (c, role, ctx = {}) => live.command(1, eventId, c, undefined, role, { now: T, ...ctx });
  const code = (c, role, ctx) => { try { cmd(c, role, ctx); return 'ok'; } catch (err) { return err.code; } };
  const snap = () => live.snapshot(1, eventId);
  const who = () => { const h = snap().holder; return h ? [h.userId, h.role] : null; };
  // the start: the leader starts with an operator connected -> the operator holds (split)
  cmd({ type: 'event.start' }, 'leader', { userId: 5, online: [LEAD, OP] });
  assert.deepStrictEqual([who(), snap().mode, snap().projector.follows], [[7, 'operator'], 'split', 'operator']);
  assert.deepStrictEqual([snap().projector.itemId, snap().projector.step], [snap().worship.itemId, 0], 'the operator\'s projector starts at the first item, not on nothing');
  cmd({ type: 'event.end' }, 'leader');
  mem.prepare("UPDATE events SET status = 'planned' WHERE id = ?").run(eventId); // a second start
  live.command(1, eventId, { type: 'event.start' }, undefined, 'leader', { now: T, userId: 5, online: [LEAD, OWNER] });
  assert.deepStrictEqual([who(), snap().mode], [[5, 'leader'], 'together'], 'no operator connected: the starter holds');
  // mine already: nothing
  const v0 = snap().version;
  assert.strictEqual(cmd({ type: 'projector.request' }, 'leader', { userId: 5, online: [LEAD, OP] }).changed, false);
  assert.strictEqual(snap().version, v0);
  // the operator asks while the leader is connected: a pending request (versioned), aimed at the holder
  let r = cmd({ type: 'projector.request' }, 'operator', { userId: 7, online: [LEAD, OP] });
  assert.deepStrictEqual([r.changed, r.handoverEvent], [true, { type: 'requested', byUserId: 7, toUserId: 5, expiresAt: T + HANDOVER_TTL_MS }]);
  assert.deepStrictEqual([who(), snap().mode], [[5, 'leader'], 'together'], 'nothing changes yet');
  assert.deepStrictEqual(snap().handover, { requestedBy: 7, requestedAt: T, expiresAt: T + HANDOVER_TTL_MS }, 'pending in the snapshot');
  const v = snap().version;
  r = cmd({ type: 'projector.request' }, 'operator', { userId: 7, online: [LEAD, OP] });
  assert.deepStrictEqual([r.changed, r.handoverEvent.type, r.handoverEvent.again, snap().version], [false, 'requested', true, v], 'asking again: the same request');
  // only the holder answers; refuse changes nothing but the request
  assert.strictEqual(code({ type: 'handover.accept' }, 'operator', { userId: 7 }), 'notHolder');
  assert.strictEqual(code({ type: 'handover.accept' }, 'presenter', { userId: 8 }), 'notHolder', 'a presenter is neither the holder nor an owner');
  assert.strictEqual(code({ type: 'handover.accept' }, 'member', { userId: 9 }), 'forbidden');
  r = cmd({ type: 'handover.refuse' }, 'leader', { userId: 5 });
  assert.deepStrictEqual([r.handoverEvent.type, r.handoverEvent.byUserId, r.handoverEvent.requestedBy, who(), snap().handover], ['refused', 5, 7, [5, 'leader'], null]);
  assert.strictEqual(code({ type: 'handover.accept' }, 'leader', { userId: 5 }), 'noHandover', 'nothing pending any more');
  // accept: the requester gets it; an operator -> split, the projector starts at the main position
  cmd({ type: 'worship.next' }, 'leader', { userId: 5 });
  cmd({ type: 'projector.request' }, 'operator', { userId: 7, online: [LEAD, OP] });
  r = cmd({ type: 'handover.accept' }, 'leader', { userId: 5, online: [LEAD, OP] });
  assert.deepStrictEqual([r.handoverEvent, who(), snap().mode, snap().projector.follows, snap().handover], [{ type: 'accepted', byUserId: 5, toUserId: 7, toRole: 'operator' }, [7, 'operator'], 'split', 'operator', null]);
  assert.deepStrictEqual([snap().projector.itemId, snap().projector.step], [snap().worship.itemId, snap().worship.step], 'the projector starts where the team is');
  // the owner asks the operator; the operator (holder) accepts although the room list lacks the owner (the account's role is used)
  cmd({ type: 'projector.request' }, 'owner', { userId: 1, online: [OWNER, OP] });
  assert.ok(snap().handover, 'pending');
  r = cmd({ type: 'handover.accept' }, 'operator', { userId: 7, online: [OP] });
  assert.deepStrictEqual([r.handoverEvent.type, r.handoverEvent.toRole, who(), snap().mode], ['accepted', 'owner', [1, 'owner'], 'together']);
  // timeout: after 60 s the request is gone (silently); accepting then says so
  cmd({ type: 'projector.request' }, 'operator', { userId: 7, online: [OWNER, OP] });
  assert.ok(snap().handover, 'pending');
  assert.strictEqual(code({ type: 'handover.accept' }, 'owner', { userId: 1, now: T + HANDOVER_TTL_MS }), 'noHandover', 'expired');
  cmd({ type: 'worship.next' }, 'owner', { userId: 1, now: T + HANDOVER_TTL_MS + 5 });
  assert.strictEqual(snap().handover, null, 'an expired request is dropped by the next change');
  assert.deepStrictEqual(who(), [1, 'owner']);
  // taken: the holder is not connected -> at once, whoever asks
  r = cmd({ type: 'projector.request' }, 'operator', { userId: 7, online: [OP, LEAD] });
  assert.deepStrictEqual([r.handoverEvent, who(), snap().mode], [{ type: 'taken', byUserId: 7, byRole: 'operator', from: 1 }, [7, 'operator'], 'split'], 'the owner is away: taken');
  r = cmd({ type: 'projector.request' }, 'leader', { userId: 5, online: [LEAD] });
  assert.deepStrictEqual([r.handoverEvent.type, who(), snap().mode], ['taken', [5, 'leader'], 'together'], 'the operator is away: taken, together again');
  // an owner may always answer (not their own request); an owner connected keeps a request pending even with the holder away
  cmd({ type: 'projector.request' }, 'operator', { userId: 7, online: [OP] });
  assert.deepStrictEqual(who(), [7, 'operator']);
  r = cmd({ type: 'projector.request' }, 'leader', { userId: 5, online: [LEAD, OP, OWNER] });
  assert.strictEqual(r.handoverEvent.type, 'requested');
  r = cmd({ type: 'handover.accept' }, 'owner', { userId: 1, online: [LEAD, OP, OWNER] });
  assert.deepStrictEqual([r.handoverEvent.type, r.handoverEvent.byUserId, who()], ['accepted', 1, [5, 'leader']], 'the owner answered for the operator');
  cmd({ type: 'projector.request' }, 'owner', { userId: 1, online: [LEAD, OWNER] });
  assert.strictEqual(code({ type: 'handover.accept' }, 'owner', { userId: 1, online: [LEAD, OWNER] }), 'notHolder', 'never their own request');
  cmd({ type: 'handover.cancel' }, 'owner', { userId: 1 });
  cmd({ type: 'projector.request' }, 'operator', { userId: 7, online: [OP] });
  r = cmd({ type: 'projector.request' }, 'leader', { userId: 5, online: [LEAD, OWNER] });
  assert.strictEqual(r.handoverEvent.type, 'requested', 'the holder is away but an owner is connected: the request waits for the owner');
  r = cmd({ type: 'handover.refuse' }, 'owner', { userId: 1 });
  assert.deepStrictEqual([r.handoverEvent.type, who()], ['refused', [7, 'operator']]);
  r = cmd({ type: 'projector.request' }, 'leader', { userId: 5, online: [LEAD] });
  assert.deepStrictEqual([r.handoverEvent.type, who()], ['taken', [5, 'leader']], 'nobody who could answer: taken');
  // hand over: the holder only, to a connected event-role person
  assert.strictEqual(code({ type: 'projector.handover', toUserId: 7 }, 'operator', { userId: 7, online: [LEAD, OP] }), 'notHolder');
  assert.strictEqual(code({ type: 'projector.handover', toUserId: 7 }, 'leader', { userId: 5, online: [LEAD] }), 'notOnline', 'the operator is not connected');
  assert.strictEqual(code({ type: 'projector.handover', toUserId: 'x' }, 'leader', { userId: 5, online: [LEAD, OP] }), 'badCommand');
  assert.strictEqual(code({ type: 'projector.handover', toUserId: 9 }, 'leader', { userId: 5, online: [LEAD, OP, { userId: 9, role: 'member' }] }), 'notOnline', 'never to a member');
  assert.strictEqual(cmd({ type: 'projector.handover', toUserId: 5 }, 'leader', { userId: 5, online: [LEAD, OP] }).changed, false, 'to myself: nothing');
  r = cmd({ type: 'projector.handover', toUserId: 7 }, 'leader', { userId: 5, online: [LEAD, OP] });
  assert.deepStrictEqual([r.handoverEvent, who(), snap().mode], [{ type: 'handedOver', byUserId: 5, toUserId: 7, toRole: 'operator' }, [7, 'operator'], 'split']);
  // cancel; a hand-over while a request is pending settles it; a restart clears pending requests; the end too
  cmd({ type: 'projector.request' }, 'leader', { userId: 5, online: [LEAD, OP] });
  r = cmd({ type: 'handover.cancel' }, 'leader', { userId: 5 });
  assert.deepStrictEqual([r.handoverEvent.type, snap().handover, who()], ['cancelled', null, [7, 'operator']]);
  assert.strictEqual(code({ type: 'handover.cancel' }, 'leader'), 'noHandover');
  cmd({ type: 'projector.request' }, 'leader', { userId: 5, online: [LEAD, OP] });
  cmd({ type: 'projector.handover', toUserId: 1 }, 'operator', { userId: 7, online: [LEAD, OP, OWNER] });
  assert.deepStrictEqual([snap().handover, who()], [null, [1, 'owner']], 'handing over settles the pending request');
  cmd({ type: 'projector.request' }, 'leader', { userId: 5, online: [LEAD, OWNER] });
  assert.strictEqual(live.clearHandovers(), 1, 'a restart clears pending requests');
  assert.strictEqual(snap().handover, null);
  cmd({ type: 'projector.request' }, 'leader', { userId: 5, online: [LEAD, OWNER] });
  cmd({ type: 'event.end' }, 'leader');
  assert.strictEqual(snap().handover, null, 'the end of the event clears it');
});

testAsync('email (Resend): disabled without a key; templates RO / EN; one retry on 5xx; 20 an hour per admin; never a token in the log', async () => {
  const { createEmail, EmailError, PER_ADMIN_PER_HOUR } = require('../lib/email');
  const logs = [];
  const logger = { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) };
  const off = createEmail({ config: { RESEND_API_KEY: '', EMAIL_FROM: 'W <w@x.ro>' }, logger });
  assert.deepStrictEqual([off.enabled, off.status()], [false, { enabled: false, from: null }]);
  await assert.rejects(off.send(1, { to: 'a@x.ro', subject: 's', text: 't', html: '<p>t</p>' }), (e) => e instanceof EmailError && e.code === 'emailDisabled');
  assert.strictEqual(createEmail({ config: { RESEND_API_KEY: 'k', EMAIL_FROM: '' }, logger }).enabled, false, 'EMAIL_FROM is needed too');
  // templates
  const vars = { appName: 'Worship', churchName: 'Maranata', invitedBy: 'Ana', url: 'https://w.example/invite/TOKEN123', expiresIn: '7 zile', email: 'ion@x.ro' };
  const inv = off.templates.invite('ro', vars);
  assert.ok(/Invitație/.test(inv.subject) && /Ana te-a adăugat/.test(inv.text) && inv.text.includes(vars.url) && inv.html.includes(vars.url) && inv.html.includes('Maranata'), inv.text);
  const rst = off.templates.reset('en', vars);
  assert.ok(/Password reset/.test(rst.subject) && /ignore this email/.test(rst.text) && rst.html.includes('href="https://w.example/invite/TOKEN123"'));
  const tricky = off.templates.test('ro', { ...vars, churchName: '<b>x</b>' });
  assert.ok(tricky.html.includes('&lt;b&gt;x&lt;/b&gt;') && !tricky.html.includes('<b>x</b>') && tricky.text.includes('<b>x</b>'), 'escaped in the HTML, plain in the text');
  // sending: the request Resend gets; a 5xx is retried once, a 4xx is not; a network error too
  const calls = [];
  let responses = [];
  const fetchMock = async (url, opts) => {
    calls.push({ url, auth: opts.headers.Authorization, body: JSON.parse(opts.body) });
    const next = responses.shift() || { status: 200, body: { id: 'em_1' } };
    if (next.throw) throw new Error('ECONNRESET');
    return new Response(JSON.stringify(next.body || {}), { status: next.status });
  };
  const on = createEmail({ config: { RESEND_API_KEY: 're_key', EMAIL_FROM: 'Worship <w@x.ro>', EMAIL_REPLY_TO: 'r@x.ro', EMAIL_API_URL: 'http://mock/emails' }, logger, fetch: fetchMock });
  assert.deepStrictEqual(on.status(), { enabled: true, from: 'Worship <w@x.ro>' });
  assert.strictEqual(await on.send(1, { ...inv, to: 'ion@x.ro', kind: 'invite', userId: 7 }), 'em_1');
  assert.deepStrictEqual([calls.length, calls[0].url, calls[0].auth, calls[0].body.from, calls[0].body.to, calls[0].body.reply_to, calls[0].body.subject], [1, 'http://mock/emails', 'Bearer re_key', 'Worship <w@x.ro>', ['ion@x.ro'], 'r@x.ro', inv.subject]);
  assert.ok(logs.some((m) => /Email "invite" sent to ion@x.ro \(user #7\) \(admin #1/.test(m)) && !logs.some((m) => m.includes('TOKEN123')), 'an audit line, never the link');
  responses = [{ status: 502, body: {} }, { status: 200, body: { id: 'em_2' } }];
  assert.strictEqual(await on.send(1, { ...inv, to: 'ion@x.ro', kind: 'invite' }), 'em_2');
  assert.strictEqual(calls.length, 3, '5xx: retried once');
  responses = [{ status: 422, body: { message: 'bad' } }];
  await assert.rejects(on.send(1, { ...inv, to: 'ion@x.ro' }), (e) => e.code === 'emailFailed');
  assert.strictEqual(calls.length, 4, '4xx: not retried');
  responses = [{ throw: true }, { throw: true }];
  await assert.rejects(on.send(1, { ...inv, to: 'ion@x.ro' }), (e) => e.code === 'emailFailed' && e.detail === 'ECONNRESET');
  assert.strictEqual(calls.length, 6, 'network errors: two attempts');
  // the hourly limit per admin (4 sends so far for admin 1: every send counts, failed ones too)
  responses = [];
  for (let i = 4; i < PER_ADMIN_PER_HOUR; i++) await on.send(1, { ...inv, to: 'ion@x.ro' });
  await assert.rejects(on.send(1, { ...inv, to: 'ion@x.ro' }), (e) => e.code === 'emailRateLimited' && e.detail > 0);
  assert.strictEqual(await on.send(2, { ...inv, to: 'x@y.ro' }), 'em_1', 'another admin is not affected');
});

testAsync('platform deletion: refused while active, the exact name, pending -> cancel, the purge removes every row and the folder, a final zip', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const Database = require('better-sqlite3');
  const { runMigrations } = require('../lib/db');
  const { createPlatformStore, createDeletionSweep, DELETE_DELAY_MS, DELETED_KEEP_MS } = require('../lib/platform');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-purge-'));
  const db = new Database(path.join(dataDir, 'worship.db'));
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  db.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'Platforma', 0), (2, 'Biserica B', 0), (3, 'Biserica C', 0)").run();
  // Rows of B and C in every kind of table.
  const seed = (a) => {
    db.prepare("INSERT INTO users (admin_id, email, name, password_hash, role, created_at) VALUES (?, ?, 'U', 'x', 'owner', 0)").run(a, `o${a}@x.ro`);
    const userId = Number(db.prepare('SELECT id FROM users WHERE admin_id = ?').pluck().get(a));
    db.prepare("INSERT INTO sessions (id, user_id, admin_id, created_at, expires_at) VALUES (?, ?, ?, 0, 9999999999999)").run(`s${a}`, userId, a);
    db.prepare("INSERT INTO admin_settings (admin_id, key, value) VALUES (?, 'backup_last_at', '5')").run(a);
    const songId = Number(db.prepare("INSERT INTO songs (admin_id, title, title_norm, created_at, updated_at) VALUES (?, 'S', 's', 0, 0)").run(a).lastInsertRowid);
    db.prepare("INSERT INTO song_sections (song_id, admin_id, position, type, content, content_hash) VALUES (?, ?, 0, 'verse', 'x', 'h')").run(songId, a);
    const eventId = Number(db.prepare("INSERT INTO events (admin_id, name, event_date, status, created_at, updated_at) VALUES (?, 'E', '2026-10-04', 'live', 0, 0)").run(a).lastInsertRowid);
    db.prepare("INSERT INTO setlist_items (event_id, admin_id, position, type, song_id) VALUES (?, ?, 0, 'song', ?)").run(eventId, a, songId);
    db.prepare('INSERT INTO live_state (event_id, admin_id, version, updated_at) VALUES (?, ?, 1, 0)').run(eventId, a);
    db.prepare("INSERT INTO media (admin_id, kind, title, created_at) VALUES (?, 'url', 'M', 0)").run(a);
    db.prepare("INSERT INTO screens (admin_id, name, token_hash, created_at) VALUES (?, 'Sc', ?, 0)").run(a, `t${a}`);
    db.prepare("INSERT INTO screen_pairings (id, code, admin_id, created_at, expires_at) VALUES (?, ?, ?, 0, 9999999999999)").run(`p${a}`, `10000${a}`, a);
    db.prepare("INSERT INTO user_tokens (user_id, admin_id, kind, token_hash, created_at, expires_at) VALUES (?, ?, 'invite', ?, 0, 9999999999999)").run(userId, a, `h${a}`);
    const posId = Number(db.prepare("INSERT INTO positions (admin_id, name, sort) VALUES (?, 'Voce', 0)").run(a).lastInsertRowid);
    db.prepare('INSERT INTO users_positions (user_id, position_id, admin_id) VALUES (?, ?, ?)').run(userId, posId, a);
    db.prepare("INSERT INTO event_assignments (event_id, admin_id, user_id, position_id, created_at) VALUES (?, ?, ?, ?, 0)").run(eventId, a, userId, posId);
    db.prepare("INSERT INTO unavailability (admin_id, user_id, date_from, date_to) VALUES (?, ?, '2026-10-01', '2026-10-02')").run(a, userId);
    db.prepare("INSERT INTO push_subscriptions (admin_id, user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, 'p', 'a', 0)").run(a, userId, `https://push.test/${a}`);
    db.prepare("INSERT INTO notifications (admin_id, user_id, kind, title, event_id, created_at) VALUES (?, ?, 'assigned', 'T', ?, 0)").run(a, userId, eventId);
    db.prepare("INSERT INTO notification_prefs (user_id, admin_id, kind, enabled) VALUES (?, ?, 'reminder', 0)").run(userId, a);
    db.prepare("INSERT INTO song_proposals (admin_id, event_id, song_id, proposed_by, created_at) VALUES (?, ?, ?, ?, 0)").run(a, eventId, songId, userId);
    db.prepare("INSERT INTO bridge_connections (event_id, admin_id, sv_base_url, sv_event_id, bridge_token, token_fingerprint, created_at, updated_at) VALUES (?, ?, 'https://dev.sanctuaryvoice.com', 'ev', 'tok', 'fp', 0, 0)").run(eventId, a);
    db.prepare("INSERT INTO bridge_pairings (admin_id, sv_base_url, pairing_token, token_fingerprint, sv_org_id, paired_at) VALUES (?, 'https://dev.sanctuaryvoice.com', 'pt', 'fp', 'org', 0)").run(a);
    db.prepare("INSERT INTO custom_roles (admin_id, name, base, perms, created_at) VALUES (?, 'Sunet', 'member', 'live', 0)").run(a);
    db.prepare("INSERT INTO role_settings (admin_id, role, name, perms) VALUES (?, 'member', 'Voluntar', 'guides')").run(a);
    db.prepare("INSERT INTO ai_usage (admin_id, month, calls) VALUES (?, '2026-10', 3)").run(a);
    const guideId = Number(db.prepare("INSERT INTO guides (admin_id, title, created_at, updated_at) VALUES (?, 'Sunet', 0, 0)").run(a).lastInsertRowid);
    db.prepare('INSERT INTO guide_positions (guide_id, position_id, admin_id) SELECT ?, id, admin_id FROM positions WHERE admin_id = ? LIMIT 1').run(guideId, a);
    db.prepare("INSERT INTO guide_items (guide_id, admin_id, kind, title, created_at) VALUES (?, ?, 'step', 'Pornește mixerul', 0)").run(guideId, a);
    fs.mkdirSync(path.join(dataDir, 'uploads', `admin-${a}`, 'media'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'uploads', `admin-${a}`, 'media', 'f.bin'), Buffer.alloc(64, 1));
  };
  seed(2);
  seed(3);
  const store = createPlatformStore(db, { dataDir, defaultMediaMaxBytes: 1 });
  const T0 = Date.UTC(2026, 8, 1, 10, 0, 0); // a real date: the zip carries a DOS date
  const counts = (a) => Object.fromEntries(store.adminTables.map((name) => [name, db.prepare(`SELECT COUNT(*) FROM "${name}" WHERE admin_id = ?`).pluck().get(a)]));
  const beforeC = counts(3);
  assert.ok(Object.values(counts(2)).every((n) => n >= 1), `rows in every admin table: ${JSON.stringify(counts(2))}`);
  // step one
  assert.deepStrictEqual(store.scheduleDelete(2, 'Biserica B', T0), { error: 'active' }, 'refused while active');
  store.deactivate(2);
  assert.deepStrictEqual(store.scheduleDelete(2, 'biserica b', T0), { error: 'name' }, 'the exact name');
  assert.deepStrictEqual(store.scheduleDelete(2, 'Biserica B', T0), { deleteAt: T0 + DELETE_DELAY_MS });
  assert.strictEqual(store.list(1).find((a) => a.id === 2).deleteAt, T0 + DELETE_DELAY_MS, 'pending in the list');
  assert.strictEqual(store.cancelDelete(2), true);
  assert.strictEqual(store.cancelDelete(2), false, 'nothing pending any more');
  assert.strictEqual(store.list(1).find((a) => a.id === 2).deleteAt, null);
  store.scheduleDelete(2, 'Biserica B', T0);
  store.reactivate(2);
  assert.strictEqual(store.get(2).delete_at, null, 'reactivating drops the schedule');
  store.deactivate(2);
  store.scheduleDelete(2, 'Biserica B', T0);
  assert.deepStrictEqual(store.dueForDeletion(T0 + DELETE_DELAY_MS - 1), [], 'not yet');
  assert.deepStrictEqual(store.dueForDeletion(T0 + DELETE_DELAY_MS).map((d) => d.id), [2]);
  // the sweep: a final backup, then the purge; C untouched; the platform church never
  const logs = [];
  const logger = { info: (m) => logs.push(m), error: (m, e) => logs.push(`${m} ${e && e.message}`), warn: () => {} };
  const sweep = createDeletionSweep({ db, dataDir, config: { APP_NAME: 'x', VERSION: '0' }, logger, platformAdminId: () => 1 });
  const early = await sweep.run(T0 + DELETE_DELAY_MS - 1);
  assert.deepStrictEqual(early.purged, [], 'nothing due yet');
  const now = T0 + DELETE_DELAY_MS;
  const out = await sweep.run(now);
  assert.deepStrictEqual([out.purged.map((p) => p.id), out.failed], [[2], []], JSON.stringify(out));
  assert.ok(Object.values(counts(2)).every((n) => n === 0), `0 rows per table: ${JSON.stringify(counts(2))}`);
  assert.strictEqual(db.prepare('SELECT COUNT(*) FROM admins WHERE id = 2').pluck().get(), 0);
  assert.ok(!fs.existsSync(path.join(dataDir, 'uploads', 'admin-2')), 'the upload folder is gone');
  assert.deepStrictEqual(counts(3), beforeC, 'the other church is untouched');
  assert.ok(fs.existsSync(path.join(dataDir, 'uploads', 'admin-3', 'media', 'f.bin')));
  const zip = path.join(dataDir, 'deleted', `2-${new Date(now).toISOString().slice(0, 10)}.zip`);
  assert.ok(fs.existsSync(zip), 'the final backup zip');
  assert.strictEqual(fs.readFileSync(zip).readUInt32LE(0), 0x04034b50, 'a zip');
  assert.ok(fs.readFileSync(zip).includes(Buffer.from('uploads/admin-2/media/f.bin')), 'the upload is inside');
  assert.ok(logs.some((m) => /purged church #2 "Biserica B"/.test(m)), 'an audit line');
  assert.deepStrictEqual((await sweep.run(now)).purged, [], 'idempotent');
  // the platform's own church is never purged, even when marked
  db.prepare('UPDATE admins SET active = 0, delete_at = 1 WHERE id = 1').run();
  assert.deepStrictEqual((await sweep.run(now)).purged, []);
  assert.strictEqual(db.prepare('SELECT COUNT(*) FROM admins WHERE id = 1').pluck().get(), 1);
  // final backups are kept 30 days
  const old = new Date(now - DELETED_KEEP_MS - 1000);
  fs.utimesSync(zip, old, old);
  assert.strictEqual((await sweep.run(now)).backupsRemoved, 1);
  assert.ok(!fs.existsSync(zip));
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('backup temp sweep: leftover .backup-* folders older than 1 h go at startup, fresh ones stay', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const Database = require('better-sqlite3');
  const { runMigrations } = require('../lib/db');
  const { createBackupService, SWEEP_AFTER_MS } = require('../lib/backup');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-sweep-'));
  const db = new Database(':memory:');
  runMigrations(db);
  const backups = createBackupService({ db, dataDir, config: { APP_NAME: 'x', VERSION: '0' } });
  const old = path.join(dataDir, '.backup-old');
  const fresh = path.join(dataDir, '.backup-fresh');
  fs.mkdirSync(old);
  fs.writeFileSync(path.join(old, 'worship.db'), 'x');
  fs.mkdirSync(fresh);
  fs.mkdirSync(path.join(dataDir, 'uploads'));
  const twoHoursAgo = new Date(Date.now() - 2 * SWEEP_AFTER_MS);
  fs.utimesSync(old, twoHoursAgo, twoHoursAgo);
  assert.strictEqual(backups.sweepTemp(), 1);
  assert.deepStrictEqual(fs.readdirSync(dataDir).sort(), ['.backup-fresh', 'uploads'], 'the fresh one (a request in progress) and everything else stay');
  assert.strictEqual(backups.sweepTemp(), 0, 'nothing more to do');
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// --- build identity (lib/version.js) ---------------------------------------------

test('build identity: the commit from the host env (Render first), else git, else none; the label feeds the PWA cache version', () => {
  const { buildIdentity } = require('../lib/version');
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const nowhere = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-nogit-')); // no .git here: git fails
  const render = buildIdentity({ version: '0.1.0', env: { RENDER_GIT_COMMIT: 'ABCDEF0123456789abcdef0123456789abcdef01', GIT_COMMIT: '1111111' }, cwd: nowhere });
  assert.deepStrictEqual(render, { version: '0.1.0', commit: 'abcdef0123456789abcdef0123456789abcdef01', shortCommit: 'abcdef0', label: '0.1.0+abcdef0' });
  assert.strictEqual(buildIdentity({ version: '0.1.0', env: { GIT_COMMIT: '1111111' }, cwd: nowhere }).label, '0.1.0+1111111', 'GIT_COMMIT when Render\'s is missing');
  assert.strictEqual(buildIdentity({ version: '0.1.0', env: { RENDER_GIT_COMMIT: 'not a sha' }, cwd: nowhere }).commit, null, 'junk is ignored');
  const none = buildIdentity({ version: '0.1.0', env: {}, cwd: nowhere });
  assert.deepStrictEqual(none, { version: '0.1.0', commit: null, shortCommit: null, label: '0.1.0' }, 'nothing known: the version alone');
  const here = buildIdentity({ version: '0.1.0', env: {} }); // this checkout
  assert.ok(here.commit === null || /^[0-9a-f]{40}$/.test(here.commit), 'git, when available, gives the full sha');
  // the PWA cache version starts with the label: a new commit is a new build
  const { buildInfo } = require('../lib/pwa');
  assert.ok(buildInfo('0.1.0+abcdef0').version.startsWith('0.1.0+abcdef0-'));
  assert.notStrictEqual(buildInfo('0.1.0+abcdef0').version, buildInfo('0.1.0+1234567').version);
  fs.rmSync(nowhere, { recursive: true, force: true });
});

// --- bridge client (stage 8) --------------------------------------------------

const bridgeClient = require('../lib/bridge/client');

test('bridge normalizeCode: SV alphabet, 6-8 chars, upper-cased', () => {
  assert.strictEqual(bridgeClient.normalizeCode(' abc23d '), 'ABC23D');
  assert.strictEqual(bridgeClient.normalizeCode('K7MNPQRS'), 'K7MNPQRS');
  for (const bad of ['abc2', 'ABC23DEF9', 'ABC01D', 'ABC-2D', 'ABCIL0', '', null]) {
    assert.strictEqual(bridgeClient.normalizeCode(bad), null, String(bad));
  }
});

test('bridge normalizeBaseUrl: https, or http only on localhost; origin, no userinfo/query', () => {
  assert.strictEqual(bridgeClient.normalizeBaseUrl('https://dev.sanctuaryvoice.com/'), 'https://dev.sanctuaryvoice.com');
  assert.strictEqual(bridgeClient.normalizeBaseUrl('https://sanctuaryvoice.com'), 'https://sanctuaryvoice.com');
  assert.strictEqual(bridgeClient.normalizeBaseUrl('http://127.0.0.1:4000/x'), 'http://127.0.0.1:4000');
  assert.strictEqual(bridgeClient.normalizeBaseUrl('http://localhost:3001'), 'http://localhost:3001');
  for (const bad of ['http://sanctuaryvoice.com', 'ftp://sanctuaryvoice.com', 'https://u:p@sanctuaryvoice.com', 'https://sanctuaryvoice.com/?a=1', 'not a url', '']) {
    assert.strictEqual(bridgeClient.normalizeBaseUrl(bad), null, String(bad));
  }
});

test('bridge parseLanguages / fingerprint', () => {
  assert.deepStrictEqual(bridgeClient.parseLanguages(['EN', 'ro', 'pt-BR', 5, '', 'toolonglanguage']), ['en', 'ro', 'pt-br']);
  assert.deepStrictEqual(bridgeClient.parseLanguages('en'), []);
  assert.match(bridgeClient.fingerprint('abc'), /^[0-9a-f]{12}$/);
  assert.strictEqual(bridgeClient.fingerprint('abc'), bridgeClient.fingerprint('abc'));
});

testAsync('bridge exchange / revoke / status: happy paths and error mapping', async () => {
  const calls = [];
  const routes = new Map();
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null });
    const key = `${opts.method || 'GET'} ${new URL(url).pathname}`;
    const handler = routes.get(key);
    return handler ? handler() : fakeResponse(500, '{}');
  };
  const client = bridgeClient.createBridgeClient({ fetchImpl });

  // exchange OK
  routes.set('POST /api/bridge/exchange', () => fakeResponse(200, JSON.stringify({
    ok: true, bridgeToken: 'tok-123', svEventId: 'ev-9', targetLanguages: ['EN', 'de'], expiresAt: 111,
  })));
  const ex = await client.exchange('https://dev.sanctuaryvoice.com/', 'abc23d');
  assert.deepStrictEqual(ex, { baseUrl: 'https://dev.sanctuaryvoice.com', bridgeToken: 'tok-123', svEventId: 'ev-9', targetLanguages: ['en', 'de'], expiresAt: 111 });
  assert.strictEqual(calls[0].url, 'https://dev.sanctuaryvoice.com/api/bridge/exchange');
  assert.deepStrictEqual(calls[0].body, { code: 'ABC23D' });

  // bad base url / bad code never hit the network
  calls.length = 0;
  await assert.rejects(client.exchange('http://evil.example', 'abc23d'), (e) => e.code === 'bad_base_url');
  await assert.rejects(client.exchange('https://dev.sanctuaryvoice.com', 'nope'), (e) => e.code === 'invalid_code');
  assert.strictEqual(calls.length, 0, 'no request for invalid inputs');

  // SV error bodies -> the SV code
  routes.set('POST /api/bridge/exchange', () => fakeResponse(400, JSON.stringify({ ok: false, error: 'code_expired' })));
  await assert.rejects(client.exchange('https://dev.sanctuaryvoice.com', 'abc23d'), (e) => e.code === 'code_expired' && e.status === 400);
  routes.set('POST /api/bridge/exchange', () => fakeResponse(429, JSON.stringify({ ok: false, error: 'too_many_attempts' })));
  await assert.rejects(client.exchange('https://dev.sanctuaryvoice.com', 'abc23d'), (e) => e.code === 'too_many_attempts' && e.status === 429);
  routes.set('POST /api/bridge/exchange', () => fakeResponse(404, ''));
  await assert.rejects(client.exchange('https://dev.sanctuaryvoice.com', 'abc23d'), (e) => e.code === 'invalid_code');

  // revoke: Bearer + body, 404 counts as success, 500 throws
  calls.length = 0;
  routes.set('POST /api/bridge/revoke', () => fakeResponse(200, JSON.stringify({ ok: true })));
  assert.deepStrictEqual(await client.revoke('https://dev.sanctuaryvoice.com', 'tok-123'), { ok: true });
  assert.strictEqual(calls[0].headers.Authorization, 'Bearer tok-123');
  assert.deepStrictEqual(calls[0].body, { bridgeToken: 'tok-123' });
  routes.set('POST /api/bridge/revoke', () => fakeResponse(404, '{}'));
  assert.deepStrictEqual(await client.revoke('https://dev.sanctuaryvoice.com', 'tok-123'), { ok: true });
  routes.set('POST /api/bridge/revoke', () => fakeResponse(500, '{}'));
  await assert.rejects(client.revoke('https://dev.sanctuaryvoice.com', 'tok-123'), (e) => e.code === 'revoke_failed');

  // status: 200 shape; 401 -> inactive
  routes.set('GET /api/bridge/status', () => fakeResponse(200, JSON.stringify({
    ok: true, connected: true, svEventId: 'ev-9', targetLanguages: ['en'], expiresAt: 222, lastSeenAt: 333,
  })));
  assert.deepStrictEqual(await client.status('https://dev.sanctuaryvoice.com', 'tok-123'), { connected: true, svEventId: 'ev-9', targetLanguages: ['en'], expiresAt: 222, lastSeenAt: 333 });
  routes.set('GET /api/bridge/status', () => fakeResponse(401, '{}'));
  await assert.rejects(client.status('https://dev.sanctuaryvoice.com', 'tok-123'), (e) => e.code === 'inactive');
});

testAsync('bridge client church pairing: pair / listEvents / connectPaired / unpair, and their error codes', async () => {
  const calls = [];
  const routes = new Map();
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null });
    const handler = routes.get(`${opts.method || 'GET'} ${new URL(url).pathname}`);
    return handler ? handler() : fakeResponse(500, '{}');
  };
  const client = bridgeClient.createBridgeClient({ fetchImpl });
  const base = 'https://dev.sanctuaryvoice.com';
  routes.set('POST /api/bridge/pair', () => fakeResponse(200, JSON.stringify({ ok: true, pairingToken: 'pt-1', svOrgId: 'org-7', svOrgName: 'Biserica Harul', expiresAt: null })));
  const paired = await client.pair(`${base}/`, 'k7mnpq', 'Harul');
  assert.deepStrictEqual(paired, { baseUrl: base, pairingToken: 'pt-1', svOrgId: 'org-7', svOrgName: 'Biserica Harul', expiresAt: null });
  assert.deepStrictEqual(calls[0].body, { code: 'K7MNPQ', churchName: 'Harul' });
  await assert.rejects(client.pair(base, 'no', 'x'), (e) => e.code === 'invalid_code');
  routes.set('POST /api/bridge/pair', () => fakeResponse(400, JSON.stringify({ ok: false, error: 'code_used' })));
  await assert.rejects(client.pair(base, 'k7mnpq', 'x'), (e) => e.code === 'code_used');
  routes.set('POST /api/bridge/pair', () => fakeResponse(500, '{}'));
  await assert.rejects(client.pair(base, 'k7mnpq', 'x'), (e) => e.code === 'pair_failed');
  // events: normalized, startsAt as a number or an ISO string, 401 -> unpaired
  routes.set('GET /api/bridge/events', () => fakeResponse(200, JSON.stringify({ ok: true, events: [
    { svEventId: 'ev-1', name: 'Duminică', startsAt: '2026-10-04T08:00:00Z', status: 'live', targetLanguages: ['EN', 'no'] },
    { svEventId: 42, name: 'Seara', startsAt: 1790000000000, status: 'planned' },
    { nope: true },
  ] })));
  calls.length = 0;
  const events = await client.listEvents(base, 'pt-1');
  assert.deepStrictEqual(events, [
    { svEventId: 'ev-1', name: 'Duminică', startsAt: Date.parse('2026-10-04T08:00:00Z'), status: 'live', targetLanguages: ['en', 'no'] },
    { svEventId: '42', name: 'Seara', startsAt: 1790000000000, status: 'planned', targetLanguages: [] },
  ]);
  assert.strictEqual(calls[0].headers.Authorization, 'Bearer pt-1');
  routes.set('GET /api/bridge/events', () => fakeResponse(401, JSON.stringify({ ok: false, error: 'unpaired' })));
  await assert.rejects(client.listEvents(base, 'pt-1'), (e) => e.code === 'unpaired');
  // connect: the exchange body; 404 -> unknown_event; 401 -> unpaired
  routes.set('POST /api/bridge/connect', () => fakeResponse(200, JSON.stringify({ ok: true, bridgeToken: 'bt-9', svEventId: 'ev-1', targetLanguages: ['en'], expiresAt: 555 })));
  calls.length = 0;
  assert.deepStrictEqual(await client.connectPaired(base, 'pt-1', 'ev-1', 'Serviciu'), { baseUrl: base, bridgeToken: 'bt-9', svEventId: 'ev-1', targetLanguages: ['en'], expiresAt: 555 });
  assert.deepStrictEqual([calls[0].headers.Authorization, calls[0].body], ['Bearer pt-1', { svEventId: 'ev-1', worshipEventName: 'Serviciu' }]);
  routes.set('POST /api/bridge/connect', () => fakeResponse(404, JSON.stringify({ ok: false, error: 'unknown_event' })));
  await assert.rejects(client.connectPaired(base, 'pt-1', 'ev-x', ''), (e) => e.code === 'unknown_event' && e.status === 404);
  routes.set('POST /api/bridge/connect', () => fakeResponse(401, '{}'));
  await assert.rejects(client.connectPaired(base, 'pt-1', 'ev-1', ''), (e) => e.code === 'unpaired');
  // unpair: ok, and 401 / 404 count as done
  routes.set('POST /api/bridge/unpair', () => fakeResponse(200, JSON.stringify({ ok: true })));
  assert.deepStrictEqual(await client.unpair(base, 'pt-1'), { ok: true });
  routes.set('POST /api/bridge/unpair', () => fakeResponse(401, '{}'));
  assert.deepStrictEqual(await client.unpair(base, 'pt-1'), { ok: true });
  routes.set('POST /api/bridge/unpair', () => fakeResponse(500, '{}'));
  await assert.rejects(client.unpair(base, 'pt-1'), (e) => e.code === 'unpair_failed');
});

testAsync('bridge hub church pairing (migration 042): pair once, list SV events, connect without a code, a revoked pairing is remembered, unpair', async () => {
  const Database = require('better-sqlite3');
  const { runMigrations } = require('../lib/db');
  const { createBridge } = require('../lib/bridge');
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  db.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'Biserica Harul', 0), (2, 'Alta', 0)").run();
  db.prepare("INSERT INTO users (id, admin_id, email, name, password_hash, role, created_at) VALUES (1, 1, 'a@x.ro', 'Ana', 'x', 'owner', 0)").run();
  const eventId = Number(db.prepare("INSERT INTO events (admin_id, name, event_date, status, created_at, updated_at) VALUES (1, 'Serviciu', '2026-10-04', 'live', 0, 0)").run().lastInsertRowid);
  const calls = [];
  let unpaired = false;
  const fetchImpl = async (url, opts = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, auth: (opts.headers || {}).Authorization || null, body: opts.body ? JSON.parse(opts.body) : null });
    if (path === '/api/bridge/pair') return fakeResponse(200, JSON.stringify({ ok: true, pairingToken: 'pt-1', svOrgId: 'org-7', svOrgName: 'Harul SV' }));
    if (unpaired) return fakeResponse(401, JSON.stringify({ ok: false, error: 'unpaired' }));
    if (path === '/api/bridge/events') return fakeResponse(200, JSON.stringify({ ok: true, events: [{ svEventId: 'ev-1', name: 'Duminică', startsAt: 1, status: 'live', targetLanguages: ['en'] }] }));
    if (path === '/api/bridge/connect') return fakeResponse(200, JSON.stringify({ ok: true, bridgeToken: 'bt-1', svEventId: 'ev-1', targetLanguages: ['en'], expiresAt: Date.now() + 3600000 }));
    if (path === '/api/bridge/unpair' || path === '/api/bridge/revoke') return fakeResponse(200, JSON.stringify({ ok: true }));
    return fakeResponse(500, '{}');
  };
  const socket = { on: () => {}, removeAllListeners: () => {}, disconnect: () => {}, emit: () => {} };
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  const bridge = createBridge({ db, config: {}, logger, fetchImpl, ioClient: () => socket });
  assert.strictEqual(bridge.pairingStatus(1), null, 'not paired');
  await assert.rejects(bridge.svEvents(1), (e) => e.code === 'not_paired');
  await assert.rejects(bridge.connectPaired(1, eventId, { svEventId: 'ev-1' }), (e) => e.code === 'not_paired');
  // pair: the church name goes to SV; the token stays server-side
  const pairing = await bridge.pair(1, 1, { svBaseUrl: 'https://dev.sanctuaryvoice.com', code: 'k7mnpq' });
  assert.deepStrictEqual([pairing.paired, pairing.status, pairing.svOrgId, pairing.svOrgName, typeof pairing.pairedAt], [true, 'paired', 'org-7', 'Harul SV', 'number']);
  assert.strictEqual(Object.keys(pairing).some((k) => /token/i.test(k)), false, 'no token in the public view');
  assert.deepStrictEqual(calls[0].body, { code: 'K7MNPQ', churchName: 'Biserica Harul' });
  assert.strictEqual(bridge.pairingStatus(2), null, 'another church is not paired');
  // the events, then a one-tap connect: the same lifecycle as a code exchange
  const events = await bridge.svEvents(1);
  assert.deepStrictEqual(events.map((e) => [e.svEventId, e.status]), [['ev-1', 'live']]);
  assert.strictEqual(calls.at(-1).auth, 'Bearer pt-1');
  const st = await bridge.connectPaired(1, eventId, { svEventId: 'ev-1' });
  assert.deepStrictEqual([st.connected, st.connection.svEventId, st.connection.svBaseUrl, st.pairing.paired], [true, 'ev-1', 'https://dev.sanctuaryvoice.com', true]);
  assert.deepStrictEqual(calls.at(-1).body, { svEventId: 'ev-1', worshipEventName: 'Serviciu' });
  assert.strictEqual(bridge.status(1, eventId).pairing.svOrgName, 'Harul SV', 'the event status carries the pairing');
  await assert.rejects(bridge.connectPaired(1, eventId, { svEventId: '' }), (e) => e.code === 'unknown_event');
  // SV revoked the pairing: remembered as unpaired_remote until the owner pairs again
  unpaired = true;
  await assert.rejects(bridge.svEvents(1), (e) => e.code === 'unpaired');
  assert.deepStrictEqual([bridge.pairingStatus(1).paired, bridge.pairingStatus(1).status], [false, 'unpaired_remote']);
  await assert.rejects(bridge.svEvents(1), (e) => e.code === 'not_paired', 'no more calls to SV until paired again');
  unpaired = false;
  await bridge.pair(1, 1, { svBaseUrl: 'https://dev.sanctuaryvoice.com', code: 'k7mnpq' });
  assert.strictEqual(bridge.pairingStatus(1).paired, true);
  // unpair: forgotten here, told to SV; the event bridge stays
  assert.strictEqual(await bridge.unpair(1), null);
  assert.strictEqual(bridge.pairingStatus(1), null);
  assert.strictEqual(calls.at(-1).path, '/api/bridge/unpair');
  assert.strictEqual(bridge.status(1, eventId).connected, true, 'the open event bridge is untouched');
  assert.strictEqual(await bridge.unpair(1), null, 'unpairing twice is fine');
  await bridge.disconnect(1, eventId);
  db.close();
});

testAsync('bridge hub: connect opens the SV socket, translations feed the projector, gated by dir_in', async () => {
  const Database = require('better-sqlite3');
  const { runMigrations } = require('../lib/db');
  const { createBridge } = require('../lib/bridge');
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  db.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'A', 0)").run();
  const eventId = Number(db.prepare("INSERT INTO events (admin_id, name, event_date, status, created_at, updated_at) VALUES (1, 'E', '2026-10-04', 'live', 0, 0)").run().lastInsertRowid);

  const handlers = {};
  const socket = { on: (ev, fn) => { handlers[ev] = fn; }, removeAllListeners: () => {}, disconnect: () => {}, emit: () => {} };
  const ioClient = () => socket;
  const updates = [];
  const screensHub = { update: (adminId) => updates.push(adminId) };
  const fetchImpl = async () => fakeResponse(200, JSON.stringify({ ok: true, bridgeToken: 'tok', svEventId: 'sv-1', targetLanguages: ['en', 'de'], expiresAt: Date.now() + 3600000 }));
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  const bridge = createBridge({ db, config: {}, logger, fetchImpl, ioClient, screensHub });

  const st = await bridge.connect(1, eventId, { svBaseUrl: 'https://dev.sanctuaryvoice.com', code: 'abc23d' });
  assert.strictEqual(st.connected, true);
  assert.strictEqual(st.connection.svEventId, 'sv-1');
  assert.ok(typeof handlers['translation.final'] === 'function', 'SV stream handlers wired');

  // A final translation arrives, but dir_in is OFF: nothing is fed to the projector.
  handlers['translation.final']({ id: 'e1', translations: { en: 'Holy\nis the Lord', de: 'Heilig' } });
  assert.strictEqual(bridge.translationFor(1, eventId, 'en'), null, 'no text while dir_in off');
  assert.strictEqual(updates.length, 0, 'no projector re-render while dir_in off');

  // Turn dir_in on: the stored translation now feeds the projector for the picked language.
  bridge.setSwitches(1, eventId, { dirIn: true, dirOut: false });
  assert.deepStrictEqual(bridge.translationFor(1, eventId, 'en'), { lines: ['Holy', 'is the Lord'], partial: false });
  assert.deepStrictEqual(bridge.translationFor(1, eventId, 'de'), { lines: ['Heilig'], partial: false });
  assert.strictEqual(bridge.translationFor(2, eventId, 'en'), null, 'scoped to the connection admin');
  handlers['translation.partial']({ entryId: 'e2', partial: true, translations: { en: 'Holy is' } });
  assert.deepStrictEqual(bridge.translationFor(1, eventId, 'en'), { lines: ['Holy is'], partial: true });
  assert.ok(updates.includes(1), 'a partial re-renders the projector when dir_in is on');

  // dir_out is available with no consent gate (every event role).
  assert.doesNotThrow(() => bridge.setSwitches(1, eventId, { dirIn: true, dirOut: true }));

  await bridge.disconnect(1, eventId);
  assert.strictEqual(bridge.translationFor(1, eventId, 'en'), null, 'forgotten after disconnect');
  assert.strictEqual(bridge.status(1, eventId).connected, false);
  db.close();
});

testAsync('bridge worship -> SV: song.current / song.clear on main-position changes', async () => {
  const Database = require('better-sqlite3');
  const { runMigrations } = require('../lib/db');
  const { createBridge } = require('../lib/bridge');
  const { createLiveStore } = require('../lib/live');
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  db.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'A', 0)").run();
  const songId = Number(db.prepare("INSERT INTO songs (admin_id, title, title_norm, created_at, updated_at) VALUES (1, 'Sfânt', 'sfant', 0, 0)").run().lastInsertRowid);
  db.prepare("INSERT INTO song_sections (song_id, admin_id, position, type, content, content_hash) VALUES (?, 1, 0, 'verse', '[G]Ne ridici din [D]noaptea grea', 'h1')").run(songId);
  db.prepare("INSERT INTO song_sections (song_id, admin_id, position, type, content, content_hash) VALUES (?, 1, 1, 'chorus', '[C]Sfânt e Domnul', 'h2')").run(songId);
  const eventId = Number(db.prepare("INSERT INTO events (admin_id, name, event_date, status, created_at, updated_at) VALUES (1, 'E', '2026-10-04', 'planned', 0, 0)").run().lastInsertRowid);
  db.prepare("INSERT INTO setlist_items (event_id, admin_id, position, type, song_id) VALUES (?, 1, 0, 'song', ?)").run(eventId, songId);
  db.prepare("INSERT INTO setlist_items (event_id, admin_id, position, type, reference, body) VALUES (?, 1, 1, 'verse', 'Ps 23', 'Domnul e Păstorul meu')").run(eventId);

  const emitted = [];
  const socket = { on: () => {}, removeAllListeners: () => {}, disconnect: () => {}, emit: (ev, payload) => emitted.push([ev, payload]) };
  const fetchImpl = async () => fakeResponse(200, JSON.stringify({ ok: true, bridgeToken: 'tok', svEventId: 'sv', targetLanguages: ['en'], expiresAt: Date.now() + 3600000 }));
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  const bridge = createBridge({ db, config: {}, logger, fetchImpl, ioClient: () => socket });
  const live = createLiveStore(db);
  await bridge.connect(1, eventId, { svBaseUrl: 'https://dev.sanctuaryvoice.com', code: 'abc23d' });
  live.command(1, eventId, { type: 'event.start' }, undefined, 'owner');

  const songs = () => emitted.filter(([ev]) => ev === 'song.current' || ev === 'song.clear');
  const setlists = () => emitted.filter(([ev]) => ev === 'setlist.sections');

  // dir_out off: nothing is sent even as the position moves.
  bridge.onLiveChanged(1, eventId);
  assert.strictEqual(emitted.length, 0, 'silent while dir_out off');

  // dir_out on (no consent gate): the current section goes out at once (chords stripped, lang ro).
  bridge.setSwitches(1, eventId, { dirIn: false, dirOut: true });
  assert.strictEqual(songs().length, 1);
  assert.deepStrictEqual([songs()[0][0], songs()[0][1].title, songs()[0][1].label, songs()[0][1].text, songs()[0][1].lang], ['song.current', 'Sfânt', 'Strofa 1', 'Ne ridici din noaptea grea', 'ro']);
  assert.match(songs()[0][1].hash, /^[0-9a-f]{64}$/);

  // B4: turning dir_out on also pre-translates the whole setlist (both song sections, deduped,
  // the same hashes song.current uses).
  assert.strictEqual(setlists().length, 1, 'setlist.sections sent when dir_out turns on');
  const pre = setlists()[0][1];
  assert.deepStrictEqual(pre.map((s) => s.text), ['Ne ridici din noaptea grea', 'Sfânt e Domnul']);
  assert.strictEqual(pre[0].hash, songs()[0][1].hash, 'pre-translation hash matches song.current');
  assert.ok(pre.every((s) => /^[0-9a-f]{64}$/.test(s.hash) && s.title === 'Sfânt'));

  // Same position again: throttled (one message per position change).
  bridge.onLiveChanged(1, eventId);
  assert.strictEqual(songs().length, 1, 'no duplicate for the same section');

  // Next -> the chorus.
  live.command(1, eventId, { type: 'worship.next' }, undefined, 'owner');
  bridge.onLiveChanged(1, eventId);
  assert.deepStrictEqual([songs().length, songs()[1][0], songs()[1][1].text], [2, 'song.current', 'Sfânt e Domnul']);

  // Next -> the verse item (not a song): song.clear, once.
  live.command(1, eventId, { type: 'worship.next' }, undefined, 'owner');
  bridge.onLiveChanged(1, eventId);
  assert.deepStrictEqual([songs().length, songs()[2][0]], [3, 'song.clear']);
  bridge.onLiveChanged(1, eventId);
  assert.strictEqual(songs().length, 3, 'clear is sent only once');

  // dir_out off -> no more song.current.
  bridge.setSwitches(1, eventId, { dirIn: false, dirOut: false });
  live.command(1, eventId, { type: 'worship.goto', itemId: db.prepare("SELECT id FROM setlist_items WHERE event_id = ? AND type = 'song'").pluck().get(eventId), step: 0 }, undefined, 'owner');
  bridge.onLiveChanged(1, eventId);
  assert.strictEqual(songs().filter(([ev]) => ev === 'song.current').length, 2, 'no song.current once dir_out is off');
  db.close();
});

(async () => {
  for (const [name, fn] of asyncTests) {
    try {
      await fn();
      passed += 1;
    } catch (err) {
      failures.push(`${name}\n    ${err.message.split('\n').join('\n    ')}`);
    }
  }
  report();
})();

function report() {
if (failures.length > 0) {
  console.error(`test-lib: ${failures.length} failed, ${passed} passed\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`test-lib: ${passed} tests passed`);
}

testAsync('invite / reset links: 32 random bytes, only the hash stored, 7 days / 1 hour, single use, a new one spends the old, the service mails the link', async () => {
  const Database = require('better-sqlite3');
  const { runMigrations } = require('../lib/db');
  const { createTokenStore, createInviteService, TTL_MS, TOKEN_RE, hashToken } = require('../lib/invites');
  const { createEmail } = require('../lib/email');
  const mem = new Database(':memory:');
  mem.pragma('foreign_keys = ON');
  runMigrations(mem);
  mem.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'Maranata', 0), (2, 'B', 0)").run();
  mem.prepare("INSERT INTO users (id, admin_id, email, name, password_hash, role, created_at) VALUES (1, 1, 'ion@x.ro', 'Ion', 'x', 'member', 0), (2, 2, 'b@x.ro', 'B', 'x', 'owner', 0)").run();
  const tokens = createTokenStore(mem);
  const T0 = 1_700_000_000_000;
  const raw = tokens.create(1, 1, 'invite', T0);
  assert.ok(TOKEN_RE.test(raw), 'raw token: 64 hex chars');
  const stored = mem.prepare('SELECT token_hash, expires_at, used_at FROM user_tokens').all();
  assert.deepStrictEqual(stored, [{ token_hash: hashToken(raw), expires_at: T0 + TTL_MS.invite, used_at: null }], 'the hash, never the token');
  const found = tokens.find('invite', raw, T0 + 1000);
  assert.deepStrictEqual([found.state, found.user_id, found.admin_id, found.name, found.email, found.admin_name], ['valid', 1, 1, 'Ion', 'ion@x.ro', 'Maranata']);
  assert.strictEqual(tokens.find('reset', raw, T0), null, 'another kind: unknown');
  assert.strictEqual(tokens.find('invite', 'zz', T0), null);
  assert.strictEqual(tokens.find('invite', raw.toUpperCase(), T0), null, 'case matters (the regex)');
  assert.strictEqual(tokens.find('invite', raw, T0 + TTL_MS.invite).state, 'expired', 'exactly 7 days later: expired');
  assert.strictEqual(tokens.consume('invite', raw, T0 + TTL_MS.invite), null, 'an expired one cannot be spent');
  const spent = tokens.consume('invite', raw, T0 + 5000);
  assert.strictEqual(spent.user_id, 1);
  assert.strictEqual(tokens.consume('invite', raw, T0 + 6000), null, 'single use');
  assert.strictEqual(tokens.find('invite', raw, T0 + 6000).state, 'used');
  // a new token of the kind spends the older unused one; the other kind is untouched
  const r1 = tokens.create(1, 1, 'reset', T0);
  const i2 = tokens.create(1, 1, 'invite', T0);
  const r2 = tokens.create(1, 1, 'reset', T0);
  assert.strictEqual(tokens.find('reset', r1, T0 + 1).state, 'used', 'the older reset was spent');
  assert.deepStrictEqual([tokens.find('reset', r2, T0 + 1).state, tokens.find('invite', i2, T0 + 1).state], ['valid', 'valid']);
  assert.strictEqual(tokens.find('reset', r2, T0 + TTL_MS.reset).state, 'expired', 'a reset lasts one hour');
  // a deactivated user or church: unknown
  mem.prepare('UPDATE users SET active = 0 WHERE id = 1').run();
  assert.strictEqual(tokens.find('invite', i2, T0 + 1), null);
  mem.prepare('UPDATE users SET active = 1 WHERE id = 1').run();
  mem.prepare('UPDATE admins SET active = 0 WHERE id = 1').run();
  assert.strictEqual(tokens.find('invite', i2, T0 + 1), null);
  mem.prepare('UPDATE admins SET active = 1 WHERE id = 1').run();
  // the service: the email carries the link; the log never does
  const sent = [];
  const logs = [];
  const logger = { info: (m) => logs.push(m), warn: (m) => logs.push(m) };
  const templates = createEmail({ config: { RESEND_API_KEY: '', EMAIL_FROM: '' }, logger }).templates;
  const email = { enabled: true, templates, send: async (adminId, message) => { sent.push({ adminId, ...message }); return 'em_1'; } };
  const service = createInviteService({ db: mem, config: { APP_NAME: 'Worship' }, logger, email });
  await service.invite({ adminId: 1, user: { id: 1, email: 'ion@x.ro', locale: 'en' }, adminName: 'Maranata', invitedBy: 'Ana', baseUrl: 'https://w.example', lang: 'ro' });
  const m = /https:\/\/w\.example\/invite\/([0-9a-f]{64})/.exec(sent[0].text);
  assert.ok(m, 'the link in the text');
  assert.deepStrictEqual([sent[0].adminId, sent[0].to, sent[0].kind, sent[0].userId, /Invitation/.test(sent[0].subject), /Ana added you/.test(sent[0].text), sent[0].html.includes(m[0])], [1, 'ion@x.ro', 'invite', 1, true, true, true], 'the user\'s locale wins over the request language');
  assert.strictEqual(tokens.find('invite', m[1]).state, 'valid');
  assert.strictEqual(tokens.find('invite', i2, T0 + 1).state, 'used', 'the earlier invitation was spent');
  await service.reset({ adminId: 1, user: { id: 1, email: 'ion@x.ro', locale: null }, adminName: 'Maranata', baseUrl: 'https://w.example', lang: 'ro' });
  const r = /https:\/\/w\.example\/reset\/([0-9a-f]{64})/.exec(sent[1].text);
  assert.ok(r && /Resetarea parolei/.test(sent[1].subject) && /o oră/.test(sent[1].text), 'a reset link, RO from the request');
  assert.strictEqual(tokens.find('reset', r[1]).state, 'valid');
  assert.ok(!logs.some((line) => line.includes(m[1]) || line.includes(r[1])), 'no token in the log');
  mem.close();
});

test('migration 027: the presenter role; existing users and sessions keep their rows and view_as', () => {
  const Database = require('better-sqlite3');
  const fs = require('fs');
  const path = require('path');
  const { runMigrations } = require('../lib/db');
  const { EVENT_ROLES, EDITOR_ROLES, SCREEN_ROLES } = require('../lib/events');
  const { validateRole } = require('../lib/team');
  const { VIEW_AS_ROLES } = require('../lib/auth');
  const mem = new Database(':memory:');
  mem.pragma('foreign_keys = ON');
  const dir = path.join(__dirname, '..', 'lib', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files.filter((x) => x < '027')) mem.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
  mem.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'A', 0)").run();
  mem.prepare("INSERT INTO users (id, admin_id, email, name, password_hash, role, created_at, locale, theme) VALUES (1, 1, 'o@x.ro', 'O', 'x', 'owner', 0, 'en', 'light'), (2, 1, 'l@x.ro', 'L', 'x', 'leader', 0, NULL, NULL)").run();
  mem.prepare("INSERT INTO sessions (id, user_id, admin_id, created_at, expires_at, view_as) VALUES ('s1', 1, 1, 0, 9999999999999, 'member'), ('s2', 2, 1, 0, 9999999999999, NULL)").run();
  mem.prepare("INSERT INTO user_tokens (user_id, admin_id, kind, token_hash, created_at, expires_at) VALUES (2, 1, 'invite', 'h', 0, 9999999999999)").run();
  assert.throws(() => mem.prepare("INSERT INTO users (admin_id, email, name, password_hash, role, created_at) VALUES (1, 'p@x.ro', 'P', 'x', 'presenter', 0)").run(), /CHECK/);
  mem.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  for (const f of files.filter((x) => x < '027')) mem.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, 0)').run(f);
  assert.ok(runMigrations(mem).includes('027_role_presenter.sql'));
  assert.deepStrictEqual(mem.prepare('SELECT id, role, locale, theme FROM users ORDER BY id').all(), [{ id: 1, role: 'owner', locale: 'en', theme: 'light' }, { id: 2, role: 'leader', locale: null, theme: null }], 'no user changed');
  assert.deepStrictEqual(mem.prepare('SELECT id, view_as FROM sessions ORDER BY id').all(), [{ id: 's1', view_as: 'member' }, { id: 's2', view_as: null }]);
  assert.strictEqual(mem.prepare('SELECT COUNT(*) FROM user_tokens').pluck().get(), 1, 'references survive');
  mem.prepare("INSERT INTO users (admin_id, email, name, password_hash, role, created_at) VALUES (1, 'p@x.ro', 'P', 'x', 'presenter', 0)").run();
  mem.prepare("UPDATE sessions SET view_as = 'presenter' WHERE id = 's1'").run();
  assert.throws(() => mem.prepare("UPDATE users SET role = 'admin' WHERE id = 2").run(), /CHECK/);
  // one definition each: the presenter has the leader's rights everywhere, never the screens
  assert.deepStrictEqual(EVENT_ROLES, ['owner', 'presenter', 'leader', 'operator']);
  assert.strictEqual(EDITOR_ROLES, EVENT_ROLES);
  assert.deepStrictEqual(SCREEN_ROLES, ['owner', 'operator']);
  assert.deepStrictEqual(VIEW_AS_ROLES, ['presenter', 'leader', 'operator', 'member']);
  assert.deepStrictEqual(validateRole('presenter', (k) => k), { value: 'presenter' });
  mem.close();
});

test('static link keys (migration 039): 12 safe characters, unique, on every screen; older rows get one; the key finds the screen until revoked', () => {
  const Database = require('better-sqlite3');
  const { runMigrations } = require('../lib/db');
  const S = require('../lib/screens');
  const key = S.newLinkKey();
  assert.ok(S.isLinkKey(key) && key.length === 12 && !/[01oli]/.test(key) && key !== S.newLinkKey(), 'no ambiguous characters');
  assert.ok(!S.isLinkKey('abc') && !S.isLinkKey(key.toUpperCase()) && !S.isLinkKey(null));
  assert.strictEqual(S.linkPath(key), `/screen/${key}`);
  const mem = new Database(':memory:');
  mem.pragma('foreign_keys = ON');
  runMigrations(mem);
  mem.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'A', 0), (2, 'B', 0)").run();
  mem.prepare("INSERT INTO screens (id, admin_id, name, token_hash, created_at) VALUES (1, 1, 'Vechi', 'h1', 0), (2, 2, 'Al altuia', 'h2', 0)").run(); // from before the migration
  const screens = S.createScreenStore(mem);
  const old = screens.get(1, 1);
  assert.ok(S.isLinkKey(old.linkKey) && old.link === `/screen/${old.linkKey}`, 'an older screen gets its key when the store opens');
  assert.notStrictEqual(old.linkKey, screens.get(2, 2).linkKey);
  assert.throws(() => mem.prepare('UPDATE screens SET link_key = ? WHERE id = 2').run(old.linkKey), /UNIQUE/);
  const made = screens.create(1, null, 'Balcon');
  assert.ok(S.isLinkKey(made.linkKey) && made.name === 'Balcon' && made.safeMargin === null);
  assert.deepStrictEqual(screens.list(1).map((s) => s.name), ['Balcon', 'Vechi'], 'listed at once (no pairing)');
  assert.strictEqual(screens.findByToken('f'.repeat(64)), null, 'no token ever matches a link-only screen');
  const found = screens.findByKey(made.linkKey);
  assert.deepStrictEqual([found.id, found.adminId, found.adminName, found.adminActive], [made.id, 1, 'A', true]);
  assert.strictEqual(screens.identify({ key: made.linkKey }).id, made.id);
  assert.strictEqual(screens.identify({ token: 'x' }), null);
  assert.strictEqual(screens.findByKey(made.linkKey.toUpperCase()), null);
  assert.strictEqual(screens.findOrCreate(1, null, 'Balcon').id, made.id, 'the console window: one screen per name');
  assert.strictEqual(screens.findOrCreate(1, null, 'Scenă').id > made.id, true);
  assert.strictEqual(screens.findOrCreate(2, null, 'Balcon').adminId, undefined); // another admin: its own screen
  assert.notStrictEqual(screens.findOrCreate(2, null, 'Balcon').id, made.id);
  assert.strictEqual(screens.revoke(1, made.id), true);
  assert.strictEqual(screens.findByKey(made.linkKey), null, 'revoked: the link is dead');
  mem.close();
});

test('safe margin: 0-12 % parsed, 5 by default; on every frame; a screen may override (migration 028)', () => {
  const Database = require('better-sqlite3');
  const { runMigrations } = require('../lib/db');
  const { createAdminSettings, parseSafeMargin, SAFE_MARGIN } = require('../lib/admin-settings');
  const { createScreenStore } = require('../lib/screens');
  const { projectorFrame } = require('../lib/projector');
  assert.deepStrictEqual([parseSafeMargin('8'), parseSafeMargin(0), parseSafeMargin(12), parseSafeMargin(13), parseSafeMargin(-1), parseSafeMargin('x'), parseSafeMargin(2.5), parseSafeMargin(null)], [8, 0, 12, null, null, null, null, null]);
  assert.deepStrictEqual(SAFE_MARGIN, { min: 0, max: 12, fallback: 5 });
  const mem = new Database(':memory:');
  mem.pragma('foreign_keys = ON');
  runMigrations(mem);
  mem.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'A', 0)").run();
  const settings = createAdminSettings(mem);
  assert.strictEqual(settings.safeMargin(1), 5, 'the default');
  settings.set(1, 'safe_margin', '8');
  assert.strictEqual(settings.safeMargin(1), 8);
  settings.set(1, 'safe_margin', '40');
  assert.strictEqual(settings.safeMargin(1), 5, 'a bad stored value falls back');
  // frames: the margin given, else 5; a bad one -> 5
  assert.strictEqual(projectorFrame(null, null, null, { safeMargin: 8 }).safeMargin, 8);
  assert.strictEqual(projectorFrame(null, null, null, {}).safeMargin, 5);
  assert.strictEqual(projectorFrame(null, null, null, { safeMargin: 99 }).safeMargin, 5);
  const live = { status: 'live', version: 3, eventId: 1, projector: { source: 'black', follows: 'worship' }, worship: { itemId: null, step: 0 }, video: null, clock: null };
  assert.deepStrictEqual([projectorFrame(live, { items: [] }, new Map(), { safeMargin: 0 }).kind, projectorFrame(live, { items: [] }, new Map(), { safeMargin: 0 }).safeMargin], ['black', 0], '0 is a value, not a fallback');
  // the screen's own margin
  const screens = createScreenStore(mem);
  mem.prepare("INSERT INTO screens (id, admin_id, name, token_hash, created_at) VALUES (1, 1, 'S', 'h', 0)").run();
  assert.strictEqual(screens.get(1, 1).safeMargin, null, 'null: the church default');
  assert.strictEqual(screens.setSafeMargin(1, 1, 8), true);
  assert.strictEqual(screens.get(1, 1).safeMargin, 8);
  assert.throws(() => mem.prepare('UPDATE screens SET safe_margin = 13 WHERE id = 1').run(), /CHECK/);
  assert.strictEqual(screens.setSafeMargin(1, 1, null), true);
  assert.strictEqual(screens.list(1)[0].safeMargin, null);
  assert.strictEqual(screens.setSafeMargin(2, 1, 3), false, 'another admin: nothing');
  mem.close();
});

test('custom roles (migration 045): rights, the live role, create / change / delete, the people follow', () => {
  const Database = require('better-sqlite3');
  const { runMigrations } = require('../lib/db');
  const R = require('../lib/roles');
  assert.deepStrictEqual(R.normalizePerms(['screens', 'media', 'bogus', 'media']), ['media', 'live', 'screens'], 'screens brings live, order kept, unknown dropped');
  assert.deepStrictEqual(R.parsePerms('schedule,library'), ['library', 'schedule']);
  assert.deepStrictEqual(['owner', 'presenter', 'leader', 'operator', 'member'].map((r) => R.liveRoleOf(r, R.BUILTIN_PERMS[r])), ['owner', 'presenter', 'leader', 'operator', 'member'], 'the built-in roles keep their live role');
  assert.deepStrictEqual([R.liveRoleOf('member', ['live']), R.liveRoleOf('member', ['live', 'screens']), R.liveRoleOf('operator', ['live']), R.liveRoleOf('leader', ['media'])], ['presenter', 'operator', 'presenter', 'member']);
  assert.strictEqual(R.seesAllEvents({ perms: ['live'] }), true);
  assert.strictEqual(R.seesAllEvents({ perms: ['media', 'schedule'] }), false);
  const tt = (k) => k;
  assert.ok(R.validateRoleInput({ name: 'X', base: 'owner', perms: [] }, tt).error, 'never an owner');
  assert.ok(R.validateRoleInput({ name: '', base: 'member', perms: [] }, tt).error);
  assert.ok(R.validateRoleInput({ name: 'X', base: 'member', perms: ['root'] }, tt).error);
  assert.deepStrictEqual(R.validateRoleInput({ perms: ['screens'] }, tt, { partial: true }).value, { perms: ['live', 'screens'] });

  const mem = new Database(':memory:');
  mem.pragma('foreign_keys = ON');
  runMigrations(mem);
  mem.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'A', 0), (2, 'B', 0)").run();
  mem.prepare("INSERT INTO users (id, admin_id, email, name, password_hash, role, created_at) VALUES (1, 1, 'o@x.ro', 'O', 'x', 'owner', 0), (2, 1, 'm@x.ro', 'M', 'x', 'member', 0), (3, 2, 'b@x.ro', 'B', 'x', 'member', 0)").run();
  const S = R.createRoleStore(mem);
  const sound = S.create(1, { name: 'Sunet', emoji: '🎚️', base: 'member', perms: ['media'] });
  assert.deepStrictEqual([sound.name, sound.emoji, sound.base, sound.perms], ['Sunet', '🎚️', 'member', ['media']]);
  assert.strictEqual(S.get(2, sound.id), null, 'another admin');
  assert.strictEqual(S.setUserRole(1, 2, { customRoleId: sound.id }), true);
  assert.strictEqual(S.setUserRole(2, 3, { customRoleId: sound.id }), false, 'another admin\'s role');
  assert.strictEqual(S.setUserRole(1, 1, { customRoleId: sound.id }), true);
  const userRow = (id) => mem.prepare('SELECT role, custom_role_id FROM users WHERE id = ?').get(id);
  assert.deepStrictEqual(userRow(1), { role: 'owner', custom_role_id: null }, 'the owner never takes a custom role');
  assert.deepStrictEqual(userRow(2), { role: 'member', custom_role_id: sound.id });
  assert.strictEqual(S.list(1)[0].users, 1);
  S.change(1, sound.id, { base: 'operator', perms: ['screens'] });
  assert.deepStrictEqual(userRow(2), { role: 'operator', custom_role_id: sound.id }, 'the people follow the new base');
  assert.deepStrictEqual(S.get(1, sound.id).perms, ['live', 'screens']);
  assert.strictEqual(S.destroy(2, sound.id), false, 'another admin');
  assert.strictEqual(S.destroy(1, sound.id), true);
  assert.deepStrictEqual(userRow(2), { role: 'member', custom_role_id: null }, 'deleted: a member, never the base\'s built-in rights');
});

testAsync('ai (lib/ai.js): off without a key; a draft and an answer through the SDK shape; usage and the monthly cap; errors and refusals mapped', async () => {
  const Database = require('better-sqlite3');
  const { runMigrations } = require('../lib/db');
  const { createAi, AiError } = require('../lib/ai');
  const mem = new Database(':memory:');
  mem.pragma('foreign_keys = ON');
  runMigrations(mem);
  mem.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'A', 0)").run();
  const logger = { info() {}, warn() {}, error() {} };
  const off = createAi({ config: { ANTHROPIC_API_KEY: '', AI_MONTHLY_CALLS: 5 }, db: mem, logger });
  assert.deepStrictEqual(off.status(1), { enabled: false, model: null, used: 0, limit: 5 });
  await assert.rejects(off.draftGuide(1, { title: 'x' }), (e) => e instanceof AiError && e.code === 'aiDisabled');
  // a stand-in for the SDK client
  const sent = [];
  let reply = null;
  class Fake {
    constructor(opts) { this.opts = opts; this.beta = { messages: { create: async (req) => { sent.push(req); if (reply instanceof Error) throw reply; return reply; } } }; }
  }
  Fake.APIError = class extends Error { constructor(status, msg) { super(msg); this.status = status; } };
  Fake.AuthenticationError = class extends Fake.APIError {};
  Fake.PermissionDeniedError = class extends Fake.APIError {};
  Fake.RateLimitError = class extends Fake.APIError {};
  Fake.APIConnectionError = class extends Fake.APIError {};
  const ai = createAi({ config: { ANTHROPIC_API_KEY: 'k', AI_MODEL: 'claude-opus-5-5', AI_MONTHLY_CALLS: 3 }, db: mem, logger, Client: Fake });
  const answer = (obj, extra = {}) => ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 1200, output_tokens: 300 }, content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(obj) }], ...extra });
  reply = answer({ summary: 'Pornirea sunetului duminica.', steps: [{ title: '  Pornește   prelungitorul ', body: 'Butonul roșu.' }, { title: '', body: 'x' }], problems: [{ title: 'Nu se aude microfonul', body: 'Bateria.' }] });
  const draft = await ai.draftGuide(1, { lang: 'ro', title: 'Sunet', description: 'X32', positions: ['Sunet'], images: [{ mediaType: 'image/jpeg', data: 'AAAA' }] });
  assert.deepStrictEqual(draft, { summary: 'Pornirea sunetului duminica.', steps: [{ title: 'Pornește prelungitorul', body: 'Butonul roșu.' }], problems: [{ title: 'Nu se aude microfonul', body: 'Bateria.' }] }, 'cleaned: titles squeezed, empty ones dropped');
  const req = sent[0];
  assert.deepStrictEqual([req.model, req.fallbacks, req.betas, req.output_config.effort, req.output_config.format.type], ['claude-opus-5-5', 'default', ['server-side-fallback-2026-07-01'], 'medium', 'json_schema']);
  assert.deepStrictEqual(req.messages[0].content.map((c) => c.type), ['image', 'text'], 'the photos first, then the text');
  assert.ok(/Romanian/.test(req.messages[0].content[1].text) && /X32/.test(req.messages[0].content[1].text));
  assert.strictEqual(req.thinking, undefined, 'no thinking setting on this model (always on)');
  // an answer from a guide only
  reply = answer({ answer: 'Verifică bateria (problema „Nu se aude microfonul”).', covered: true });
  const ask = await ai.askGuide(1, { lang: 'ro', guide: { title: 'Sunet', summary: '' }, items: [{ kind: 'step', title: 'Pornește', body: '' }, { kind: 'problem', title: 'Nu se aude', body: 'Bateria' }], question: 'nu se aude micul 2' });
  assert.deepStrictEqual(ask, { answer: 'Verifică bateria (problema „Nu se aude microfonul”).', covered: true });
  assert.ok(/<guide title="Sunet">/.test(sent[1].messages[0].content[0].text) && sent[1].output_config.effort === 'low');
  assert.deepStrictEqual(ai.status(1), { enabled: true, model: 'claude-opus-5-5', used: 2, limit: 3 });
  assert.deepStrictEqual(mem.prepare('SELECT calls, input_tokens, output_tokens FROM ai_usage WHERE admin_id = 1').get(), { calls: 2, input_tokens: 2400, output_tokens: 600 });
  // a refusal counts and says so; then the cap
  reply = answer({}, { stop_reason: 'refusal' });
  await assert.rejects(ai.askGuide(1, { guide: { title: 'x' }, items: [], question: 'q?' }), (e) => e.code === 'aiRefused');
  await assert.rejects(ai.askGuide(1, { guide: { title: 'x' }, items: [], question: 'q?' }), (e) => e.code === 'aiLimit', 'the monthly cap');
  // errors mapped (a fresh church under the cap)
  mem.prepare("INSERT INTO admins (id, name, created_at) VALUES (2, 'B', 0)").run();
  for (const [err, code] of [[new Fake.AuthenticationError(401, 'bad key'), 'aiKey'], [new Fake.RateLimitError(429, 'slow'), 'aiBusy'], [new Fake.APIConnectionError(0, 'net'), 'aiOffline'], [new Fake.APIError(529, 'overloaded'), 'aiBusy'], [new Fake.APIError(400, 'bad'), 'aiFailed']]) {
    reply = err;
    await assert.rejects(ai.askGuide(2, { guide: { title: 'x' }, items: [], question: 'q?' }), (e) => e.code === code, code);
  }
  reply = { stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: 'not json' }] };
  await assert.rejects(ai.askGuide(2, { guide: { title: 'x' }, items: [], question: 'q?' }), (e) => e.code === 'aiFailed');
});

testAsync('guides (migration 046): steps and problems in order, positions, photos resized to WebP, delete takes the photos', async () => {
  const Database = require('better-sqlite3');
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const { runMigrations } = require('../lib/db');
  const G = require('../lib/guides');
  const tt = (k) => k;
  assert.ok(G.validateGuide({ title: '' }, tt).error);
  assert.deepStrictEqual(G.validateGuide({ title: '  Pornirea   sunetului ', summary: ' Duminica ', positionIds: [2, 2, 3] }, tt).value, { title: 'Pornirea sunetului', summary: 'Duminica', positionIds: [2, 3] });
  assert.ok(G.validateItem({ kind: 'other', title: 'x' }, tt).error);
  assert.ok(G.validateItem({ kind: 'step', title: 'x', body: 'y'.repeat(G.MAX_BODY + 1) }, tt).error);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-guides-'));
  const mem = new Database(':memory:');
  mem.pragma('foreign_keys = ON');
  runMigrations(mem);
  mem.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'A', 0), (2, 'B', 0)").run();
  mem.prepare("INSERT INTO positions (id, admin_id, name, sort) VALUES (1, 1, 'Sunet', 0), (2, 2, 'Altul', 0)").run();
  const S = G.createGuideStore(mem, dataDir);
  const made = S.create(1, null, { title: 'Pornirea sunetului', emoji: '🎚️', summary: '', positionIds: [1, 2] });
  assert.deepStrictEqual(made.guide.positionIds, [1], 'only this church\'s positions');
  const gid = made.guide.id;
  const a = S.addItem(1, gid, { kind: 'step', title: 'Pornește prelungitorul' });
  const b = S.addItem(1, gid, { kind: 'step', title: 'Pornește mixerul' });
  const p = S.addItem(1, gid, { kind: 'problem', title: 'Nu se aude microfonul', body: 'Verifică bateria.\nApoi canalul 3.' });
  assert.strictEqual(S.addItem(2, gid, { kind: 'step', title: 'x' }), null, 'another church');
  assert.deepStrictEqual(S.get(1, gid).items.map((i) => i.title), ['Pornește prelungitorul', 'Pornește mixerul', 'Nu se aude microfonul'], 'steps first, then problems');
  assert.strictEqual(S.reorder(1, gid, 'step', [b.id, a.id]), true);
  assert.strictEqual(S.reorder(1, gid, 'step', [b.id]), false, 'every id of the kind');
  assert.deepStrictEqual(S.get(1, gid).items.filter((i) => i.kind === 'step').map((i) => i.id), [b.id, a.id]);
  assert.deepStrictEqual(S.list(1).map((g) => [g.title, g.steps, g.problems]), [['Pornirea sunetului', 2, 1]]);
  assert.deepStrictEqual(S.list(2), []);
  // a photo: any image -> WebP, at most 1600 px
  const sharp = require('sharp');
  const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 100, b: 50 } } }).jpeg().toBuffer();
  const webp = await G.toWebp(big);
  const meta = await sharp(webp).metadata();
  assert.deepStrictEqual([meta.format, meta.width, meta.height], ['webp', 1600, 1067]);
  await assert.rejects(G.toWebp(Buffer.from('not an image')));
  const withPhoto = S.saveImage(1, gid, p.id, webp);
  const file = withPhoto.image.split('/').pop();
  assert.ok(G.isImageFile(file) && S.findImage(file).adminId === 1);
  assert.ok(fs.existsSync(S.findImage(file).path));
  assert.strictEqual(S.findImage('../../etc/passwd'), null);
  assert.strictEqual(S.destroy(2, gid), false, 'another church');
  const where = S.findImage(file).path;
  assert.strictEqual(S.destroy(1, gid), true);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(!fs.existsSync(where), 'the photo goes with the guide');
  assert.strictEqual(S.get(1, gid), null);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('positions (migration 029): seeded once per admin, add / rename / reorder / deactivate, the users\' usual positions', () => {
  const Database = require('better-sqlite3');
  const { runMigrations } = require('../lib/db');
  const { createPositionStore, DEFAULT_POSITIONS, DEFAULT_EMOJI, guessEmoji, validatePositionName, validatePositionEmoji } = require('../lib/positions');
  const mem = new Database(':memory:');
  mem.pragma('foreign_keys = ON');
  runMigrations(mem);
  mem.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'A', 0), (2, 'B', 0)").run();
  mem.prepare("INSERT INTO users (id, admin_id, email, name, password_hash, role, created_at) VALUES (1, 1, 'a@x.ro', 'A', 'x', 'member', 0), (2, 2, 'b@x.ro', 'B', 'x', 'member', 0)").run();
  const P = createPositionStore(mem);
  assert.deepStrictEqual(P.list(1).map((p) => p.name), DEFAULT_POSITIONS, 'seeded on first use');
  assert.strictEqual(P.list(1).length, 7, 'not seeded twice');
  assert.strictEqual(P.list(2).length, 7, 'per admin');
  const violin = P.create(1, 'Vioară');
  assert.deepStrictEqual([violin.name, violin.sort, violin.active], ['Vioară', 7, true]);
  assert.deepStrictEqual(P.update(1, violin.id, { name: 'Vioara', active: false }), { id: violin.id, name: 'Vioara', emoji: '🎻', sort: 7, active: false });
  assert.strictEqual(P.update(2, violin.id, { name: 'x' }), null, 'another admin');
  // emoji (migration 044): the defaults have theirs, new ones a guess from the name, changeable
  assert.deepStrictEqual(P.list(1).slice(0, 7).map((p) => p.emoji), DEFAULT_POSITIONS.map((n) => DEFAULT_EMOJI[n]));
  assert.deepStrictEqual([guessEmoji('Bass'), guessEmoji('Sunet'), guessEmoji('Drums'), guessEmoji('Altceva')], ['🎸', '🎚️', '🥁', null]);
  assert.strictEqual(P.create(2, 'Lumini', null).emoji, null, 'null = none');
  assert.strictEqual(P.update(1, violin.id, { emoji: '🎷' }).emoji, '🎷');
  const tt = (k) => k;
  assert.deepStrictEqual(['🎤', ' 🎙️ ', '👩🏽‍🎤', '', null].map((v) => validatePositionEmoji(v, tt).value), ['🎤', '🎙️', '👩🏽‍🎤', null, null]);
  assert.ok(['abc', '🎤x', '1', 42, '🎤🎤🎤🎤🎤🎤🎤🎤🎤'].every((v) => validatePositionEmoji(v, tt).error), 'letters, digits, too long: refused');
  assert.deepStrictEqual(P.list(1, { activeOnly: true }).map((p) => p.name).length, 7, 'inactive ones out of the pickers');
  const ids = P.list(1).map((p) => p.id);
  assert.strictEqual(P.reorder(1, [ids[1], ids[0], ...ids.slice(2)]), true);
  assert.deepStrictEqual(P.list(1).slice(0, 2).map((p) => p.name), ['Chitară', 'Voce']);
  assert.strictEqual(P.reorder(1, ids.slice(1)), false, 'every id, once');
  assert.strictEqual(P.reorder(1, [...ids.slice(1), ids[1]]), false);
  // the users' positions: only active ones of the same admin
  assert.strictEqual(P.setForUser(1, 1, [ids[0], ids[2], violin.id, 999]), true);
  assert.deepStrictEqual(P.ofUserIds(1, 1), [ids[0], ids[2]], 'in the positions\' order (Voce now second, Pian third), the inactive and unknown dropped');
  assert.deepStrictEqual([...P.byUser(1).entries()], [[1, [ids[0], ids[2]]]]);
  assert.strictEqual(P.setForUser(1, 2, [ids[0]]), false, 'a user of another admin');
  assert.ok(validatePositionName('   ', (k) => k).error && validatePositionName('x'.repeat(41), (k) => k).error);
  assert.deepStrictEqual(validatePositionName('  Vioară   solo ', (k) => k), { value: 'Vioară solo' });
  mem.close();
});

test('assignments (migration 030): replace keeps answers, answers are the person\'s own, a copy resets to pending, summary', () => {
  const Database = require('better-sqlite3');
  const { runMigrations } = require('../lib/db');
  const { createAssignmentStore, ASSIGN_ROLES } = require('../lib/assignments');
  const { createPositionStore } = require('../lib/positions');
  const mem = new Database(':memory:');
  mem.pragma('foreign_keys = ON');
  runMigrations(mem);
  mem.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'A', 0), (2, 'B', 0)").run();
  mem.prepare("INSERT INTO users (id, admin_id, email, name, password_hash, role, created_at, active) VALUES (1, 1, 'a@x.ro', 'Ana', 'x', 'owner', 0, 1), (2, 1, 'b@x.ro', 'Bob', 'x', 'member', 0, 1), (3, 1, 'c@x.ro', 'Cezar', 'x', 'member', 0, 0), (4, 2, 'd@x.ro', 'Dan', 'x', 'member', 0, 1)").run();
  mem.prepare("INSERT INTO events (id, admin_id, name, event_date, status, created_at, updated_at) VALUES (1, 1, 'E', '2026-10-04', 'planned', 0, 0), (2, 1, 'T', '2026-10-04', 'planned', 0, 0)").run();
  const positions = createPositionStore(mem).list(1);
  const [voce, chitara] = positions.map((p) => p.id);
  const other = createPositionStore(mem).list(2)[0].id;
  const A = createAssignmentStore(mem);
  assert.deepStrictEqual(ASSIGN_ROLES, ['owner', 'leader']);
  assert.deepStrictEqual(A.replace(1, 1, [{ userId: 2, positionId: voce }, { userId: 1, positionId: chitara }], 1), { ok: true, added: 2, removed: 0 });
  assert.deepStrictEqual(A.replace(1, 1, [{ userId: 3, positionId: voce }], 1), { error: 'userInvalid' }, 'a deactivated person');
  assert.deepStrictEqual(A.replace(1, 1, [{ userId: 4, positionId: voce }], 1), { error: 'userInvalid' }, 'another admin\'s person');
  assert.deepStrictEqual(A.replace(1, 1, [{ userId: 2, positionId: other }], 1), { error: 'positionInvalid' });
  let rows = A.list(1, 1);
  assert.deepStrictEqual(rows.map((r) => [r.userName, r.positionName, r.status]), [['Bob', 'Voce', 'pending'], ['Ana', 'Chitară', 'pending']], 'in the positions\' order');
  // the answer: only the person's own row
  const bob = rows.find((r) => r.userId === 2);
  assert.strictEqual(A.answer(1, 1, bob.id, 1, 'declined', 'x'), null, 'not Ana\'s row');
  assert.strictEqual(A.answer(1, 1, bob.id, 2, 'pending', ''), null);
  assert.deepStrictEqual([A.answer(1, 1, bob.id, 2, 'declined', 'Sunt plecat').status, A.get(1, 1, bob.id).note], ['declined', 'Sunt plecat']);
  // replacing the list keeps Bob's row (and answer), drops Ana's, adds Bob on guitar
  assert.deepStrictEqual(A.replace(1, 1, [{ userId: 2, positionId: voce }, { userId: 2, positionId: chitara }], 1), { ok: true, added: 1, removed: 1 });
  rows = A.list(1, 1);
  assert.deepStrictEqual(rows.map((r) => [r.userName, r.positionName, r.status]), [['Bob', 'Voce', 'declined'], ['Bob', 'Chitară', 'pending']]);
  assert.deepStrictEqual(A.summary(rows), { accepted: 0, pending: 1, declined: 1, total: 2 });
  assert.deepStrictEqual(A.forUser(1, 2, 1).map((r) => [r.positionName, r.status]), [['Voce', 'declined'], ['Chitară', 'pending']]);
  assert.deepStrictEqual(A.assignedUserIds(1, 1), [2]);
  A.markSent(1, rows.map((r) => r.id), 5);
  assert.ok(A.list(1, 1).every((r) => r.notifiedAt === 5));
  // a copy: pending, not sent
  assert.strictEqual(A.copyFrom(1, 1, 2, 1), 2);
  assert.deepStrictEqual(A.list(1, 2).map((r) => [r.status, r.notifiedAt, r.note]), [['pending', null, null], ['pending', null, null]]);
  mem.close();
});

test('unavailability (migration 031): own ranges, validation, who is busy on a date, upcoming per user', () => {
  const Database = require('better-sqlite3');
  const { runMigrations } = require('../lib/db');
  const { createUnavailabilityStore, validateRange } = require('../lib/unavailability');
  const mem = new Database(':memory:');
  mem.pragma('foreign_keys = ON');
  runMigrations(mem);
  mem.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'A', 0)").run();
  mem.prepare("INSERT INTO users (id, admin_id, email, name, password_hash, role, created_at) VALUES (1, 1, 'a@x.ro', 'A', 'x', 'member', 0), (2, 1, 'b@x.ro', 'B', 'x', 'member', 0)").run();
  const U = createUnavailabilityStore(mem);
  const k = (key) => key;
  assert.deepStrictEqual(validateRange({ dateFrom: '2026-10-10' }, k), { value: { dateFrom: '2026-10-10', dateTo: '2026-10-10', note: '' } }, 'one day');
  assert.deepStrictEqual(validateRange({ dateFrom: '2026-10-10', dateTo: '2026-10-12', note: ' Concediu ' }, k).value, { dateFrom: '2026-10-10', dateTo: '2026-10-12', note: 'Concediu' });
  assert.ok(validateRange({ dateFrom: '2026-10-12', dateTo: '2026-10-10' }, k).error && validateRange({ dateFrom: '2026-13-40' }, k).error && validateRange({}, k).error);
  const a = U.add(1, 1, { dateFrom: '2026-10-10', dateTo: '2026-10-12', note: 'Concediu' });
  U.add(1, 1, { dateFrom: '2026-09-01', dateTo: '2026-09-02', note: '' });
  U.add(1, 2, { dateFrom: '2026-10-11', dateTo: '2026-10-11', note: '' });
  assert.deepStrictEqual(U.listForUser(1, 1, '2026-09-05').map((r) => r.dateFrom), ['2026-10-10'], 'past ranges are gone from the list');
  assert.deepStrictEqual([...U.onDate(1, '2026-10-11').keys()], [1, 2]);
  assert.strictEqual(U.onDate(1, '2026-10-11').get(1).note, 'Concediu');
  assert.deepStrictEqual([...U.onDate(1, '2026-10-13').keys()], []);
  assert.deepStrictEqual([...U.byUser(1, '2026-10-11').keys()], [1, 2]);
  assert.strictEqual(U.removeOwn(1, 2, a.id), false, 'not theirs');
  assert.strictEqual(U.removeOwn(1, 1, a.id), true);
  assert.deepStrictEqual([...U.onDate(1, '2026-10-11').keys()], [2]);
  assert.throws(() => mem.prepare("INSERT INTO unavailability (admin_id, user_id, date_from, date_to) VALUES (1, 1, '2026-10-12', '2026-10-10')").run(), /CHECK/);
  mem.close();
});

testAsync('web push (lib/push.js): keys, VAPID header, aes128gcm round trip, delivery with 410 cleanup, disabled without keys', async () => {
  const crypto = require('crypto');
  const Database = require('better-sqlite3');
  const { runMigrations } = require('../lib/db');
  const P = require('../lib/push');
  const keys = P.generateVapidKeys();
  assert.ok(/^[A-Za-z0-9_-]{87}$/.test(keys.publicKey) && Buffer.from(keys.privateKey, 'base64url').length === 32, 'a 65-byte point and a 32-byte scalar');
  const key = P.vapidKey(keys.publicKey, keys.privateKey);
  assert.ok(key, 'a usable private key');
  assert.strictEqual(P.vapidKey('x', 'y'), null);
  const header = P.vapidHeader('https://push.example/send/abc', 'mailto:a@x.ro', keys.publicKey, key, 1_700_000_000_000);
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  assert.ok(m && m[2] === keys.publicKey);
  const [h, p, sig] = m[1].split('.');
  assert.deepStrictEqual(JSON.parse(Buffer.from(h, 'base64url')), { typ: 'JWT', alg: 'ES256' });
  assert.deepStrictEqual(JSON.parse(Buffer.from(p, 'base64url')), { aud: 'https://push.example', exp: 1_700_000_000 + 12 * 3600, sub: 'mailto:a@x.ro' });
  const pubKey = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: keys.x, y: keys.y } });
  assert.strictEqual(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: pubKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')), true, 'the JWT verifies with the public key');
  // the browser side: a P-256 pair and a 16-byte auth secret
  const client = crypto.createECDH('prime256v1');
  client.generateKeys();
  const sub = { endpoint: 'https://push.test/send/1', keys: { p256dh: client.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
  const message = P.encrypt('{"title":"Salut"}', sub.keys);
  assert.strictEqual(message.readUInt32BE(16), 4096);
  assert.strictEqual(message[20], 65);
  assert.strictEqual(P.decrypt(message, client.getPrivateKey(), sub.keys.auth), '{"title":"Salut"}', 'round trip');
  assert.notStrictEqual(P.encrypt('x', sub.keys).toString('hex'), P.encrypt('x', sub.keys).toString('hex'), 'a fresh salt and key each time');
  assert.ok(P.validSubscription(sub) && !P.validSubscription({ endpoint: 'http://evil.example/x', keys: sub.keys }) && !P.validSubscription({ endpoint: sub.endpoint, keys: { p256dh: 'short', auth: sub.keys.auth } }));
  // delivery
  const mem = new Database(':memory:');
  mem.pragma('foreign_keys = ON');
  runMigrations(mem);
  mem.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'A', 0)").run();
  mem.prepare("INSERT INTO users (id, admin_id, email, name, password_hash, role, created_at) VALUES (1, 1, 'a@x.ro', 'A', 'x', 'member', 0)").run();
  const calls = [];
  let status = 201;
  const logs = [];
  const logger = { info: (x) => logs.push(x), warn: (x) => logs.push(x), error: (x) => logs.push(x) };
  const fetchMock = async (url, opts) => { calls.push({ url, headers: opts.headers, body: opts.body }); return new Response('', { status: typeof status === 'function' ? status(url) : status }); };
  const off = P.createPush({ db: mem, config: {}, logger, fetch: fetchMock });
  assert.deepStrictEqual([off.enabled, off.publicKey, await off.sendToUser(1, 1, { title: 'x' })], [false, null, { sent: 0, failed: 0, removed: 0 }]);
  const push = P.createPush({ db: mem, config: { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:a@x.ro' }, logger, fetch: fetchMock });
  assert.strictEqual(push.enabled, true);
  assert.ok(push.subscribe(1, 1, sub, 'UA/1'));
  assert.ok(push.subscribe(1, 1, { endpoint: 'https://push.test/send/gone', keys: sub.keys }, 'UA/2'));
  assert.strictEqual(push.subscribe(1, 1, { endpoint: 'ftp://x', keys: sub.keys }), null);
  assert.strictEqual(push.listForUser(1, 1).length, 2);
  assert.strictEqual(push.subscribe(1, 1, sub, 'UA/1b').id, push.listForUser(1, 1)[0].id, 'the same endpoint again updates the row');
  status = (url) => (url.endsWith('/gone') ? 410 : 201);
  const out = await push.sendToUser(1, 1, { title: 'Ești programat', body: 'Chitară', url: '/events/1', tag: 'assigned', id: 7 });
  assert.deepStrictEqual(out, { sent: 1, failed: 0, removed: 1 }, 'a 410 removes the subscription');
  assert.deepStrictEqual(push.listForUser(1, 1).map((r) => r.endpoint), ['https://push.test/send/1']);
  const call = calls.find((c) => c.url === 'https://push.test/send/1');
  assert.deepStrictEqual([call.headers['Content-Encoding'], call.headers.TTL, call.headers.Urgency, /^vapid t=/.test(call.headers.Authorization)], ['aes128gcm', '86400', 'normal', true]);
  assert.deepStrictEqual(JSON.parse(P.decrypt(call.body, client.getPrivateKey(), sub.keys.auth)), { title: 'Ești programat', body: 'Chitară', url: '/events/1', tag: 'assigned', id: 7 }, 'the browser would read the small payload');
  status = 500;
  assert.deepStrictEqual(await push.sendToUser(1, 1, { title: 'x' }), { sent: 0, failed: 1, removed: 0 });
  assert.strictEqual(push.listForUser(1, 1)[0].failedCount, 1, 'other failures only count');
  assert.strictEqual(push.unsubscribe(1, 1, 'https://push.test/send/1'), true);
  assert.strictEqual(push.hasSubscription(1, 1), false);
  mem.close();
});

testAsync('notifications (migration 033): rows in the person\'s language + push when subscribed; prefs; declined -> leaders; setlist throttle; reminders once', async () => {
  const Database = require('better-sqlite3');
  const { runMigrations } = require('../lib/db');
  const { createNotifications, KINDS } = require('../lib/notifications');
  const mem = new Database(':memory:');
  mem.pragma('foreign_keys = ON');
  runMigrations(mem);
  mem.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'A', 0)").run();
  mem.prepare("INSERT INTO admin_settings (admin_id, key, value) VALUES (1, 'timezone', 'Europe/Bucharest')").run();
  mem.prepare("INSERT INTO users (id, admin_id, email, name, password_hash, role, created_at, locale) VALUES (1, 1, 'o@x.ro', 'Ana', 'x', 'owner', 0, 'ro'), (2, 1, 'l@x.ro', 'Lider', 'x', 'leader', 0, 'en'), (3, 1, 'm@x.ro', 'Maria', 'x', 'member', 0, 'en'), (4, 1, 'p@x.ro', 'Petru', 'x', 'member', 0, NULL)").run();
  mem.prepare("INSERT INTO events (id, admin_id, name, event_date, start_time, status, created_at, updated_at) VALUES (1, 1, 'Duminică', '2026-10-04', '10:00', 'planned', 0, 0)").run();
  const pos = mem.prepare("INSERT INTO positions (admin_id, name, sort) VALUES (1, 'Chitară', 0)").run().lastInsertRowid;
  mem.prepare("INSERT INTO event_assignments (event_id, admin_id, user_id, position_id, status, created_at) VALUES (1, 1, 3, ?, 'pending', 0), (1, 1, 4, ?, 'accepted', 0), (1, 1, 2, ?, 'declined', 0)").run(pos, pos, pos);
  const pushed = [];
  const push = { enabled: true, hasSubscription: (a, u) => u === 3, sendToUser: async (a, u, payload) => { pushed.push({ u, ...payload }); return { sent: 1, failed: 0, removed: 0 }; } };
  const logs = [];
  const N = createNotifications({ db: mem, logger: { info: (m) => logs.push(m), warn: () => {}, error: () => {} }, push });
  assert.deepStrictEqual(N.KINDS, KINDS);
  // assigned: one per person, in their language; a push only for the subscribed one
  const rows = N.assignments.list(1, 1);
  const out = await N.onAssigned(1, { id: 1, name: 'Duminică', eventDate: '2026-10-04', startTime: '10:00' }, rows.filter((r) => r.status === 'pending'), 'Lider');
  assert.deepStrictEqual(out, { sent: 1, withPush: 1, withoutPush: 0, userIds: [3] });
  const maria = N.list(1, 3);
  assert.deepStrictEqual([maria.length, maria[0].kind, maria[0].title, maria[0].url, maria[0].readAt], [1, 'assigned', 'You are scheduled: Chitară', '/events/1', null], 'English for Maria');
  assert.deepStrictEqual([pushed.length, pushed[0].u, pushed[0].tag, pushed[0].title, typeof pushed[0].id], [1, 3, 'assigned-1', 'You are scheduled: Chitară', 'number']);
  // declined: the owner and the leaders, not the one who declined (the leader here)
  await N.onDeclined(1, { id: 1, name: 'Duminică', eventDate: '2026-10-04' }, rows.find((r) => r.userId === 2));
  assert.deepStrictEqual([N.list(1, 1).length, N.list(1, 2).length, N.list(1, 3).length], [1, 0, 1]);
  assert.strictEqual(N.list(1, 1)[0].title, 'Lider nu poate: Chitară', 'Romanian for Ana');
  // prefs: off suppresses (row and push); default all on
  assert.deepStrictEqual(N.prefs(1, 4), Object.fromEntries(KINDS.map((k) => [k, true])));
  N.setPrefs(1, 4, { live_started: false, bogus: false });
  assert.strictEqual(N.prefs(1, 4).live_started, false);
  assert.strictEqual(await N.onLiveStarted(1, 1), 1, 'Maria yes, Petru off, the leader declined');
  // setlist changes: the pending / accepted people, once per 10 minutes
  assert.strictEqual(await N.onSetlistChanged(1, 1), 2);
  assert.strictEqual(await N.onSetlistChanged(1, 1), 0, 'throttled');
  mem.prepare("UPDATE notifications SET created_at = created_at - 11 * 60 * 1000 WHERE kind = 'setlist_changed'").run();
  assert.strictEqual(await N.onSetlistChanged(1, 1), 2, 'after 10 minutes again');
  // reminders: tomorrow's event, after 18:00 church time, once
  assert.strictEqual(await N.tick(new Date('2026-10-03T14:59:00Z')), 0, '17:59 in Bucharest: not yet');
  assert.strictEqual(await N.tick(new Date('2026-10-03T15:00:00Z')), 2, '18:00: Maria and Petru (the leader declined)');
  assert.strictEqual(await N.tick(new Date('2026-10-03T15:01:00Z')), 0, 'never twice (a restart would find the rows)');
  assert.strictEqual(await N.tick(new Date('2026-10-04T15:00:00Z')), 0, 'the day itself: nothing');
  // reading
  assert.strictEqual(N.unread(1, 3), 5);
  assert.strictEqual(N.markRead(1, 3, [N.list(1, 3)[0].id]), 1);
  assert.strictEqual(N.unread(1, 3), 4);
  assert.strictEqual(N.markRead(1, 3, 'all'), 4);
  assert.strictEqual(N.unread(1, 3), 0);
  assert.strictEqual(N.markRead(1, 4, [N.list(1, 3)[0].id]), 0, 'not theirs');
  mem.close();
});

test('song proposals (migration 034): one open per song, five open per member, settle once, members see their own', () => {
  const Database = require('better-sqlite3');
  const { runMigrations } = require('../lib/db');
  const { createProposalStore, MAX_OPEN_PER_MEMBER } = require('../lib/proposals');
  const mem = new Database(':memory:');
  mem.pragma('foreign_keys = ON');
  runMigrations(mem);
  mem.prepare("INSERT INTO admins (id, name, created_at) VALUES (1, 'A', 0), (2, 'B', 0)").run();
  mem.prepare("INSERT INTO users (id, admin_id, email, name, password_hash, role, created_at) VALUES (1, 1, 'l@x.ro', 'Lider', 'x', 'leader', 0), (2, 1, 'm@x.ro', 'Maria', 'x', 'member', 0), (3, 1, 'p@x.ro', 'Petru', 'x', 'member', 0)").run();
  mem.prepare("INSERT INTO events (id, admin_id, name, event_date, status, created_at, updated_at) VALUES (1, 1, 'E', '2026-10-04', 'planned', 0, 0)").run();
  const song = mem.prepare("INSERT INTO songs (admin_id, title, title_norm, created_at, updated_at) VALUES (1, ?, ?, 0, 0)");
  const ids = [];
  for (let i = 0; i < 7; i++) ids.push(Number(song.run(`Cântarea ${i}`, `cantarea ${i}`).lastInsertRowid));
  const other = Number(mem.prepare("INSERT INTO songs (admin_id, title, title_norm, created_at, updated_at) VALUES (2, 'X', 'x', 0, 0)").run().lastInsertRowid);
  const P = createProposalStore(mem);
  assert.strictEqual(MAX_OPEN_PER_MEMBER, 5);
  const first = P.create(1, 1, ids[0], 2, '  Ar merge la final  ');
  assert.deepStrictEqual([first.proposal.status, first.proposal.note, first.proposal.songTitle, first.proposal.proposerName], ['open', 'Ar merge la final', 'Cântarea 0', 'Maria']);
  assert.deepStrictEqual(P.create(1, 1, ids[0], 3, ''), { error: 'proposalExists' }, 'another member, the same song: one open per song');
  assert.deepStrictEqual(P.create(1, 1, other, 2, ''), { error: 'songInvalid' }, 'another admin\'s song');
  assert.deepStrictEqual(P.create(1, 1, 999, 2, ''), { error: 'songInvalid' });
  for (let i = 1; i < 5; i++) assert.ok(P.create(1, 1, ids[i], 2, '').proposal, `proposal ${i + 1}`);
  assert.deepStrictEqual(P.create(1, 1, ids[5], 2, ''), { error: 'proposalLimit' }, 'the sixth open one');
  assert.ok(P.create(1, 1, ids[5], 3, '').proposal, 'another member is not limited by Maria\'s');
  assert.strictEqual(P.openCount(1, 1), 6);
  assert.deepStrictEqual([P.list(1, 1).length, P.list(1, 1, { forUser: 2 }).length, P.list(1, 1, { forUser: 3 }).length], [6, 5, 1]);
  // settle: added (where it landed), then never again; declined with a note
  const added = P.settle(1, 1, first.proposal.id, { status: 'added', decidedBy: 1, target: 'setlist', itemId: 42 });
  assert.deepStrictEqual([added.status, added.addedTarget, added.addedItemId, added.deciderName], ['added', 'setlist', 42, 'Lider']);
  assert.strictEqual(P.settle(1, 1, first.proposal.id, { status: 'declined', decidedBy: 1 }), null, 'decided once');
  assert.strictEqual(P.settle(1, 1, first.proposal.id, { status: 'open', decidedBy: 1 }), null);
  const second = P.list(1, 1, { forUser: 2 }).find((p) => p.status === 'open');
  const declined = P.settle(1, 1, second.id, { status: 'declined', decidedBy: 1, note: 'O cântăm duminica viitoare' });
  assert.deepStrictEqual([declined.status, declined.decisionNote], ['declined', 'O cântăm duminica viitoare']);
  assert.strictEqual(P.openCount(1, 1), 4);
  assert.ok(P.create(1, 1, ids[0], 3, '').proposal, 'the song can be proposed again once the first was decided');
  assert.strictEqual(P.list(1, 1)[0].status, 'open', 'open ones first');
  mem.close();
});
