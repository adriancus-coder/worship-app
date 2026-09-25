# CLAUDE.md — worship-app

> **Note:** the canonical CLAUDE.md was not available when the repository was
> scaffolded. This file was reconstructed from the Stage 1 task description.
> Replace it with the canonical version.

## What this is

`worship-app` is a small web app for church worship teams. One deployment hosts
one or more **admins** (a church / team account). Each admin has **users** with a
role: `owner`, `leader`, `operator`, `member`.

## Stack (do not change without an explicit decision)

- Node.js ≥ 20, CommonJS, plain JavaScript.
- Express, Socket.IO, better-sqlite3, helmet, compression, dotenv.
- Frontend: static HTML + CSS + vanilla JS in `public/`. **No** React, TypeScript,
  bundlers or other build tools.
- Data: a single SQLite file at `${DATA_DIR}/worship.db` (WAL, foreign keys ON).

## Layout

- `server.js` — thin: load config, create app/http server/socket.io, mount routes, listen.
- `lib/` — config, logger, db, auth and other shared modules.
- `lib/migrations/NNN_name.sql` — schema changes, applied in filename order.
  Never edit a migration that has been committed; add a new one.
- `routes/` — one Express router per area, created by a factory that receives
  its dependencies (`{ db, config, logger, ... }`).
- `public/` — static pages and assets.
- `scripts/` — dev tooling (`check-syntax.js`).
- `docs/ROADMAP.md` — stages. Implement only the stage you are asked to.

## Rules

- Work in small steps; one change per commit. Commit subjects are prefixed with an
  uppercase tag, e.g. `AUTH-LOGIN: ...`.
- Run `npm run check` before every commit; it must pass.
- UI text is Romanian. Code, comments, logs and commit messages are English.
- UI is mobile-first, dark theme: background `#141318`, text `#F3EFE8`,
  accent `#E8A33D`, touch targets at least 44px.
- Every query is scoped by `admin_id`; never leak data across admins.
- Security: hash passwords with scrypt, compare secrets in constant time,
  httpOnly session cookies, never reveal whether an email exists.
- Never commit `.env`, `data/` or secrets. Document new settings in `.env.example`.
- Do not add features from later roadmap stages.
