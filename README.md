# worship-app

Web app for church worship teams. Plain Node.js + Express + SQLite, no build step.

## Run locally

```sh
cp .env.example .env   # set SETUP_TOKEN
npm install
npm start              # http://localhost:3000
```

Open `/setup` on first run to create the admin account and its owner, using the
`SETUP_TOKEN` from your environment.

Email (invitations, password resets) is optional: set `RESEND_API_KEY` and `EMAIL_FROM`
as described in `docs/EMAIL.md`; without them the app hands out temporary passwords.
Backgrounds can be added by link or searched on Pexels (`PEXELS_API_KEY`, see
`docs/BACKGROUNDS.md`); without a key the Pexels tab is hidden.
AI for the Ghiduri (a draft of the steps from a description and photos, "Întreabă ghidul")
is optional too: set `ANTHROPIC_API_KEY` (and optionally `AI_MODEL`, default
`claude-opus-5-5`, and `AI_MONTHLY_CALLS`, default 300 per church); without it the AI parts
are hidden. Setări shows the uses of the month.

## Versions

Every page and `/api/health` carry the build the server runs: the `package.json` version
plus the git commit (`0.1.0+569a1ad`). On Render the commit comes from `RENDER_GIT_COMMIT`
(set on every deploy); elsewhere from `GIT_COMMIT` / `SOURCE_COMMIT` or the checkout itself.
The service worker's cache version starts with this label, so every deployed commit is a
new build for installed apps (PWA): pages of an older build show "Versiune nouă disponibilă ·
Reîncarcă", and "Mai mult → Versiune …" shows the running build and checks for a newer one
on tap. To confirm a deploy: compare `shortCommit` in `/api/health` with `git log -1` on `main`.

## Scripts

- `npm start` — start the server.
- `npm run check` — must pass before every commit: syntax check, i18n parity (RO / EN),
  WCAG AA contrast of the colour tokens, the unit tests and the live (socket) tests.
- `npm run test:browser` — the browser suite (Playwright, `tests/browser/`); one file with
  `node tests/browser/run.js <name>`.
- `npm run vapid` — print a VAPID key pair for web push (`docs/PUSH.md`); never commit it.

See `CLAUDE.md` for conventions and `docs/ROADMAP.md` for the plan.
