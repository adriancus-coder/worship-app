'use strict';

// Song search and import from resursecrestine.ro.
// extractResurseCrestineSongId, fetchResurseCrestineSong, searchResurseCrestineSongs and
// importFromUrl are ported from sanctuary-voice-app routes/admin-import.js (same endpoints:
// OpenSong XML at /cantece/opensong/<id>, title search with output=json2, 10 s timeout).
// Unlike Sanctuary Voice, the OpenSong structure and chords are kept (parseOpenSongLyrics).
// Network access is server-side only, https to the resursecrestine.ro hosts only.

const { XMLParser } = require('fast-xml-parser');
const { mergeChordLine, chordsOverLyricsToInline, isChordLine, stripChords, inlineLinePairs } = require('./chords');
const { SONG_KEYS, stripLeadingLabel, leadingLabel } = require('./sections');

const PRIMARY_HOST = 'www.resursecrestine.ro';
const ALLOWED_HOSTS = new Set([PRIMARY_HOST, 'resursecrestine.ro']);
const SEARCH_BASE = `https://${PRIMARY_HOST}/web-api-search`;
const FETCH_TIMEOUT_MS = 10000;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 5;
const USER_AGENT = 'WorshipApp/1.0';
const SOURCE_PROVIDER = 'resursecrestine';

// Error codes map to HTTP statuses and i18n messages in routes/resurse.js.
class ResurseError extends Error {
  constructor(code, detail) {
    super(detail || code);
    this.code = code;
  }
}

// Only https://www.resursecrestine.ro/... or https://resursecrestine.ro/... (default port,
// no credentials).
function isAllowedUrl(value) {
  let url;
  try {
    url = value instanceof URL ? value : new URL(String(value));
  } catch (err) {
    return false;
  }
  return url.protocol === 'https:'
    && ALLOWED_HOSTS.has(url.hostname.toLowerCase())
    && url.port === ''
    && url.username === ''
    && url.password === '';
}

/**
 * Song id from a resursecrestine.ro song URL, or null.
 *   https://www.resursecrestine.ro/cantece/<id>/<slug>
 *   https://www.resursecrestine.ro/cantece/<id>
 * A chord sheet URL (https://www.resursecrestine.ro/acorduri/<id>/<slug>) gives "a<id>": the
 * sheet imported as a song of its own (fetchChordSheetSong).
 */
function extractResurseCrestineSongId(url) {
  if (!isAllowedUrl(url)) return null;
  const path = new URL(String(url)).pathname;
  const match = path.match(/^\/cantece\/(\d{1,10})(\/|$)/);
  if (match) return match[1];
  const sheet = path.match(/^\/acorduri\/(\d{1,10})(\/|$)/);
  return sheet ? `a${sheet[1]}` : null;
}
const SHEET_ID_RE = /^a(\d{1,10})$/;

// fetch() restricted to the allowed hosts: redirects are followed by hand (each hop is
// checked), the whole exchange has a 10 s timeout and the body is capped at 1 MB.
async function safeFetchText(url, { accept, fetchImpl = fetch, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  let current = new URL(url);
  for (let hop = 0; ; hop++) {
    if (!isAllowedUrl(current)) throw new ResurseError('blocked_host', current.host);
    let res;
    try {
      res = await fetchImpl(current.toString(), {
        headers: { 'User-Agent': USER_AGENT, Accept: accept },
        redirect: 'manual',
        signal,
      });
    } catch (err) {
      if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) throw new ResurseError('timeout');
      throw new ResurseError('unreachable', err && err.message);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location || hop >= MAX_REDIRECTS) throw new ResurseError('bad_response', `redirect ${res.status}`);
      current = new URL(location, current);
      continue;
    }
    if (res.status === 404) throw new ResurseError('not_found');
    if (!res.ok) throw new ResurseError('upstream_error', `HTTP ${res.status}`);

    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new ResurseError('too_large');
    return readLimited(res, signal);
  }
}

