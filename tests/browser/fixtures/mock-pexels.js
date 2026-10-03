// Browser tests only (preloaded with --require, together with PEXELS_API_KEY=test-key and
// PEXELS_API_URL=https://api.pexels.test): a stand-in for the Pexels API and its CDN.
//   GET /v1/search?query=      two photos (their files come from cdn.example.org via mock-cdn.js)
//   GET /videos/search?query=  one video (an HD and an SD file; the SD one is served)
//   query "nimic"              no results; a missing Authorization header answers 401
// Every search is counted in global.__pexelsCalls (the 10 minute cache is checked with it).
require('./mock-cdn.js');
const dns = require('dns');

global.__pexelsCalls = [];
const IMG = 'https://cdn.example.org/sky.jpg';
const VID = 'https://cdn.example.org/loop.webm';

const realLookup = dns.promises.lookup;
dns.promises.lookup = async (host, opts) => {
  if (host === 'api.pexels.test') return opts && opts.all ? [{ address: '203.0.113.30', family: 4 }] : { address: '203.0.113.30', family: 4 };
  return realLookup(host, opts);
};

const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  const u = new URL(url);
  if (u.hostname !== 'api.pexels.test') return realFetch(url, opts);
  const res = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (!opts || !opts.headers || opts.headers.Authorization !== 'test-key') return res(401, { error: 'Unauthorized' });
  const q = u.searchParams.get('query') || '';
  global.__pexelsCalls.push(`${u.pathname}?${q}`);
  if (u.pathname === '/v1/search') {
    if (q === 'nimic') return res(200, { photos: [], total_results: 0 });
    return res(200, { photos: [
      { id: 1001, width: 4000, height: 2250, url: 'https://www.pexels.com/photo/sky-1001/', photographer: 'Ana Fotograf', photographer_url: 'https://www.pexels.com/@ana', alt: 'Blue sky with clouds', src: { original: `${IMG}?o`, large2x: `${IMG}?l2x`, large: `${IMG}?l`, medium: `${IMG}?m`, small: `${IMG}?s` } },
      { id: 1002, width: 3000, height: 2000, url: 'https://www.pexels.com/photo/light-1002/', photographer: 'Ion Lumină', photographer_url: 'https://www.pexels.com/@ion', alt: 'Warm light', src: { original: `${IMG}?o2`, large: `${IMG}?l2`, medium: `${IMG}?m2` } },
    ], total_results: 2 });
  }
  if (u.pathname === '/videos/search') {
    if (q === 'nimic') return res(200, { videos: [], total_results: 0 });
    return res(200, { videos: [
      { id: 2001, width: 3840, height: 2160, duration: 12, url: 'https://www.pexels.com/video/waves-2001/', image: `${IMG}?poster`, user: { name: 'Maria Video', url: 'https://www.pexels.com/@maria' }, video_files: [
        { id: 1, quality: 'uhd', file_type: 'video/mp4', width: 3840, height: 2160, link: 'https://cdn.example.org/never-4k.mp4' },
        { id: 2, quality: 'hd', file_type: 'video/mp4', width: 1920, height: 1080, link: `${VID}?hd` },
        { id: 3, quality: 'sd', file_type: 'video/mp4', width: 960, height: 540, link: `${VID}?sd` },
      ] },
    ], total_results: 1 });
  }
  if (u.pathname === '/v1/photos/1003') return res(200, { id: 1003, width: 100, height: 60, url: 'https://www.pexels.com/photo/1003/', photographer: 'Direct', photographer_url: '', alt: 'Direct lookup', src: { large: `${IMG}?direct` } });
  return res(404, { error: 'Not Found' });
};
