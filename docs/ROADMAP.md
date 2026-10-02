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
- **The projector has a holder** (migration 041): one event-role person controls what the
  church sees. The live mode follows from the holder's role (the internal values stay
  `together` / `split`): an **operator** holds it → *split* (the projector follows the
  console's own position; the leader page's big controls move the team, the console's move
  the projector; each page shows where the other is: "Proiectorul e la …" / "Echipa e la …"
  with "Sari acolo", key W on the console); **anyone else** holds it → *together* (ONE main
  position: the leader page and the console both move it; the projector and the team phones
  follow it; projector-position commands are refused). At the start the holder is a
  connected operator if there is one, else whoever starts. Taking it as an operator copies
  the main position to the projector; back to together the projector shows the main
  position at once.
  - **Requests and hand-overs** (`projector.request`, `projector.handover { toUserId }`,
    `handover.accept / refuse / cancel`): every live page shows "Proiectorul: <name> (<role>)"
    and ONE action. Anyone but the holder has **"Cere controlul proiectorului"**: a request
    kept in the live state (60 s, expiry silent), broadcast as `live:handover`, shown as
    "Cerere trimisă… N s" with "Anulează"; the holder's pages AND every owner's (the owner
    may always answer, on whatever page they have open, never their own request) get a toast
    "<X> cere controlul proiectorului" with Acceptă (Enter) / Refuză and a badge. Accept →
    the requester holds it; refuse → nothing changes ("<X> a refuzat" 5 s). With none of
    them connected (or nobody holding it yet) a request applies at once (`taken`). The holder has **"Predă controlul proiectorului"**: a list
    "Predă lui <name> (<role>)" of the event-role people connected (from the presence; never a
    member). Whoever gets the projector is told for 8 s, under the action and in the big
    lyrics' status line, that what they change shows on the projector in front of the church
    ("<X> a acceptat: ai proiectorul" / "<X> ți-a predat proiectorul" / "ai preluat
    proiectorul"); the others see "<X> are acum proiectorul"; the hints say whose it is and
    what the projector follows. A restart clears pending requests; the end of the event too.
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
  drag + F11. The window opens the static link of the screen "Fereastra de proiecție" (one
  per church, reused on every click, never a new row).
- **Every screen has a static link** (`/screen/<link_key>`, migration 039: a random
  12-character key, unique, given to every screen, older ones included): opened on the
  projector PC it shows that screen's output at once, in any browser, at any time, with
  nothing stored in the browser; it stays valid until the screen is revoked (then the page
  shows a pairing code and says the link is no longer valid). The key is the screen's
  credential (socket handshake `auth.key`, header `X-Screen-Key`), next to the token of a
  code pairing. /screens lists the screens first ("Linkul ecranului" per screen: copy /
  email / share), then "Adaugă un ecran" in three ways: with a name (the screen and its
  link, the default), from the operator console, with a 6-digit code on a PC where the link
  cannot be typed (the generic "adresa proiectorului", then the code shown there).
- **"Pe ce ecrane"** (live state `screens`, migration 040; command `projector.screens
  { screenIds: null | [ids] }`, event roles, any mode): which of the church's screens show
  the live event; null = every screen (a new start resets to it). A screen left out shows the
  idle screen (logo / clock, its own margin) until it is put back; the previews on the live
  page and the console keep showing the live frame. Shown on both pages as a selection
  control with one option per screen (name + online dot), only when the church has two or
  more screens; nobody chosen = every screen idle (the hint says so).
- **Preparing the projector before the start** (migration 043): on a planned event the event
  roles may already set the corner clock, the background override, "Pe ce ecrane" and the
  prepared video (+ volume) from the console or the live page ("Pregătire: … se păstrează la
  pornire"); the event page has a "Proiector" card leading there ("Pregătește proiectorul":
  the console for owner / operator, the live page for presenter / leader). The start keeps
  them (`live_state.prepared`), otherwise it starts from the church defaults as before.
  Sources, playback, moves and the holder still wait for the start; screens stay idle.
- **Safe margin** (`safe_margin`, church default 5 %, 0-12; a screen may override it,
  migration 028): text, logo and corner clock (offset = margin + 20 / 24 px) keep away from the
  edges some projectors crop (overscan); backgrounds and video stay full-bleed. Every frame
  carries `safeMargin`; the console and leader previews draw a dashed rectangle at it.
- **Test pattern** ("Ecran de test" per screen on /screens): a 1 px border, dashed markers at
  2 / 4 / 6 / 8 / 10 % with labels, the current margin, a centre cross, the screen's
  resolution. The operator reads the first fully visible percent and presses "Aplică n %";
  the pattern stays until closed or the next live frame. Advice shown on /screens and here:
  when the projector's own menu has "overscan" / "screen fit", turn it off first; the margin
  is for the rest.
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

- **Church pairing (one-time, the usual way):** the owner pairs the church once with its
  Sanctuary Voice organisation (Settings → "Sanctuary Voice", a one-time pairing code from
  SV's admin; migration 042). From then on the connection panel lists SV's events and
  connects with one tap ("Conectează la Serviciu duminică (live)"); "Desparte" forgets it.
- **Connection code (fallback):** Sanctuary Voice generates a short-lived **connection code**
  for its event (separate from the public participant code), entered behind "Conectează cu
  cod". Either way the server gets a **bridge token** scoped to that event pair (server to
  server; expires when the event ends; either side can disconnect). Projector PCs and phones
  never talk to Sanctuary Voice. Details: `docs/BRIDGE.md`.
- The connection panel (one shared component) is available to every event role (owner,
  presenter, leader, operator) on the event page, the leader/presenter live page and the
  operator console; a member never sees it. Two independent switches, both available to
  every event role with no consent gate:
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
- Lyrics sent for translation may be copyrighted; the church is responsible for having the
  rights (a documentation note, not an in-app gate).

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
- **Team on each event (stage 7, done).** Scheduling is the LEADER's job (leader and owner
  assign; presenter and operator view):
  - *Positions* (`positions`, migration 029): what a church uses — seeded Voce, Chitară,
    Pian/Clape, Bas, Tobe, Operator, Prezentator; owner / leader add, rename, reorder,
    deactivate (Echipa → Poziții). Each person's usual positions
    (`users_positions`) come from Echipa (owner) or "Mai mult → Profilul meu" (name, phone
    optional, positions); they are the picker's first suggestions.
  - *Assignments* (`event_assignments`, migration 030): one row per event, person and
    position, status pending / accepted / declined with a note and `notified_at`. The
    editor's "Echipa" tab (owner, leader) picks people per position; everyone sees the
    "Echipa" card on the event page and "Ești programat: …" with Vin / Nu pot on the home
    card. Summary "5 confirmați · 1 așteaptă · 1 nu poate"; declined rows highlighted. A copy
    of an event or template copies the team as pending; templates keep the "usual team".
  - *Unavailability* (`unavailability`, migration 031): own date ranges ("Profilul meu →
    Indisponibil"); the picker greys the person out on the event date with the reason; the
    owner and the leader see everyone's, other members nothing.
  - *Push* (`push_subscriptions`, migration 032, `lib/push.js`): web push with VAPID and
    aes128gcm in `node:crypto` (no extra package); keys from `npm run vapid` (docs/PUSH.md);
    "Mai mult → Notificări" switches it per device; 404 / 410 endpoints are deleted.
  - *Notifications* (`notifications`, `notification_prefs`, migration 033): kinds assigned,
    reminder (day before at 18:00 church time; a minute tick idempotent per event and person),
    setlist_changed (max one per 10 minutes), declined (owner + leaders), live_started. In-app
    list with an unread badge on "Mai mult", per-kind switches, plus a push when subscribed.
  - *"Trimite programarea"*: notifies every pending person not yet told; re-sending reaches
    only new rows; with email enabled, people without push get an email with the same text.
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
7. Team (done): user invites, roles, positions, assignments, confirmations, unavailability,
   notifications + push, rehearsal view.
8. Bridge to Sanctuary Voice (done): church pairing once, then one-tap connections (a
   connection code as fallback):
   8a. SV → worship: live translated text as a projector source.
   8b. worship → SV: current song/section + setlist pre-translation for SV participants.
   (Matching work done in the sanctuary-voice-app repo.)
9. Pilot at Maranata, then 1–2 other churches. Before it: test on `dev`, promote `dev` to
   `main` (backup branch first, fast-forward only), set the production env on Render
   (`render.yaml`), run `/setup`, check `/api/health` against the deployed commit, and a
   rehearsal Sunday in church (projector PC on its screen link, console, leader tablet,
   team phones, an internet drop).

Later, not planned in detail yet: a local mode (the server on the operator PC, devices on
the church Wi-Fi; rule 8 keeps the live path ready for it), Norwegian UI, the subscription.
