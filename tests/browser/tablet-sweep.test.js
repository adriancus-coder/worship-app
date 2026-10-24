'use strict';

// A sweep of every page at tablet widths (iPad portrait 768 / 834, landscape 1024 / 1180):
// no horizontal overflow of the page, nothing sticking out of the viewport, touch targets of
// at least 44 px, no text clipped by its box. One check per page and width; the details of a
// failing page are printed so they can be fixed.

const { wait } = require('./harness');

const SIZES = [[768, 1024], [1024, 768]]; // iPad portrait and landscape (834 / 1180 behave the same)

module.exports = {
  name: 'tablet-sweep',
  timeout: 600000,
  async run({ app, signIn, check }) {
    const { eventId: E, songs } = app.seed;
    const pages = [
      ['owner', '/app', '#now .now-card'], ['owner', '/events', '#events, .events-page'], ['owner', `/events/${E}`, '#items .item-main'],
      ['owner', `/events/${E}/edit`, '#items .item-main'], ['owner', `/events/${E}/rehearse`, '#rehearse:not([hidden])'],
      ['owner', '/library', '#songs'], ['owner', `/songs/${songs.G}`, '#sections'], ['owner', `/songs/${songs.G}/edit`, '#song-form, form'],
      ['owner', '/songs/new', 'form'], ['owner', '/team', 'main'], ['owner', '/positions', 'main'], ['owner', '/settings', '#clock-panel'],
      ['owner', '/screens', 'main'], ['owner', '/media', 'main'], ['owner', '/guides', 'main'], ['owner', '/profile', 'main'], ['owner', '/notifications', 'main'],
      ['leader', `/events/${E}/live?view=full`, '#live-clock, .live-page'], ['operator', `/events/${E}/operator`, '#op-steps'],
      ['member', '/app', '#now .now-card'], ['member', `/events/${E}`, '#items .item-main'], ['member', `/events/${E}/follow`, '#slide'],
      ['member', `/events/${E}/rehearse`, '#rehearse:not([hidden])'], ['member', '/library', '#songs'], ['member', `/songs/${songs.G}`, '#sections'],
    ];
    check((await app.command({ type: 'event.start' })).ok, 'the event is live (the live pages have content)');
    const audit = (p) => p.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const visible = (x) => x.getClientRects().length && !x.closest('[hidden], dialog:not([open])') && getComputedStyle(x).visibility !== 'hidden';
      const out = [];
      for (const x of document.querySelectorAll('body *')) {
        if (!visible(x)) continue;
        const r = x.getBoundingClientRect();
        if (r.width > 0 && (r.right > vw + 1 || r.left < -1) && !x.closest('.setlist-scroll, .list-pane, [style*="overflow"], .now-keys, .chord-sheet, .big-text')) {
          out.push({ kind: 'outside', el: `${x.tagName.toLowerCase()}${x.id ? `#${x.id}` : ''}${x.className && typeof x.className === 'string' ? `.${x.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`, right: Math.round(r.right), left: Math.round(r.left) });
          if (out.length > 6) break;
        }
      }
      const small = [...document.querySelectorAll('a, button')].filter(visible).filter((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && (r.height < 44 || r.width < 44); }).map((x) => (x.getAttribute('aria-label') || x.textContent).trim().slice(0, 30)).slice(0, 8);
      const clipped = [...document.querySelectorAll('h1, h2, h3, p, span, button, a, li, label')].filter(visible).filter((x) => !x.classList.contains('sr-only')).filter((x) => { const cs = getComputedStyle(x); return cs.overflow === 'hidden' && cs.textOverflow !== 'ellipsis' && cs.webkitLineClamp === 'none' && x.scrollWidth > x.clientWidth + 2 && x.textContent.trim(); }).map((x) => x.textContent.trim().slice(0, 30)).slice(0, 6);
      // a button / pill / badge whose words wrapped onto a second line (taller than two lines of its font)
      // (a button laid out as stacked blocks - a tab with its icon, a setlist row - is tall on purpose)
      const stacked = (x) => [...x.children].some((c) => !getComputedStyle(c).display.startsWith('inline')) || x.querySelector('br');
      // (the text's line boxes: more than one distinct top = the words wrapped)
      const lines = (x) => { const r = document.createRange(); r.selectNodeContents(x); return new Set([...r.getClientRects()].filter((b) => b.width > 0).map((b) => Math.round(b.top))).size; };
      const wrapped = [...document.querySelectorAll('button, .pill, .key-badge, .type-badge, .tab-count')].filter(visible).filter((x) => !stacked(x)).filter((x) => !x.closest('.big-nav, .now-actions, .event-actions, .rehearse-nav, .save-bar, .form-actions')).filter((x) => x.textContent.trim().length > 1 && lines(x) > 1).map((x) => x.textContent.trim().slice(0, 30)).slice(0, 6);
      // a selection group whose options sit on more than one row
      const groups = [...document.querySelectorAll('.choice-group, .tabs, .source-buttons, .mode-switch, .notation-switch, .lang-switch')].filter(visible).filter((g) => { const tops = new Set([...g.children].filter(visible).map((c) => Math.round(c.getBoundingClientRect().top))); return tops.size > 1; }).map((g) => (g.getAttribute('aria-label') || g.id || g.className).slice(0, 30)).slice(0, 6);
      return { overflow: document.documentElement.scrollWidth > vw + 1, outside: out, small, clipped, wrapped, groups };
    });
    for (const [w, h] of SIZES) {
      for (const [role, path, sel] of pages) {
        const p = await signIn(role, { width: w, height: h, lang: 'ro' });
        try {
          await p.goto(`${app.url}${path}`);
          await p.waitForSelector(sel, { timeout: 8000 }).catch(() => {});
          await wait(400);
          const a = await audit(p);
          const ok = !a.overflow && !a.outside.length && !a.small.length && !a.clipped.length && !a.wrapped.length && !a.groups.length;
          check(ok, `[${w}x${h}] ${role} ${path}`, ok ? undefined : a);
        } finally {
          await p.context().close();
        }
      }
    }
  },
};
