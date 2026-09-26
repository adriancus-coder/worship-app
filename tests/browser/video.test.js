'use strict';

// Video on the projector: prepare from the library (the screen keeps showing lyrics), play
// (the screen plays within a second, the leader panel shows the time), pause, restart,
// volume, the end (the screen goes black, never back to lyrics on its own), stop; a file
// chosen on the projector PC; a YouTube link prepared as an iframe; a projector whose
// browser needs a click before sound says so on the leader panel.

const fs = require('fs');
const path = require('path');
const { FIXTURES, layoutAudit } = require('./harness');

async function pairScreen(app, browser, name, init) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  if (init) await context.addInitScript(init);
  const sp = await context.newPage();
  await sp.goto(`${app.url}/screen`);
  await sp.waitForFunction(() => /\d{3} \d{3}/.test(document.getElementById('pairing-code').textContent));
  await app.api(app.cookies.owner, 'POST', '/api/screens/claim', { code: (await sp.textContent('#pairing-code')).replace(' ', ''), name });
  await sp.waitForSelector('#output:not([hidden])', { timeout: 6000 });
  return sp;
}

module.exports = {
  name: 'video',
  timeout: 240000,
  async run({ app, browser, signIn, check }) {
    const { eventId: E } = app.seed;
    const up = await app.api(app.cookies.leader, 'POST', `/api/media/upload?title=${encodeURIComponent('Clip anunț')}`, fs.readFileSync(path.join(FIXTURES, 'clip.webm')), { 'Content-Type': 'video/webm' });
    check(up.status === 201, 'the clip is in the media library');
    await app.api(app.cookies.leader, 'POST', '/api/media/url', { title: 'Clip YouTube', url: 'https://youtu.be/dQw4w9WgXcQ' });
    const sp = await pairScreen(app, browser, 'Proiector sală');
    const csp = [];
    sp.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) csp.push(m.text().slice(0, 120)); });
    const lp = await signIn('leader', { width: 1280, height: 900 });
    await lp.goto(`${app.url}/events/${E}/live`);
    await lp.waitForSelector('#live:not([hidden])');
    await lp.click('#start-button');
    await sp.waitForFunction(() => /Ne ridici/.test(document.getElementById('output').innerText));
    const screen = () => sp.evaluate(() => {
      const v = document.querySelector('#video-layer video');
      const f = document.querySelector('#video-layer iframe');
      return { text: document.getElementById('output').innerText, visible: document.getElementById('video-layer').classList.contains('visible'),
        video: v ? { paused: v.paused, t: v.currentTime, volume: v.volume, src: v.src.slice(0, 5) } : null, iframe: f ? f.src : null };
    });
    const status = () => lp.textContent('#video-status-text');

    await lp.click('#video-panel .video-row:has-text("Clip anunț") button');
    await lp.waitForTimeout(800);
    let s = await screen();
    check(!s.visible && /Ne ridici/.test(s.text), 'prepared: the screen still shows the lyrics', s);
    const t0 = Date.now();
    await lp.click('#video-toggle');
    const playing = await sp.waitForFunction(() => { const v = document.querySelector('#video-layer video'); return v && !v.paused && v.currentTime > 0.2; }, null, { timeout: 5000 }).then(() => true, () => false);
    check(playing && Date.now() - t0 < 1500, `play: the screen plays within ${Date.now() - t0} ms`);
    check(await lp.waitForFunction(() => /Rulează/.test(document.getElementById('video-status-text').textContent), null, { timeout: 4000 }).then(() => true, () => false), 'the leader panel shows it playing', await status());
    await lp.click('#video-toggle');
    await lp.waitForTimeout(600);
    check((await screen()).video.paused, 'pause: the screen pauses');
    await lp.$eval('#video-volume', (i) => { i.value = '0.4'; i.dispatchEvent(new Event('change')); });
    await lp.waitForTimeout(500);
    check(Math.abs((await screen()).video.volume - 0.4) < 0.01, 'volume 0.4 reaches the screen');
    await lp.click('#video-restart');
    await lp.waitForTimeout(500);
    check((await screen()).video.t < 0.5, 'restart: back to 0');
    await lp.click('#video-toggle');
    const ended = await sp.waitForFunction(() => !document.getElementById('video-layer').classList.contains('visible'), null, { timeout: 10000 }).then(() => true, () => false);
    s = await screen();
    check(ended && s.text === '', 'the end: the screen goes black, not back to the lyrics', s.text);
    check(await lp.$eval('[data-source="black"]', (b) => b.getAttribute('aria-pressed') === 'true'), 'the leader sees "Ecran negru" selected');
    await lp.click('#video-stop');

    // A file chosen on the projector PC
    await lp.click('#video-tab-usb');
    await lp.click('#video-panel button:has-text("Pregătește un fișier")');
    await sp.waitForSelector('.local-picker:not([hidden])', { timeout: 4000 });
    await sp.setInputFiles('.local-picker input[type=file]', path.join(FIXTURES, 'clip.webm'));
    const chosen = await lp.waitForFunction(() => /clip\.webm/.test((document.querySelector('.video-status-title') || {}).textContent || ''), null, { timeout: 4000 }).then(() => true, () => false);
    check(chosen, 'a file chosen on the projector PC shows on the leader panel');
    await lp.click('#video-toggle');
    check(await sp.waitForFunction(() => { const v = document.querySelector('#video-layer video'); return v && !v.paused && v.src.startsWith('blob:'); }, null, { timeout: 5000 }).then(() => true, () => false), 'it plays from the local file');
    await lp.click('#video-stop');
    await lp.waitForTimeout(400);

    // YouTube: an iframe (no network needed to check it is prepared)
    await lp.click('#video-tab-library');
    await lp.click('#video-panel .video-row:has-text("Clip YouTube") button');
    await lp.waitForTimeout(800);
    check(/youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/.test((await screen()).iframe || ''), 'a YouTube link is prepared as a youtube-nocookie iframe', (await screen()).iframe);
    await lp.click('[data-source="content"]');
    check(csp.length === 0, 'no Content Security Policy violations on the screen', csp);
    const a = await layoutAudit(lp, '#video-panel');
    check(!a.overflow && !a.small.length, 'video panel: no overflow, targets >= 44 px', a);

    // A projector that needs a click before playing sound
    await sp.close();
    await lp.waitForTimeout(500);
    await lp.click('#video-panel .video-row:has-text("Clip anunț") button');
    const strict = await pairScreen(app, browser, 'Proiector 2', () => {
      const play = HTMLMediaElement.prototype.play;
      let clicked = false;
      window.addEventListener('pointerdown', () => { clicked = true; }, true);
      HTMLMediaElement.prototype.play = function () {
        if (!clicked) return Promise.reject(new DOMException('play() needs a user gesture', 'NotAllowedError'));
        return play.call(this);
      };
    });
    await lp.waitForTimeout(500);
    await lp.click('#video-toggle');
    const blocked = await lp.waitForFunction(() => /Apasă o dată/.test(document.getElementById('video-status-text').textContent), null, { timeout: 5000 }).then(() => true, () => false);
    check(blocked, 'autoplay blocked: the leader panel asks for one click on the projector', await status());
    await strict.mouse.click(400, 200);
    check(await strict.waitForFunction(() => { const v = document.querySelector('#video-layer video'); return v && !v.paused; }, null, { timeout: 5000 }).then(() => true, () => false), 'after one click on the projector the video plays');
  },
};
