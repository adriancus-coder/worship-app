'use strict';

// Song search and import from resursecrestine.ro.
// extractResurseCrestineSongId, fetchResurseCrestineSong, searchResurseCrestineSongs and
// importFromUrl are ported from sanctuary-voice-app routes/admin-import.js (same endpoints:
// OpenSong XML at /cantece/opensong/<id>, title search with output=json2, 10 s timeout).
// Unlike Sanctuary Voice, the OpenSong structure and chords are kept (parseOpenSongLyrics).
// Network access is server-side only, https to the resursecrestine.ro hosts only.

const { XMLParser } = require('fast-xml-parser');
const { mergeChordLine } = require('./chords');
const { SONG_KEYS } = require('./sections');

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
 */
function extractResurseCrestineSongId(url) {
  if (!isAllowedUrl(url)) return null;
  const match = new URL(String(url)).pathname.match(/^\/cantece\/(\d{1,10})(\/|$)/);
  return match ? match[1] : null;
}

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
      sections.push({ type, label, content });
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

// --- ported entry points -----------------------------------------------------

function songPageUrl(songId) {
  return `https://${PRIMARY_HOST}/cantece/${songId}`;
}

async function fetchResurseCrestineSong(songId, options) {
  const xml = await safeFetchText(`https://${PRIMARY_HOST}/cantece/opensong/${songId}`, {
    accept: 'application/xml, text/xml',
    ...options,
  });
  return {
    ...parseOpenSongXml(xml),
    sourceProvider: SOURCE_PROVIDER,
    sourceUrl: songPageUrl(songId),
  };
}

// { url } or { id } -> parsed song. Throws ResurseError('invalid_url') for anything else.
async function importFromUrl(input, options) {
  const id = input && input.id !== undefined && input.id !== null && input.id !== ''
    ? (/^\d{1,10}$/.test(String(input.id)) ? String(input.id) : null)
    : extractResurseCrestineSongId(input && input.url);
  if (!id) throw new ResurseError('invalid_url');
  return fetchResurseCrestineSong(id, options);
}

/**
 * Title search through the site's public API (search_in=2 = songs, output=json2).
 * Response: { Results: [{ id, title, title_slug, author, kind, slug }] }.
 * Returns up to 20 [{ id, title, author, url }].
 */
async function searchResurseCrestineSongs(query, options) {
  const trimmed = String(query || '').trim();
  if (trimmed.length < 2) throw new ResurseError('query_too_short');

  const url = new URL(SEARCH_BASE);
  url.searchParams.set('search_text', trimmed.slice(0, 100));
  url.searchParams.set('search_in', '2');
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

  return items
    .map((item) => ({
      id: text(item && item.id),
      title: text(item && item.title),
      author: text(item && item.author),
      titleSlug: text(item && item.title_slug),
      category: text(item && item.slug),
    }))
    .filter((item) => /^\d{1,10}$/.test(item.id) && item.title && item.category === 'cantece')
    .slice(0, 20)
    .map((item) => ({
      id: item.id,
      title: item.title,
      author: item.author || null,
      url: `https://${PRIMARY_HOST}/cantece/${item.id}/${encodeURIComponent(item.titleSlug || 'cantec')}`,
    }));
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
};
