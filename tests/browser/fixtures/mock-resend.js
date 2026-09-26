// Browser tests only (preloaded with --require): stands in for api.resend.com. Every email the
// server sends is appended as one JSON line to DATA_DIR/outbox.jsonl ({ to, subject, text,
// html }); the tests read the links from there. A recipient at fail.example gets a 500 twice.
const fs = require('fs');
const path = require('path');
const realFetch = global.fetch;
const outbox = path.join(process.env.DATA_DIR, 'outbox.jsonl');
global.fetch = async (url, opts) => {
  const u = new URL(url);
  if (u.hostname !== 'api.resend.com') return realFetch(url, opts);
  const body = JSON.parse(opts.body);
  if (!/^Bearer re_/.test(opts.headers.Authorization)) return new Response('{"message":"unauthorized"}', { status: 401 });
  if (String(body.to[0]).endsWith('@fail.example')) return new Response('{"message":"boom"}', { status: 500 });
  fs.appendFileSync(outbox, `${JSON.stringify({ to: body.to[0], subject: body.subject, text: body.text, html: body.html })}\n`);
  return new Response(JSON.stringify({ id: `em_${Date.now()}` }), { status: 200, headers: { 'content-type': 'application/json' } });
};
