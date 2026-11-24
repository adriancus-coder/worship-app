'use strict';

// Passkeys (WebAuthn, migration 068): "Intră cu Face ID / amprentă". The browser's platform
// authenticator (Face ID, Touch ID, an Android fingerprint, Windows Hello) signs a challenge
// with a key it made for this site; the server keeps the public key per person and device.
// No dependency: the parts of WebAuthn a passkey needs are small (a CBOR subset, the
// authenticator data, a COSE key to JWK, an ES256 / RS256 signature check). The attestation
// statement is not verified (the server asks for none, as passkeys do).
//
//   registrationOptions({ rpId, rpName, challenge, user: { id, name, displayName }, excludeIds })
//   verifyRegistration({ clientDataJSON, attestationObject, expectedChallenge, expectedOrigins, rpId })
//     -> { credentialId, publicKeyJwk, alg, counter }
//   authenticationOptions({ rpId, challenge })
//   verifyAuthentication({ clientDataJSON, authenticatorData, signature, expectedChallenge,
//     expectedOrigins, rpId, publicKeyJwk, alg, counter }) -> { counter }
//   createChallenges()        issue(data) -> challenge; take(challenge) -> data | null (5 min)
//   createPasskeyStore(db)    add, listForUser, findByCredentialId, used, remove, countForUser
// Every check failure throws a PasskeyError with a short code (badChallenge, badOrigin, badType,
// badRpId, notPresent, badKey, badSignature, badCounter, badData).

const crypto = require('crypto');

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const ALGS = { '-7': 'ES256', '-257': 'RS256' };

class PasskeyError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const toB64url = (bytes) => Buffer.from(bytes).toString('base64url');
const fromB64url = (text) => {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text)) throw new PasskeyError('badData');
  return Buffer.from(text, 'base64url');
};
const sha256 = (data) => crypto.createHash('sha256').update(data).digest();

// --- CBOR (RFC 8949): the subset an attestation object and a COSE key use -------------------
function decodeCbor(buf) {
  let at = 0;
  const need = (n) => { if (at + n > buf.length) throw new PasskeyError('badData'); };
  function argument(info) {
    if (info < 24) return info;
    if (info === 24) { need(1); return buf[at++]; }
    if (info === 25) { need(2); const v = buf.readUInt16BE(at); at += 2; return v; }
    if (info === 26) { need(4); const v = buf.readUInt32BE(at); at += 4; return v; }
    if (info === 27) { need(8); const v = buf.readBigUInt64BE(at); at += 8; if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new PasskeyError('badData'); return Number(v); }
    throw new PasskeyError('badData'); // indefinite lengths and reserved values
  }
  function read() {
    need(1);
    const first = buf[at++];
    const major = first >> 5;
    const arg = argument(first & 31);
    switch (major) {
      case 0: return arg;
      case 1: return -1 - arg;
      case 2: { need(arg); const v = buf.subarray(at, at + arg); at += arg; return Buffer.from(v); }
      case 3: { need(arg); const v = buf.toString('utf8', at, at + arg); at += arg; return v; }
      case 4: { const list = []; for (let i = 0; i < arg; i += 1) list.push(read()); return list; }
      case 5: {
        const map = new Map();
        for (let i = 0; i < arg; i += 1) { const key = read(); const value = read(); map.set(typeof key === 'string' ? key : Number(key), value); }
        return map;
      }
      case 6: return read(); // a tag: the value itself
      case 7:
        if (arg === 20) return false;
        if (arg === 21) return true;
        if (arg === 22 || arg === 23) return null;
        throw new PasskeyError('badData'); // floats are not used here
      default: throw new PasskeyError('badData');
    }
  }
  const value = read();
  return { value, rest: buf.subarray(at) };
}

// --- the authenticator data ----------------------------------------------------------------
// rpIdHash (32) | flags (1) | signCount (4) | [attested credential: aaguid (16) | credIdLen (2)
// | credId | COSE key (CBOR)] | [extensions (CBOR)]
function parseAuthData(buf) {
  if (buf.length < 37) throw new PasskeyError('badData');
  const rpIdHash = buf.subarray(0, 32);
  const flags = buf[32];
  const counter = buf.readUInt32BE(33);
  const out = { rpIdHash, flags, counter, userPresent: Boolean(flags & 0x01), userVerified: Boolean(flags & 0x04) };
  if (flags & 0x40) {
    if (buf.length < 55) throw new PasskeyError('badData');
    const credIdLen = buf.readUInt16BE(53);
    if (buf.length < 55 + credIdLen) throw new PasskeyError('badData');
    out.credentialId = Buffer.from(buf.subarray(55, 55 + credIdLen));
    out.coseKey = decodeCbor(buf.subarray(55 + credIdLen)).value;
  }
  return out;
}