async function readLimited(res, signal) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const text = await res.text();
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new ResurseError('too_large');
    return text;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        reader.cancel().catch(() => {});
        throw new ResurseError('too_large');
      }
      chunks.push(Buffer.from(value));
    }
  } catch (err) {
    if (err instanceof ResurseError) throw err;
    if (signal.aborted) throw new ResurseError('timeout');
    throw new ResurseError('unreachable', err && err.message);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// --- OpenSong parsing --------------------------------------------------------

const MARKER_TYPES = { V: 'verse', C: 'chorus', P: 'pre_chorus', B: 'bridge', I: 'intro', O: 'outro', T: 'tag' };
const STANDARD_MARKER_RE = /^([VCPBIOT])\d*$/i;

function markerType(marker) {
  const m = STANDARD_MARKER_RE.exec(marker || 'V');
  return m ? { type: MARKER_TYPES[m[1].toUpperCase()], label: null } : { type: 'other', label: marker.slice(0, 60) };
}

// "|" and "||" are OpenSong slide/page splitters: dropped (as spaces, to keep chord columns).
function dropSplitters(text) {
  return text.includes('|') ? text.replace(/\|/g, ' ') : text;
}

function tidyLine(line, hadSplitter) {
  const out = hadSplitter ? line.replace(/ {2,}/g, ' ') : line;
  return out.trimEnd();
}

// Lines of one [marker] block -> one or more section contents (inline ChordPro).
// OpenSong line prefixes: "." chord line, ";" comment, " " lyrics, "1".."9" lyrics of
// verse N in a multi-verse block. A chord line applies to the next lyric line (of each
// verse number); a chord line with no lyric under it becomes a chord-only line.
function parseBlock(lines) {
  const numbers = [...new Set(lines.filter((l) => /^[1-9]/.test(l)).map((l) => l[0]))].sort();
  const targets = numbers.length ? numbers : ['*'];
  const out = Object.fromEntries(targets.map((n) => [n, []]));
  let chord = null;
  let usedBy = new Set();

  const flushChordOnly = () => {
    if (chord !== null && usedBy.size === 0) {
      for (const n of targets) out[n].push(mergeChordLine(chord, ''));
    }
  };

  for (const raw of lines) {
    if (raw.startsWith(';')) continue;
    if (raw.startsWith('.')) {
      flushChordOnly();
      chord = raw.slice(1);
      usedBy = new Set();
      continue;
    }
    const numbered = /^[1-9]/.test(raw);
    const body = raw.startsWith(' ') || numbered ? raw.slice(1) : raw;
    const hadSplitter = body.includes('|');
    const text = dropSplitters(body);
    if (hadSplitter && !text.trim()) continue; // a "|" / "||" line on its own
    if (!text.trim()) {
      flushChordOnly();
      chord = null;
      for (const n of targets) out[n].push('');
      continue;
    }

    const lineTargets = numbered ? [raw[0]] : targets;
    for (const n of lineTargets) {
      const withChord = chord !== null && !usedBy.has(n) && !usedBy.has('*') && (numbered || usedBy.size === 0);
      out[n].push(tidyLine(withChord ? mergeChordLine(chord, text) : text, hadSplitter));
    }
    if (chord !== null) {
      if (numbered) usedBy.add(raw[0]);
      else usedBy.add('*');
    }
  }
  flushChordOnly();

  return targets
    .map((n) => out[n].join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\s+$/g, ''))
    .filter((content) => content.trim());
}

// OpenSong <lyrics> -> [{ type, label, content }].
function parseOpenSongLyrics(lyrics) {
  const lines = String(lyrics || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let current = null;
  for (const line of lines) {
    const marker = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (marker) {
      current = { marker: marker[1].trim(), lines: [] };
      blocks.push(current);
    } else {
      if (!current) {
        current = { marker: null, lines: [] };
        blocks.push(current);
      }
      current.lines.push(line);
    }
  }

  const sections = [];
  for (const block of blocks) {
    const { type, label } = markerType(block.marker);
    for (const content of parseBlock(block.lines)) {
      // A "Refren:" line left in the lyrics says what the marker already says: dropped.
      sections.push({ type, label, content: label ? content : stripLeadingLabel(content, type) });
    }
  }
  return sections;
}

function text(value) {
  if (value === undefined || value === null || typeof value === 'object') return '';
  return String(value).trim();
}

// OpenSong XML -> { title, author, key, presentation, sections }. Throws ResurseError.
function parseOpenSongXml(xml) {
  if (typeof xml !== 'string' || xml.length < 50) throw new ResurseError('bad_response', 'response too short');
  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: false });
  let parsed;
  try {
    parsed = parser.parse(xml);
  } catch (err) {
    throw new ResurseError('bad_response', `XML parse error: ${err.message}`);
  }
  const song = parsed && parsed.song;
  if (!song || typeof song !== 'object') throw new ResurseError('bad_response', 'no <song> root');

  const title = text(song.title);
  const sections = parseOpenSongLyrics(typeof song.lyrics === 'string' ? song.lyrics : '');
  if (!title || sections.length === 0) throw new ResurseError('bad_response', 'missing title or lyrics');

  const key = text(song.key);
  return {
    title,
    author: text(song.author) || null,
    key: SONG_KEYS.includes(key) ? key : null,
    presentation: text(song.presentation).replace(/\s+/g, ' ').slice(0, 200) || null,
    sections,
  };
}

