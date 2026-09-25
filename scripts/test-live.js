'use strict';

// Live mode against a real server (fresh temp DATA_DIR, random port) with socket.io-client:
// handshake auth, room visibility, ordered versions for every client, roles, stale
// versions, setlist clamping, reconnects and a server restart. No external network.

const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const Database = require('better-sqlite3');
const { hashPassword } = require('../lib/auth');

const ROOT = path.resolve(__dirname, '..');
const PASSWORD = 'parola-lunga-1';
const STARTED = Date.now();

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-live-'));
let port;
let server = null;
const sockets = [];

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port: p } = probe.address();
      probe.close(() => resolve(p));
    }).on('error', reject);
  });
}

async function startServer() {
  server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), SETUP_TOKEN: 'live-test', NODE_ENV: 'test', LOG_LEVEL: 'error' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base()}/api/health`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('server did not start');
}

function stopServer() {
  return new Promise((resolve) => {
    if (!server || server.exitCode !== null) return resolve();
    server.once('exit', resolve);
    server.kill();
  });
}

const base = () => `http://127.0.0.1:${port}`;

async function api(method, url, cookie, body) {
  const res = await fetch(base() + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}

async function login(email) {
  const res = await api('POST', '/api/auth/login', null, { email, password: PASSWORD });
  assert.strictEqual(res.status, 200, `login ${email}`);
  return /wa_sid=[0-9a-f]+/.exec(res.headers.get('set-cookie'))[0];
}

function connect(cookie, options = {}) {
  const socket = io(base(), { transports: ['websocket'], extraHeaders: cookie ? { Cookie: cookie } : {}, reconnection: false, ...options });
  sockets.push(socket);
  return socket;
}

// Resolves with the first `event` (optionally matching `test`), or rejects after ms.
function next(socket, event, test = () => true, ms = 3000) {
  const origin = new Error().stack.split('\n')[3];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for ${event} ${origin}`));
    }, ms);
    function handler(payload) {
      if (!test(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

const emit = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));

async function joined(cookie, eventId) {
  const socket = connect(cookie);
  await next(socket, 'connect');
  const state = next(socket, 'live:state');
  const ack = await emit(socket, 'live:join', { eventId });
  assert.strictEqual(ack.ok, true, `join ${eventId}: ${JSON.stringify(ack)}`);
  return { socket, state: await state };
}

const results = [];
async function step(name, fn) {
  await fn();
  results.push(name);
}

async function main() {
  port = await freePort();
  await startServer();

  // Accounts: owner (admin 1), leader and member (admin 1), owner of admin 2.
  assert.strictEqual((await api('POST', '/api/setup', null, {
    setupToken: 'live-test', adminName: 'Biserica', ownerName: 'Ana', ownerEmail: 'ana@x.ro', ownerPassword: PASSWORD,
  })).status, 200);
  const db = new Database(path.join(dataDir, 'worship.db'));
  const hash = await hashPassword(PASSWORD);
  const addUser = db.prepare('INSERT INTO users (admin_id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, 0)');
  addUser.run(1, 'lider@x.ro', 'Lider', hash, 'leader');
  addUser.run(1, 'membru@x.ro', 'Membru', hash, 'member');
  addUser.run(1, 'operator@x.ro', 'Operator', hash, 'operator');
  db.prepare("INSERT INTO admins (id, name, created_at) VALUES (2, 'Alta', 0)").run();
  addUser.run(2, 'alt@x.ro', 'Alt', hash, 'owner');
  db.close();
  const owner = await login('ana@x.ro');
  const leader = await login('lider@x.ro');
  const member = await login('membru@x.ro');
  const operator = await login('operator@x.ro');
  const other = await login('alt@x.ro');

  // Event: a song V1 C V2 C B C (6 steps), a verse, a song with 2 sections (2 steps).
  const song = async (title, sections) => (await api('POST', '/api/songs', owner, { title, sections })).body.song;
  const s1 = await song('Sfânt', ['verse', 'chorus', 'verse', 'bridge'].map((type) => ({ type, content: `[G]${type}` })));
  const s2 = await song('Mare ești', ['verse', 'chorus'].map((type) => ({ type, content: `[D]${type}` })));
  const ev = (await api('POST', '/api/events', owner, { name: 'Duminică', eventDate: '2026-10-04' })).body.event;
  const saved = await api('PUT', `/api/events/${ev.id}/items`, owner, { items: [
    { type: 'song', songId: s1.id, arrangement: 'V1 C V2 C B C' },
    { type: 'verse', reference: 'Psalmul 23' },
    { type: 'song', songId: s2.id },
  ] });
  const [i1, i2, i3] = saved.body.items.map((it) => it.id);

  await step('handshake without a session cookie is refused', async () => {
    const anon = connect(null);
    assert.strictEqual((await next(anon, 'connect_error')).message, 'unauthenticated');
  });

  await step('join visibility: member 404 on a draft, other admin 404, owner sees the draft', async () => {
    const m = connect(member);
    await next(m, 'connect');
    assert.strictEqual((await emit(m, 'live:join', { eventId: ev.id })).code, 'notFound');
    const o2 = connect(other);
    await next(o2, 'connect');
    assert.strictEqual((await emit(o2, 'live:join', { eventId: ev.id })).code, 'notFound');
    const { state } = await joined(owner, ev.id);
    assert.strictEqual(state.status, 'draft');
    assert.strictEqual(state.version, 0);
  });

  await step('operator: full event rights (create, edit, publish, templates, delete); member none', async () => {
    const created = await api('POST', '/api/events', operator, { name: 'Repetiție', eventDate: '2026-10-06' });
    assert.strictEqual(created.status, 201, JSON.stringify(created.body));
    const id = created.body.event.id;
    assert.strictEqual((await api('GET', `/api/events/${id}`, operator)).status, 200, 'sees its draft');
    assert.strictEqual((await api('PUT', `/api/events/${id}`, operator, { name: 'Repetiție mare', eventDate: '2026-10-06' })).status, 200);
    assert.strictEqual((await api('PUT', `/api/events/${id}/items`, operator, { items: [{ type: 'verse', reference: 'Ps 1' }] })).status, 200);
    assert.strictEqual((await api('POST', `/api/events/${id}/publish`, operator)).status, 200);
    assert.strictEqual((await api('POST', `/api/events/${id}/unpublish`, operator)).status, 200);
    const tpl = await api('POST', `/api/events/${id}/save-as-template`, operator, { name: 'Șablon op' });
    assert.strictEqual(tpl.status, 201);
    const templates = await api('GET', '/api/events?when=templates', operator);
    assert.ok(templates.body.events.some((e) => e.id === tpl.body.event.id), 'sees templates');
    assert.ok((await api('GET', '/api/events?when=upcoming', operator)).body.events.some((e) => e.id === ev.id), 'sees drafts');
    for (const [method, url, body] of [
      ['POST', '/api/events', { name: 'X', eventDate: '2026-10-06' }],
      ['PUT', `/api/events/${id}`, { name: 'X', eventDate: '2026-10-06' }],
      ['PUT', `/api/events/${id}/items`, { items: [] }],
      ['POST', `/api/events/${id}/publish`],
      ['POST', `/api/events/${id}/save-as-template`, { name: 'Y' }],
      ['DELETE', `/api/events/${id}`],
    ]) {
      assert.strictEqual((await api(method, url, member, body)).status, 403, `member ${method} ${url}`);
    }
    assert.strictEqual((await api('GET', '/api/events?when=templates', member)).status, 403);
    assert.strictEqual((await api('GET', `/api/events/${ev.id}`, member)).status, 404, 'member: no drafts');
    // the library, media, screens, team and settings keep their rules
    assert.strictEqual((await api('POST', '/api/songs', operator, { title: 'X', sections: [{ type: 'verse', content: 'x' }] })).status, 403);
    assert.strictEqual((await api('POST', '/api/media/url', operator, { title: 'X', url: 'https://youtu.be/dQw4w9WgXcQ' })).status, 403);
    assert.strictEqual((await api('GET', '/api/team', operator)).status, 403);
    assert.strictEqual((await api('GET', '/api/settings', operator)).status, 403);
    assert.strictEqual((await api('DELETE', `/api/events/${id}`, operator)).status, 200);
    assert.strictEqual((await api('DELETE', `/api/events/${tpl.body.event.id}`, operator)).status, 200);
    // pages: the operator opens the editor and the live page
    for (const page of [`/events/${ev.id}/edit`, `/events/${ev.id}/live`, `/events/${ev.id}/operator`]) {
      const res = await fetch(base() + page, { headers: { Cookie: operator }, redirect: 'manual' });
      assert.strictEqual(res.status, 200, page);
      const m = await fetch(base() + page, { headers: { Cookie: member }, redirect: 'manual' });
      assert.strictEqual(m.status, 302, `member ${page}`);
    }
    // live: the operator joins the draft (event roles see drafts)
    const o = connect(operator);
    await next(o, 'connect');
    assert.strictEqual((await emit(o, 'live:join', { eventId: ev.id })).ok, true);
    o.close();
  });

  await step('a draft cannot start', async () => {
    const { socket } = await joined(leader, ev.id);
    assert.strictEqual((await emit(socket, 'live:command', { type: 'event.start', eventId: ev.id })).code, 'notPublished');
  });

  assert.strictEqual((await api('POST', `/api/events/${ev.id}/publish`, owner)).status, 200);
  const lead = await joined(leader, ev.id);
  const mem = await joined(member, ev.id);
  const ownerSocket = (await joined(owner, ev.id)).socket;
  const seen = { leader: [], member: [] };
  lead.socket.on('live:state', (s) => seen.leader.push(`${s.version}:${s.worship.itemId}.${s.worship.step}`));
  mem.socket.on('live:state', (s) => seen.member.push(`${s.version}:${s.worship.itemId}.${s.worship.step}`));
  let version = mem.state.version;
  const send = async (socket, cmd) => {
    const reply = await emit(socket, 'live:command', { eventId: ev.id, ...cmd });
    if (reply.ok) version = reply.version;
    return reply;
  };
  // The server broadcasts before it acknowledges, so a state may already have arrived.
  const memberStates = [];
  const record = (socket) => socket.on('live:state', (s) => memberStates.push(s));
  record(mem.socket);
  const memberAt = (v) => {
    const found = memberStates.find((s) => s.version === v);
    return found ? Promise.resolve(found) : next(mem.socket, 'live:state', (s) => s.version === v);
  };

  await step('start -> live at the first item, step 0', async () => {
    const reply = await send(lead.socket, { type: 'event.start', expectedVersion: version });
    assert.strictEqual(reply.ok, true);
    const s = await memberAt(reply.version);
    assert.deepStrictEqual([s.status, s.worship.itemId, s.worship.step, s.projector.follows, s.projector.source],
      ['live', i1, 0, 'worship', 'content']);
    assert.ok(s.startedAt);
  });

  await step('next x6 -> verse, next -> second song, prev back, goto, next at the end stays', async () => {
    for (let i = 0; i < 6; i++) await send(lead.socket, { type: 'worship.next', expectedVersion: version });
    let s = await memberAt(version);
    assert.deepStrictEqual([s.worship.itemId, s.worship.step], [i2, 0]);
    await send(lead.socket, { type: 'worship.next', expectedVersion: version });
    s = await memberAt(version);
    assert.deepStrictEqual([s.worship.itemId, s.worship.step], [i3, 0]);
    await send(lead.socket, { type: 'worship.prev', expectedVersion: version });
    s = await memberAt(version);
    assert.deepStrictEqual([s.worship.itemId, s.worship.step], [i2, 0]);
    await send(ownerSocket, { type: 'worship.goto', itemId: i1, step: 4 });
    s = await memberAt(version);
    assert.deepStrictEqual([s.worship.itemId, s.worship.step], [i1, 4]);
    assert.strictEqual((await send(lead.socket, { type: 'worship.goto', itemId: i1, step: 6 })).code, 'badPosition');
    assert.strictEqual((await send(lead.socket, { type: 'worship.goto', itemId: 999, step: 0 })).code, 'badPosition');
    await send(lead.socket, { type: 'worship.goto', itemId: i3, step: 1 });
    await memberAt(version);
    const atEnd = version;
    const reply = await send(lead.socket, { type: 'worship.next' });
    assert.deepStrictEqual([reply.ok, reply.version], [true, atEnd], 'next at the end changes nothing');
  });

  await step('both clients received the same versions, in order', async () => {
    await new Promise((r) => setTimeout(r, 100));
    assert.deepStrictEqual(seen.leader, seen.member);
    const versions = seen.member.map((x) => Number(x.split(':')[0]));
    assert.deepStrictEqual(versions, [...versions].sort((a, b) => a - b));
    assert.strictEqual(new Set(versions).size, versions.length);
  });

  await step('member command refused, nothing applied', async () => {
    const before = version;
    for (const type of ['worship.next', 'event.end', 'event.start']) {
      const reply = await emit(mem.socket, 'live:command', { type, eventId: ev.id });
      assert.deepStrictEqual([reply.ok, reply.code], [false, 'forbidden']);
    }
    assert.strictEqual((await api('GET', `/api/events/${ev.id}`, owner)).body.event.status, 'live');
    const reply = await send(lead.socket, { type: 'worship.goto', itemId: i1, step: 0, expectedVersion: before });
    assert.strictEqual(reply.ok, true, 'version unchanged by the refused commands');
    await memberAt(version);
  });

  await step('stale expectedVersion -> error "stale" + current snapshot, nothing applied', async () => {
    const reply = await emit(lead.socket, 'live:command', { type: 'worship.next', eventId: ev.id, expectedVersion: version - 1 });
    assert.deepStrictEqual([reply.ok, reply.code], [false, 'stale']);
    assert.deepStrictEqual([reply.state.version, reply.state.worship.itemId, reply.state.worship.step], [version, i1, 0]);
    assert.ok(reply.error);
  });

  // --- projector screens ----------------------------------------------------------
  async function pairScreen(cookie, name) {
    const pairing = (await api('POST', '/api/screen/pairings')).body;
    assert.strictEqual((await api('POST', '/api/screens/claim', cookie, { code: pairing.code, name })).status, 201);
    return (await api('GET', `/api/screen/pairings/${pairing.pairingId}`)).body;
  }
  function connectScreen(token) {
    const socket = io(`${base()}/screens`, { transports: ['websocket'], auth: { token }, reconnection: false });
    sockets.push(socket);
    socket.frames = [];
    socket.on('projector:frame', (frame) => socket.frames.push(frame));
    return socket;
  }
  const frameWhere = (socket, test) => {
    const found = socket.frames.find(test);
    return found ? Promise.resolve(found) : next(socket, 'projector:frame', test);
  };
  let screen;
  let otherScreen;

  await step('screens: bad token refused; a paired screen gets the current frame (lyrics, no chords)', async () => {
    const bad = io(`${base()}/screens`, { transports: ['websocket'], auth: { token: 'f'.repeat(64) }, reconnection: false });
    sockets.push(bad);
    assert.strictEqual((await next(bad, 'connect_error')).message, 'unauthorized');
    const paired = await pairScreen(owner, 'Proiector sală');
    screen = connectScreen(paired.token);
    const frame = await frameWhere(screen, () => true);
    assert.deepStrictEqual([frame.kind, frame.eventId, frame.lines], ['lyrics', ev.id, ['verse']]);
    // Another admin's screen: idle, and it never gets this admin's frames.
    const otherPaired = await pairScreen(other, 'Alt proiector');
    otherScreen = connectScreen(otherPaired.token);
    assert.strictEqual((await frameWhere(otherScreen, () => true)).kind, 'idle');
  });

  await step('worship moves and projector.source change the screen frame; member refused', async () => {
    await send(lead.socket, { type: 'worship.goto', itemId: i2, step: 0 });
    let frame = await frameWhere(screen, (f) => f.kind === 'verse');
    assert.deepStrictEqual([frame.reference, frame.version], ['Psalmul 23', version]);
    await send(lead.socket, { type: 'projector.source', source: 'black' });
    assert.strictEqual((await frameWhere(screen, (f) => f.version === version)).kind, 'black');
    await send(ownerSocket, { type: 'projector.source', source: 'logo' });
    frame = await frameWhere(screen, (f) => f.version === version);
    assert.deepStrictEqual([frame.kind, frame.logoUrl], ['logo', null]);
    assert.strictEqual((await send(lead.socket, { type: 'projector.source', source: 'video' })).code, 'badCommand');
    const refused = await emit(mem.socket, 'live:command', { type: 'projector.source', eventId: ev.id, source: 'black' });
    assert.deepStrictEqual([refused.ok, refused.code], [false, 'forbidden']);
    await send(lead.socket, { type: 'projector.source', source: 'content' });
    assert.strictEqual((await frameWhere(screen, (f) => f.version === version)).kind, 'verse');
    const snap = await memberAt(version);
    assert.strictEqual(snap.projector.source, 'content');
    await send(lead.socket, { type: 'worship.goto', itemId: i1, step: 0 });
    await memberAt(version);
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(otherScreen.frames.every((f) => f.kind === 'idle'), 'other admin screen saw only idle');
  });

  await step('video: prepare keeps the projector, play switches to video, ended -> black; member refused', async () => {
    const upload = await fetch(`${base()}/api/media/upload?title=Clip`, {
      method: 'POST',
      headers: { Cookie: owner, 'Content-Type': 'video/mp4' },
      body: Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(4000)]),
    });
    assert.strictEqual(upload.status, 201);
    const mediaId = (await upload.json()).media.id;
    const before = screen.frames[screen.frames.length - 1];
    await send(lead.socket, { type: 'video.prepare', mediaId });
    let frame = await frameWhere(screen, (f) => f.version === version);
    assert.strictEqual(frame.kind, before.kind, 'prepare does not change what the projector shows');
    assert.deepStrictEqual([frame.video.state, frame.video.media.type, frame.video.media.title], ['prepared', 'upload', 'Clip']);
    assert.ok(/^\/api\/media\/\d+\/file\?exp=\d+&sig=[0-9a-f]{64}$/.test(frame.video.media.src), 'signed file URL');
    const refused = await emit(mem.socket, 'live:command', { type: 'video.play', eventId: ev.id });
    assert.deepStrictEqual([refused.ok, refused.code], [false, 'forbidden']);
    await send(lead.socket, { type: 'video.play' });
    frame = await frameWhere(screen, (f) => f.version === version);
    assert.deepStrictEqual([frame.kind, frame.video.state], ['video', 'playing']);
    // The screen reports progress; the leader's projector watchers get it.
    const watchers = connect(leader);
    await next(watchers, 'connect');
    assert.strictEqual((await emit(watchers, 'projector:watch', {})).ok, true);
    const relayed = next(watchers, 'projector:video-status');
    screen.emit('screen:video-status', { state: 'playing', position: 12.5, duration: 60 });
    const status = await relayed;
    assert.deepStrictEqual([status.state, status.position, status.duration], ['playing', 12.5, 60]);
    await send(lead.socket, { type: 'video.pause' });
    frame = await frameWhere(screen, (f) => f.version === version);
    assert.deepStrictEqual([frame.kind, frame.video.state, frame.video.position], ['video', 'paused', 12.5]);
    await send(lead.socket, { type: 'video.volume', volume: 0.4 });
    assert.strictEqual((await frameWhere(screen, (f) => f.version === version)).video.volume, 0.4);
    const seq = frame.video.seq;
    await send(lead.socket, { type: 'video.restart' });
    frame = await frameWhere(screen, (f) => f.version === version);
    assert.deepStrictEqual([frame.video.position, frame.video.seq > seq], [0, true]);
    await send(lead.socket, { type: 'video.play' });
    await frameWhere(screen, (f) => f.version === version);
    screen.emit('screen:video-status', { state: 'ended', position: 60, duration: 60 });
    frame = await frameWhere(screen, (f) => f.video && f.video.state === 'ended');
    assert.strictEqual(frame.kind, 'black', 'the end of a video goes to black, never back to lyrics');
    const snap = await memberAt(frame.version);
    assert.deepStrictEqual([snap.projector.source, snap.video.state], ['black', 'ended']);
    version = snap.version;
    // A local file on the projector PC: prepare, then the screen reports the chosen name.
    await send(lead.socket, { type: 'video.prepare', local: true });
    frame = await frameWhere(screen, (f) => f.version === version);
    assert.deepStrictEqual(frame.video.media, { type: 'local', name: null });
    assert.strictEqual((await send(lead.socket, { type: 'video.play' })).code, 'videoLocalNotChosen');
    screen.emit('screen:video-local', { name: 'anunturi.mp4' });
    frame = await frameWhere(screen, (f) => f.video && f.video.media.name === 'anunturi.mp4');
    version = frame.version;
    await send(lead.socket, { type: 'video.play' });
    assert.strictEqual((await frameWhere(screen, (f) => f.version === version)).kind, 'video');
    await send(lead.socket, { type: 'video.stop' });
    frame = await frameWhere(screen, (f) => f.version === version);
    assert.deepStrictEqual([frame.kind, frame.video.state], ['black', 'prepared']);
    await send(lead.socket, { type: 'projector.source', source: 'content' });
    await frameWhere(screen, (f) => f.version === version);
    watchers.close();
  });

  await step('together: leader and operator move ONE position, applied in order with versions', async () => {
    const op = await joined(operator, ev.id);
    const opStates = [];
    op.socket.on('live:state', (st) => opStates.push(st));
    await send(lead.socket, { type: 'worship.goto', itemId: i1, step: 0 });
    await memberAt(version);
    const start = version;
    // concurrent moves from both pages, no expectedVersion: each is applied once, in order
    const replies = await Promise.all([
      emit(lead.socket, 'live:command', { eventId: ev.id, type: 'worship.next' }),
      emit(op.socket, 'live:command', { eventId: ev.id, type: 'worship.next' }),
      emit(lead.socket, 'live:command', { eventId: ev.id, type: 'worship.next' }),
      emit(op.socket, 'live:command', { eventId: ev.id, type: 'worship.next' }),
    ]);
    assert.ok(replies.every((r) => r.ok), JSON.stringify(replies));
    assert.deepStrictEqual(replies.map((r) => r.version).sort((x, y) => x - y), [start + 1, start + 2, start + 3, start + 4]);
    version = start + 4;
    const snap = await memberAt(version);
    assert.deepStrictEqual([snap.mode, snap.worship.itemId, snap.worship.step], ['together', i1, 4]);
    const frame = await frameWhere(screen, (f) => f.version === version);
    assert.deepStrictEqual([frame.kind, frame.lines], ['lyrics', ['bridge']], 'the projector follows every move');
    const seen = memberStates.filter((st) => st.version > start && st.version <= version).map((st) => st.version);
    assert.deepStrictEqual(seen, [start + 1, start + 2, start + 3, start + 4], 'the member saw each version once, in order');
    // a stale move from one page does not apply
    const stale = await emit(op.socket, 'live:command', { eventId: ev.id, type: 'worship.next', expectedVersion: start });
    assert.deepStrictEqual([stale.ok, stale.code], [false, 'stale']);
    // together: no separate projector position
    assert.strictEqual((await emit(op.socket, 'live:command', { eventId: ev.id, type: 'projector.next' })).code, 'notSplitMode');
    assert.strictEqual((await send(lead.socket, { type: 'projector.next' })).code, 'notSplitMode');
    op.socket.close();
  });

  await step('split: team and projector positions apart; back to together shows the main position', async () => {
    const op = await joined(operator, ev.id);
    const opCode = async (cmd) => (await emit(op.socket, 'live:command', { eventId: ev.id, ...cmd })).code || 'ok';
    const opSend = async (cmd) => {
      const reply = await emit(op.socket, 'live:command', { eventId: ev.id, ...cmd });
      assert.strictEqual(reply.ok, true, JSON.stringify(reply));
      version = reply.version;
    };
    await send(lead.socket, { type: 'worship.goto', itemId: i1, step: 0 });
    await frameWhere(screen, (f) => f.version === version || (f.kind === 'lyrics' && f.lines[0] === 'verse'));
    assert.strictEqual((await emit(mem.socket, 'live:command', { eventId: ev.id, type: 'live.mode', mode: 'split' })).code, 'forbidden');
    // the operator switches to split: the projector starts at the main position
    await opSend({ type: 'live.mode', mode: 'split' });
    let snap = await memberAt(version);
    assert.deepStrictEqual([snap.mode, snap.projector.follows, snap.projector.itemId, snap.projector.step], ['split', 'operator', i1, 0]);
    await opSend({ type: 'projector.goto', itemId: i2, step: 0 });
    assert.strictEqual((await frameWhere(screen, (f) => f.version === version)).kind, 'verse');
    snap = await memberAt(version);
    assert.deepStrictEqual([snap.worship.itemId, snap.worship.step], [i1, 0], 'team phones stay on the main position');
    // the leader moves the team; the projector does not move
    await send(lead.socket, { type: 'worship.next' });
    snap = await memberAt(version);
    assert.deepStrictEqual([snap.worship.itemId, snap.worship.step, snap.projector.itemId], [i1, 1, i2]);
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(screen.frames[screen.frames.length - 1].kind, 'verse', 'screen unchanged by the team move');
    // "Sari acolo" both ways: projector -> team, team -> projector
    await opSend({ type: 'projector.syncToWorship' });
    let frame = await frameWhere(screen, (f) => f.version === version);
    assert.deepStrictEqual([frame.kind, frame.lines], ['lyrics', ['chorus']]);
    await opSend({ type: 'projector.goto', itemId: i3, step: 1 });
    await send(lead.socket, { type: 'worship.goto', itemId: i3, step: 1 });
    snap = await memberAt(version);
    assert.deepStrictEqual([snap.worship.itemId, snap.worship.step], [i3, 1]);
    // the leader moves the projector too (event rights), sources from either page
    await send(lead.socket, { type: 'projector.goto', itemId: i2, step: 0 });
    assert.strictEqual((await frameWhere(screen, (f) => f.version === version)).kind, 'verse');
    await opSend({ type: 'projector.source', source: 'black' });
    assert.strictEqual((await frameWhere(screen, (f) => f.version === version)).kind, 'black');
    await send(lead.socket, { type: 'projector.source', source: 'content' });
    await frameWhere(screen, (f) => f.version === version);
    // back to together: the projector shows the main position at once
    await send(lead.socket, { type: 'live.mode', mode: 'together' });
    frame = await frameWhere(screen, (f) => f.version === version);
    assert.deepStrictEqual([frame.kind, frame.lines], ['lyrics', ['chorus']]);
    assert.strictEqual(await opCode({ type: 'projector.next' }), 'notSplitMode');
    await send(lead.socket, { type: 'worship.goto', itemId: i1, step: 0 });
    await memberAt(version);
    op.socket.close();
  });

  await step('team mode: follow / free from any event role, broadcast to the team', async () => {
    const op = await joined(operator, ev.id);
    assert.strictEqual((await emit(mem.socket, 'live:command', { eventId: ev.id, type: 'team.mode', mode: 'free' })).code, 'forbidden');
    let reply = await emit(op.socket, 'live:command', { eventId: ev.id, type: 'team.mode', mode: 'free' });
    assert.strictEqual(reply.ok, true);
    version = reply.version;
    assert.strictEqual((await memberAt(version)).teamMode, 'free');
    reply = await send(lead.socket, { type: 'team.mode', mode: 'follow' });
    assert.strictEqual((await memberAt(version)).teamMode, 'follow');
    op.socket.close();
  });

  await step('additions: "Doar pe proiector" never reaches the team; "În setlist" at once; a notice, no approval', async () => {
    const op = await joined(operator, ev.id);
    const opStates = [];
    op.socket.on('live:state', (st) => opStates.push(st));
    const notices = { leader: [], member: [] };
    lead.socket.on('live:notice', (n) => notices.leader.push(n));
    mem.socket.on('live:notice', (n) => notices.member.push(n));
    const memberKey = (await memberAt(version)).setlistKey;
    const add = (socket, target, item) => emit(socket, 'live:command', { eventId: ev.id, type: 'operator.addItem', target, item });
    let reply = await add(op.socket, 'projector', { type: 'song', songId: s2.id });
    assert.strictEqual(reply.ok, true, JSON.stringify(reply));
    version = reply.version;
    let snap = await memberAt(version);
    assert.strictEqual(snap.setlistKey, memberKey, 'team phones do not reload');
    assert.deepStrictEqual([snap.items, snap.requests], [undefined, undefined], 'team snapshots carry no operator items');
    const opSnap = opStates.find((st) => st.version === version) || await next(op.socket, 'live:state', (st) => st.version === version);
    assert.strictEqual(opSnap.requests, undefined, 'no requests any more');
    const added = opSnap.items.find((it) => it.scope === 'projector');
    assert.deepStrictEqual([opSnap.items.map((it) => it.id).indexOf(added.id), added.title], [1, 'Mare ești'], 'right after the current item');
    const memberEvent = (await api('GET', `/api/events/${ev.id}`, member)).body;
    assert.ok(!memberEvent.items.some((it) => it.id === added.id));
    assert.strictEqual((await api('GET', `/api/events/${ev.id}/items/${added.id}/song`, member)).status, 404);
    assert.strictEqual((await api('GET', `/api/events/${ev.id}/items/${added.id}/song`, leader)).status, 200, 'the leader can preview it');
    await new Promise((r) => setTimeout(r, 100));
    assert.deepStrictEqual(notices.leader.map((n) => [n.type, n.by, n.title, n.target]), [['itemAdded', 'Operator', 'Mare ești', 'projector']]);
    assert.deepStrictEqual(notices.member, [], 'team phones get no notice');
    // În setlist: shared right after the main item, members reload at once
    reply = await add(op.socket, 'setlist', { type: 'verse', reference: 'Ioan 3:16', body: 'Fiindcă' });
    assert.strictEqual(reply.ok, true);
    version = reply.version;
    snap = await memberAt(version);
    assert.notStrictEqual(snap.setlistKey, memberKey, 'team phones reload the setlist');
    const after = (await api('GET', `/api/events/${ev.id}`, member)).body.items.map((it) => it.reference || it.title);
    assert.deepStrictEqual(after.slice(0, 2), ['Sfânt', 'Ioan 3:16'], 'after the current main item');
    await new Promise((r) => setTimeout(r, 100));
    assert.deepStrictEqual(notices.leader[1] && [notices.leader[1].title, notices.leader[1].target], ['Ioan 3:16', 'setlist']);
    // the approval commands are gone; members add nothing
    assert.strictEqual((await send(lead.socket, { type: 'request.accept', itemId: added.id, position: 'end' })).code, 'badCommand');
    assert.strictEqual((await add(mem.socket, 'setlist', { type: 'verse', reference: 'x' })).code, 'forbidden');
    assert.strictEqual((await add(op.socket, undefined, { type: 'verse', reference: 'x' })).code, 'badCommand');
    lead.socket.off('live:notice');
    mem.socket.off('live:notice');
    op.socket.close();
  });

  await step('backgrounds in the media library: images (resized, thumbnails) and loops; limits; access', async () => {
    const sharp = require('sharp');
    const upload = async (cookie, as, body, type, title = 'Fundal') => {
      const res = await fetch(`${base()}/api/media/upload?as=${as}&title=${encodeURIComponent(title)}`, {
        method: 'POST', headers: { Cookie: cookie, 'Content-Type': type }, body,
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    };
    const jpeg = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#ffd27a' } }).jpeg({ quality: 90 }).toBuffer();
    const img = await upload(owner, 'background', jpeg, 'image/jpeg', 'Răsărit');
    assert.strictEqual(img.status, 201, JSON.stringify(img.body));
    assert.deepStrictEqual([img.body.media.kind, img.body.media.category, img.body.media.width, img.body.media.height, img.body.media.thumb],
      ['image', 'background', 2400, 1600, true]);
    const id = img.body.media.id;
    const file = async (cookie, query = '') => fetch(`${base()}/api/media/${id}/file${query}`, { headers: cookie ? { Cookie: cookie } : {} });
    const size = async (res) => sharp(Buffer.from(await res.arrayBuffer())).metadata();
    let meta = await size(await file(owner, '?v=display'));
    assert.deepStrictEqual([meta.format, meta.width, meta.height], ['webp', 1620, 1080], 'projector version fits 1920x1080');
    meta = await size(await file(owner, '?v=thumb'));
    assert.deepStrictEqual([meta.format, meta.width, meta.height], ['webp', 320, 180]);
    meta = await size(await file(owner));
    assert.deepStrictEqual([meta.format, meta.width], ['jpeg', 2400], 'the original is kept');
    // PNG and WebP too; a small image is never enlarged
    const png = await sharp({ create: { width: 800, height: 600, channels: 4, background: '#224466ff' } }).png().toBuffer();
    const p = await upload(owner, 'background', png, 'image/png');
    assert.strictEqual(p.status, 201);
    meta = await size(await fetch(`${base()}/api/media/${p.body.media.id}/file?v=display`, { headers: { Cookie: owner } }));
    assert.deepStrictEqual([meta.width, meta.height], [800, 600]);
    const webp = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#000' } }).webp().toBuffer();
    assert.strictEqual((await upload(owner, 'background', webp, 'image/webp')).status, 201);
    // a fake image (JPEG magic, not an image) -> 400; too big -> 413; an image as a video -> 400
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);
    const bad = await upload(owner, 'background', fake, 'image/jpeg');
    assert.deepStrictEqual([bad.status, typeof bad.body.error], [400, 'string']);
    const huge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(9 * 1024 * 1024)]);
    assert.strictEqual((await upload(owner, 'background', huge, 'image/jpeg')).status, 413, 'images max 8 MB');
    assert.strictEqual((await upload(owner, 'video', jpeg, 'image/jpeg')).status, 400, 'a video upload stays video only');
    // a loop: an MP4 as a background; over 50 MB -> 413 (declared size)
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(4000)]);
    const loop = await upload(owner, 'background', mp4, 'video/mp4', 'Nori');
    assert.deepStrictEqual([loop.status, loop.body.media.kind, loop.body.media.category], [201, 'loop', 'background']);
    const big = await fetch(`${base()}/api/media/upload?as=background&title=x`, {
      method: 'POST', headers: { Cookie: owner, 'Content-Type': 'video/mp4', 'Content-Length': String(51 * 1024 * 1024) }, body: mp4,
    }).catch(() => ({ status: 413 }));
    assert.strictEqual(big.status, 413);
    // the quota counts images with their versions
    const list = (await api('GET', '/api/media', owner)).body;
    assert.ok(list.usedBytes >= jpeg.length + 4000, 'usage includes backgrounds');
    assert.deepStrictEqual([list.maxImageBytes, list.maxLoopBytes], [8 * 1024 * 1024, 50 * 1024 * 1024]);
    // a background is not a video: video.prepare refuses it
    const op = await joined(owner, ev.id);
    assert.strictEqual((await emit(op.socket, 'live:command', { eventId: ev.id, type: 'video.prepare', mediaId: loop.body.media.id })).code, 'videoNotFound');
    op.socket.close();
    // access: another admin 404, no session 404, a member of the admin may load it, a signed URL
    assert.strictEqual((await file(other, '?v=display')).status, 404);
    assert.strictEqual((await file(null, '?v=display')).status, 404);
    assert.strictEqual((await file(member, '?v=display')).status, 200);
    assert.strictEqual((await api('GET', '/api/media', member)).status, 403);
    const { createMediaSigner } = require('../lib/media');
    const signed = createMediaSigner(dataDir).url(1, id, Date.now(), 'display');
    const viaSig = await fetch(base() + signed);
    assert.deepStrictEqual([viaSig.status, viaSig.headers.get('content-type')], [200, 'image/webp']);
    // delete removes every file of the image
    assert.strictEqual((await api('DELETE', `/api/media/${p.body.media.id}`, owner)).status, 200);
    assert.strictEqual((await fetch(`${base()}/api/media/${p.body.media.id}/file?v=thumb`, { headers: { Cookie: owner } })).status, 404);
  });

  await step('shared frames: a page holding the event data computes the same frame as the server', async () => {
    // The browser build of public/frames.js (no require), as the live page loads it.
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    for (const file of ['chords.js', 'frames.js']) {
      vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', file), 'utf8'), sandbox, { filename: file });
    }
    const { projectorFrame } = sandbox.window.FRAMES;
    // Admin 2 (its own live event and screen): every item kind, a transposed song, a logo.
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000'
      + '1f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d69b3a0000000049454e44ae426082', 'hex');
    assert.strictEqual((await fetch(`${base()}/api/settings/logo`, { method: 'PUT', headers: { Cookie: other, 'Content-Type': 'image/png' }, body: png })).status, 200);
    const add = async (title, sections) => (await api('POST', '/api/songs', other, { title, songKey: 'G', sections })).body.song;
    const a = await add('Cânt', [{ type: 'verse', content: '[G]Cânt [D/F#]azi\n[Em]pentru [C]Tine\n' }, { type: 'chorus', content: '\n[C]Sfânt [G]ești' }]);
    const gone = await add('Șters', [{ type: 'verse', content: '[A]x' }]);
    const e2 = (await api('POST', '/api/events', other, { name: 'Seara', eventDate: '2026-10-05' })).body.event;
    const put = await api('PUT', `/api/events/${e2.id}/items`, other, { items: [
      { type: 'song', songId: a.id, arrangement: 'V1 C V1', transpose: 2 },
      { type: 'verse', reference: 'Ioan 3:16', body: 'Fiindcă atât de mult\na iubit' },
      { type: 'announcement', title: 'Tabără', body: 'Înscrieri\nduminică' },
      { type: 'sermon', title: 'Predica' },
      { type: 'other', body: '\nRugăciune\npentru țară' },
      { type: 'video', title: 'Clip', url: 'https://youtu.be/dQw4w9WgXcQ' },
      { type: 'song', songId: gone.id },
    ] });
    assert.strictEqual(put.status, 200, JSON.stringify(put.body));
    assert.strictEqual((await api('DELETE', `/api/songs/${gone.id}`, other)).status, 200);
    assert.strictEqual((await api('POST', `/api/events/${e2.id}/publish`, other)).status, 200);
    const o = await joined(other, e2.id);
    const states = [];
    o.socket.on('live:state', (st) => states.push(st));
    const stateAt = (v) => states.find((st) => st.version === v) || next(o.socket, 'live:state', (st) => st.version === v);
    const cmd = async (c) => {
      const reply = await emit(o.socket, 'live:command', { eventId: e2.id, ...c });
      assert.strictEqual(reply.ok, true, JSON.stringify(reply));
      return reply.version;
    };
    // What the browser has: the event and each song item ready to render, over HTTP.
    const loaded = (await api('GET', `/api/events/${e2.id}`, other)).body;
    const songs = new Map();
    for (const it of loaded.items.filter((x) => x.type === 'song' && x.songId)) {
      songs.set(it.id, (await api('GET', `/api/events/${e2.id}/items/${it.id}/song`, other)).body.song);
    }
    const kinds = new Set();
    let logoUrl = null;
    async function compare(v) {
      const snap = await stateAt(v);
      const watched = await emit(o.socket, 'projector:watch', {});
      logoUrl = watched.logoUrl;
      const server = watched.frame;
      const local = projectorFrame(snap, { items: loaded.items }, songs, { logoUrl, videoMedia: server.video ? server.video.media : null });
      assert.deepStrictEqual(JSON.parse(JSON.stringify(local)), server, `frame at ${JSON.stringify(snap.worship)} / ${snap.projector.source}`);
      kinds.add(server.kind);
      return server;
    }
    assert.strictEqual((await compare(await cmd({ type: 'event.start' }))).kind, 'lyrics');
    const layout = loaded.items.map((it) => (it.arrangementResolved && it.songId ? it.arrangementResolved.length : 1));
    for (const [i, it] of loaded.items.entries()) {
      for (let st = 0; st < layout[i]; st++) {
        const frame = await compare(await cmd({ type: 'worship.goto', itemId: it.id, step: st })); // the first: a no-op
        if (i === 0 && st === 0) assert.deepStrictEqual(frame.lines, ['Cânt azi', 'pentru Tine'], 'no chords');
      }
    }
    await cmd({ type: 'worship.goto', itemId: loaded.items[1].id, step: 0 });
    for (const source of ['black', 'logo', 'content']) await compare(await cmd({ type: 'projector.source', source }));
    assert.ok(/^\/api\/logo\//.test(logoUrl), 'the watch reply carries the logo URL');
    await compare(await cmd({ type: 'video.prepare', itemId: loaded.items[5].id }));
    await compare(await cmd({ type: 'video.play' }));
    await compare(await cmd({ type: 'video.pause' }));
    await compare(await cmd({ type: 'video.stop' }));
    assert.deepStrictEqual([...kinds].sort(), ['announcement', 'black', 'logo', 'lyrics', 'title', 'verse', 'video']);
    await cmd({ type: 'event.end' });
  });

  await step('a second event cannot start while one is live', async () => {
    const ev2 = (await api('POST', '/api/events', owner, { name: 'Seara', eventDate: '2026-10-04' })).body.event;
    await api('POST', `/api/events/${ev2.id}/publish`, owner);
    const { socket } = await joined(leader, ev2.id);
    assert.strictEqual((await emit(socket, 'live:command', { type: 'event.start', eventId: ev2.id })).code, 'anotherLive');
    socket.emit('live:leave', {});
  });

  await step('setlist saved without the current song -> position moves to the next item', async () => {
    await send(lead.socket, { type: 'worship.goto', itemId: i1, step: 3 });
    await memberAt(version);
    const moved = next(mem.socket, 'live:state', (s) => s.worship.itemId === i2);
    const res = await api('PUT', `/api/events/${ev.id}/items`, leader, { items: [
      { id: i2, type: 'verse', reference: 'Psalmul 23' },
      { id: i3, type: 'song', songId: s2.id },
    ] });
    assert.deepStrictEqual(res.body.items.map((it) => it.id), [i2, i3], 'saved items keep their ids');
    const s = await moved;
    assert.strictEqual(s.worship.step, 0);
    version = s.version;
  });

  await step('a song edited during live clamps the step (arrangement shortened)', async () => {
    await send(lead.socket, { type: 'worship.goto', itemId: i3, step: 1 });
    await memberAt(version);
    const moved = next(mem.socket, 'live:state', (s) => s.version > version);
    await api('PUT', `/api/songs/${s2.id}`, owner, { title: 'Mare ești', sections: [{ type: 'verse', content: '[D]doar strofa' }] });
    const s = await moved;
    assert.deepStrictEqual([s.worship.itemId, s.worship.step], [i3, 0]);
    version = s.version;
  });

  await step('reconnect gets the current state', async () => {
    mem.socket.disconnect();
    const again = await joined(member, ev.id);
    record(again.socket);
    assert.deepStrictEqual([again.state.version, again.state.worship.itemId, again.state.worship.step], [version, i3, 0]);
    mem.socket = again.socket;
  });

  await step('server restart: clients reconnect to the persisted position, mode and team mode', async () => {
    let r = await send(lead.socket, { type: 'live.mode', mode: 'split' });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    r = await send(lead.socket, { type: 'team.mode', mode: 'free' });
    assert.strictEqual(r.ok, true);
    await memberAt(version);
    const auto = connect(member, { reconnection: true, reconnectionDelay: 100, reconnectionDelayMax: 300 });
    await next(auto, 'connect');
    auto.on('connect', () => auto.emit('live:join', { eventId: ev.id }));
    auto.emit('live:join', { eventId: ev.id });
    await next(auto, 'live:state');
    await stopServer();
    const restored = next(auto, 'live:state', () => true, 8000);
    await startServer();
    const s = await restored;
    assert.deepStrictEqual([s.version, s.status, s.worship.itemId, s.worship.step, s.mode, s.teamMode], [version, 'live', i3, 0, 'split', 'free']);
  });

  await step('logout closes that session\'s sockets', async () => {
    const cookie = await login('membru@x.ro');
    const { socket } = await joined(cookie, ev.id);
    const closed = next(socket, 'disconnect');
    await api('POST', '/api/auth/logout', cookie);
    assert.strictEqual(await closed, 'io server disconnect');
  });

  await step('revoking a screen disconnects it at once', async () => {
    const list = (await api('GET', '/api/screens', owner)).body.screens;
    assert.deepStrictEqual(list.map((x) => [x.name, x.online]), [['Proiector sală', false]], 'the restart dropped the socket');
    const again = connectScreen((await pairScreen(owner, 'Proiector 2')).token);
    await frameWhere(again, () => true);
    const online = (await api('GET', '/api/screens', owner)).body.screens.find((x) => x.name === 'Proiector 2');
    assert.strictEqual(online.online, true);
    const closed = next(again, 'disconnect');
    assert.strictEqual((await api('DELETE', `/api/screens/${online.id}`, leader)).status, 200);
    assert.strictEqual(await closed, 'io server disconnect');
    screen = connectScreen((await pairScreen(owner, 'Proiector 3')).token);
    await frameWhere(screen, () => true);
  });

  await step('team: the owner creates and manages accounts; others cannot', async () => {
    const created = await api('POST', '/api/team', owner, { name: 'Ion', email: 'Ion@X.ro', role: 'operator' });
    assert.strictEqual(created.status, 201, JSON.stringify(created.body));
    const temp = created.body.temporaryPassword;
    assert.ok(/^[a-km-zA-HJ-NP-Z2-9]{12}$/.test(temp), temp);
    assert.deepStrictEqual([created.body.user.email, created.body.user.role, created.body.user.mustChangePassword], ['ion@x.ro', 'operator', true]);
    const ionId = created.body.user.id;
    assert.strictEqual((await api('POST', '/api/team', owner, { name: 'Dublura', email: 'ion@x.ro', role: 'member' })).status, 409);
    assert.strictEqual((await api('POST', '/api/team', owner, { name: 'Alt', email: 'alt@x.ro', role: 'member' })).status, 409, 'another admin\'s email');
    assert.strictEqual((await api('POST', '/api/team', owner, { name: 'X', email: 'x@x.ro', role: 'owner' })).status, 400);
    for (const cookie of [leader, member]) {
      assert.strictEqual((await api('GET', '/api/team', cookie)).status, 403);
      assert.strictEqual((await api('POST', '/api/team', cookie, { name: 'Y', email: 'y@x.ro', role: 'member' })).status, 403);
    }
    const list = (await api('GET', '/api/team', owner)).body.users;
    assert.ok(list.some((u) => u.id === ionId) && list.every((u) => !('password_hash' in u) && !('passwordHash' in u)));
    assert.ok(!list.some((u) => u.email === 'alt@x.ro'), 'only this admin');
    const ownerId = list.find((u) => u.role === 'owner').id;
    // owner row and other admins' users
    assert.strictEqual((await api('PATCH', `/api/team/${ownerId}`, owner, { role: 'member' })).status, 403);
    assert.strictEqual((await api('POST', `/api/team/${ownerId}/deactivate`, owner)).status, 403);
    const otherId = (await api('GET', '/api/team', other)).body.users[0].id;
    for (const path of [`/api/team/${otherId}/deactivate`, `/api/team/${otherId}/reset-password`]) {
      assert.strictEqual((await api('POST', path, owner)).status, 404);
    }
    assert.strictEqual((await api('PATCH', `/api/team/${otherId}`, owner, { name: 'Z' })).status, 404);
    // login with the temporary password; last login recorded; rename and role change
    const ion = (await api('POST', '/api/auth/login', null, { email: 'ion@x.ro', password: temp }));
    assert.strictEqual(ion.status, 200);
    const ionCookie = /wa_sid=[0-9a-f]+/.exec(ion.headers.get('set-cookie'))[0];
    assert.ok((await api('GET', '/api/team', owner)).body.users.find((u) => u.id === ionId).lastLoginAt > 0);
    let patched = await api('PATCH', `/api/team/${ionId}`, owner, { name: 'Ion Pop', role: 'member' });
    assert.deepStrictEqual([patched.body.user.name, patched.body.user.role], ['Ion Pop', 'member']);
    assert.strictEqual((await api('PATCH', `/api/team/${ionId}`, owner, { role: 'boss' })).status, 400);
    // deactivate: the socket closes, the session is gone, login refused; reactivate: login again
    const ionSocket = connect(ionCookie);
    await next(ionSocket, 'connect');
    const closed = next(ionSocket, 'disconnect');
    assert.strictEqual((await api('POST', `/api/team/${ionId}/deactivate`, owner)).body.user.active, false);
    assert.strictEqual(await closed, 'io server disconnect');
    assert.strictEqual((await api('GET', '/api/auth/me', ionCookie)).status, 401);
    assert.strictEqual((await api('POST', '/api/auth/login', null, { email: 'ion@x.ro', password: temp })).status, 401);
    assert.strictEqual((await api('POST', `/api/team/${ionId}/reactivate`, owner)).body.user.active, true);
    const again = await api('POST', '/api/auth/login', null, { email: 'ion@x.ro', password: temp });
    assert.strictEqual(again.status, 200);
    const againCookie = /wa_sid=[0-9a-f]+/.exec(again.headers.get('set-cookie'))[0];
    // reset: old sessions gone, the old password refused, the new one works
    const reset = await api('POST', `/api/team/${ionId}/reset-password`, owner);
    assert.ok(reset.body.temporaryPassword && reset.body.temporaryPassword !== temp);
    assert.strictEqual((await api('GET', '/api/auth/me', againCookie)).status, 401);
    assert.strictEqual((await api('POST', '/api/auth/login', null, { email: 'ion@x.ro', password: temp })).status, 401);
    assert.strictEqual((await api('POST', '/api/auth/login', null, { email: 'ion@x.ro', password: reset.body.temporaryPassword })).status, 200);
  });

  await step('theme: own choice on every device, church default otherwise, cookie and first paint', async () => {
    const pref = async (cookie) => /data-theme-pref="(\w+)" data-theme="(\w+)"/.exec(await (await fetch(`${base()}/library`, { headers: { Cookie: cookie } })).text()).slice(1).join('/');
    const cookieOf = (res) => (/wa_theme=(\w+)/.exec(res.headers.get('set-cookie') || '') || [])[1];
    // church default (dark) for a user without a choice
    let me = await api('GET', '/api/auth/me', member);
    assert.deepStrictEqual([me.body.user.theme, me.body.user.themeOwn], ['dark', null]);
    assert.strictEqual(cookieOf(me), 'dark', 'the cookie follows the effective theme');
    assert.strictEqual(await pref(member), 'dark/dark');
    // the owner changes the default: the member follows it
    assert.strictEqual((await api('PUT', '/api/settings/theme-default', member, { theme: 'light' })).status, 403);
    assert.strictEqual((await api('PUT', '/api/settings/theme-default', owner, { theme: 'purple' })).status, 400);
    assert.strictEqual((await api('PUT', '/api/settings/theme-default', owner, { theme: 'light' })).body.themeDefault, 'light');
    assert.strictEqual((await api('GET', '/api/settings', owner)).body.themeDefault, 'light');
    assert.strictEqual((await api('GET', '/api/auth/me', member)).body.user.theme, 'light');
    assert.strictEqual(await pref(member), 'light/light');
    // own choice: wins over the default, on another device (another session) too
    const bad = await api('PUT', '/api/me/theme', member, { theme: 'pink' });
    assert.deepStrictEqual([bad.status, typeof bad.body.error], [400, 'string']);
    const set = await api('PUT', '/api/me/theme', member, { theme: 'auto' });
    assert.deepStrictEqual([set.status, set.body.theme, cookieOf(set)], [200, 'auto', 'auto']);
    assert.strictEqual(await pref(member), 'auto/dark', 'auto: the browser resolves it (public/theme.js)');
    const other = await login('membru@x.ro');
    assert.strictEqual(await pref(other), 'auto/dark');
    await api('PUT', '/api/me/theme', other, { theme: 'dark' });
    assert.strictEqual((await api('GET', '/api/auth/me', member)).body.user.theme, 'dark', 'the first device sees it');
    // login sets the cookie: signed-out pages of this device follow it
    const res = await api('POST', '/api/auth/login', null, { email: 'membru@x.ro', password: PASSWORD });
    assert.strictEqual(cookieOf(res), 'dark');
    const loginPage = async (cookie) => /data-theme-pref="(\w+)"/.exec(await (await fetch(`${base()}/login`, { headers: cookie ? { Cookie: cookie } : {} })).text())[1];
    assert.strictEqual(await loginPage('wa_theme=light'), 'light');
    assert.strictEqual(await loginPage(null), 'auto', 'no cookie: the device decides');
    // null returns to the church default; the manifest follows the theme
    assert.strictEqual((await api('PUT', '/api/me/theme', member, { theme: null })).body.theme, 'light');
    const manifest = await (await fetch(`${base()}/manifest.webmanifest`, { headers: { Cookie: member } })).json();
    assert.deepStrictEqual([manifest.theme_color, manifest.background_color], ['#f7f5f1', '#f7f5f1']);
    const html = await (await fetch(`${base()}/library`, { headers: { Cookie: member } })).text();
    assert.ok(html.includes('<meta name="theme-color" content="#f7f5f1">') && html.includes('content="default"') && /<script src="\/theme\.js\?v=/.test(html));
    await api('PUT', '/api/settings/theme-default', owner, { theme: 'dark' });
  });

  await step('first login: a temporary password must be changed before anything else', async () => {
    const created = await api('POST', '/api/team', owner, { name: 'Maria', email: 'maria@x.ro', role: 'member' });
    const temp = created.body.temporaryPassword;
    const loginAs = async (password) => {
      const res = await api('POST', '/api/auth/login', null, { email: 'maria@x.ro', password });
      assert.strictEqual(res.status, 200);
      return /wa_sid=[0-9a-f]+/.exec(res.headers.get('set-cookie'))[0];
    };
    const first = await loginAs(temp);
    const second = await loginAs(temp); // another device
    const me = await api('GET', '/api/auth/me', first);
    assert.deepStrictEqual([me.status, me.body.user.mustChangePassword], [200, true]);
    for (const [method, url] of [['GET', '/api/events'], ['GET', '/api/songs'], ['GET', '/api/home'], ['PUT', '/api/me/locale']]) {
      const res = await api(method, url, first, method === 'PUT' ? { locale: 'en' } : undefined);
      assert.deepStrictEqual([res.status, res.body.code], [403, 'mustChangePassword'], url);
    }
    for (const path of ['/app', '/events', `/events/${ev.id}/follow`]) {
      const page = await fetch(base() + path, { headers: { Cookie: first }, redirect: 'manual' });
      assert.deepStrictEqual([page.status, page.headers.get('location')], [302, '/change-password'], path);
    }
    assert.strictEqual((await fetch(base() + '/change-password', { headers: { Cookie: first }, redirect: 'manual' })).status, 200);
    const socket = connect(first);
    await next(socket, 'connect');
    assert.strictEqual((await emit(socket, 'live:join', { eventId: ev.id })).code, 'mustChangePassword');
    assert.strictEqual((await emit(socket, 'home:watch', {})).code, 'mustChangePassword');
    // wrong current, too short, same as the temporary one
    assert.strictEqual((await api('POST', '/api/me/password', first, { current: 'nope', password: 'parola-noua-1' })).body.code, 'wrongPassword');
    assert.strictEqual((await api('POST', '/api/me/password', first, { current: temp, password: 'scurta' })).body.code, 'tooShort');
    assert.strictEqual((await api('POST', '/api/me/password', first, { current: temp, password: temp })).body.code, 'samePassword');
    assert.strictEqual((await api('POST', '/api/me/password', first, { current: temp, password: 'parola-mariei-1' })).status, 200);
    // now normal access for a member; the other device is signed out; the temporary password is gone
    assert.strictEqual((await api('GET', '/api/events', first)).status, 200);
    assert.strictEqual((await api('GET', '/api/team', first)).status, 403, 'member: no team page');
    assert.strictEqual((await api('GET', '/api/auth/me', second)).status, 401);
    assert.strictEqual((await api('POST', '/api/auth/login', null, { email: 'maria@x.ro', password: temp })).status, 401);
    const afterSocket = connect(first);
    await next(afterSocket, 'connect');
    assert.strictEqual((await emit(afterSocket, 'live:join', { eventId: ev.id })).ok, true);
    // a later voluntary change needs the current password
    assert.strictEqual((await api('POST', '/api/me/password', first, { current: 'parola-mariei-1', password: 'parola-mariei-2' })).status, 200);
  });

  await step('end -> finished for the whole room; commands then refused', async () => {
    const l = await joined(leader, ev.id);
    const m = await joined(member, ev.id);
    const ended = next(m.socket, 'live:state', (s) => s.status === 'finished');
    assert.strictEqual((await emit(l.socket, 'live:command', { type: 'event.end', eventId: ev.id })).ok, true);
    await ended;
    assert.strictEqual((await frameWhere(screen, (f) => f.kind === 'idle')).eventId, null, 'screens go idle');
    assert.strictEqual((await emit(l.socket, 'live:command', { type: 'worship.next', eventId: ev.id })).code, 'notLive');
    assert.strictEqual((await emit(l.socket, 'live:command', { type: 'event.start', eventId: ev.id })).code, 'finished');
  });
}

main()
  .then(() => {
    console.log(`test-live: ${results.length} checks passed in ${((Date.now() - STARTED) / 1000).toFixed(1)} s`);
  }, (err) => {
    console.error(`test-live: failed after ${results.length} passed checks\n  ${err.stack}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const socket of sockets) socket.close();
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
