// Browser tests only (preloaded with --require): stands in for a push service at push.test.
// Every delivery is appended as one JSON line to DATA_DIR/push-outbox.jsonl ({ endpoint, headers,
// body (base64) }); an endpoint ending in /gone answers 410 (the browser dropped it).
const fs = require('fs');
const path = require('path');
const realFetch = global.fetch;
const outbox = path.join(process.env.DATA_DIR, 'push-outbox.jsonl');
global.fetch = async (url, opts) => {
  const u = new URL(url);
  if (u.hostname !== 'push.test') return realFetch(url, opts);
  if (u.pathname.endsWith('/gone')) return new Response('', { status: 410 });
  fs.appendFileSync(outbox, `${JSON.stringify({ endpoint: String(url), headers: opts.headers, body: Buffer.from(opts.body).toString('base64') })}\n`);
  return new Response('', { status: 201 });
};
