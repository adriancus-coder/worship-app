# DESIGN.md — worship-app

The visual system. Started on Home (November 2026) as "Avganger", the departure board; the
rest of the app still uses the earlier dark stage look and moves to this one screen by screen.
(Chosen by Adrian over "the hymn board" and a standard card look, which stay in git history:
`10fd1a7` and PR #5.)

## World: the departure board
The departure board in Sandnes or Stavanger station: a dark panel, times in amber monospace,
destinations in clear white type, the platform beside each departure. Home reads the same way:
the next service is the first departure, your position is your platform, the weeks ahead are
the next departures.

- Use it for screens read at a glance before or during a service (Home first).
- Not a costume: no dot-matrix effects, no fake LEDs, no flip-clock chrome. One motion only.

## Colour (tokens in `public/styles.css`, both themes; never a literal colour elsewhere)
| Token | Role |
|---|---|
| `--board` | the panel |
| `--board-groove` | hover / quiet fill on the panel |
| `--board-rule` | lines between rows and bands |
| `--board-frame` | unused by this world (kept for the token set) |
| `--board-letter` / `--board-letter-muted` | text on the panel / hints, labels, other items |
| `--plate` | amber: times, keys, the panel's top edge |
| `--on-plate` | text on amber (the picked key) |
| `--accent-fill` | the primary action and the selected answer |
| `--live-fill` | the "LIVE ACUM" plate and the live top edge |

Dark theme: blue-black panel, white text, amber `#ffc94d`. Light theme: white panel, near-black
text, deep amber `#8a5200`. Every text pair is in `scripts/check-contrast.js` (WCAG AA in both
themes). Strategy: restrained, amber as the one signal colour.

## Type
- **Board** (Overpass 400/700, SIL OFL, self-hosted in `public/fonts`): all Home text.
- **Board Mono** (Overpass Mono 700, SIL OFL): only times, dates and keys, the "departure" data.
- Static instances made with fontTools from the variable fonts, subset to Latin + Romanian.

## Components
- **Board** (`.board`): panel with a 3 px amber top edge, 6 px radius; header (time line in
  amber mono, event name), then bands and rows; ends with a **ledge** (`.board-ledge`) holding
  ONE primary action and at most one secondary.
- **Platform band** (`.board-you`): your positions and answer, between two rules.
- **Row** (`.now-item`): 52 px min; a song shows its key first in amber mono (a button for
  editors; picked = amber fill), then the title; other items are indented, muted, with their
  type in small caps on the right.
- A key change flips the new key in (300 ms, ease-out, off with reduced motion): the one motion.
- **Next departures** (`.weeks-list`): date in amber mono, then the event, time and your
  position with your answer.

## Layout
Phone first. From 900 px the board and "Săptămânile următoare" sit side by side
(1.65fr / 1fr, max 1120 px). Hover effects only under `(hover: hover)`.
