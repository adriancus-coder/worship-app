# DESIGN.md — worship-app

The visual system. Started on Home (November 2026) as "the hymn board"; the rest of the app
still uses the earlier dark stage look and moves to this one screen by screen.

## World: the hymn board
The board on the church wall that lists this Sunday's songs: dark felt with fine horizontal
grooves inside a wooden frame, tall white condensed numbers, and number cards slid into the
grooves. Brass (the app's amber accent) marks what you act on and what is live.

- Use it for screens a team member reads at a glance before or during a service (Home first).
- Not a costume: no wood photos, no fake screws, no textures beyond the 1 px grooves.

## Colour (tokens in `public/styles.css`, both themes; never a literal colour elsewhere)
| Token | Role |
|---|---|
| `--board` | the felt ground of a board |
| `--board-groove` | the 1 px groove every 14 px (`repeating-linear-gradient`) |
| `--board-rule` | lines between rows, dashed empty plates, row edges |
| `--board-frame` | the 7 px wooden frame (6 px on phones), date plate borders |
| `--board-letter` / `--board-letter-muted` | letters on the board / hints, labels, non-song rows |
| `--plate` / `--on-plate` | key plates, the "peste 3 zile" plate |
| `--accent-fill` | brass: the primary action, the selected answer, the live frame |
| `--live-fill` | the "LIVE ACUM" plate |

Dark theme: charcoal felt, warm-white letters, ivory plates, walnut frame. Light theme: pale
felt, near-black letters, dark plates, light walnut frame. Every text pair is in
`scripts/check-contrast.js` (WCAG AA in both themes). Strategy: restrained, with brass as
the only accent.

## Type
- **Board** (Barlow Condensed 600/700, SIL OFL, self-hosted in `public/fonts`, subset with
  `scripts/subset-font.js`): only for what sits on the board as letters: the day and time,
  song numbers, key plates, date plates, short uppercase section labels. Never for body text,
  buttons or forms.
- Everything else: the system UI sans (titles 1.0625–1.25rem, weight 600).

## Components
- **Board** (`.board`): frame + felt + grooves; header (day/time line, event name), then
  bands and rows; ends with a **ledge** (`.board-ledge`) holding ONE primary action and at
  most one secondary.
- **Band** (`.board-you`): a full-width brass-tinted strip for the person's own slot.
- **Row** (`.now-item`): grooved, 56 px min; a song has its number (center) and a key plate
  on the right; other items show the title muted and their type in small caps on the right.
- **Plate** (`.now-item-key`): 44 px square, solid, soft shadow; empty = dashed outline. A new
  key slides into its groove (260 ms, ease-out, off with reduced motion): the one motion.
- **Date plate** (`.week-plate`): weekday / day / month in Board letters on felt in a frame.

## Layout
Phone first. From 900 px the board and "Săptămânile următoare" sit side by side
(1.65fr / 1fr, max 1120 px). Hover effects only under `(hover: hover)`.
