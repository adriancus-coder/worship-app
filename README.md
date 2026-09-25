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

## Scripts

- `npm start` — start the server.
- `npm run check` — syntax-check every `.js` file.

See `CLAUDE.md` for conventions and `docs/ROADMAP.md` for the plan.
