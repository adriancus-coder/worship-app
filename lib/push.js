'use strict';

// Web push without the `web-push` package: VAPID (RFC 8292, an ES256 JWT) and the aes128gcm
// message encryption (RFC 8291 / 8188), all with node:crypto. Disabled without a VAPID key
// pair (config.VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, `npm run vapid`); the app runs without it.
//
//   const push = createPush({ db, config, logger, fetch? })
//   push.enabled, push.publicKey
//   push.subscribe(adminId, userId, subscription, userAgent) -> row | null (invalid)
//   push.unsubscribe(adminId, userId, endpoint) -> boolean
//   push.listForUser(adminId, userId) -> rows (no keys)
//   push.hasSubscription(adminId, userId) -> boolean
//   await push.sendToUser(adminId, userId, { title, body, url, tag, id }) -> { sent, failed, removed }
// Payloads stay small (title, body, url, tag); a 404 / 410 from the push service removes the
// subscription; other failures count (failed_count) and are logged, never thrown.

const crypto = require('crypto');

const TTL_SECONDS = 24 * 60 * 60;
const JWT_TTL_SECONDS = 12 * 60 * 60;
const TIMEOUT_MS = 10000;
const MAX_PAYLOAD = 3000;

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (s) => Buffer.from(String(s || ''), 'base64url');

// A new VAPID key pair: { publicKey, privateKey } (base64url: 65-byte uncompressed point, 32-byte d).
function generateVapidKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  return { publicKey: b64url(publicKey.export({ format: 'der', type: 'spki' }).subarray(-65)), privateKey: jwk.d, x: jwk.x, y: jwk.y };
}

// The private KeyObject for signing, from the two base64url strings.
function vapidKey(publicKey, privateKey) {
  const pub = fromB64url(publicKey);
  if (pub.length !== 65 || pub[0] !== 4 || fromB64url(privateKey).length !== 32) return null;
  try {
    return crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)), d: privateKey } });
  } catch (err) {
    return null;
  }
}

