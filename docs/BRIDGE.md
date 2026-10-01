# Bridge to Sanctuary Voice — worship-app side (stage 8)

Optional, two-way bridge that connects a worship event to a Sanctuary Voice (SV) event so a
congregation can read live translations, and so SV can translate the church's songs for its own
participants. **The app runs fully without it** — an event with no bridge, and both switches off,
behaves exactly as it does today (CLAUDE.md rule 4). Translation logic lives behind `lib/bridge/`;
worship-app never holds translation or AI keys.

The **authoritative wire protocol** (REST paths, socket namespace, message names and payloads) is
owned by Sanctuary Voice, in the SV repo's `docs/BRIDGE.md`. This page describes only the
worship-app side. Do not rename or reshape the wire here.

## How it connects

- SV generates a short-lived **connection code** in its admin Live tab ("Conectează worship-app"),
  separate from the public participant code.
- The operator/leader enters it on the **operator console** (the bridge panel, bottom right). The
  worship server exchanges it **server-to-server** for a **bridge token** scoped to the
  `{worship event ↔ SV event}` pair (~12 h, revocable from either side).
- Phones and projector screens never talk to SV — only the two servers do (REST for the handshake,
  one Socket.IO connection for the live stream).
- The bridge token is a client credential worship-app must present back to SV, so it is stored
  **server-side only** (`bridge_connections.bridge_token`) and never sent to any browser or API
  response; `token_fingerprint` is a non-secret log id.

## Two switches, both default OFF

On the connection panel, once connected. Both switches are available to every event role (owner,
presenter, leader, operator) — there is no consent gate:

- **"Afișează traducerea pe proiector"** (`dir_in`) — enables the projector source
  **"Traducere · <limbă>"**, one per SV target language. It is shown only when the operator/leader
  picks it explicitly; the projector never switches to it on its own. Final text is shown large,
  in-progress (partial) text lighter. If the bridge drops, the projector carries on.
- **"Trimite cântările spre traducere"** (`dir_out`) — sends song sections to SV.

Note: the lyrics sent for translation may be copyrighted; the church is responsible for having the
rights to send them. (Documentation only — not a gate in the app.)

## What flows over the socket

Worship-app opens a server-side `socket.io-client` to `<svBaseUrl>/bridge` with the token in the
handshake, and reconnects with backoff. Nothing else changes if it drops.

- **SV → worship** (read-only, `dir_in`): `bridge.ready`, `translation.partial`,
  `translation.final`. The latest text per language is kept in memory (not persisted — a fast
  stream) and merged onto the projector frame for the picked language.
- **worship → SV** (`dir_out`): `song.current` on every MAIN-position change to a song
  section — `{ title, label, text (chords stripped), hash, lang }` — and `song.clear` when the main
  position leaves songs. Throttled to one message per position change. On connect and on any
  setlist change, `setlist.sections` sends all shared song sections ahead so SV can pre-translate
  (instant display, lower cost).

The section **hash** is `lib/songs.lyricsHash` (sha256 of the chord-stripped, whitespace-collapsed
lyrics), so it is stable across transposition and identical for `song.current` and
`setlist.sections`; SV caches translations per hash.

## Server-to-server REST (worship-app calls these)

Base URL: `PUBLIC` SV, default `https://sanctuaryvoice.com`; staging `https://dev.sanctuaryvoice.com`.

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `POST /api/bridge/exchange` | the code | code → bridge token, SV event id, target languages, expiry |
| `POST /api/bridge/revoke` | token | disconnect |
| `GET  /api/bridge/status` | token | liveness |

## worship-app endpoints (the UI calls these)

Event-scoped, all event roles (owner, presenter, leader, operator); a member sees nothing. None
ever returns the token.

| Method & path | Purpose |
| --- | --- |
| `GET  /api/events/:id/bridge` | connection status + switches |
| `POST /api/events/:id/bridge/connect` | `{ code, svBaseUrl? }` → exchange + connect |
| `POST /api/events/:id/bridge/switches` | `{ dirIn, dirOut }` |
| `POST /api/events/:id/bridge/refresh` | re-check liveness at SV |
| `POST /api/events/:id/bridge/disconnect` | revoke + forget |

