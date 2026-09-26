'use strict';

// Media (owner / leader): upload a video with progress, refuse a file that is not a video,
// add a link (YouTube) and refuse a page link, background images; the editor picks a video
// from the library; delete; RO/EN; phone layout.

const path = require('path');
const { FIXTURES, layoutAudit } = require('./harness');

module.exports = {
  name: 'media',
  async run({ app, signIn, check }) {
    const { eventId: E } = app.seed;
    for (const width of [1024, 375]) {
      const tag = `[${width}]`;
      const p = await signIn('leader', { width });
      await p.waitForSelector('#app-shell .shell-label:not(:empty)');
      await p.click('.shell-more');
      await p.click('#shell-panel [data-page=media]');
      await p.waitForURL('**/media');
      await p.waitForFunction(() => !/^Se încarcă/.test(document.getElementById('status').textContent));
      // a slow uplink (100 KB/s) so the progress bar is seen
      const cdp = await p.context().newCDPSession(p);
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: 100 * 1024 });
      const progress = p.waitForSelector('#upload-progress:not([hidden])', { timeout: 5000 }).then(() => true, () => false);
      await p.setInputFiles('#upload-file', path.join(FIXTURES, 'clip.webm'));
      const uploaded = await p.waitForFunction(() => /încărcat/.test(document.getElementById('upload-message').textContent), null, { timeout: 10000 }).then(() => true, () => false);
      check(uploaded && await progress, `${tag} a video uploads, with progress`, await p.textContent('#upload-message'));
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await p.setInputFiles('#upload-file', { name: 'fals.mp4', mimeType: 'video/mp4', buffer: Buffer.from('text only, not a video at all'.repeat(3)) });
      const refused = await p.waitForFunction(() => document.getElementById('upload-message').classList.contains('error'), null, { timeout: 5000 }).then(() => true, () => false);
      check(refused, `${tag} a text file named .mp4 is refused`, await p.textContent('#upload-message'));
      await p.setInputFiles('#bg-file', path.join(FIXTURES, 'bg-sunrise.jpg'));
      const bg = await p.waitForFunction(() => /încărcat/.test(document.getElementById('bg-message').textContent), null, { timeout: 10000 }).then(() => true, () => false);
      check(bg, `${tag} a background image uploads`, await p.textContent('#bg-message'));
      await p.fill('#url-title', 'Clip YouTube');
      await p.fill('#url-value', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      await p.click('#url-form button[type=submit]');
      check(await p.waitForFunction(() => /adăugat/.test(document.getElementById('url-message').textContent), null, { timeout: 4000 }).then(() => true, () => false), `${tag} a YouTube link is added`);
      await p.fill('#url-title', 'Rău');
      await p.fill('#url-value', 'https://example.com/pagina');
      await p.click('#url-form button[type=submit]');
      await p.waitForTimeout(300);
      check(await p.$eval('#url-message', (x) => x.classList.contains('error')), `${tag} a page link is refused`, await p.textContent('#url-message'));
      check(await p.locator('.media-row').count() === 3, `${tag} the list shows the video, the background and the link`, await p.locator('.media-row').count());
      if (width === 1024) {
        await p.goto(`${app.url}/events/${E}/edit`);
        await p.waitForSelector('#event:not([hidden])');
        await p.click('[data-add=video]');
        await p.waitForSelector('#it-media');
        await p.selectOption('#it-media', { label: 'clip' });
        await p.waitForTimeout(200);
        check(await p.inputValue('#it-title') === 'clip', 'editor: picking a library video fills its title');
        await p.click('#save-button');
        await p.waitForFunction(() => document.getElementById('save-state').textContent === 'Salvat.');
        const items = (await app.api(app.cookies.owner, 'GET', `/api/events/${E}`)).body.items;
        check(items.some((it) => it.type === 'video' && it.mediaId), 'editor: the video item is saved with its media id');
        await p.goto(`${app.url}/media`);
        await p.waitForSelector('.media-row');
      }
      const a = await layoutAudit(p, 'main');
      check(!a.overflow, `${tag} no horizontal overflow`, a);
      // delete everything for the next width
      while (await p.locator('.media-row').count()) {
        const n = await p.locator('.media-row').count();
        await p.click('.media-row >> nth=0 >> text=Șterge');
        await p.click('#delete-dialog button[value=delete]');
        await p.waitForFunction((n) => document.querySelectorAll('.media-row').length < n, n, { timeout: 4000 });
      }
      check(true, `${tag} every item deleted`);
      await p.request.put(`${app.url}/api/me/locale`, { data: { locale: 'en' } });
      await p.reload();
      check(/Media/.test(await p.textContent('h1')) && /Upload|video/i.test(await p.textContent('#upload-heading')), `${tag} the page in English`);
      await p.context().close();
    }
  },
};
