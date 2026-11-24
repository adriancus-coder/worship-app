'use strict';

// Passkeys in the browser (routes/passkeys.js, lib/passkeys.js): "Intră cu Face ID / amprentă".
//   PASSKEYS.supported()                      -> the browser has WebAuthn (and a secure context)
//   await PASSKEYS.platformAvailable()        -> a Face ID / Touch ID / fingerprint authenticator here
//   await PASSKEYS.conditionalAvailable()     -> the passkey can be offered in the email field's autofill
//   await PASSKEYS.register({ name })         -> adds a passkey for the signed-in person; { passkeys }
//   await PASSKEYS.registerInvite({ token, name }) -> the invitation without a password; { user }
//   await PASSKEYS.login({ mediation, signal }) -> signs in; { user, admin }
//   PASSKEYS.deviceName()                     -> 'iphone' | 'ipad' | 'android' | 'mac' | 'windows' | 'other'
// Every failure throws an Error with .code: 'cancelled' (the person closed the prompt),
// 'unsupported', or the server's code (passkeyUnknown, passkeyInvalid, passkeyChallenge, …)
// with .message already translated by the server.

(function () {
  const b64url = {
    decode(text) { const bin = atob(String(text).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(text).length / 4) * 4, '=')); return Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer; },
    encode(buffer) { return btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  };

  function supported() {
    return Boolean(window.PublicKeyCredential && navigator.credentials && window.isSecureContext);
  }
  async function platformAvailable() {
    if (!supported()) return false;
    try { return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch (err) { return false; }
  }
  async function conditionalAvailable() {
    if (!supported() || !window.PublicKeyCredential.isConditionalMediationAvailable) return false;
    try { return await window.PublicKeyCredential.isConditionalMediationAvailable(); } catch (err) { return false; }
  }

  function fail(code, message) { const err = new Error(message || code); err.code = code; return err; }

  async function post(url, body) {
    const res = await fetch(url, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw fail(data.code || 'failed', data.error || '');
    return data;
  }

  // The server's options (base64url strings) -> what navigator.credentials wants (buffers).
  function creationOptions(pk) {
    return { ...pk, challenge: b64url.decode(pk.challenge), user: { ...pk.user, id: b64url.decode(pk.user.id) }, excludeCredentials: (pk.excludeCredentials || []).map((c) => ({ ...c, id: b64url.decode(c.id) })) };
  }
  function requestOptions(pk) {
    return { ...pk, challenge: b64url.decode(pk.challenge), allowCredentials: (pk.allowCredentials || []).map((c) => ({ ...c, id: b64url.decode(c.id) })) };
  }
  function wrap(err) {
    if (err && err.code) return err;
    if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) return fail('cancelled');
    if (err && err.name === 'InvalidStateError') return fail('passkeyExists');
    return fail('unsupported', err && err.message);
  }

  async function create(optionsUrl) {
    if (!supported()) throw fail('unsupported');
    const { publicKey } = await post(optionsUrl);
    let cred;
    try { cred = await navigator.credentials.create({ publicKey: creationOptions(publicKey) }); } catch (err) { throw wrap(err); }
    if (!cred) throw fail('cancelled');
    const transports = cred.response.getTransports ? cred.response.getTransports() : [];
    return {
      challenge: publicKey.challenge,
      credential: { id: cred.id, type: cred.type, response: { clientDataJSON: b64url.encode(cred.response.clientDataJSON), attestationObject: b64url.encode(cred.response.attestationObject), transports } },
    };
  }

  function deviceName() {
    const ua = navigator.userAgent || '';
    if (/iPhone/.test(ua)) return 'iphone';
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ipad';
    if (/Android/.test(ua)) return 'android';
    if (/Macintosh/.test(ua)) return 'mac';
    if (/Windows/.test(ua)) return 'windows';
    return 'other';
  }

  async function register({ name } = {}) {
    const made = await create('/api/auth/passkey/register/options');
    return post('/api/auth/passkey/register', { ...made, name: name || '' });
  }

  async function registerInvite({ token, name }) {
    const made = await create(`/api/invite/${encodeURIComponent(token)}/passkey/options`);
    return post(`/api/invite/${encodeURIComponent(token)}/passkey`, { ...made, name: name || '' });
  }

  async function login({ mediation = 'optional', signal, remember = true, label = '' } = {}) {
    if (!supported()) throw fail('unsupported');
    const { publicKey } = await post('/api/auth/passkey/login/options');
    let cred;
    try { cred = await navigator.credentials.get({ publicKey: requestOptions(publicKey), mediation, signal }); } catch (err) { throw wrap(err); }
    if (!cred) throw fail('cancelled');
    const r = cred.response;
    return post('/api/auth/passkey/login', {
      challenge: publicKey.challenge, remember,
      credential: { id: cred.id, type: cred.type, response: { clientDataJSON: b64url.encode(r.clientDataJSON), authenticatorData: b64url.encode(r.authenticatorData), signature: b64url.encode(r.signature), userHandle: r.userHandle ? b64url.encode(r.userHandle) : null } },
      label,
    });
  }

  window.PASSKEYS = { supported, platformAvailable, conditionalAvailable, register, registerInvite, login, deviceName };
})();