// Authorization: vapid t=<jwt>, k=<public key>
function vapidHeader(endpoint, subject, publicKey, key, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64url(JSON.stringify({ aud, exp: Math.floor(now / 1000) + JWT_TTL_SECONDS, sub: subject }));
  const signature = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${payload}.${b64url(signature)}, k=${publicKey}`;
}

const hkdf = (salt, ikm, info, length) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, length));

// RFC 8291: the encrypted body for a subscription's keys (p256dh, auth) and a small payload.
function encrypt(payload, { p256dh, auth }, serverKeys = null) {
  const clientPub = fromB64url(p256dh);
  const authSecret = fromB64url(auth);
  if (clientPub.length !== 65 || authSecret.length !== 16) throw new Error('bad subscription keys');
  const ecdh = crypto.createECDH('prime256v1');
  if (serverKeys) ecdh.setPrivateKey(serverKeys.privateKey);
  else ecdh.generateKeys();
  const serverPub = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(clientPub);
  const salt = (serverKeys && serverKeys.salt) || crypto.randomBytes(16);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), clientPub, serverPub]);
  const ikm = hkdf(authSecret, shared, info, 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const record = Buffer.concat([Buffer.from(payload), Buffer.from([2])]); // the last record's delimiter
  const body = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([serverPub.length]), serverPub, body]);
}

// The receiving side (tests): decrypts what encrypt() produced, with the client's keys.
function decrypt(message, clientPrivateKey, auth) {
  const salt = message.subarray(0, 16);
  const idlen = message[20];
  const serverPub = message.subarray(21, 21 + idlen);
  const body = message.subarray(21 + idlen);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(clientPrivateKey);
  const clientPub = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(serverPub);
  const ikm = hkdf(fromB64url(auth), shared, Buffer.concat([Buffer.from('WebPush: info\0'), clientPub, serverPub]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(body.subarray(body.length - 16));
  const plain = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]);
  return plain.subarray(0, plain.length - 1).toString(); // minus the delimiter
}

function validSubscription(sub) {
  if (!sub || typeof sub !== 'object' || typeof sub.endpoint !== 'string' || !sub.keys) return null;
  let url;
  try { url = new URL(sub.endpoint); } catch (err) { return null; }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return null;
  const { p256dh, auth } = sub.keys;
  if (fromB64url(p256dh).length !== 65 || fromB64url(auth).length !== 16 || sub.endpoint.length > 1000) return null;
  return { endpoint: sub.endpoint, p256dh, auth };
}

function createPush({ db, config, logger, fetch = global.fetch }) {
  const key = config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY ? vapidKey(config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY) : null;
  const enabled = Boolean(key);
  const subject = config.VAPID_SUBJECT || 'mailto:admin@example.org';
  const insert = db.prepare(`INSERT INTO push_subscriptions (admin_id, user_id, endpoint, p256dh, auth, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET admin_id = excluded.admin_id, user_id = excluded.user_id,
    p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, failed_count = 0`);
  const remove = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND admin_id = ? AND user_id = ?');
  const removeAny = db.prepare('DELETE FROM push_subscriptions WHERE id = ?');
  const ofUser = db.prepare('SELECT * FROM push_subscriptions WHERE admin_id = ? AND user_id = ? ORDER BY id');
  const count = db.prepare('SELECT COUNT(*) FROM push_subscriptions WHERE admin_id = ? AND user_id = ?').pluck();
  const ok = db.prepare('UPDATE push_subscriptions SET last_ok_at = ?, failed_count = 0 WHERE id = ?');
  const failed = db.prepare('UPDATE push_subscriptions SET failed_count = failed_count + 1 WHERE id = ?');

  const toRow = (r) => ({ id: r.id, endpoint: r.endpoint, userAgent: r.user_agent, createdAt: r.created_at, lastOkAt: r.last_ok_at, failedCount: r.failed_count });

  function subscribe(adminId, userId, subscription, userAgent) {
    const sub = validSubscription(subscription);
    if (!sub) return null;
    insert.run(adminId, userId, sub.endpoint, sub.p256dh, sub.auth, String(userAgent || '').slice(0, 200) || null, Date.now());
    return toRow(db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').get(sub.endpoint));
  }

  const unsubscribe = (adminId, userId, endpoint) => remove.run(String(endpoint || ''), adminId, userId).changes > 0;
  const listForUser = (adminId, userId) => ofUser.all(adminId, userId).map(toRow);
  const hasSubscription = (adminId, userId) => count.get(adminId, userId) > 0;

  async function deliver(row, payload) {
    const body = encrypt(payload, { p256dh: row.p256dh, auth: row.auth });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await fetch(row.endpoint, {
        method: 'POST',
        headers: {
          Authorization: vapidHeader(row.endpoint, subject, config.VAPID_PUBLIC_KEY, key),
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: String(TTL_SECONDS),
          Urgency: 'normal',
        },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  // Every subscription of the user gets the message; { sent, failed, removed }.
  async function sendToUser(adminId, userId, { title, body, url, tag, id }) {
    const out = { sent: 0, failed: 0, removed: 0 };
    if (!enabled) return out;
    const payload = JSON.stringify({ title: String(title || '').slice(0, 120), body: String(body || '').slice(0, 300), url: String(url || '/app').slice(0, 300), tag: String(tag || 'worship').slice(0, 60), ...(id ? { id: Number(id) } : {}) });
    if (payload.length > MAX_PAYLOAD) throw new Error('push payload too large');
    for (const row of ofUser.all(adminId, userId)) {
      try {
        const res = await deliver(row, payload);
        if (res.ok || res.status === 201) {
          ok.run(Date.now(), row.id);
          out.sent += 1;
        } else if (res.status === 404 || res.status === 410) {
          removeAny.run(row.id); // gone: the browser dropped the subscription
          out.removed += 1;
          logger.info(`Push subscription #${row.id} removed (${res.status}) (user #${userId}, admin #${adminId})`);
        } else {
          failed.run(row.id);
          out.failed += 1;
          logger.warn(`Push to subscription #${row.id} failed: HTTP ${res.status} (user #${userId}, admin #${adminId})`);
        }
      } catch (err) {
        failed.run(row.id);
        out.failed += 1;
        logger.warn(`Push to subscription #${row.id} failed: ${err.name === 'AbortError' ? 'timeout' : err.message} (user #${userId}, admin #${adminId})`);
      }
    }
    return out;
  }

  return { enabled, publicKey: enabled ? config.VAPID_PUBLIC_KEY : null, subject, subscribe, unsubscribe, listForUser, hasSubscription, sendToUser };
}

module.exports = { TTL_SECONDS, generateVapidKeys, vapidKey, vapidHeader, encrypt, decrypt, validSubscription, createPush };
