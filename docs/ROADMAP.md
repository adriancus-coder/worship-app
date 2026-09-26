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
  (role + live mode), applies, versions the state and broadcasts it to the event room.
  On reconnect a client receives the full state snapshot. Commands carry the version they
  were made against; one made against an older version is refused ("stale") and the page
  gets the current state, so two people moving at once never skip a section.
- **Event rights.** Owner, leader and operator (EVENT_ROLES, defined once in
  `lib/events.js`) have the same rights over events, always: create, edit, publish,
  unpublish, templates, delete, start, end, move the live position, projector, sources,
  video, live mode and team mode. They see drafts and templates. Members only see
  published / live / finished events and send no commands. The library (writing), media,
  screens, team and settings keep their own rules (owner / leader, or owner).
- **Two live modes** (`live.mode`, any event role; a new start is *together*):
  - *Împreună* (together, default) — ONE main position. The leader page and the operator
    console both move it; the projector and the team phones follow it. Projector-position
    commands are refused.
  - *Separat* (split) — the main position (team phones) and the projector position are
    independent; anyone with event rights may move either. The leader page's big controls
    move the team, the console's move the projector; each page shows where the other is
    ("Proiectorul e la …" / "Echipa e la …") with "Sari acolo" (key W on the console).
    Entering split copies the main position to the projector; back to together the
    projector shows the main position at once.
- **Team mode** (`team.mode`, any event role; a new start is *follow*):
  - *Urmărește live* (follow) — phones follow the main position. Someone who moves away on
    their own phone (swipe, ← / →) keeps their place with a floating "Revino la live";
    a tap, or 30 s without touching the page, returns them.
  - *Derulează liber* (free) — phones never jump; each person navigates the whole setlist,
    with a slim "Live: <song> · <section>" bar and "Mergi la live".
  Switching is instant for everyone; free mode keeps each person's place.
- **The projector never changes on its own.** Every source change is an explicit action.
  Projector sources: song, verse, video, logo, translation (bridge), black screen.
- **Tap or hold** (`public/press.js`, one convention for every Program list): a short tap
  runs the primary action, a long press (500 ms, cancelled by a 10 px move; a short buzz
  and a press animation) the secondary one. Desktop equivalents: right-click, the
  context-menu key, Shift+Enter. On the leader page and the console a tap on an item goes
  there (moves the live position, or the projector's in split mode on the console) and a
  long press on a song opens the arrange sheet without moving anything; in the event
  editor a tap selects the item and a long press arranges a song. Other items: a long press
  does nothing. The long press is only a shortcut: every song card keeps a visible
  "Aranjează" (the editor its "Aranjează cântarea"). A dismissible hint explains it once
  per device.
- **End of the item** (`worship.endItem`, event roles, key E): the third button of the
  Înapoi / Următoarea row ("Următoarea cântare →" / "Următorul element →" with the next
  title). It moves to the first step of the next item in the list the sender drives — the
  main position, or with `target: 'projector'` (split mode, the console) the projector's.
  After the last item it reads "Sfârșit": the position stays (the team still sees where the
  service is) and the projector goes to the logo, or black without one — an explicit
  action, like every source change. In split mode the leader's button ends only the team's
  item and never touches the projector. Versioned and broadcast like every command; phones
  put Înapoi and the end button on one line with Următoarea (the primary) under them.
- **Additions during live** (operator console; any event role): the sender chooses where
  the item goes, no approval:
  - "Doar pe proiector" — a projector-only item right after what the projector shows.
    Main-position navigation, team phones, rehearsal, item counts and history never see
    it; the editor's save leaves it in place. Choosing it on the console while together
    switches to split (only the projector can show it).
  - "În setlist" — a shared item right after the current main item; team phones reload
    the setlist at once.
  The other event-role pages get a short, non-blocking info toast ("<name> a adăugat
  <title>", hidden after 5 s, never over a control). Only the event roles receive the full
  item list in their live snapshots. (Before this, operator additions were proposals the
  leader accepted or refused; migration 014 turned pending ones into projector-only items.)
- **Video:** from the app library (uploaded, size-limited), URL (direct mp4 preferred;
  YouTube/Vimeo allowed), or a file picked once on the projector PC (e.g. USB stick).
  Selecting only *prepares* it; it plays only on "Pornește pe proiector".

## Projector screen

- Separate page with no controls. Opened from the operator console or the leader's live
  page with "Deschide ecranul proiectorului": new window, moved fullscreen to the second
  display via the Window Management API (Chrome/Edge, one-time permission); fallback =
  drag + F11. Opened from a logged-in page it pairs automatically.
- A PC with no operator pairs with a 6-digit code entered in the admin.
- **Emergency mode:** the leader's live page and the projector window on the same PC keep
  working without internet (BroadcastChannel + locally cached event and songs): the main
  position and Black / Logo only (mode switches and additions wait for the server). The
  operator console does not run it yet.
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
- Status: draft (owner / leader / operator only) → published (team sees it) → live →
  finished (history).
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
6. Operator console: full event rights for the operator, live modes together / split,
   direct additions (projector only / setlist), team follow mode.
7. Team: user invites, roles, assignments, confirmations, rehearsal view, push.
8. Bridge to Sanctuary Voice via event code:
   8a. SV → worship: live translated text as a projector source.
   8b. worship → SV: current song/section + setlist pre-translation for SV participants.
   (Requires matching work in the sanctuary-voice-app repo.)
9. Pilot at Maranata, then 1–2 other churches.
