'use strict';

/* global self, caches, fetch, URL, Response */
// Service worker template, served as /sw.js by routes/pwa.js with CONFIG filled in:
//   { version, precache: [static urls], offline: '/offline' }
//
// Static files: cache-first, precached on install, in a cache named after the version (a new
//   deploy = a new cache; old ones are deleted when the new worker activates).
// Pages (navigations): network-first with a 4 s timeout, then the cached copy of that page,
//   then /offline. Pages are kept in their own cache, which logout clears.
// Never touched: other origins, anything but GET, Range requests, /api/* (files, logos and
//   data included), /socket.io/*, /sw.js. The manifest is network-first.
// A new worker waits until the page asks it to take over ({ type: 'SKIP_WAITING' }).

const CONFIG = /* __CONFIG__ */ { version: 'dev', precache: [], offline: '/offline' };
const STATIC_CACHE = `wa-static-${CONFIG.version}`;
const PAGES_CACHE = 'wa-pages';
const PAGE_TIMEOUT_MS = 4000;
const PRECACHED = new Set(CONFIG.precache);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll([...CONFIG.precache, CONFIG.offline])));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('wa-static-') && name !== STATIC_CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'SKIP_WAITING') self.skipWaiting();
  else if (type === 'CLEAR_PAGES') event.waitUntil(caches.delete(PAGES_CACHE));
  else if (type === 'VERSION' && event.ports[0]) event.ports[0].postMessage({ version: CONFIG.version });
});

function skipped(request, url) {
  return request.method !== 'GET'
    || url.origin !== self.location.origin
    || request.headers.has('range')
    || url.pathname.startsWith('/api/')
    || url.pathname.startsWith('/socket.io/')
    || url.pathname === '/sw.js';
}

function timeout(ms) {
  return new Promise((resolve, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

async function page(request) {
  const cache = await caches.open(PAGES_CACHE);
  const network = fetch(request).then((response) => {
    // Only a page as such: not a redirect (e.g. to /login), not an error.
    if (response.ok && !response.redirected && response.type === 'basic') cache.put(request, response.clone());
    return response;
  });
  try {
    return await Promise.race([network, timeout(PAGE_TIMEOUT_MS)]);
  } catch (err) {
    network.catch(() => {}); // a late answer still refreshes the cache
    return (await cache.match(request)) || (await caches.match(CONFIG.offline, { cacheName: STATIC_CACHE }))
      || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { cacheName: STATIC_CACHE });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(STATIC_CACHE)).put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(STATIC_CACHE)).put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await caches.match(request, { cacheName: STATIC_CACHE });
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (skipped(request, url)) return;
  if (request.mode === 'navigate') event.respondWith(page(request));
  else if (url.pathname === '/manifest.webmanifest') event.respondWith(networkFirst(request));
  else if (PRECACHED.has(url.pathname)) event.respondWith(cacheFirst(request));
});
