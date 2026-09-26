# ROADMAP — worship-app

Decisions agreed with the product owner (Adrian). Stages are built in order;
never implement a later stage early. Mockups: claude.ai design canvas
"Aplicație worship — machete" (shared separately).

## Product decisions

- **Standalone worship app** for churches, no speech recognition or translation in core.
  Translation is an optional two-way bridge to Sanctuary Voice (stage 8, see below).
- **Customer = "admin"** (one church/group). Subscription per admin, paid outside
  the app (website). The app itself never shows prices, buy buttons or payment links.
- **Churches on the platform** (`/platform`, the platform owner only): create (owner +
  temporary password shown once), deactivate / reactivate, a new owner password, the media
  quota, and **permanent deletion in two steps** (migration 023): only a deactivated church,
  its exact name typed, "Programează ștergerea" sets `admins.delete_at` 7 days ahead
  ("Ștergere programată pe <data>", cancellable from the church page or the /platform row;
  reactivating cancels too). A sweep at startup and every 24 h writes a final backup zip
  (the owner-backup format) to `DATA_DIR/deleted/<id>-<date>.zip`, kept 30 days, then
  removes every row of the church in one transaction and its upload folder. The platform's
  own church can never be deactivated or deleted. Every step is logged.
- **PWA first.** App Store / Google Play later, possibly via Capacitor; not planned yet.
- **Accounts:** personal logins (email + password) per user. Owner invites users (by
  email link or a temporary password). "Remember me" for church PCs.
- **Roles** (rights → where an event opens for them):
  - *owner* — everything → the home card as always (live page).
  - *presenter* (Prezentator) — event + editor rights (EVENT_ROLES) → the live page.
    Prepares the events and runs the songs for the team.
  - *leader* (Lider) — the SAME rights as the presenter → straight into the big lyrics
    (`/events/:id/live?view=lyrics`: the live page with "⤢ Versuri mari" open; ✕ shows the
    page underneath). Leads the music from the stage; rehearsal at hand.
  - *operator* — event + editor rights + the projector screens (SCREEN_ROLES), no
    rehearsal → the operator console (only owner and operator open the console).
  - *member* — follow + rehearsal → "Repetiție" before, "Urmărește live" during.
  Home card and event page, by role and state (planned / live): owner "Pornește live" /
  "Intră live"; presenter "Pregătește" (+ "Pornește live") / "Intră live"; leader "Repetiție"
  (+ "Pornește live") / "Versuri mari"; operator "Pregătește" (+ "Pornește live") / "Consolă
  operator"; member "Repetiție" / "Urmărește live". "Pornește live" starts the event and
  opens that role's own page. Never show the internal role word in the UI (labels through
  `team.roles.*`). The owner can look at the app as any other role ("Vezi aplicația ca").
- **UI:** new design, dark stage theme, phone- and tablet-first; Romanian UI by default.
- **Chord notation:** letters (C D E) or Romanian solfège (Do Re Mi), chosen per user with a
  church default; songs are always stored with letters (display only).

## Live model (core rules)

- **Server is the single source of truth.** Clients send commands; the server validates
  (role + live mode), applies, versions the state and broadcasts it to the event room.
  On reconnect a client receives the full state snapshot. Commands carry the version they
  were made against; one made against an older version is refused ("stale") and the page
  gets the current state, so two people moving at once never skip a section.
- **Event rights.** Owner, presenter, leader and operator (EVENT_ROLES, defined once in
  `lib/events.js`) have the same rights over events, always: create, edit, templates,
  delete, start, end, move the live position, projector, sources, video, live mode and
  team mode. They see templates. Members see every event as soon as it exists (never
  templates) and send no commands. The same roles (EDITOR_ROLES = EVENT_ROLES) edit
  the library (create, edit, delete, file import / export, the key, backgrounds) and
  media; presenter, leader and operator differ by the page an event opens on (live page /
  big lyrics / console; the console itself is the owner's and the operator's) and by the
  projector screens (SCREEN_ROLES = owner, operator): pairing with a code, renaming,
  revoking and "Deschide ecranul proiectorului" are the operator's; the presenter and the
  leader keep the projector preview and the source buttons. Owner-only stays owner-only:
  settings, team, logo, backup, platform.
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
  - **Handover consent** (migration 024): in split mode a LEADER's "Împreună" is a request,
    not a switch. It is kept in the live state (60 s, expiry silent), broadcast as
    `live:handover`, and shown on the leader page as "Cerere trimisă… N s" with "Anulează";
    the console (operator, owner) gets a toast "<Lider> cere controlul proiectorului" with
    Acceptă (Enter) / Refuză and a badge on the switch. Accept → together (the projector
    shows the main position); refuse → nothing changes ("Operatorul a refuzat" 5 s). With no
    operator / owner page in the room the switch applies at once; the owner's requests and
    every operator switch are direct; leader together → split stays direct; a restart clears
    pending requests. The big lyrics show the state in their status line.
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
- **"■ Sfârșit"** (`worship.endItem`, event roles, key E): the permanent third button of the
  Înapoi / Următoarea row, enabled whenever an item is on screen. It ends the current item
  in place: the position stays (the team still sees where the service is), an `ended` flag
  is set on it and, while set, the projector is black whatever the source (the logo only
  through the explicit Logo source / key L); it never moves by itself and the last item is
  no special case. The button
  then reads "✓ Terminat" (disabled) and "Următoarea" reads "Următoarea: <next item> →".
  After it, next goes to the next item's first step and prev back to the ended item's last
  step, both putting the content back; goto anywhere clears the flag. One flag per
  position: the leader ends the team's item, the console in split mode the projector's
  (`target: 'projector'`); a team move in split mode leaves the projector alone. Team phones
  show "Sfârșitul cântării · Urmează: …" (free mode and rehearsal unaffected). Versioned,
  broadcast and persisted like every command (migration 021).
