// Browser tests only (preloaded with --require): a stand-in for Sanctuary Voice's bridge REST
// at https://sv.test (docs/BRIDGE.md). The pairing code "K7MNPQ" pairs once (then it is used);
// the pairing token is "pt-test"; two events (one live); connect hands out a bridge token.
// Every call is recorded in global.__svCalls. The /bridge socket is not served: the hub's
// socket.io-client just retries in the background (the bridge degrades gracefully).
const dns = require('dns');

global.__svCalls = [];
let codeUsed = false;
let unpaired = false;

const realLookup = dns.promises.lookup;
dns.promises.lookup = async (host, opts) => {
  if (host === 'sv.test') return opts && opts.all ? [{ address: '203.0.113.40', family: 4 }] : { address: '203.0.113.40', family: 4 };
  return realLookup(host, opts);
};

const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  const u = new URL(url);
  if (u.hostname !== 'sv.test') return realFetch(url, opts);
  const res = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const headers = (opts && opts.headers) || {};
  const body = opts && opts.body ? JSON.parse(opts.body) : {};
  global.__svCalls.push({ path: u.pathname, auth: headers.Authorization || null, body });
  if (u.pathname === '/api/bridge/pair') {
    if (body.code !== 'K7MNPQ') return res(404, { ok: false, error: 'invalid_code' });
    if (codeUsed) return res(400, { ok: false, error: 'code_used' });
    codeUsed = true;
    unpaired = false;
    return res(200, { ok: true, pairingToken: 'pt-test', svOrgId: 'org-1', svOrgName: 'Biserica Harul (SV)', expiresAt: null });
  }
  if (headers.Authorization !== 'Bearer pt-test' || unpaired) return res(401, { ok: false, error: 'unpaired' });
  if (u.pathname === '/api/bridge/events') {
    return res(200, { ok: true, events: [
      { svEventId: 'sv-live', name: 'Serviciu duminică', startsAt: Date.now() - 600000, status: 'live', targetLanguages: ['en', 'no'] },
      { svEventId: 'sv-next', name: 'Seara de rugăciune', startsAt: Date.now() + 86400000, status: 'planned', targetLanguages: ['en'] },
    ] });
  }
  if (u.pathname === '/api/bridge/connect') {
    if (!['sv-live', 'sv-next'].includes(body.svEventId)) return res(404, { ok: false, error: 'unknown_event' });
    return res(200, { ok: true, bridgeToken: `bt-${body.svEventId}`, svEventId: body.svEventId, targetLanguages: body.svEventId === 'sv-live' ? ['en', 'no'] : ['en'], expiresAt: Date.now() + 12 * 3600000 });
  }
  if (u.pathname === '/api/bridge/unpair') { unpaired = true; return res(200, { ok: true }); }
  if (u.pathname === '/api/bridge/revoke' || u.pathname === '/api/bridge/status') return res(200, { ok: true, connected: true });
  return res(404, { ok: false, error: 'not_found' });
};
