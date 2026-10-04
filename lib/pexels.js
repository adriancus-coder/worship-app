'use strict';

// Pexels (https://www.pexels.com/api/): free photos and video loops for the projector
// backgrounds. OPTIONAL: without PEXELS_API_KEY the provider is disabled and Media hides the
// tab. Everything goes through this server (the key never reaches the browser): a search is
// one call to api.pexels.com, cached 10 minutes per query, at most 60 searches an hour per
// admin (church); "Adaugă" downloads the projector-size photo or the SD / HD video with
// lib/media-fetch.js and keeps the photographer's name + the Pexels page as attribution.
//
//   const pexels = createPexels({ config, logger, fetch? })
//   pexels.enabled, pexels.status()               -> { enabled }
//   await pexels.search(adminId, { query, kind })  -> { items: [...], cached } | throws PexelsError
//   await pexels.item(adminId, { id, kind })       -> one item (from the cache, else fetched)

const { createRequestLimiter } = require('./rate-limit');

const API_URL = 'https://api.pexels.com';
const PER_PAGE = 24;
const CACHE_MS = 10 * 60 * 1000;
const SEARCHES_PER_HOUR = 60;
const TIMEOUT_MS = 10000;
const MAX_VIDEO_WIDTH = 1920;
const SUGGESTIONS = ['sky', 'light', 'nature', 'abstract', 'worship', 'water', 'mountains', 'sunrise'];
const KINDS = ['photos', 'videos'];

class PexelsError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'PexelsError';
    this.code = code; // disabled | rate_limited | bad_query | upstream_error | timeout | unreachable | not_found
    if (code === 'rate_limited') this.retryAfter = detail;
  }
}

// One photo -> what the page and the download need.
function photoItem(p) {
  const src = p.src || {};
  return {
    id: String(p.id), kind: 'photos', width: p.width, height: p.height, alt: p.alt || '',
    thumb: src.medium || src.small || src.large, preview: src.large || src.medium,
    download: src.large2x || src.large || src.original, // projector size (large2x is 1880 px wide)
    photographer: p.photographer || '', photographerUrl: p.photographer_url || '', pageUrl: p.url || '',
  };
}

// The largest MP4 that is at most 1920 wide (HD), else SD: a projector loop, not a 4K file.
function pickVideoFile(files) {
  const mp4 = (files || []).filter((f) => f && f.link && /^video\/mp4$/i.test(f.file_type || 'video/mp4'));
  const fitting = mp4.filter((f) => !f.width || f.width <= MAX_VIDEO_WIDTH).sort((a, b) => (b.width || 0) - (a.width || 0));
  return fitting[0] || null;
}

function videoItem(v) {
  const file = pickVideoFile(v.video_files);
  return {
    id: String(v.id), kind: 'videos', width: v.width, height: v.height, duration: v.duration || null, alt: '',
    thumb: v.image, preview: v.image, download: file ? file.link : null, fileWidth: file ? file.width : null,
    photographer: v.user ? v.user.name || '' : '', photographerUrl: v.user ? v.user.url || '' : '', pageUrl: v.url || '',
  };
}

function createPexels({ config, logger, fetch: doFetch = (...args) => globalThis.fetch(...args) }) {
  const key = String(config.PEXELS_API_KEY || '').trim();
  const apiUrl = (config.PEXELS_API_URL || API_URL).replace(/\/+$/, '');
  const enabled = Boolean(key);
  const cache = new Map(); // "kind:query" -> { at, items }
  const items = new Map(); // "kind:id" -> item (from any search or lookup)
  const limiter = createRequestLimiter({ maxRequests: SEARCHES_PER_HOUR, windowMs: 60 * 60 * 1000 });
  if (logger) logger.info(enabled ? 'Pexels: enabled' : 'Pexels: disabled (no PEXELS_API_KEY)');

  async function call(path) {
    let res;
    try {
      res = await doFetch(`${apiUrl}${path}`, { headers: { Authorization: key, 'User-Agent': 'WorshipApp/1.0' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) throw new PexelsError('timeout');
      throw new PexelsError('unreachable', err && err.message);
    }
    if (res.status === 404) throw new PexelsError('not_found');
    if (!res.ok) throw new PexelsError('upstream_error', `HTTP ${res.status}`);
    try {
      return await res.json();
    } catch (err) {
      throw new PexelsError('upstream_error', 'bad JSON');
    }
  }

  function remember(list) {
    for (const item of list) items.set(`${item.kind}:${item.id}`, item);
    return list;
  }

  async function search(adminId, { query, kind }) {
    if (!enabled) throw new PexelsError('disabled');
    const q = String(query || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const k = KINDS.includes(kind) ? kind : 'photos';
    if (q.length < 2) throw new PexelsError('bad_query');
    const cacheKey = `${k}:${q.toLowerCase()}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_MS) return { items: hit.items, cached: true };
    const retryAfter = limiter.take(String(adminId));
    if (retryAfter > 0) throw new PexelsError('rate_limited', retryAfter);
    const qs = `query=${encodeURIComponent(q)}&per_page=${PER_PAGE}&orientation=landscape`;
    const body = await call(k === 'photos' ? `/v1/search?${qs}` : `/videos/search?${qs}`);
    const list = k === 'photos' ? (body.photos || []).map(photoItem) : (body.videos || []).map(videoItem).filter((v) => v.download);
    remember(list);
    cache.set(cacheKey, { at: Date.now(), items: list });
    return { items: list, cached: false };
  }

  // One item for "Adaugă": from the searches seen (10 minutes), else one lookup by id.
  async function item(adminId, { id, kind }) {
    if (!enabled) throw new PexelsError('disabled');
    const k = KINDS.includes(kind) ? kind : 'photos';
    const known = items.get(`${k}:${String(id)}`);
    if (known) return known;
    if (!/^\d{1,12}$/.test(String(id))) throw new PexelsError('not_found');
    const body = await call(k === 'photos' ? `/v1/photos/${id}` : `/videos/videos/${id}`);
    const found = k === 'photos' ? photoItem(body) : videoItem(body);
    if (!found.download) throw new PexelsError('not_found');
    remember([found]);
    return found;
  }

  return { enabled, status: () => ({ enabled }), search, item, SUGGESTIONS };
}

module.exports = { PexelsError, KINDS, SUGGESTIONS, PER_PAGE, CACHE_MS, SEARCHES_PER_HOUR, photoItem, videoItem, pickVideoFile, createPexels };