- **"⤢ Versuri mari"** (`public/big-lyrics.js`, the leader page and the console): tapping
  the current step, the button next to the step grid or key F opens a full-screen lyrics
  view for whoever leads: the current section large (auto-fitted like the projector, the
  chords above the lines in the reader's notation, "Doar text" honoured), the section label
  on top, the next section's first line small at the bottom, a slim status line
  (connection · mode · in split mode where the other one is). Its bottom bar sends the
  SAME live commands as the page (Înapoi · Următoarea · "■ Sfârșit": projector and team
  follow per mode); swipe left / right = next / prev; keys ← → Space E B as on the page;
  A− / A+ saved; ✕ / Escape / F return to the page at the same position; the view follows
  live updates from other devices. Wake lock while open. Members keep the follow page.
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
  item list in their live snapshots.
  - **"+ Cântare nouă"** (`public/live-new-song.js`): a song written during the service, in
    the SAME editor component as /songs/new (`public/song-editor.js`: title, key, author,
    sections with chords-over-lyrics paste, live preview), in a non-modal sheet (bottom on
    phones, a side panel from 900 px) so next / prev and the keys keep working. "Salvează ·
    În setlist" (primary) / "Salvează · Doar pe proiector" create the library song
    (EDITOR_ROLES) and add it in one step like an import; a duplicate title (409) shows the
    existing song with "Adaugă cântarea existentă"; a library search with no result offers
    "Creează „<query>” ca cântare nouă". The text is kept on the device while writing
    (survives a reconnect / reload); closing with text asks first. (Before this, operator additions were proposals the
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
- **Corner clock** (`public/clock.js`, migration 022), as in Sanctuary Voice: HH:MM in the
  church timezone in one corner of every frame (content, verse, announcement, logo, black,
  idle), never while a video plays. Part of the live state (`clock.set { show, position,
  scale }`, event roles, versioned and broadcast; key K toggles it): shown or not, the
  corner, the size 70–180 % (default 180 %, bottom right). A new event starts from the church
  defaults (Settings → "Ceasul pe proiector"), which the idle screen shows too. The screens
  and the previews tick it themselves (no server traffic per minute). The time format (24 h,
  or 12 h; Settings) applies to every clock.
- **Time on the live pages** (`public/live-clock.js`): the leader page, the console and the
  big lyrics view show the time and "Live de hh:mm" since the event started in their status
  line; a tap switches to "pe elementul curent de mm:ss" (the item that page drives) and
  back. Ticks every second without re-rendering the page.
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
- "+ Eveniment nou" is one tap (`POST /api/events/quick`): name, time and items from the
  template used last (else the most recent one; else "Serviciu de duminică"), the date of
  the next usual service (church setting "Ziua și ora obișnuită a slujbei", default Sunday
  10:00, timezone-aware; the day itself until 2 h after the start). The editor opens with
  an inline "Detalii" row (name, date, time, template); "Cu opțiuni" keeps the full dialog.
- Acasă, event roles: "▶ Pornește live" on the next event starts it and opens the live page
  (the console for the operator) in one tap (`POST /api/events/:id/start`); live already:
  "Intră live". Only when another event is live a confirmation offers to end it first.
  Members keep "Repetiție" / "Urmărește live".
- Status: planned → live → finished (history). No publishing step: the team sees an
  event as soon as it exists (templates stay hidden). "Pornește" works on any planned
  event (one live event per church). Migration 020 turned draft and published into planned.
- "Cântată ultima dată": live or finished events, and planned ones whose date has passed.
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