## Code map

- `lib/bridge/client.js` — REST handshake + the SV socket (fetch and socket.io-client injected).
- `lib/bridge/store.js` — `bridge_connections` and the switches.
- `lib/bridge/sections.js` — the current song section and the setlist's sections (+ hashing).
- `lib/bridge/index.js` — the hub: connect/disconnect, switches, the SV → worship translation
  cache, the worship → SV emitters, resume-after-restart.
- `routes/bridge.js` — the event-scoped HTTP endpoints.
- `public/bridge-panel.js` — the shared UI (event page, live page, operator console): connect,
  switches, revoke, translation sources.
- Migrations `037_bridge.sql` (connections) and `038_bridge_translation.sql` (`live_state.translation_lang`).

## Local mode

The bridge is a cloud feature (it reaches SV over HTTPS). It degrades gracefully: with no bridge or
offline, the live path (setlist, positions, projector control) runs entirely on this server +
SQLite, exactly as CLAUDE.md rule 8 requires. Nothing in the live path depends on SV.

## Proposed: church pairing (one-time), then one-tap connections

**Status: proposal, to be agreed with the Sanctuary Voice repo (which owns the wire).** Nothing of
this is implemented yet on either side. Today every event needs a fresh code typed from SV's Live
tab. The goal: pair the church with SV **once**, then connect any event with a single tap.

### Flow

1. **Pair once** (worship-app owner, Settings → "Sanctuary Voice"): SV's admin shows a one-time
   **pairing code** ("Împerechează worship-app", same alphabet as the connection code). The owner
   types it in worship-app, which exchanges it server-to-server for a long-lived **pairing token**
   scoped to `{worship church (admin) ↔ SV organisation}`. Stored server-side only
   (`bridge_pairings`, one row per admin), never sent to a browser. Revocable from either side.
2. **Connect an event** (any event role, the connection panel): no code. worship-app asks SV for
   the organisation's events that can take a bridge and shows them as a list ("Conectează la:
   Serviciu duminică · 10:00"); with exactly one SV event live or planned today it offers it
   directly ("Conectează la Serviciu duminică"). The pick exchanges the pairing token for the
   per-event **bridge token** exactly as today, so everything after the handshake (switches,
   socket, translation sources, `song.current`, `setlist.sections`) stays unchanged.
3. **Unpair** (owner): revokes the pairing at SV and forgets it; open event bridges keep working
   until their own token expires or is revoked.

The typed connection code stays as a fallback (a church not paired, or a guest SV event).

### Wire additions (SV side; naming to be confirmed by SV)

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `POST /api/bridge/pair` | the pairing code | `{ code, churchName }` → `{ ok, pairingToken, svOrgId, svOrgName, expiresAt? }` (long-lived or no expiry) |
| `GET  /api/bridge/events` | pairing token | `{ ok, events: [{ svEventId, name, startsAt, status: 'live' \| 'planned', targetLanguages }] }` — today's and upcoming events that may take a bridge |
| `POST /api/bridge/connect` | pairing token | `{ svEventId, worshipEventName }` → the same body as `/api/bridge/exchange` (`bridgeToken`, `svEventId`, `targetLanguages`, `expiresAt`) |
| `POST /api/bridge/unpair` | pairing token | `{ ok }` |

Security: the pairing token is a client credential like the bridge token (server-side only,
`token_fingerprint` for logs); SV may rotate it and must reject it after an unpair from its side.
One pairing per worship admin; SV decides whether one organisation may pair several worship
churches.

### worship-app side (once SV confirms)

- Migration `bridge_pairings (admin_id PK, sv_base_url, pairing_token, token_fingerprint,
  sv_org_id, sv_org_name, paired_by, paired_at, last_checked_at)`.
- `lib/bridge/client.js`: `pair`, `listEvents`, `connectPaired`, `unpair` next to `exchange`.
- Settings page: "Sanctuary Voice" card (owner): paired as "<org>", "Împerechează" / "Desparte".
- `public/bridge-panel.js`: when paired, the event list / the one-tap button first; the code
  field behind "Conectează cu cod".