// A COSE key (map) -> { jwk, alg }: EC2 P-256 (ES256) or RSA (RS256).
function coseToJwk(cose) {
  if (!(cose instanceof Map)) throw new PasskeyError('badKey');
  const kty = cose.get(1);
  const alg = cose.get(3);
  if (!ALGS[String(alg)]) throw new PasskeyError('badKey');
  if (kty === 2 && alg === -7) {
    if (cose.get(-1) !== 1) throw new PasskeyError('badKey'); // P-256 only
    const x = cose.get(-2); const y = cose.get(-3);
    if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) throw new PasskeyError('badKey');
    return { alg, jwk: { kty: 'EC', crv: 'P-256', x: toB64url(x), y: toB64url(y) } };
  }
  if (kty === 3 && alg === -257) {
    const n = cose.get(-1); const e = cose.get(-2);
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e) || n.length < 256) throw new PasskeyError('badKey');
    return { alg, jwk: { kty: 'RSA', n: toB64url(n), e: toB64url(e) } };
  }
  throw new PasskeyError('badKey');
}

function keyObject(jwk) {
  try { return crypto.createPublicKey({ key: jwk, format: 'jwk' }); } catch (err) { throw new PasskeyError('badKey'); }
}

function checkClientData(clientDataJSON, { type, expectedChallenge, expectedOrigins }) {
  let data;
  try { data = JSON.parse(clientDataJSON.toString('utf8')); } catch (err) { throw new PasskeyError('badData'); }
  if (!data || data.type !== type) throw new PasskeyError('badType');
  if (typeof data.challenge !== 'string' || data.challenge !== expectedChallenge) throw new PasskeyError('badChallenge');
  const origins = Array.isArray(expectedOrigins) ? expectedOrigins : [expectedOrigins];
  if (!origins.includes(data.origin)) throw new PasskeyError('badOrigin');
  return data;
}

function checkRpId(rpIdHash, rpId) {
  if (!crypto.timingSafeEqual(rpIdHash, sha256(rpId))) throw new PasskeyError('badRpId');
}

// --- options -------------------------------------------------------------------------------
function registrationOptions({ rpId, rpName, challenge, user, excludeIds = [] }) {
  return {
    challenge,
    rp: { id: rpId, name: rpName },
    user: { id: toB64url(Buffer.from(`u${user.id}`)), name: user.name, displayName: user.displayName || user.name },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
    excludeCredentials: excludeIds.map((id) => ({ type: 'public-key', id })),
    attestation: 'none',
    timeout: 120000,
  };
}

function authenticationOptions({ rpId, challenge }) {
  return { challenge, rpId, allowCredentials: [], userVerification: 'preferred', timeout: 120000 };
}

// --- verification --------------------------------------------------------------------------
function verifyRegistration({ clientDataJSON, attestationObject, expectedChallenge, expectedOrigins, rpId }) {
  const clientData = fromB64url(clientDataJSON);
  checkClientData(clientData, { type: 'webauthn.create', expectedChallenge, expectedOrigins });
  const attestation = decodeCbor(fromB64url(attestationObject)).value;
  if (!(attestation instanceof Map) || !Buffer.isBuffer(attestation.get('authData'))) throw new PasskeyError('badData');
  const auth = parseAuthData(attestation.get('authData'));
  checkRpId(auth.rpIdHash, rpId);
  if (!auth.userPresent) throw new PasskeyError('notPresent');
  if (!auth.credentialId || !auth.coseKey) throw new PasskeyError('badData');
  const { jwk, alg } = coseToJwk(auth.coseKey);
  keyObject(jwk); // a key Node can use
  return { credentialId: toB64url(auth.credentialId), publicKeyJwk: jwk, alg, counter: auth.counter };
}

