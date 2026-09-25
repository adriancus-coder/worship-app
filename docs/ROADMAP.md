# ROADMAP — worship-app

Decisions agreed with the product owner (Adrian). Stages are built in order;
never implement a later stage early. Mockups: claude.ai design canvas
"Aplicație worship — machete" (shared separately).

## Product decisions

- **Standalone worship app** for churches, no speech recognition or translation in core.
  Translation is an optional two-way bridge to Sanctuary Voice (stage 8, see below).
- **Customer = "admin"** (one church/group). Subscription per admin, paid outside
  the app (website). The app itself never shows prices, buy buttons or payment links.
- **PWA first.** App Store / Google Play later, possibly via Capacitor; not planned yet.
- **Accounts:** personal logins (email + password) per user, roles owner / leader /
  operator / member. Owner invites users. "Remember me" for church PCs.
- **UI:** new design, dark stage theme, phone- and tablet-first; Romanian UI by default.
- **Chord notation:** letters (C D E) or Romanian solfège (Do Re Mi), chosen per user with a
  church default; songs are always stored with letters (display only).

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

## Bridge to Sanctuary Voice (optional, two-way)

- Connection: Sanctuary Voice generates a short-lived **connection code** for its event
  (separate from the public participant code). Entered in the worship event, it is exchanged
  server-to-server for a **bridge token** scoped to that event pair; expires when the event
  ends; either side can disconnect. Projector PCs and phones never talk to Sanctuary Voice.
- Two independent switches on the connection:
  - **SV → worship:** live translated text becomes a projector source
    ("Traducere · limba X"); shown only when the operator/leader picks it explicitly.
  - **worship → SV:** worship sends the current song + section (title, section label,
    section text in the source language) whenever the **worship position** changes, and
    "no song" when leaving songs. Sanctuary Voice translates with its own pipeline and cache
    and shows the translated lyrics to its participants in their language.
- **Pre-translation:** when the bridge connects (or the setlist changes), worship sends
  the whole setlist's song sections in advance so Sanctuary Voice can translate them
  before they are sung (instant display, lower cost). Content hashes identify sections.
- Worship never holds translation/AI keys; all translation happens in Sanctuary Voice.
- If the bridge drops, both apps continue on their own; the projector never switches
  source automatically.
- Lyrics sent for translation may be copyrighted; the admin enables worship → SV
  explicitly and is responsible for having the rights.

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
8. Bridge to Sanctuary Voice via event code:
   8a. SV → worship: live translated text as a projector source.
   8b. worship → SV: current song/section + setlist pre-translation for SV participants.
   (Requires matching work in the sanctuary-voice-app repo.)
9. Pilot at Maranata, then 1–2 other churches.
