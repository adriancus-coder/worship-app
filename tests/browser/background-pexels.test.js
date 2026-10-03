'use strict';

// Media → Fundaluri → "Caută pe Pexels" with a test key (fixtures/mock-pexels.js stands in
// for api.pexels.com and the CDN): the tab shows with suggestions, a search returns a grid
// (photos), the toggle switches to videos, "Adaugă" downloads the projector-size photo / the
// HD video into the library with the photographer's name + Pexels link as attribution
// (shown in the list), the same query within 10 minutes is served from the cache, a short
// query and a 429 give clear messages; Setări says "Pexels: activ". RO 375 / EN 1024.
// (Without a key the tab is hidden: checked by background-url.test.js.)

const path = require('path');
const { FIXTURES, layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'background-pexels',
  timeout: 240000,
  app: { preload: [path.join(FIXTURES, 'mock-pexels.js')], env: { PEXELS_API_KEY: 'test-key', PEXELS_API_URL: 'https://api.pexels.test' } },
  async run({ app, signIn, check }) {
    const owner = app.cookies.owner;
    for (const [lang, width] of [['ro', 375], ['en', 1024]]) {
      const tag = `[${lang} ${width}]`;
      const p = await signIn('leader', { width, lang });
      const res = await p.goto(`${app.url}/media`);
      const csp = (res.headers()['content-security-policy'] || '').split(';').find((d) => /^\s*img-src/.test(d)) || '';
      check(/https:\/\/images\.pexels\.com/.test(csp), `${tag} the page allows Pexels thumbnails (img-src)`, csp);
      await p.waitForSelector('#pexels-section:not([hidden])');
      const chips = await p.$$eval('#pexels-suggestions button', (l) => l.map((b) => b.textContent));
      check(chips.length >= 5 && chips.includes('sky') && chips.includes('worship'), `${tag} the tab shows with suggestions (${chips.join(', ')})`, chips);
      // a search: the photo grid
      await p.click('#pexels-suggestions button:has-text("sky")');
      await p.waitForSelector('#pexels-grid .pexels-item');
      const grid = await p.evaluate(() => [...document.querySelectorAll('#pexels-grid .pexels-item')].map((li) => ({ by: li.querySelector('.pexels-by').textContent, img: li.querySelector('img').getAttribute('src'), add: li.querySelector('button').textContent.trim() })));
      check(grid.length === 2 && /Ana Fotograf/.test(grid[0].by) && /cdn\.example\.org/.test(grid[0].img) && /(Adaugă|Add)/.test(grid[0].add), `${tag} search "sky": a grid of photos with thumbnails and photographers`, grid);
      const a = await layoutAudit(p, '#pexels-section');
      check(!a.overflow && !a.small.length, `${tag} the Pexels section: no overflow, targets >= 44 px`, a);
      // "Adaugă": the projector-size photo, attribution in the list
      await p.click('#pexels-grid .pexels-item >> nth=0 >> button');
      await p.waitForFunction(() => document.getElementById('pexels-message').classList.contains('success'), null, { timeout: 15000 });
      check(/Ana Fotograf/.test(await p.textContent('#pexels-message')) && /(Adăugată|Added)/.test(await p.locator('#pexels-grid .pexels-item').first().locator('button').textContent()), `${tag} "Adaugă": stored, the tile says Adăugată`, await p.textContent('#pexels-message'));
      await p.waitForSelector('.media-row:has-text("Blue sky")');
      const row = await p.locator('.media-row', { hasText: 'Blue sky' }).first().evaluate((li) => ({ source: (li.querySelector('.media-source') || {}).textContent, link: (li.querySelector('.media-source a') || {}).getAttribute && li.querySelector('.media-source a').getAttribute('href') }));
      check(/(Foto|Photo): Ana Fotograf/.test(row.source) && /Pexels/.test(row.source) && row.link === 'https://www.pexels.com/photo/sky-1001/', `${tag} the list shows "Foto: Ana Fotograf · Pexels" with the link`, row);
      // videos: the toggle, the HD file (never the 4K one)
      await p.click('#pexels-section [data-kind="videos"]');
      await p.waitForFunction(() => document.querySelectorAll('#pexels-grid .pexels-item').length === 1 && /Maria/.test(document.querySelector('#pexels-grid .pexels-by').textContent));
      check((await p.getAttribute('#pexels-section [data-kind="videos"]', 'aria-pressed')) === 'true' && /12 s/.test(await p.textContent('#pexels-grid .pexels-item')), `${tag} Video-uri: the toggle switches, the video with its duration`);
      await p.click('#pexels-grid .pexels-item button');
      await p.waitForFunction(() => /Maria/.test(document.getElementById('pexels-message').textContent) && document.getElementById('pexels-message').classList.contains('success'), null, { timeout: 15000 });
      const items = (await app.api(owner, 'GET', '/api/media')).body.media;
      const photo = items.find((m) => m.title === 'Blue sky with clouds');
      const video = items.find((m) => m.attribution && m.attribution.photographer === 'Maria Video');
      check(photo && photo.kind === 'image' && photo.thumb && photo.sourceUrl === 'https://cdn.example.org/sky.jpg?l2x' && photo.attribution.provider === 'pexels' && photo.attribution.photographerUrl === 'https://www.pexels.com/@ana', `${tag} API: the photo came from large2x with the attribution`, photo);
      check(video && video.kind === 'loop' && video.sourceUrl === 'https://cdn.example.org/loop.webm?hd', `${tag} API: the HD file (1920 px), not the 4K one`, video);
      // the cache: the same query again makes no second API call; a short query is refused
      const calls = await app.api(owner, 'GET', '/api/media/pexels/search?q=sky&kind=photos');
      check(calls.body.cached === true, `${tag} the same search within 10 minutes is served from the cache`);
      await p.click('#pexels-section [data-kind="photos"]');
      await p.fill('#pexels-q', 'a');
      await p.click('#pexels-search');
      await wait(300);
      check(/(două litere|two letters)/.test(await p.textContent('#pexels-message')), `${tag} a one-letter query: "Scrie cel puțin două litere"`);
      await p.fill('#pexels-q', 'nimic');
      await p.click('#pexels-search');
      await p.waitForFunction(() => /nimic/.test(document.getElementById('pexels-status').textContent));
      check(/(Niciun rezultat|No result)/.test(await p.textContent('#pexels-status')), `${tag} no results: a clear line`);
      await p.context().close();
      for (const m of [photo, video].filter(Boolean)) await app.api(owner, 'DELETE', `/api/media/${m.id}`);
    }
    // the rate limit: 60 searches an hour per church -> the 61st answers 429
    let status = 200;
    for (let i = 0; i < 62 && status !== 429; i++) status = (await app.api(owner, 'GET', `/api/media/pexels/search?q=q${i}&kind=photos`)).status;
    check(status === 429, 'the 61st distinct search in an hour answers 429 (rate limit)');
    // Setări: "Pexels: activ"
    const o = await signIn('owner', { width: 1024 });
    await o.goto(`${app.url}/settings`);
    await o.waitForFunction(() => /\S/.test(document.getElementById('pexels-status').textContent));
    check(/Pexels: activ/.test(await o.textContent('#pexels-status')), 'Setări: "Pexels: activ"');
    // a member: no access to the provider
    check((await app.api(app.cookies.member, 'GET', '/api/media/pexels/search?q=sky')).status === 403, 'member: 403 on the Pexels search');
  },
};
