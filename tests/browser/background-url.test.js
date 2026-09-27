'use strict';

// Media → Fundaluri → "Din link" (fixtures/mock-cdn.js stands in for the internet): an https
// image and a video are fetched by the server and stored like uploads (projector version for
// the image, "sursă: <host>" caption, source kept), the image works as a background; a page,
// a private address, a too-big file, a redirect to http, a 404 and an http link give clear
// errors. RO 375 / EN 1024.

const path = require('path');
const { FIXTURES, layoutAudit } = require('./harness');

module.exports = {
  name: 'background-url',
  timeout: 240000,
  app: { preload: [path.join(FIXTURES, 'mock-cdn.js')] },
  async run({ app, signIn, check }) {
    const owner = app.cookies.owner;
    for (const [lang, width] of [['ro', 375], ['en', 1024]]) {
      const tag = `[${lang} ${width}]`;
      const p = await signIn('leader', { width, lang });
      await p.goto(`${app.url}/media`);
      await p.waitForFunction(() => !/^(Se încarcă|Loading)/.test(document.getElementById('status').textContent));
      const add = async (url) => {
        await p.fill('#bg-url', url);
        await p.click('#bg-url-submit');
        await p.waitForFunction(() => { const m = document.getElementById('bg-url-message'); return m.classList.contains('success') || m.classList.contains('error'); }, null, { timeout: 15000 });
        return { ok: await p.$eval('#bg-url-message', (m) => m.classList.contains('success')), text: await p.textContent('#bg-url-message') };
      };
      // an image, via a redirect
      let r = await add('https://cdn.example.org/redirect');
      check(r.ok && /sky/.test(r.text) && /cdn\.example\.org/.test(r.text), `${tag} an image by link (through a redirect): "sky" added, source cdn.example.org`, r);
      await p.waitForSelector('.media-row:has-text("sky")');
      const row = await p.locator('.media-row', { hasText: 'sky' }).first().evaluate((li) => ({ meta: li.querySelector('.screen-meta').textContent, source: (li.querySelector('.media-source') || {}).textContent, thumb: Boolean(li.querySelector('img.media-thumb')) }));
      check(/Imagine|Image/.test(row.meta) && /(sursă|source): cdn\.example\.org/.test(row.source) && row.thumb, `${tag} listed as an image with a thumbnail and "sursă: cdn.example.org"`, row);
      // a video loop
      r = await add('https://cdn.example.org/loop.webm');
      check(r.ok && /loop/.test(r.text), `${tag} a video by link: "loop" added`, r);
      await p.waitForSelector('.media-row:has-text("loop")');
      check(/Buclă|Loop|WebM/.test(await p.locator('.media-row', { hasText: 'loop' }).first().locator('.screen-meta').first().textContent()), `${tag} listed as a video loop`);
      // clear errors
      const errors = [
        ['https://cdn.example.org/page.html', /(nu duce la o imagine|does not lead to)/, 'not an image'],
        ['https://private.example.org/a.jpg', /(rețeaua locală|local network)/, 'a private address'],
        ['https://cdn.example.org/big.jpg', /(prea mare|too large|cel mult|at most)/, 'too big'],
        ['https://cdn.example.org/elsewhere', /https:\/\//, 'a redirect to http'],
        ['https://cdn.example.org/missing', /404/, 'a 404'],
        ['http://cdn.example.org/sky.jpg', /https:\/\//, 'an http link'],
      ];
      for (const [url, re, what] of errors) {
        r = await add(url);
        check(!r.ok && re.test(r.text), `${tag} ${what}: a clear error`, r);
      }
      const a = await layoutAudit(p, 'main');
      check(!a.overflow && !a.small.length, `${tag} media page: no overflow, targets >= 44 px`, a);
      await p.context().close();
      // API: the image has its projector version and works as a background
      const items = (await app.api(owner, 'GET', '/api/media')).body.media;
      const sky = items.find((m) => m.title === 'sky');
      const loop = items.find((m) => m.title === 'loop');
      check(sky && sky.kind === 'image' && sky.category === 'background' && sky.thumb && sky.sourceUrl === 'https://cdn.example.org/sky.jpg' && loop && loop.kind === 'loop' && loop.sourceUrl === 'https://cdn.example.org/loop.webm', `${tag} API: image + loop stored as backgrounds with source_url`, { sky, loop });
      const display = await fetch(`${app.url}/api/media/${sky.id}/file?v=display`, { headers: { Cookie: owner } });
      check(display.status === 200 && /image\/webp/.test(display.headers.get('content-type') || ''), `${tag} the projector-size WebP is served`, display.status);
      const set = await app.api(owner, 'PUT', `/api/songs/${app.seed.songs.G}/background`, { background: sky.id });
      check(set.status === 200, `${tag} the fetched image can be a song's background`, set.body);
      for (const m of [sky, loop]) await app.api(owner, 'DELETE', `/api/media/${m.id}`);
    }
  },
};
