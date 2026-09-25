# Roadmap

> **Note:** the canonical ROADMAP.md was not available when the repository was
> scaffolded. Only Stage 1 is described here, from the Stage 1 task description.
> Replace this file with the canonical version.

## Stage 1 — Skeleton

- Express + Socket.IO server, config, logger, `GET /api/health`.
- SQLite database with a migration runner; tables `admins`, `admin_settings`,
  `users`, `sessions`.
- First-run setup (`/setup`, protected by `SETUP_TOKEN`): creates the admin
  account and its owner user.
- Email + password login with server-side sessions, logout, `GET /api/auth/me`,
  login rate limiting, placeholder app page.
- CI workflow (syntax check + health smoke test) and Render blueprint.

## Later stages

Not described here (user invites, email, songs, events, projector, translations, ...).
