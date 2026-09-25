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