function verifyAuthentication({ clientDataJSON, authenticatorData, signature, expectedChallenge, expectedOrigins, rpId, publicKeyJwk, alg, counter }) {
  const clientData = fromB64url(clientDataJSON);
  checkClientData(clientData, { type: 'webauthn.get', expectedChallenge, expectedOrigins });
  const authData = fromB64url(authenticatorData);
  const auth = parseAuthData(authData);
  checkRpId(auth.rpIdHash, rpId);
  if (!auth.userPresent) throw new PasskeyError('notPresent');
  if (!ALGS[String(alg)]) throw new PasskeyError('badKey');
  const signed = Buffer.concat([authData, sha256(clientData)]);
  const key = keyObject(publicKeyJwk);
  let ok = false;
  try { ok = crypto.verify('sha256', signed, alg === -7 ? { key, dsaEncoding: 'der' } : key, fromB64url(signature)); } catch (err) { ok = false; }
  if (!ok) throw new PasskeyError('badSignature');
  // a counter that moved backwards means a cloned key; synced passkeys keep 0 forever
  if ((auth.counter > 0 || counter > 0) && auth.counter <= counter) throw new PasskeyError('badCounter');
  return { counter: auth.counter };
}

// --- the challenges this server issued, one use each, five minutes ---------------------------
function createChallenges({ ttlMs = CHALLENGE_TTL_MS } = {}) {
  const pending = new Map();
  function prune(now) {
    for (const [key, entry] of pending) if (entry.expiresAt <= now) pending.delete(key);
  }
  return {
    issue(data, now = Date.now()) {
      prune(now);
      const challenge = toB64url(crypto.randomBytes(32));
      pending.set(challenge, { ...data, expiresAt: now + ttlMs });
      return challenge;
    },
    take(challenge, now = Date.now()) {
      prune(now);
      const entry = typeof challenge === 'string' ? pending.get(challenge) : undefined;
      if (!entry) return null;
      pending.delete(challenge);
      return entry;
    },
    size() { return pending.size; },
  };
}

// --- the table ------------------------------------------------------------------------------
function createPasskeyStore(db) {
  const insert = db.prepare(`INSERT INTO passkeys (admin_id, user_id, credential_id, public_key, alg, counter, transports, name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const selectForUser = db.prepare('SELECT id, credential_id, name, transports, created_at, last_used_at FROM passkeys WHERE admin_id = ? AND user_id = ? ORDER BY created_at');
  const selectByCredential = db.prepare(`SELECT p.id, p.admin_id, p.user_id, p.public_key, p.alg, p.counter,
      u.name, u.email, u.role, u.locale, u.theme, a.name AS admin_name
    FROM passkeys p JOIN users u ON u.id = p.user_id AND u.admin_id = p.admin_id JOIN admins a ON a.id = p.admin_id
    WHERE p.credential_id = ? AND u.active = 1 AND a.active = 1`);
  const update = db.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?');
  const remove = db.prepare('DELETE FROM passkeys WHERE id = ? AND admin_id = ? AND user_id = ?');
  const count = db.prepare('SELECT COUNT(*) FROM passkeys WHERE admin_id = ? AND user_id = ?').pluck();
  const row = (r) => ({ id: r.id, credentialId: r.credential_id, name: r.name, transports: JSON.parse(r.transports || '[]'), createdAt: r.created_at, lastUsedAt: r.last_used_at });
  return {
    add(adminId, userId, { credentialId, publicKeyJwk, alg, counter, transports = [], name = '' }, now = Date.now()) {
      return Number(insert.run(adminId, userId, credentialId, JSON.stringify(publicKeyJwk), alg, counter, JSON.stringify(transports.slice(0, 8)), name.slice(0, 60), now).lastInsertRowid);
    },
    listForUser: (adminId, userId) => selectForUser.all(adminId, userId).map(row),
    findByCredentialId(credentialId) {
      const r = selectByCredential.get(credentialId);
      return r ? { ...r, publicKeyJwk: JSON.parse(r.public_key) } : null;
    },
    used: (id, counter, now = Date.now()) => update.run(counter, now, id),
    remove: (adminId, userId, id) => remove.run(id, adminId, userId).changes > 0,
    countForUser: (adminId, userId) => count.get(adminId, userId),
  };
}

module.exports = {
  PasskeyError, ALGS, decodeCbor, parseAuthData, coseToJwk, registrationOptions, authenticationOptions,
  verifyRegistration, verifyAuthentication, createChallenges, createPasskeyStore, toB64url, fromB64url,
};
