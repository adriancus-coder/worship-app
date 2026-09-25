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
    id: null, type: 'song', songId: 5, title: 'Sfânt', body: null, reference: null, url: null, durationMin: null,
    transpose: -3, arrangement: 'V1 C C B', teamNote: 'încet', referenceUrl: 'https://youtu.be/x',
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
