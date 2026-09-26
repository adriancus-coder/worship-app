'use strict';

// The browser side of web push (routes/push.js): PUSH.status() -> { supported, permission,
// enabled, subscribed, standalone, ios }, PUSH.subscribe(), PUSH.unsubscribe(). The service
// worker (/sw.js) shows the notifications and opens their page.

(function () {
  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const standalone = () => Boolean((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone);
  const ios = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function toKey(base64url) {
    const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
    const raw = atob((base64url + padding).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  async function config() {
    const res = await fetch('/api/push/config', { cache: 'no-store' });
    return res.ok ? res.json() : { enabled: false, publicKey: null };
  }

  async function current() {
    if (!supported()) return null;
    const reg = await navigator.serviceWorker.getRegistration('/');
    return reg ? reg.pushManager.getSubscription() : null;
  }

  async function status() {
    const cfg = await config();
    const sub = await current().catch(() => null);
    return { supported: supported(), permission: supported() ? Notification.permission : 'denied', enabled: cfg.enabled, subscribed: Boolean(sub), endpoint: sub ? sub.endpoint : null, standalone: standalone(), ios: ios() };
  }

  // -> { ok, reason?: 'unsupported' | 'disabled' | 'denied' | 'failed' }
  async function subscribe() {
    if (!supported()) return { ok: false, reason: 'unsupported' };
    const cfg = await config();
    if (!cfg.enabled) return { ok: false, reason: 'disabled' };
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { ok: false, reason: 'denied' };
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(cfg.publicKey) }));
      const res = await fetch('/api/push/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) });
      return res.ok ? { ok: true } : { ok: false, reason: 'failed' };
    } catch (err) {
      return { ok: false, reason: 'failed', detail: err.message };
    }
  }

  async function unsubscribe() {
    const sub = await current().catch(() => null);
    const endpoint = sub ? sub.endpoint : null;
    if (sub) await sub.unsubscribe().catch(() => {});
    if (endpoint) await fetch('/api/push/subscriptions', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint }) }).catch(() => {});
    return { ok: true };
  }

  window.PUSH = { status, subscribe, unsubscribe, supported, standalone, ios };
})();