// --- chord sheets ("Acorduri") ------------------------------------------------------------
// A song page (/cantece/<id>/<slug>) lists chord sheets people sent for that title
// (/acorduri/<id>/<slug>): the chords over the lyrics, with the sheet's key. The title is the
// only link: a sheet may be another song with the same title, so the lyrics are matched line
// by line before any chord is taken (overlayChords); the editor can still pick a sheet.

const SHEET_MAX = 6;
const MATCH_MIN = 0.6; // the share of lyric lines a sheet must cover to be used on its own

function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code) => {
    const named = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", acirc: 'â', Acirc: 'Â', icirc: 'î', Icirc: 'Î', abreve: 'ă', Abreve: 'Ă', scedil: 'ș', Scedil: 'Ș', tcedil: 'ț', Tcedil: 'Ț', hellip: '…', ndash: '–', mdash: '—', bdquo: '„', rdquo: '”', ldquo: '“', rsquo: '’', lsquo: '‘', laquo: '«', raquo: '»', eacute: 'é', egrave: 'è', ouml: 'ö', uuml: 'ü', auml: 'ä' };
    if (code[0] === '#') { const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return named[code.toLowerCase()] !== undefined ? named[code.toLowerCase()] : m;
  });
}

// The chord sheets a song page lists: [{ id, title, author }], first listed first.
function songPageSheets(html) {
  const out = [];
  const re = /href="(?:https:\/\/(?:www\.)?resursecrestine\.ro)?\/acorduri\/(\d{1,10})\/[^"]*"[^>]*class="listingTitleLink"[^>]*>([^<]*)/g;
  let m;
  while ((m = re.exec(String(html))) && out.length < SHEET_MAX) {
    if (out.some((s) => s.id === m[1])) continue;
    const after = String(html).slice(m.index, m.index + 1500);
    const author = /class="brownLink"[^>]*>\s*([^<]+?)\s*</.exec(after);
    out.push({ id: m[1], title: decodeEntities(m[2]).trim(), author: author ? decodeEntities(author[1]).replace(/\s+/g, ' ').trim() : null });
  }
  return out;
}

