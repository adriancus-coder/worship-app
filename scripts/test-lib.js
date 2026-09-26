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
  assert.deepStrictEqual(frame(1, 0), { kind: 'lyrics', lines: ['Ne ridici din noaptea grea', 'Tu ești lumina mea'], version: 7, eventId: 3, background: null });
  assert.deepStrictEqual(frame(1, 1).lines, ['Sfânt, sfânt']);
  assert.ok(!/\[[A-G]/.test(frame(1, 2).lines.join('\n')), 'no chords reach the projector');
  assert.deepStrictEqual(frame(2, 0), { kind: 'verse', reference: 'Psalmul 23:1', text: 'Domnul este Păstorul meu.', version: 7, eventId: 3, background: null });
  assert.deepStrictEqual(frame(3, 0), { kind: 'announcement', title: 'Agapă', body: 'După serviciu', version: 7, eventId: 3, background: null });
  assert.strictEqual(frame(4, 0).title, 'Predica');
  assert.deepStrictEqual([frame(5, 0).kind, frame(5, 0).title], ['title', 'Rugăciune']);
  assert.strictEqual(frame(6, 0).kind, 'black', 'video: black until stage 5b');
  assert.deepStrictEqual([frame(7, 0).kind, frame(7, 0).title], ['title', 'Cântare ștearsă']);
  assert.deepStrictEqual(frame(1, 0, 'black'), { kind: 'black', version: 7, eventId: 3, background: null });
  assert.deepStrictEqual(frame(1, 0, 'logo', '/api/logo/x.png'), { kind: 'logo', logoUrl: '/api/logo/x.png', version: 7, eventId: 3, background: null });
  assert.strictEqual(frame(1, 0, 'logo').logoUrl, null);
  assert.strictEqual(frame(99, 0).kind, 'black', 'no item at the position');
  assert.deepStrictEqual(projectorFrame(null, null, null, { logoUrl: '/api/logo/x.png' }), { kind: 'idle', logoUrl: '/api/logo/x.png', version: 0, eventId: null, background: null });
  assert.strictEqual(projectorFrame({ ...state(1, 0), status: 'finished' }, { items }, new Map()).kind, 'idle');
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
  assert.deepStrictEqual(f('content', 'prepared'), { kind: 'verse', reference: 'Ps 1', text: 'Ferice', version: 3, eventId: 2, background: null,
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
  const E = ['owner', 'leader', 'operator'];
  const together = {
    'worship.next': E, 'worship.goto': E, 'event.start': E, 'event.end': E, 'live.mode': E, 'team.mode': E,
    'projector.next': [], 'projector.goto': [], 'projector.syncToWorship': [],
    'projector.source': E, 'video.play': E, 'operator.addItem': E,
  };
  const split = { ...together, 'projector.next': E, 'projector.goto': E, 'projector.syncToWorship': E };
  for (const [mode, table] of [['together', together], ['split', split]]) {
    for (const [type, allowed] of Object.entries(table)) {
      for (const role of ['owner', 'leader', 'operator', 'member']) {
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
  assert.strictEqual(code({ type: 'live.mode', mode: 'split' }), 'notLive');
  cmd({ type: 'event.start' }, 'operator');
  assert.deepStrictEqual([snap().mode, snap().teamMode, snap().projector.follows], ['together', 'follow', 'worship']);
  // together: leader and operator move the same main position; projector commands refused
  cmd({ type: 'worship.next' }, 'leader');
  cmd({ type: 'worship.next' }, 'operator');
  assert.deepStrictEqual(pos(snap().worship), [song, 2]);
  cmd({ type: 'worship.prev' }, 'operator');
  assert.deepStrictEqual(pos(snap().worship), [song, 1]);
  for (const role of ['leader', 'operator', 'owner']) assert.strictEqual(code({ type: 'projector.next' }, role), 'notSplitMode');
  assert.strictEqual(code({ type: 'projector.source', source: 'content' }, 'operator'), 'ok');
  assert.strictEqual(code({ type: 'live.mode', mode: 'apart' }), 'badCommand');
  // split: the projector starts at the main position; then the two move on their own
  cmd({ type: 'live.mode', mode: 'split' }, 'operator');
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
  // back to together: the projector shows the main position at once; the position is kept
  cmd({ type: 'live.mode', mode: 'together' }, 'leader');
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
  cmd({ type: 'live.mode', mode: 'split' });
  cmd({ type: 'projector.goto', itemId: v2, step: 0 }, 'operator');
  const again = require('../lib/live').createLiveStore(mem).snapshot(1, eventId);
  assert.deepStrictEqual([again.mode, again.teamMode, again.worship, again.projector], ['split', 'free', snap().worship, snap().projector]);
  // a new start begins together, following
  cmd({ type: 'event.end' }, 'operator');
  mem.close();
});

test('live store: both positions clamp on their own after a setlist change; persisted', () => {
  const { mem, live, eventId, items, save } = liveFixture();
  const [song, v1, v2] = items.map((it) => it.id);
  const cmd = (c, role = 'leader') => live.command(1, eventId, c, undefined, role);
  cmd({ type: 'event.start' });
  cmd({ type: 'worship.goto', itemId: song, step: 2 });
  cmd({ type: 'live.mode', mode: 'split' });
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
  cmd({ type: 'event.start' });
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
  cmd({ type: 'live.mode', mode: 'split' });
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
