# CLAUDE.md — worship-app

Standalone worship app for churches: song library, event setlists, live song control,
a projector screen, and worship-team roles. No speech recognition, no translation in core.
Translation can be connected later as an optional bridge to Sanctuary Voice (via event code).

Working name: `worship-app`. The public name may change — keep it in ONE place
(`lib/config.js` → `APP_NAME`) and read it everywhere else.

## Terminology
- **Admin** = the customer account: one church (or group) that owns its data, manages its
  team and, later, pays the subscription. In code: table `admins`, key `admin_id`.
- **User** = a person with their own login (email + password), belonging to one admin.
- **User roles** (never call a role "admin"): `owner` (created at setup, manages everything),
  `leader` (worship leader: prepares events, controls live), `operator` (projector),
  `member` (worship team: views setlists and lyrics).
- Do not use the word "church" in code identifiers; UI text may say "biserica" where natural.

## Stack (do not change without explicit approval)
- Node.js >= 20, Express 4, socket.io 4
- SQLite via `better-sqlite3` (synchronous, single file, WAL mode)
- Frontend: vanilla JS + HTML + CSS, PWA. NO React, NO build step, NO TypeScript
- Hosting: Render, with a persistent disk mounted at `DATA_DIR`

## Architectural rules
1. **Multi-admin from day one.** Every table with admin data has `admin_id`.
   Every query filters by `admin_id`. Every socket room is prefixed `admin:<id>:`.
   Even with one admin account, never skip this.
2. **The projector never changes what it shows on its own.** Only an explicit
   operator action changes the projector source (song / verse / blank / bridge text).
3. **The projector screen is a separate surface** with no controls, no online dots,
   no menus. It only renders what the congregation should see.
4. **Translation is never core.** Anything translation-related lives behind the
   bridge module (`lib/bridge/`, later) and the app must run fully without it.
5. **One file per domain**: `routes/<domain>.js`, `socket/<domain>.js`, `lib/<domain>.js`.
   `server.js` only wires things together — keep it under ~150 lines.
6. **Security is server-side.** Every protected route goes through middleware
   (`requireUser`, `requireRole(...)`). Never trust `admin_id` from the client body;
   take it from the session.
7. **No copyrighted song content ships with the app.** The library starts empty.
8. **Local-mode ready.** A local mode is planned (server running on the operator PC,
   devices on the church Wi-Fi). So the live engine (setlist, positions, projector
   control, requests) must depend only on this server + SQLite: no calls to external
   cloud services in the live path, no hard-coded public URLs (use relative URLs and
   a configurable `PUBLIC_BASE_URL`), and any cloud-only feature (e.g. push, bridge)
   must degrade gracefully when offline.

## Conventions
- Work on `dev`. `main` = production. Never merge automatically; fast-forward only,
  and only after a remote backup branch exists.
- **One change per commit.** Commit subject starts with a marker in CAPS:
  `FEATURE-NAME: short description` (e.g. `DB-SQLITE: add migration runner`).
- Code, comments and commit messages in English. UI text in Romanian by default,
  through a simple i18n object (Norwegian/English later).
- Migrations: numbered SQL files in `lib/migrations/NNN_name.sql`, applied in order,
  tracked in the `schema_migrations` table. Never edit an applied migration — add a new one.
- `npm run check` must pass before every commit.
- Diagnostic/debug tools are never removed unless Adrian explicitly confirms.

## UI rules
Actions and selection must never look alike (styles in `public/styles.css`, "UI rules").
- **Primary action:** filled accent (`button`, `a.button`), a verb with a leading icon
  (`data-icon="play"` → "▶ Intră live"). At most ONE primary action visible per screen area.
- **Secondary action:** `.secondary` — dark surface + 1px border, icon + verb.
- **Selection controls** (segmented switches, tabs, RO/EN, C/Do, filters, "Doar text",
  projector sources): options carry `aria-pressed` (or `role="tab"` + `aria-selected`) and
  sit in a visible container (`.choice-group` or one of the switch classes; a single toggle
  such as "Doar text" keeps its own border). The selected option gets the accent fill + a
  check mark + bold; the others are flat.
- Never give an action `aria-pressed`, and never style a selection option as a button.
- **Long lists scroll in their own pane, not the page.** On any page whose main content is
  a long list, the page itself does not scroll: the header (title, actions, search field,
  tabs, section headings) stays fixed and only the list pane scrolls, with its own
  scrollbar (`body.list-page` + one `.list-pane`, `public/list-pane.js`; section headings
  in the pane are sticky, empty / loading states fill it). On phones this keeps the search
  field and the bottom tab bar always reachable. Pages that are not lists (song, rehearsal,
  follow, settings, help) scroll normally.
- **Colours only through the tokens** in `public/styles.css` `:root` (dark) and
  `[data-theme="light"]`; never a literal colour elsewhere (CSS, inline, JS). New text /
  background pairs go into `scripts/check-contrast.js` (WCAG AA in both themes).

## Reporting
Every task ends with a final report **inside one triple-backtick code block**
(commit SHAs + subjects, `npm run check` output, smoke test output, anything skipped).

## Roadmap
Product decisions and the stage plan live in `docs/ROADMAP.md`. Read it before starting
any new stage; do not implement anything from a later stage early.

## Reference
The Sanctuary Voice repo (`adriancus-coder/sanctuary-voice-app`) is the reference for
proven logic (search normalisation, Romanian elision variants, token-AND title search,
worship roles, wake lock). Port logic from it deliberately, function by function —
never copy whole files.
