# ROADMAP — worship-app

Decisions agreed with the product owner (Adrian). Stages are built in order;
never implement a later stage early. Mockups: claude.ai design canvas
"Aplicație worship — machete" (shared separately).

## Product decisions

- **Standalone worship app** for churches, no speech recognition or translation in core.
  Translation is an optional bridge to Sanctuary Voice (stage 8).
- **Customer = "admin"** (one church/group). Subscription per admin, paid outside
  the app (website). The app itself never shows prices, buy buttons or payment links.
- **PWA first.** App Store / Google Play later, possibly via Capacitor; not planned yet.
- **Accounts:** personal logins (email + password) per user, roles owner / leader /
  operator / member. Owner invites users. "Remember me" for church PCs.
- **UI:** new design, dark stage theme, phone- and tablet-first; Romanian UI by default.

## Live model (core rules)

- **Server is the single source of truth.** Clients send commands; the server validates
  (role + who has control), applies, versions the state and broadcasts it to the event room.
  On reconnect a client receives the full state snapshot.
- **Two positions per event:**
  - *worship position* — moved by the leader's tablet; team phones always follow it;
  - *projector position* — follows the worship position, unless the leader ticks
    "Proiectorul controlat de operator"; then only the operator moves it, independently.
    Unticking returns the projector to the worship position.
- The operator always sees where worship is ("Worship e la: …") and has
  "Sari la worship" (key W) to jump the projector there.
- **The projector never changes on its own.** Every source change is an explicit action.
  Projector sources: song, verse, video, logo, translation (bridge), black screen.
- **Operator additions:** a song the operator adds goes to the projector only. If
  "Propune și în setlist-ul worship" is ticked, a request goes to the leader.
  The leader gets a small non-blocking notification; "Vezi" opens a preview
  (key, sections, lyrics+chords) with position choice (after current / at end)
  and Accept / Refuse. Accepted → shared setlist → team phones.
- **Video:** from the app library (uploaded, size-limited), URL (direct mp4 preferred;
  YouTube/Vimeo allowed), or a file picked once on the projector PC (e.g. USB stick).
  Selecting only *prepares* it; it plays only on "Pornește pe proiector".

## Projector screen

- Separate page with no controls. Opened from the operator console with
  "Deschide ecranul proiectorului": new window, moved fullscreen to the second display
  via the Window Management API (Chrome/Edge, one-time permission); fallback = drag + F11.
  Opened from a logged-in console it pairs automatically.
- A PC with no operator pairs with a 6-digit code entered in the admin.
- **Emergency mode:** the operator console and projector window on the same PC keep
  working without internet (BroadcastChannel + locally cached event and songs).
  Team phones keep cached songs and navigate manually. Resync when back online.
  (A phone hotspot is the recommended backup internet.)
- A full local-server mode is NOT planned now; keep the live path free of external
  services so it stays possible (see CLAUDE.md rule 8).

## Event preparation

- Events: name, date, time; create from a template or copy a previous event.
- Status: draft (leader only) → published (team sees it) → live → finished (history).
- Setlist items of several types: song, verse, video, announcement, sermon/other.
- Per song, per event: key (with automatic chord transposition), section order
  (arrangement — drives "Next" in live mode), note for the team, optional reference link.
- History: "last sung N weeks ago".
- Team (stage 7): assign people + roles, notification, confirm/decline.
- Rehearsal view on phones: event key, arrangement, leader note, lyrics+chords, reference.

## Stages

1. Skeleton: server, SQLite, first-run setup, accounts + login.
2. Song library: songs, sections, chords, search (port normalisation, Romanian elision,
   token-AND title search from Sanctuary Voice), import.
3. Events + setlists (preparation, arrangement, key/transposition, item types).
4. Live control: worship position, leader tablet, team phone view.
5. Projector screen: pairing, open-on-second-display, sources, video, emergency mode.
6. Operator console: independent control, requests to the leader.
7. Team: user invites, roles, assignments, confirmations, rehearsal view, push.
8. Bridge to Sanctuary Voice via event code (read-only live text as a projector source).
9. Pilot at Maranata, then 1–2 other churches.
