'use strict';

// Downloading a media file from a link (Media → Fundaluri → "Din link", and the Pexels
// provider later): https only, no credentials, never a private / local address (every
// hostname is resolved first and each address checked; redirects are followed by hand,
// each hop checked the same way), a 10 s timeout for the whole exchange, the body streamed
// to a temp file and stopped as soon as it passes the byte cap. What it is (image / video)
// is decided afterwards from the file's first bytes, never from the URL or Content-Type.
//
//   const { temp, size, head, finalUrl } = await fetchToTemp(url, { temp, maxBytes, fetchImpl?, lookup? })
//   throws MediaFetchError(code): bad_url | blocked_host | private_address | timeout |
//     unreachable | too_large | upstream_error | not_found

const fs = require('fs');
const net = require('net');
const dns = require('dns');

const TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 5;
const URL_MAX = 2000;
const USER_AGENT = 'WorshipApp/1.0 (+background fetch)';

class MediaFetchError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'MediaFetchError';
    this.code = code;
  }
}

// An https URL without credentials or a port, or null.
function parseMediaUrl(value) {
  if (typeof value !== 'string' || value.length > URL_MAX) return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch (err) {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (!url.hostname || url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local')) return null;
  return url;
}

// Loopback, link-local, private, multicast, unspecified and IPv4-mapped equivalents.
function isPrivateAddress(address) {
  const ip = String(address || '').toLowerCase();
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    if (ip === '::1' || ip === '::') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^(fc|fd|fe[89ab])/.test(ip) || ip.startsWith('ff');
  }
  return true; // not an address at all
}

// Every address of the host must be public (the first is used).
async function checkHost(url, lookup) {
  let addresses;
  if (net.isIP(url.hostname)) addresses = [{ address: url.hostname }];
  else {
    try {
      addresses = await lookup(url.hostname, { all: true, verbatim: true });
    } catch (err) {
      throw new MediaFetchError('unreachable', `${url.hostname}: ${err.code || err.message}`);
    }
  }
  if (!addresses || !addresses.length) throw new MediaFetchError('unreachable', url.hostname);
  if (addresses.some((a) => isPrivateAddress(a.address))) throw new MediaFetchError('private_address', url.hostname);
}

async function fetchToTemp(value, { temp, maxBytes, fetchImpl = fetch, lookup = (host, opts) => dns.promises.lookup(host, opts), timeoutMs = TIMEOUT_MS }) {
  const start = parseMediaUrl(value);
  if (!start) throw new MediaFetchError('bad_url');
  const signal = AbortSignal.timeout(timeoutMs);
  let current = start;
  let res;
  for (let hop = 0; ; hop++) {
    await checkHost(current, lookup);
    try {
      res = await fetchImpl(current.toString(), { headers: { 'User-Agent': USER_AGENT, Accept: 'image/*,video/*;q=0.9,*/*;q=0.5' }, redirect: 'manual', signal });
    } catch (err) {
      if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) throw new MediaFetchError('timeout');
      throw new MediaFetchError('unreachable', err && err.message);
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location || hop >= MAX_REDIRECTS) throw new MediaFetchError('upstream_error', `redirect ${res.status}`);
      let next;
      try {
        next = new URL(location, current);
      } catch (err) {
        throw new MediaFetchError('upstream_error', 'bad redirect');
      }
      const parsed = parseMediaUrl(next.toString());
      if (!parsed) throw new MediaFetchError('blocked_host', next.hostname);
      current = parsed;
      continue;
    }
    if (res.status === 404) throw new MediaFetchError('not_found');
    if (!res.ok) throw new MediaFetchError('upstream_error', `HTTP ${res.status}`);
    break;
  }
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new MediaFetchError('too_large');
  const out = fs.createWriteStream(temp, { flags: 'wx' });
  let size = 0;
  let head = Buffer.alloc(0);
  const fail = async (code, detail) => {
    out.destroy();
    await fs.promises.rm(temp, { force: true }).catch(() => {});
    throw new MediaFetchError(code, detail);
  };
  try {
    if (!res.body || typeof res.body.getReader !== 'function') {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) return fail('too_large');
      await new Promise((resolve, reject) => out.end(buf, (err) => (err ? reject(err) : resolve())));
      size = buf.length;
      head = buf.subarray(0, 64);
    } else {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        size += chunk.byteLength;
        if (size > maxBytes) {
          reader.cancel().catch(() => {});
          return fail('too_large');
        }
        if (head.length < 64) head = Buffer.concat([head, Buffer.from(chunk)]).subarray(0, 64);
        if (!out.write(Buffer.from(chunk))) await new Promise((resolve) => out.once('drain', resolve));
      }
      await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    }
  } catch (err) {
    if (err instanceof MediaFetchError) throw err;
    if (signal.aborted) return fail('timeout');
    return fail('unreachable', err && err.message);
  }
  if (!size) return fail('upstream_error', 'empty body');
  return { temp, size, head, finalUrl: current.toString() };
}

module.exports = { MediaFetchError, TIMEOUT_MS, parseMediaUrl, isPrivateAddress, fetchToTemp };
