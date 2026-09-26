# Browser smoke tests

End-to-end checks in a real browser (Chromium through Playwright). Each test starts its own
server on a free port with a temporary `DATA_DIR`, seeds it and drives the pages:
Acasă, the app shell, navigation, the library (with a local stand-in for resursecrestine.ro),
the arrange sheet, live end to end, the operator console, tap / hold, end of item, the
projector panel and `/screen`, video, media and emergency mode.

They are **not** part of `npm run check`. They need a browser and take a few minutes. CI runs
them in a separate `browser` job that does not fail the workflow until they have proven
stable.

## Run locally

```sh
npm install                          # Playwright is a devDependency
npx playwright install chromium      # once: the browser itself
npm run test:browser                 # all tests
node tests/browser/run.js live-e2e   # one test (or several: names or name prefixes)
```

To use a Chromium already on the machine instead of Playwright's download, set
`CHROMIUM_PATH=/path/to/chromium`.

Each check prints `ok` or `FAIL` with details; the exit code is 1 when any check failed.
Server logs are captured, never printed; uncaught page errors fail the test.

## Writing a test

A test is `tests/browser/<name>.test.js` exporting `{ name, timeout?, app?, run(ctx) }`:

- `ctx.app`: `url`, `seed` (`songs`, `eventId`, `event2Id`, `items`, `today`),
  `cookies` (per role), `api(cookie, method, path, body)`, `command(cmd)` (a live command
  as the owner), `state()` (the live state now), `stop()` (SIGTERM, a clean stop) and `start()`.
- `ctx.signIn(role, { width, lang, touch })`: a signed-in page (`owner`, `leader`,
  `operator`, `member`). Widths under 600 are phones with touch.
- `ctx.check(ok, label, detail)`: one checked expectation.
- `app: { preload: [file] }`: modules loaded into the server first, such as
  `fixtures/mock-resurse.js`.

`harness.js` also exports `layoutAudit(page, scope)` (horizontal overflow and touch
targets under 44 px). Keep fixtures small: they live in `fixtures/`.
