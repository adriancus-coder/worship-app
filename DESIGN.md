# DESIGN.md — worship-app

The visual system for Home (November 2026): "Standard", a familiar team-app card. Adrian tried
"the hymn board" (`10fd1a7`) and "Avganger", the departure board (`c18e6b3`, backup branch
`backup/dev-2026-11-24-before-standard`), then chose to try this one. The rest of the app keeps
its dark stage look; this style uses the same fonts and colours, so it already fits.

## Idea
Planning-Center-like clarity: one card for the next service, nothing decorative, the app's own
system font and accent. Familiar on purpose; the craft is in spacing, hierarchy and states.

## Colour (tokens in `public/styles.css`, both themes; never a literal colour elsewhere)
| Token | Role |
|---|---|
| `--board` | the card surface (= `--surface` in each theme) |
| `--board-groove` | the soft fill of the "your answer" band, avatars, skeleton |
| `--board-rule` | lines between rows |
| `--board-frame` | the card border |
| `--board-letter` / `--board-letter-muted` | text on the card / hints, labels, other items |
| `--plate` / `--on-plate` | key pills and the "peste 3 zile" pill (soft amber) |
| `--accent-fill` | the primary action, the selected answer, the picked key, the live border |
| `--live-fill` | the "LIVE ACUM" pill |

Every text pair is in `scripts/check-contrast.js` (WCAG AA in both themes). Strategy:
restrained, the app's amber as the only accent.

## Type
The system UI sans only (no custom font): event name 1.375rem/700, row titles 600, meta 0.8–0.94rem.

## Components
- **Card** (`.board`): 14 px radius, 1 px border, soft shadow; the when line (muted, with a
  pill), the event name, the "your answer" band (`.board-you`, soft fill, rounded), the songs,
  the team, then ONE primary action and at most one secondary (`.board-ledge`).
- **Row** (`.now-item`): 50 px min, rules between; a song's key is a soft amber pill on the right
  (a 44 px button for editors; picked = accent fill); other items are muted with their type on
  the right. A new key pops in (220 ms, off with reduced motion).
- **Weeks ahead** (`.weeks-list`): one small card per event: month and day in accent, name,
  time, and your position with your answer.

## Layout
Phone first. From 900 px the card and "Săptămânile următoare" sit side by side
(1.65fr / 1fr, max 1120 px). Hover effects only under `(hover: hover)`.
