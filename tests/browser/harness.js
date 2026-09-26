'use strict';

// Browser smoke tests (tests/browser/README.md): a fresh server per test (temp DATA_DIR,
// free port) seeded with one admin, four users and a live-ready event, plus Playwright
// helpers. Nothing here is loaded by the app or by `npm run check`.

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const { hashPassword } = require('../../lib/auth');

const ROOT = path.resolve(__dirname, '..', '..');
const PASSWORD = 'parola-lunga-1';
const USERS = { owner: 'ana@example.ro', leader: 'lider@x.ro', operator: 'op@x.ro', member: 'm@x.ro' };
const FIXTURES = path.join(__dirname, 'fixtures');

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    }).on('error', reject);
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- the server --------------------------------------------------------------------

// options.preload: modules loaded into the server first (e.g. fixtures/mock-resurse.js).
async function startApp(options = {}) {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-browser-'));
  const url = `http://127.0.0.1:${port}`;
  const app = { url, port, dataDir, proc: null, log: [] };

  app.start = async () => {
    app.proc = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      // DISK_MIN_FREE_PCT: a test machine's disk may be fuller than the default guard.
      env: {
        ...process.env, DATA_DIR: dataDir, PORT: String(port), SETUP_TOKEN: 'browser-test', NODE_ENV: 'test', LOG_LEVEL: 'warn', DISK_MIN_FREE_PCT: '1',
        NODE_OPTIONS: (options.preload || []).map((file) => `--require ${JSON.stringify(file)}`).join(' '),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [app.proc.stdout, app.proc.stderr]) stream.on('data', (chunk) => app.log.push(String(chunk)));
    for (let i = 0; i < 200; i++) {
      try {
        if ((await fetch(`${url}/api/health`)).ok) return;
      } catch {
        // not listening yet
      }
      await wait(50);
    }
    throw new Error(`server did not start:\n${app.log.join('')}`);
  };

  // SIGTERM: a clean stop (lib/shutdown.js). -> exit code
  app.stop = () => new Promise((resolve) => {
    if (!app.proc || app.proc.exitCode !== null) return resolve(app.proc ? app.proc.exitCode : null);
    app.proc.once('exit', (code) => resolve(code));
    app.proc.kill('SIGTERM');
  });

  app.api = async (cookie, method, url2, body, headers = {}) => {
    const raw = Buffer.isBuffer(body);
    const res = await fetch(url + url2, {
      method,
      headers: { ...(raw ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : (raw ? body : JSON.stringify(body)),
    });
    return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
  };

  app.login = async (email) => {
    const res = await app.api(null, 'POST', '/api/auth/login', { email, password: PASSWORD });
    if (res.status !== 200) throw new Error(`login ${email}: ${res.status}`);
    return /wa_sid=[0-9a-f]+/.exec(res.headers.get('set-cookie'))[0];
  };

  // A socket command as the owner (moves live state without a page).
  app.command = async (cmd) => {
    const { io } = require('socket.io-client');
    const socket = io(url, { transports: ['websocket'], extraHeaders: { Cookie: app.cookies.owner }, reconnection: false });
    const emit = (event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    await emit('live:join', { eventId: cmd.eventId || app.seed.eventId });
    const reply = await emit('live:command', { eventId: app.seed.eventId, ...cmd });
    socket.close();
    return reply;
  };

  // The live state the server holds now (as the owner sees it).
  app.state = async (eventId) => {
    const { io } = require('socket.io-client');
    const socket = io(url, { transports: ['websocket'], extraHeaders: { Cookie: app.cookies.owner }, reconnection: false });
    const state = new Promise((resolve) => socket.once('live:state', resolve));
    socket.on('connect', () => socket.emit('live:join', { eventId: eventId || app.seed.eventId }));
    const out = await state;
    socket.close();
    return out;
  };

  await app.start();
  await seed(app);
  return app;
}

// One admin ("Biserica Harul"), owner / leader / operator / member, three songs and the
// event "Serviciu duminică" today: song, verse, song, announcement, song (published);
// "Seara" (published, a week later).
async function seed(app) {
  const setup = await app.api(null, 'POST', '/api/setup', {
    setupToken: 'browser-test', adminName: 'Biserica Harul', ownerName: 'Ana', ownerEmail: USERS.owner, ownerPassword: PASSWORD,
  });
  if (setup.status >= 300) throw new Error(`setup: ${setup.status} ${JSON.stringify(setup.body)}`);
  const db = new Database(path.join(app.dataDir, 'worship.db'));
  const hash = await hashPassword(PASSWORD);
  const insert = db.prepare('INSERT INTO users (admin_id, email, name, password_hash, role, created_at) VALUES (1, ?, ?, ?, ?, 0)');
  insert.run(USERS.leader, 'Lider', hash, 'leader');
  insert.run(USERS.operator, 'Operator', hash, 'operator');
  insert.run(USERS.member, 'Membru', hash, 'member');
  db.close();
  app.cookies = {};
  for (const [role, email] of Object.entries(USERS)) app.cookies[role] = await app.login(email);
  const owner = app.cookies.owner;
  const song = async (body) => (await app.api(owner, 'POST', '/api/songs', body)).body.song.id;
  const songs = {
    G: await song({ title: 'Sfânt în G', song_key: 'G', sections: [
      { type: 'verse', content: '[G]Ne ridici din [D]noaptea grea\n[Em]Tu ești [C]lumina mea' },
      { type: 'chorus', content: '[C]Sfânt, [G/B]sfânt, [D/F#]sfânt\n[Em]Domnul [C]Dumnezeu' }] }),
    SIX: await song({ title: 'Șase rânduri', song_key: 'D', sections: [
      { type: 'verse', content: '[D]Primul rând\n[A]Al doilea rând\n[Bm]Al treilea rând\n[G]Al patrulea rând\n[D]Al cincilea rând\n[A]Al șaselea rând' }] }),
    T3: await song({ title: 'Mare ești Tu', song_key: 'C', sections: [
      { type: 'verse', content: '[C]Mare ești Tu, [F]Doamne\n[G]Mare-i numele Tău' },
      { type: 'chorus', content: '[F]Aleluia, [C]aleluia' }] }),
  };
  const today = (await app.api(owner, 'GET', '/api/events')).body.today;
  const later = new Date(`${today}T12:00:00Z`);
  later.setUTCDate(later.getUTCDate() + 7);
  const event = async (name, eventDate, items) => {
    const id = (await app.api(owner, 'POST', '/api/events', { name, eventDate, startTime: '10:00' })).body.event.id;
    if (items) await app.api(owner, 'PUT', `/api/events/${id}/items`, { items });
    await app.api(owner, 'POST', `/api/events/${id}/publish`);
    return id;
  };
  const eventId = await event('Serviciu duminică', today, [
    { type: 'song', songId: songs.G },
    { type: 'verse', reference: 'Luca 2:1-7', body: 'În zilele acelea a ieșit o poruncă de la Cezar August.' },
    { type: 'song', songId: songs.SIX },
    { type: 'announcement', title: 'Agapă', body: 'După serviciu, în sala mică.' },
    { type: 'song', songId: songs.T3 },
  ]);
  const items = (await app.api(owner, 'GET', `/api/events/${eventId}`)).body.items.map((it) => it.id);
  const event2Id = await event('Seara', later.toISOString().slice(0, 10), [{ type: 'verse', reference: 'Psalmul 23' }]);
  app.seed = { songs, eventId, event2Id, items, today };
}

// --- the browser -------------------------------------------------------------------

function loadPlaywright() {
  try {
    return require('playwright');
  } catch (err) {
    throw new Error('Playwright is not installed: npm install (devDependencies), then npx playwright install chromium');
  }
}

async function launch() {
  const { chromium } = loadPlaywright();
  // CHROMIUM_PATH: a Chromium already on the machine instead of Playwright's download.
  return chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
}

// A signed-in page. width < 600 is a phone (touch); lang 'ro' | 'en' (saved on the user).
async function signIn(ctx, role, { width = 1024, height, lang = 'ro', touch = width < 600, reducedMotion } = {}) {
  const context = await ctx.browser.newContext({
    viewport: { width, height: height || (width < 600 ? 667 : 820) }, hasTouch: touch, isMobile: touch, reducedMotion,
  });
  const page = await context.newPage();
  page.on('pageerror', (err) => ctx.errors.push(`${role} ${width}: ${err.message}`));
  await page.goto(`${ctx.app.url}/login`);
  await page.fill('[name=email]', USERS[role]);
  await page.fill('[name=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL('**/app');
  await page.request.put(`${ctx.app.url}/api/me/locale`, { data: { locale: lang } });
  page.touch = touch;
  ctx.pages.push(page);
  return page;
}

// Horizontal overflow and touch targets under 44 px inside `scope` (visible ones).
function layoutAudit(page, scope = 'body') {
  return page.evaluate((scope) => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    small: [...document.querySelectorAll(`${scope} a, ${scope} button`)]
      .filter((x) => x.getClientRects().length && !x.closest('[hidden], dialog:not([open])'))
      .filter((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && (r.height < 44 || r.width < 44); })
      .map((x) => (x.getAttribute('aria-label') || x.textContent).trim().slice(0, 40)),
  }), scope);
}

module.exports = { ROOT, PASSWORD, USERS, FIXTURES, wait, startApp, launch, signIn, layoutAudit };
