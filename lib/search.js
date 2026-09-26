'use strict';

// Song search. normalizeForSearch, elisionVariants and the matching rule are ported
// from sanctuary-voice-app public/app.js (normalizeForSearch, elisionVariants,
// filterAndSortLibrary) with unchanged behaviour, except that one-word queries do not
// search lyrics (see lyricsMatches).

// Case- and diacritic-insensitive form (RO ăâîșț, NO æøå, ...); punctuation and hyphens become spaces.
function normalizeForSearch(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// In titles, elision swallows an initial "î"/"i" ("Dacă-ntr-o" = "Dacă într-o").
// Returns de-elided variants so the title is also found when the full word is typed.
// Anchored on a hyphen/apostrophe followed by a CONSONANT, so normal words are untouched
// ("Isus" does not become "sus").
function elisionVariants(raw) {
  if (!raw) return '';
  const out = [];
  const re = /[-'’ʼ]([\p{L}]+)/gu;
  let mm;
  while ((mm = re.exec(String(raw))) !== null) {
    const fragN = normalizeForSearch(mm[1]);
    if (fragN && 'bcdfghjklmnpqrstvwxyz'.includes(fragN[0])) out.push('i' + fragN);
  }
  return out.join(' ');
}

// Title: every query word appears in the title (or its elision variants), in any order.
function titleMatches(normalizedQuery, title) {
  const titleN = normalizeForSearch(title) + ' ' + elisionVariants(title);
  return normalizedQuery.split(' ').filter(Boolean).every((word) => titleN.includes(word));
}

// Lyrics: only the full normalized phrase, so common words do not flood the results.
// A single word is not a phrase: one-word queries match titles only (worship-app rule,
// stricter than Sanctuary Voice, where a single word also matched lyrics).
function lyricsMatches(normalizedQuery, text) {
  if (!normalizedQuery.includes(' ')) return false;
  return normalizeForSearch(text).includes(normalizedQuery);
}

const collator = new Intl.Collator('ro', { sensitivity: 'base', numeric: true });

// items: [{ title, text, updated_at, ... }]. Returns the matching items, each with
// matchedIn ('title' | 'lyrics' | null when there is no query). Title hits come
// before lyrics-only hits; within each group the sort mode applies (az | za | recent).
function searchSongs(items, rawQuery, sortMode = 'az') {
  const query = normalizeForSearch(String(rawQuery || '').trim());
  const results = [];
  for (const item of items) {
    if (!query) {
      results.push({ ...item, matchedIn: null });
    } else if (titleMatches(query, item.title)) {
      results.push({ ...item, matchedIn: 'title' });
    } else if (lyricsMatches(query, item.text)) {
      results.push({ ...item, matchedIn: 'lyrics' });
    }
  }
  const rank = (item) => (item.matchedIn === 'lyrics' ? 1 : 0);
  return results.sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (sortMode === 'recent') return (b.updated_at || 0) - (a.updated_at || 0);
    const byTitle = collator.compare(a.title || '', b.title || '');
    return sortMode === 'za' ? -byTitle : byTitle;
  });
}

module.exports = { normalizeForSearch, elisionVariants, titleMatches, lyricsMatches, searchSongs };
