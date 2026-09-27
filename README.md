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

## Scripts

- `npm start` — start the server.
- `npm run check` — syntax-check every `.js` file.

See `CLAUDE.md` for conventions and `docs/ROADMAP.md` for the plan.
