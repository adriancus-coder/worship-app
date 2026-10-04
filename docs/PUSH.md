# Push notifications (web push)

The app sends short notifications to the team's phones and computers: "Ești programat",
a reminder the day before, a changed setlist, the event going live. They are **web push**
messages: the browser's push service delivers them, the app's service worker shows them,
and a tap opens the right page. Nothing is sent to third-party SDKs; the server talks to the
push service directly (`lib/push.js`, VAPID + aes128gcm with `node:crypto`, no extra package).

Without keys the app runs exactly as before: the in-app list on "Mai mult → Notificări"
still works, and the page says push is not set up on this server.

## 1. Keys

```sh
npm run vapid
```

prints three lines:

```
VAPID_PUBLIC_KEY=BM…      (a P-256 public key, base64url, 87 characters)
VAPID_PRIVATE_KEY=…       (32 bytes, base64url)
VAPID_SUBJECT=mailto:admin@example.org
```

Put them in the environment (Render: the service's **Environment** tab, then redeploy;
locally: `.env`). Set `VAPID_SUBJECT` to a real contact (`mailto:` or an `https:` page):
push services may use it to reach you about abuse. Keep the private key secret. Changing the
keys invalidates every subscription: people turn notifications on again.

## 2. What the user does

"Mai mult → Notificări → Activează notificările": the browser asks for permission once, the
subscription is saved on the server (one per browser / device, table `push_subscriptions`).
"Dezactivează pe acest dispozitiv" removes it. "Trimite o notificare de test" sends one to
this user's devices.

On **iPhone / iPad** web push works only from the installed app (iOS 16.4+, "Add to Home
Screen"); the page says so and points to "Instalează aplicația" when opened in the browser.

## 3. Behaviour and limits

- Payloads are small: `{ title, body, url, tag }`; the same `tag` replaces an earlier
  notification of the same kind.
- A 404 / 410 from the push service means the browser dropped the subscription: the row is
  deleted. Other failures are counted (`failed_count`) and logged; nothing is thrown.
- Delivery goes to every subscription of the user. The server never stores notification
  content in the subscription table; the in-app list (`notifications`) is the record.
- Requests to push services time out after 10 s.
- The service worker (`lib/service-worker.js`) handles `push` and `notificationclick`
  (focus an open window and navigate it, else open one).
- Local mode / no internet: the push service is unreachable, deliveries fail quietly and the
  in-app list still shows everything.

## Tests

`scripts/test-lib.js` encrypts and decrypts a message with generated keys and checks the
VAPID header; the browser suite uses a fake push service (`tests/browser/fixtures/mock-push.js`)
and a generated key pair, so no real push service is contacted.
