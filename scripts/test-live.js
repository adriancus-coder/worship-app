'use strict';

// Live mode against a real server (fresh temp DATA_DIR, random port) with socket.io-client:
// handshake auth, room visibility, ordered versions for every client, roles, stale
// versions, setlist clamping, reconnects and a server restart. No external network.

const assert = require('assert');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
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
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for ${event}`));
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
  db.prepare("INSERT INTO admins (id, name, created_at) VALUES (2, 'Alta', 0)").run();
  addUser.run(2, 'alt@x.ro', 'Alt', hash, 'owner');
  db.close();
  const owner = await login('ana@x.ro');
  const leader = await login('lider@x.ro');
  const member = await login('membru@x.ro');
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

  await step('server restart: clients reconnect to the persisted position', async () => {
    const auto = connect(member, { reconnection: true, reconnectionDelay: 100, reconnectionDelayMax: 300 });
    await next(auto, 'connect');
    auto.on('connect', () => auto.emit('live:join', { eventId: ev.id }));
    auto.emit('live:join', { eventId: ev.id });
    await next(auto, 'live:state');
    await stopServer();
    const restored = next(auto, 'live:state', () => true, 8000);
    await startServer();
    const s = await restored;
    assert.deepStrictEqual([s.version, s.status, s.worship.itemId, s.worship.step], [version, 'live', i3, 0]);
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
