# Surface brief — Acasă (`/app`)

Development-only design brief. Never copy any of it into code, comments or anything served.

## Scope
- Surface: Home (`public/app.html`, `public/app.js`, the `.home-page` / `.board*` styles).
- Visitor mode: Operate. For every role (owner, presenter, leader, operator, member, custom).
- The week before a service, on a phone: answer Vin / Poate / Nu pot (and see the position),
  rehearse the songs (keys, lyrics), see the coming weeks. Leaders also prepare and start live.
- Moved off Home (Adrian, 23 Nov 2026): the install card (stays in Mai mult), quick actions
  (Evenimente has "Eveniment nou"); the backup reminder shrinks to one line, owner only, when due.
- First surface of a replacement visual world, to be extended to the rest of the app later.

## Direction contract
Adrian chose "Avganger" (24 Nov 2026) over the hymn board (first build, `10fd1a7`) and the
standard card (PR #5).

THESIS: Home is the station's departure board for this church: the next service is the first
departure (time and keys in amber monospace), your position is your platform, the weeks ahead
are the next departures. It refuses the stacked-card dashboard.

OWN-WORLD: blue-black panel, white Overpass text, amber Overpass Mono for times, dates and
keys; light theme: white panel, deep amber. Restrained colour strategy.

STORY: a team member opens Home, sees when the next service "leaves", answers in one tap,
reads the songs with their keys in front, opens any song's lyrics in place, then sees which
coming departures they serve on.

FIRST VIEWPORT (390 px): the time line in amber mono, the event name, the platform band
(position + Vin / Poate / Nu pot), then the songs with keys in front.

FORM: departure board, candidate 7 of 7 in the first round; seed: none (unavailable).
Signature interaction: a key change flips the new key in.
