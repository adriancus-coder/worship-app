'use strict';

// The projector screen (/screen). Unpaired: shows a 6-digit pairing code (renewed when it
// expires) and waits for an owner/leader to claim it. Paired: a black page with no UI that
// renders the frames the server sends. It never shows an error over the output: when the
// connection drops it keeps the last frame and reconnects quietly.

(function () {
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const TOKEN_KEY = 'wa_screen_token';
  const POLL_MS = 3000;
  const CURSOR_IDLE_MS = 2000;
  const HINT_MS = 5000;
  const OFFLINE_DOT_MS = 30000;

  const state = { token: null, pairing: null, pollTimer: null, countdown: null, socket: null, view: null, offlineTimer: null, logos: new Map() };

  function readToken() {
    try {
      return window.localStorage.getItem(TOKEN_KEY);
    } catch (err) {
      return null;
    }
  }

  function saveToken(token) {
    state.token = token;
    try {
      if (token) window.localStorage.setItem(TOKEN_KEY, token);
      else window.localStorage.removeItem(TOKEN_KEY);
    } catch (err) {
      // No storage (private mode): the pairing lasts until the window closes.
    }
  }

  async function request(method, url, body, headers = {}) {
    const res = await fetch(url, {
      method,
      cache: 'no-store',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // --- pairing ----------------------------------------------------------------------

  function formatCode(code) {
    return `${code.slice(0, 3)} ${code.slice(3)}`;
  }

  function renderCountdown() {
    if (!state.pairing) return;
    const left = Math.max(0, Math.round((state.pairing.expiresAt - Date.now()) / 1000));
    $('pairing-expiry').textContent = t('screen.expiresIn', { time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` });
    if (left === 0) startPairing(); // renew automatically
  }

  async function startPairing() {
    clearTimeout(state.pollTimer);
    state.pairing = null;
    $('output').hidden = true;
    $('pairing').hidden = false;
    $('pairing-code').textContent = '— — —';
    $('pairing-expiry').textContent = '';
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await request('POST', '/api/screen/pairings');
        if (res.status === 201) {
          state.pairing = res.body;
          break;
        }
        $('pairing-error').textContent = res.status === 429 ? t('screen.tooMany') : t('common.networkError');
      } catch (err) {
        $('pairing-error').textContent = t('common.networkError');
      }
      await sleep(Math.min(60000, 5000 * (attempt + 1)));
    }
    $('pairing-error').textContent = '';
    $('pairing-code').textContent = formatCode(state.pairing.code);
    $('pairing-code').setAttribute('aria-label', state.pairing.code.split('').join(' '));
    renderCountdown();
    poll();
  }

  async function poll() {
    const pairing = state.pairing;
    if (!pairing) return;
    try {
      const res = await request('GET', `/api/screen/pairings/${pairing.pairingId}`);
      if (pairing !== state.pairing) return;
      if (res.ok && res.body.status === 'paired') {
        paired(res.body.token);
        return;
      }
      if (res.status === 404) {
        startPairing();
        return;
      }
    } catch (err) {
      // Offline: keep the code on screen and try again.
    }
    state.pollTimer = setTimeout(poll, POLL_MS);
  }

  function paired(token) {
    clearTimeout(state.pollTimer);
    state.pairing = null;
    saveToken(token);
    connect();
  }

  // --- paired: output -----------------------------------------------------------------

  // The logo needs the screen token: fetched once and shown from a local object URL.
  async function resolveLogo(url) {
    if (!state.logos.has(url)) {
      state.logos.set(url, fetch(url, { headers: { 'X-Screen-Token': state.token } })
        .then((res) => (res.ok ? res.blob() : null))
        .then((blob) => (blob ? URL.createObjectURL(blob) : null))
        .catch(() => null));
    }
    const src = await state.logos.get(url);
    if (!src) state.logos.delete(url); // try again next time
    return src;
  }

  // A 4px dot in a corner after 30 s without the server; nothing else changes on screen.
  // Reconnect attempts keep failing meanwhile: the timer runs from the first one.
  function showOffline(offline) {
    if (!offline) {
      clearTimeout(state.offlineTimer);
      state.offlineTimer = null;
      $('offline-dot').hidden = true;
      return;
    }
    if (state.offlineTimer) return;
    state.offlineTimer = setTimeout(() => { $('offline-dot').hidden = false; }, OFFLINE_DOT_MS);
  }

  function dropToken() {
    if (state.socket) {
      state.socket.removeAllListeners();
      state.socket.close();
      state.socket = null;
    }
    saveToken(null);
    showOffline(false);
    startPairing();
  }

  function connect() {
    $('pairing').hidden = true;
    $('output').hidden = false;
    if (!state.view) state.view = window.PROJECTOR_RENDER.create($('output'), { resolveLogo });
    const socket = window.io('/screens', {
      auth: { token: state.token },
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 15000,
    });
    state.socket = socket;
    socket.on('connect', () => showOffline(false));
    socket.on('projector:frame', (frame) => {
      state.view.show(frame);
      updateHint();
    });
    socket.on('screen:revoked', dropToken);
    socket.on('connect_error', (err) => {
      if (err && err.message === 'unauthorized') dropToken(); // revoked or unknown token
      else showOffline(true);
    });
    socket.on('disconnect', async (reason) => {
      showOffline(true);
      if (reason !== 'io server disconnect') return; // socket.io reconnects by itself
      // Closed by the server: revoked (-> pair again) or a restart (-> reconnect).
      try {
        const res = await request('GET', '/api/screen/me', null, { 'X-Screen-Token': state.token });
        if (res.status === 401) return dropToken();
      } catch (err) {
        // Server unreachable: keep trying.
      }
      await sleep(2000);
      if (state.socket === socket) socket.connect();
    });
    keepScreenOn();
  }

  // --- fullscreen, cursor, wake lock ------------------------------------------------

  let hintTimer = null;
  function updateHint() {
    const hint = $('fullscreen-hint');
    const content = state.view && window.PROJECTOR_RENDER.isContent(state.view.frame);
    if (document.fullscreenElement || $('output').hidden || content) {
      hint.hidden = true;
      return;
    }
    if (!hint.hidden || hint.dataset.shown === '1') return;
    hint.dataset.shown = '1'; // once per page load / fullscreen exit
    hint.hidden = false;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { hint.hidden = true; }, HINT_MS);
  }

  // Browsers allow fullscreen only after a click or tap.
  document.addEventListener('pointerdown', () => {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen && !$('output').hidden) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) $('fullscreen-hint').dataset.shown = '';
    updateHint();
  });

  let cursorTimer = null;
  function wakeCursor() {
    document.body.classList.remove('cursor-hidden');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => document.body.classList.add('cursor-hidden'), CURSOR_IDLE_MS);
  }
  document.addEventListener('pointermove', wakeCursor);
  wakeCursor();

  let wakeLock = null;
  async function keepScreenOn() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || (wakeLock && !wakeLock.released)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (err) {
      // Not allowed right now: the OS power settings decide.
    }
  }
  document.addEventListener('visibilitychange', keepScreenOn);

  document.addEventListener('i18n:change', () => {
    renderCountdown();
    $('pairing-app').textContent = document.documentElement.dataset.appName || '';
  });

  // --- start --------------------------------------------------------------------------

  (async () => {
    $('pairing-app').textContent = document.documentElement.dataset.appName || '';
    document.title = t('screen.pageTitle', { appName: document.documentElement.dataset.appName || '' });
    setInterval(renderCountdown, 1000);
    // A one-time claim link from the leader's live page pairs this window without a code.
    const url = new URL(window.location.href);
    const claim = url.searchParams.get('claim');
    if (claim) {
      url.searchParams.delete('claim');
      window.history.replaceState(null, '', url);
      try {
        const res = await request('POST', '/api/screen/claim-link', { claim });
        if (res.ok) saveToken(res.body.token);
      } catch (err) {
        // Falls back to the pairing code.
      }
    }
    state.token = state.token || readToken();
    if (state.token) connect();
    else startPairing();
  })();
})();
