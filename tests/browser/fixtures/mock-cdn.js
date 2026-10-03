// Browser tests only (preloaded with --require): a stand-in for the internet when a
// background is added from a link (lib/media-fetch.js). Hosts:
//   cdn.example.org      /sky.jpg (a JPEG), /loop.webm (a WebM), /page.html (text),
//                        /big.jpg (declares 60 MB), /redirect (302 -> /sky.jpg),
//                        /elsewhere (302 -> http://cdn.example.org/sky.jpg: refused), /missing (404)
//   private.example.org  resolves to 192.168.1.5 (refused before any request)
//   slow.example.org     never answers (the 10 s timeout)
const fs = require('fs');
const path = require('path');
const dns = require('dns');

const JPG = fs.readFileSync(path.join(__dirname, 'bg-sunrise.jpg'));
const WEBM = fs.readFileSync(path.join(__dirname, 'clip.webm'));
const ADDRESSES = { 'cdn.example.org': '203.0.113.10', 'private.example.org': '192.168.1.5', 'slow.example.org': '203.0.113.20' };

const realLookup = dns.promises.lookup;
dns.promises.lookup = async (host, opts) => {
  if (ADDRESSES[host]) return opts && opts.all ? [{ address: ADDRESSES[host], family: 4 }] : { address: ADDRESSES[host], family: 4 };
  return realLookup(host, opts);
};

const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  const u = new URL(url);
  if (u.hostname === 'slow.example.org') return new Promise((resolve, reject) => { if (opts && opts.signal) opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))); });
  if (u.hostname !== 'cdn.example.org') return realFetch(url, opts);
  const res = (status, body, headers = {}) => new Response(body, { status, headers });
  switch (u.pathname) {
    case '/sky.jpg': return res(200, JPG, { 'content-type': 'image/jpeg', 'content-length': String(JPG.length) });
    case '/loop.webm': return res(200, WEBM, { 'content-type': 'video/webm' });
    case '/page.html': return res(200, '<html><body>not an image</body></html>', { 'content-type': 'text/html' });
    case '/big.jpg': return res(200, JPG, { 'content-type': 'image/jpeg', 'content-length': String(60 * 1024 * 1024) });
    case '/redirect': return res(302, '', { location: '/sky.jpg' });
    case '/elsewhere': return res(302, '', { location: 'http://cdn.example.org/sky.jpg' });
    default: return res(404, 'nope');
  }
};
