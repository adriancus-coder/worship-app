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
  for (const w of ['Ne', 'Doamne', 'H', 'Gg', 'x2', 'Em7,', 'Tu', 'G/', '[G]']) {
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

// --- sections -------------------------------------------------------------

test('sectionLabels: numbered verses, repeated types, custom labels, both languages', () => {
  const secs = [{ type: 'verse' }, { type: 'chorus' }, { type: 'verse' }, { type: 'bridge' }, { type: 'tag', label: 'Final lent' }];
  assert.deepStrictEqual(sectionLabels(secs, (k, v) => t(k, v, 'ro')), ['Strofa 1', 'Refren', 'Strofa 2', 'Punte', 'Final lent']);
  assert.deepStrictEqual(sectionLabels(secs, (k, v) => t(k, v, 'en')), ['Verse 1', 'Chorus', 'Verse 2', 'Bridge', 'Final lent']);
  assert.deepStrictEqual(sectionLabels([{ type: 'chorus' }, { type: 'chorus' }], (k, v) => t(k, v, 'ro')), ['Refren 1', 'Refren 2']);
});

if (failures.length > 0) {
  console.error(`test-lib: ${failures.length} failed, ${passed} passed\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`test-lib: ${passed} tests passed`);