// A chord sheet page -> { key, text } (text: chords over lyrics, one line each, blank lines
// between stanzas). Throws when the page has no sheet.
function parseChordSheetHtml(html) {
  const s = String(html || '');
  const start = s.indexOf('class="stil-acorduri"');
  if (start < 0) throw new ResurseError('bad_response', 'no chord sheet');
  let block = s.slice(s.indexOf('>', start) + 1);
  const end = block.search(/<\/span>\s*<\/div>/);
  if (end >= 0) block = block.slice(0, end);
  block = block.replace(/<a [^>]*class="nice-acord"[^>]*>([^<]*)<\/a>/g, '$1');
  block = block.replace(/<br\s*\\?\/?>\r?\n?/g, '\n');
  block = block.replace(/<[^>]+>/g, '');
  const text = decodeEntities(block).replace(/\u00a0/g, ' ').replace(/\r/g, '').split('\n').map((l) => l.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const keyMatch = /acorduri:\s*([A-G][#b]?m?)\b/.exec(s);
  const key = keyMatch && SONG_KEYS.includes(keyMatch[1].replace(/m$/, '')) ? keyMatch[1] : null;
  if (!text) throw new ResurseError('bad_response', 'empty chord sheet');
  return { key, text };
}

// A lyric line's leading numbering ("1. ") or section label ("Ref:", "R:", "Cor:"), with the
// spaces around it: what the sheet's chord columns include and the song's lines do not.
const LYRIC_PREFIX_RE = /^\s*(?:\d{1,2}[.)]|ref(?:ren)?[.:]|r[.:]|cor[.:])\s*/i;
const prefixLength = (line) => { const m = LYRIC_PREFIX_RE.exec(String(line || '')); return m ? m[0].length : (String(line || '').match(/^\s*/) || [''])[0].length; };
// A chord line with every chord moved left by `offset` columns (never below 0; chords that
// would overlap keep one space between them).
function shiftChordLine(line, offset) {
  if (!offset) return String(line);
  let out = '';
  for (const m of String(line).matchAll(/\S+/g)) {
    const col = Math.max(0, m.index - offset, out.length ? out.length + 1 : 0);
    out = out.padEnd(col, ' ') + m[0];
  }
  return out;
}

// Lyrics compared without case, diacritics, punctuation, numbering ("1. ") or "Ref:".
function normalizeLyric(line) {
  return stripChords(String(line || '')).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(LYRIC_PREFIX_RE, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// The sheet's lyric lines with the chord line above each (its columns shifted by the lyric
// line's prefix, so the chords land where they do on the song's own line): Map normalized
// lyric -> chord line | null.
function sheetChordMap(text) {
  const lines = String(text || '').split('\n');
  const map = new Map();
  for (let i = 0; i < lines.length; i++) {
    if (isChordLine(lines[i]) || !lines[i].trim()) continue;
    const key = normalizeLyric(lines[i]);
    if (!key || map.has(key)) continue;
    const above = i > 0 && isChordLine(lines[i - 1]) ? shiftChordLine(lines[i - 1], prefixLength(lines[i])) : null;
    map.set(key, above);
  }
  return map;
}

// The OpenSong sections with the sheet's chords put over the lines it has (a line that
// already carries chords keeps them). { sections, matched, total, score }
function overlayChords(sections, sheetText) {
  const map = sheetChordMap(sheetText);
  let matched = 0;
  let total = 0;
  const out = sections.map((section) => {
    const lines = String(section.content || '').split('\n').map((line) => {
      const key = normalizeLyric(line);
      if (!key) return line;
      total++;
      if (!map.has(key)) return line;
      matched++;
      const chords = map.get(key);
      return chords && !/\[[^\]]+\]/.test(line) ? mergeChordLine(chords, line) : line;
    });
    return { ...section, content: lines.join('\n') };
  });
  return { sections: out, matched, total, score: total ? matched / total : 0 };
}

// The sheet as a song of its own: stanzas (blank lines between) -> sections typed by a
// leading label ("Ref:", "Refren:", "Bridge", "1.") and the chords inline.
function sheetSections(text) {
  // (only newlines are cut around a stanza: a chord line's leading spaces are its columns)
  const stanzas = String(text || '').split(/\n[ \t]*\n/).map((s) => s.replace(/^\n+/, '').trimEnd()).filter((s) => s.trim());
  return stanzas.map((stanza) => {
    const lines = stanza.split('\n');
    const first = lines.find((l) => l.trim() && !isChordLine(l)) || '';
    let type = 'verse';
    const label = leadingLabel(first);
    if (label) type = label.type;
    else if (/^\s*(ref|r|cor)\s*[.:]/i.test(first)) type = 'chorus';
    // the label / numbering goes from the first line, and the chord line above it moves along
    const at = lines.indexOf(first);
    const offset = at >= 0 ? prefixLength(first) : 0;
    const cleaned = lines.map((l, i) => {
      if (i === at) return l.replace(LYRIC_PREFIX_RE, '');
      if (i === at - 1 && isChordLine(l)) return shiftChordLine(l, offset);
      return l;
    }).join('\n');
    const content = stripLeadingLabel(chordsOverLyricsToInline(cleaned), type).trim();
    return { type, label: null, content };
  }).filter((s) => s.content);
}

const hasChords = (sections) => sections.some((s) => inlineLinePairs(s.content).some((p) => p.chords !== null));

// A chord sheet page as a song: its title (og:title / <title>), author ("Autor:" link), key
// and the sheet's stanzas as sections (sheetSections).
function parseChordSheetPage(html) {
  const s = String(html || '');
  const { key, text } = parseChordSheetHtml(s);
  const og = /<meta property="og:title" content="([^"]*)"/.exec(s);
  const tt = /<title>([\s\S]*?)<\/title>/.exec(s);
  const title = decodeEntities((og ? og[1] : tt ? tt[1] : '')).replace(/\s+/g, ' ').replace(/\s*-\s*Resurse Cre[sș]tine\s*$/i, '').trim();
  const at = s.indexOf('Autor:');
  const author = at >= 0 ? /index-autori\/[^"]+"[^>]*>([\s\S]*?)<\/a>/.exec(s.slice(at, at + 600)) : null;
  if (!title) throw new ResurseError('bad_response', 'no sheet title');
  return { title, author: author ? decodeEntities(author[1]).replace(/\s+/g, ' ').trim() || null : null, key, text };
}

async function fetchChordSheetSong(sheetId, options = {}) {
  const { sheet, ...fetchOptions } = options;
  const html = await safeFetchText(`https://${PRIMARY_HOST}/acorduri/${sheetId}/acorduri`, { accept: 'text/html', ...fetchOptions });
  const page = parseChordSheetPage(html);
  const sections = sheetSections(page.text);
  if (!sections.length) throw new ResurseError('bad_response', 'empty chord sheet');
  return {
    title: page.title, author: page.author, key: page.key, presentation: null, sections,
    chords: { source: 'sheet', sheetId: String(sheetId), author: page.author, score: null, overlay: false }, sheets: [],
    sourceProvider: SOURCE_PROVIDER, sourceUrl: `https://${PRIMARY_HOST}/acorduri/${sheetId}/acorduri`,
  };
}

// The sheets of a song page, each fetched and parsed; the ones that fail are left out. The
// site wants a slug after the id (/cantece/<id> alone is a 404): any word does.
async function fetchChordSheets(songId, options) {
  const page = await safeFetchText(`${songPageUrl(songId)}/cantare`, { accept: 'text/html', ...options });
  const listed = songPageSheets(page);
  const sheets = await Promise.all(listed.map(async (s) => {
    try {
      const html = await safeFetchText(`https://${PRIMARY_HOST}/acorduri/${s.id}/x`, { accept: 'text/html', ...options });
      return { ...s, ...parseChordSheetHtml(html) };
    } catch (err) {
      return null;
    }
  }));
  return sheets.filter(Boolean);
}

// The parsed song with chords from a sheet. sheet: 'none' (as the OpenSong came), 'auto'
// (the OpenSong's own chords, else the best-matching sheet when it covers enough lines), or
// a sheet id (the editor's pick: its chords over the lines it matches, or - when it is
// another song with this title - the sheet as the song). Adds `chords` ({ source: 'own' |
// 'sheet' | null, sheetId, author, score }) and `sheets` (every sheet: id, author, key, score).
async function withChords(parsed, songId, sheet, options) {
  const own = hasChords(parsed.sections);
  const base = { ...parsed, chords: own ? { source: 'own', sheetId: null, author: null, score: null } : { source: null, sheetId: null, author: null, score: null }, sheets: [] };
  if (sheet === 'none' || sheet === undefined || sheet === null) return base;
  // The chords are extra: a page that cannot be read never fails the import itself.
  let sheets;
  try {
    sheets = await fetchChordSheets(songId, options);
  } catch (err) {
    return base;
  }
  const scored = sheets.map((s) => ({ ...s, ...overlayChords(parsed.sections, s.text) }));
  base.sheets = scored.map((s) => ({ id: s.id, author: s.author, key: s.key, score: Math.round(s.score * 100) / 100 }));
  const pick = sheet === 'auto'
    ? (own ? null : scored.filter((s) => s.score >= MATCH_MIN).sort((a, b) => b.score - a.score)[0] || null)
    : scored.find((s) => s.id === String(sheet)) || null;
  if (!pick) return base;
  const overlay = pick.score >= MATCH_MIN;
  return {
    ...base,
    key: parsed.key || pick.key || null,
    sections: overlay ? pick.sections : sheetSections(pick.text),
    chords: { source: 'sheet', sheetId: pick.id, author: pick.author, score: Math.round(pick.score * 100) / 100, overlay },
  };
}

// --- ported entry points -----------------------------------------------------

function songPageUrl(songId) {
  return `https://${PRIMARY_HOST}/cantece/${songId}`;
}

async function fetchResurseCrestineSong(songId, options = {}) {
  const { sheet, ...fetchOptions } = options;
  const xml = await safeFetchText(`https://${PRIMARY_HOST}/cantece/opensong/${songId}`, {
    accept: 'application/xml, text/xml',
    ...fetchOptions,
  });
  const parsed = await withChords(parseOpenSongXml(xml), songId, sheet, fetchOptions);
  return {
    ...parsed,
    sourceProvider: SOURCE_PROVIDER,
    sourceUrl: songPageUrl(songId),
  };
}

// { url } or { id } -> parsed song. Throws ResurseError('invalid_url') for anything else.
// options.sheet: 'none' | 'auto' | a sheet id (the chords, see withChords).
async function importFromUrl(input, options) {
  const id = input && input.id !== undefined && input.id !== null && input.id !== ''
    ? (/^a?\d{1,10}$/.test(String(input.id)) ? String(input.id) : null)
    : extractResurseCrestineSongId(input && input.url);
  if (!id) throw new ResurseError('invalid_url');
  const sheet = SHEET_ID_RE.exec(id);
  return sheet ? fetchChordSheetSong(sheet[1], options) : fetchResurseCrestineSong(id, options);
}

/**
 * Title search through the site's public API (search_in=2 = songs, output=json2).
 * Response: { Results: [{ id, title, title_slug, author, kind, slug }] }.
 * Returns up to 20 [{ id, title, author, url }].
 */
async function searchResurseCrestineSongs(query, options) {
  const trimmed = String(query || '').trim();
  if (trimmed.length < 2) throw new ResurseError('query_too_short');

  // search_in 2 = the songs (text, OpenSong), 1 = the chord sheets ("Acorduri").
  const ask = async (searchIn) => {
    const url = new URL(SEARCH_BASE);
    url.searchParams.set('search_text', trimmed.slice(0, 100));
    url.searchParams.set('search_in', searchIn);
    url.searchParams.set('search_by', 'filtru-titlu');
    url.searchParams.set('output', 'json2');
    const body = await safeFetchText(url.toString(), { accept: 'application/json', ...options });
    let data;
    try {
      data = JSON.parse(body);
    } catch (err) {
      throw new ResurseError('bad_response', `JSON parse error: ${err.message}`);
    }
    let items;
    if (Array.isArray(data && data.Results)) items = data.Results;
    else if (Array.isArray(data && data.results)) items = data.results;
    else if (Array.isArray(data)) items = data;
    else throw new ResurseError('bad_response', 'unexpected search response');
    return items.map((item) => ({
      id: text(item && item.id),
      title: text(item && item.title),
      author: text(item && item.author),
      titleSlug: text(item && item.title_slug),
      category: text(item && item.slug),
    })).filter((item) => /^\d{1,10}$/.test(item.id) && item.title);
  };
  // the sheets are extra: their search failing never fails the songs'
  const [songs, sheets] = await Promise.all([ask('2'), ask('1').catch(() => [])]);
  return [
    ...songs.filter((item) => item.category === 'cantece').slice(0, 20).map((item) => ({
      id: item.id, kind: 'song', title: item.title, author: item.author || null,
      url: `https://${PRIMARY_HOST}/cantece/${item.id}/${encodeURIComponent(item.titleSlug || 'cantec')}`,
    })),
    ...sheets.filter((item) => item.category === 'acorduri').slice(0, 10).map((item) => ({
      id: `a${item.id}`, kind: 'sheet', title: item.title, author: item.author || null,
      url: `https://${PRIMARY_HOST}/acorduri/${item.id}/${encodeURIComponent(item.titleSlug || 'acorduri')}`,
    })),
  ];
}

module.exports = {
  SOURCE_PROVIDER,
  MAX_BODY_BYTES,
  ResurseError,
  isAllowedUrl,
  extractResurseCrestineSongId,
  safeFetchText,
  parseOpenSongLyrics,
  parseOpenSongXml,
  fetchResurseCrestineSong,
  importFromUrl,
  searchResurseCrestineSongs,
  songPageSheets, parseChordSheetHtml, parseChordSheetPage, fetchChordSheetSong, overlayChords, sheetSections, normalizeLyric, fetchChordSheets, SHEET_MAX, MATCH_MIN,
};
