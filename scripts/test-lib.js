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
