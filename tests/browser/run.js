'use strict';

// Runs the browser smoke tests: node tests/browser/run.js [name ...]
// Each *.test.js exports { name, timeout?, app? (startApp options), run(ctx) };
// ctx = { app, browser, check, errors, pages, signIn(role, options) }. Every test gets a fresh server and browser; uncaught page
// errors fail it. Exit code 1 when any check failed.

const fs = require('fs');
const path = require('path');
const H = require('./harness');

const only = process.argv.slice(2);
const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js')).sort()
  .filter((f) => !only.length || only.some((name) => f.startsWith(name)));

async function runOne(file) {
  const test = require(path.join(__dirname, file));
  const results = [];
  const check = (ok, label, detail) => {
    results.push({ ok: Boolean(ok), label, detail });
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
    return Boolean(ok);
  };
  const started = Date.now();
  console.log(`\n# ${test.name || file}`);
  let app = null;
  let browser = null;
  const ctx = { check, errors: [], pages: [] };
  try {
    app = await H.startApp(test.app || {});
    browser = await H.launch();
    Object.assign(ctx, { app, browser, signIn: (role, options) => H.signIn(ctx, role, options) });
    let timer;
    const limit = new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${test.timeout || 180000} ms`)), test.timeout || 180000); });
    await Promise.race([test.run(ctx), limit]);
    clearTimeout(timer);
    check(ctx.errors.length === 0, 'no uncaught page errors', ctx.errors);
  } catch (err) {
    check(false, 'test ran to the end', err.stack || String(err));
    // What the open pages were showing, for a wait that never ended.
    if (ctx.errors.length) console.log(`  page errors so far:\n    ${ctx.errors.join('\n    ')}`);
    if (ctx.console && ctx.console.length) console.log(`  console so far:\n    ${ctx.console.slice(-12).join('\n    ')}`);
    for (const page of ctx.pages) {
      if (page.isClosed()) continue;
      const info = await page.evaluate(() => ({
        url: location.pathname,
        status: (document.getElementById('status') || {}).textContent,
        connection: (document.getElementById('connection-text') || {}).textContent,
        hiddenMain: ['live', 'console', 'follow', 'event'].map((id) => { const n = document.getElementById(id); return n ? `${id}:${n.hidden}` : null; }).filter(Boolean).join(' '),
        body: document.body.innerText.slice(0, 200).replace(/\s+/g, ' '),
      })).catch((e) => ({ error: String(e) }));
      console.log(`  page ${JSON.stringify(info)}`);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (app) await app.stop().catch(() => {});
    if (app) fs.rmSync(app.dataDir, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`# ${test.name || file}: ${results.length - failed}/${results.length} ok in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  return { file, failed, total: results.length };
}

(async () => {
  const summary = [];
  for (const file of files) summary.push(await runOne(file));
  console.log('\nSummary');
  for (const s of summary) console.log(`  ${s.failed ? 'FAIL' : 'ok  '} ${s.file} (${s.total - s.failed}/${s.total})`);
  process.exit(summary.some((s) => s.failed) ? 1 : 0);
})();
