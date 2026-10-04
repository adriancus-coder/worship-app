'use strict';

// Segmented controls fit: "Vezi aplicația ca" (five roles) and every other selection group
// (Limbă, Notație, Temă, tabs, live mode switches) wrap into rows instead of overlapping or
// clipping; every option keeps its full label, is at least 44 px high and lies inside its
// container (bounding boxes checked); the selected option keeps the accent fill + check.
// More sheet at 320 / 375 / 768 / 1024 / 1180, RO and EN; events tabs, the arrange sheet's
// tabs and the live mode switches too.

const SEL = '.lang-switch, .notation-switch, .mode-switch, .source-buttons, .video-tabs, .tabs, .notation-choice, .choice-group';

// Every visible group: buttons that clip, overlap, leave the container or are under 44 px.
const audit = (page) => page.evaluate((SEL) => {
  const out = [];
  for (const group of document.querySelectorAll(SEL)) {
    if (!group.getClientRects().length || group.closest('[hidden], dialog:not([open])')) continue;
    const g = group.getBoundingClientRect();
    const buttons = [...group.querySelectorAll(':scope > button')].filter((b) => b.getClientRects().length && !b.hidden);
    if (!buttons.length) continue;
    const rects = buttons.map((b) => b.getBoundingClientRect());
    const problems = [];
    // a group that scrolls sideways on purpose (the event tabs on phones): buttons beyond its
    // edges are reachable by scrolling, not cut off
    const scrolls = ['auto', 'scroll'].includes(getComputedStyle(group).overflowX);
    rects.forEach((r, i) => {
      const b = buttons[i];
      if (b.scrollWidth > b.clientWidth + 1) problems.push(`clipped:${b.textContent.trim()}`);
      if (!scrolls && (r.left < g.left - 1 || r.right > g.right + 1)) problems.push(`outside:${b.textContent.trim()}`);
      if (r.height < 44) problems.push(`small:${b.textContent.trim()}`);
      for (let j = i + 1; j < rects.length; j++) {
        const o = rects[j];
        if (Math.min(r.right, o.right) - Math.max(r.left, o.left) > 1 && Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top) > 1) problems.push(`overlap:${b.textContent.trim()}/${buttons[j].textContent.trim()}`);
      }
    });
    if (g.right > document.documentElement.clientWidth + 1) problems.push('overflows-viewport');
    out.push({ name: `${group.id ? `#${group.id}` : ''}.${[...group.classList].join('.')}`, n: buttons.length, rows: new Set(rects.map((r) => Math.round(r.top))).size, problems });
  }
  return out;
}, SEL);

module.exports = {
  name: 'view-as-layout',
  timeout: 300000,
  async run({ app, signIn, check }) {
    const E = app.seed.eventId;
    for (const [lang, width] of [['ro', 320], ['ro', 375], ['en', 375], ['ro', 768], ['ro', 1024], ['en', 1024], ['ro', 1180]]) {
      const tag = `[${lang} ${width}]`;
      const p = await signIn('owner', { width, lang, height: width === 768 ? 1024 : undefined });
      await p.click('.shell-more');
      await p.waitForSelector('#shell-panel:not([hidden])');
      await p.waitForTimeout(300);
      const groups = await audit(p);
      const viewAs = groups.find((g) => /view-as-switch/.test(g.name));
      const bad = groups.filter((g) => g.problems.length);
      check(viewAs && viewAs.n === 5 && !bad.length, `${tag} More sheet: five roles readable and tappable, no overlap / clipping in any group (rows: view-as ${viewAs && viewAs.rows}, theme ${(groups.find((g) => /theme/.test(g.name)) || {}).rows})`, bad);
      const selected = await p.evaluate(() => {
        const b = document.querySelector('#shell-panel [data-view-as][aria-pressed="true"]');
        const cs = getComputedStyle(b);
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-fill').trim();
        const probe = document.createElement('span'); probe.style.color = accent; document.body.append(probe);
        const want = getComputedStyle(probe).color; probe.remove();
        return { fill: cs.backgroundColor === want, bold: Number(cs.fontWeight) >= 700, check: getComputedStyle(b, '::before').content !== 'none', label: b.textContent.trim() };
      });
      check(selected.fill && selected.bold && selected.check, `${tag} the selected role keeps the accent fill + check + bold`, selected);
      await p.keyboard.press('Escape');
      // events tabs
      await p.goto(`${app.url}/events`);
      await p.waitForSelector('.tabs');
      const tabs = (await audit(p)).filter((g) => g.problems.length);
      check(!tabs.length, `${tag} events tabs: no clipping / overlap`, tabs);
      // the arrange sheet's tabs (below 900 px)
      await p.goto(`${app.url}/events/${E}/edit`);
      await p.waitForSelector('#items .item-main');
      await p.locator('#items .item-main').first().click();
      await p.click('#opt-arrange');
      await p.waitForSelector('dialog.arrange-sheet[open]');
      const sheet = (await audit(p)).filter((g) => g.problems.length);
      check(!sheet.length, `${tag} arrange sheet tabs + editor controls: no clipping / overlap`, sheet);
      await p.context().close();
    }
    // live mode switches on the leader page and the console
    check((await app.command({ type: 'event.start' })).ok, 'the event is live');
    for (const [lang, width] of [['ro', 320], ['ro', 375], ['en', 1024], ['ro', 1180]]) {
      const tag = `[${lang} ${width}]`;
      const p = await signIn('owner', { width, lang });
      await p.goto(`${app.url}/events/${E}/live`);
      await p.waitForSelector('#live:not([hidden])');
      await p.waitForTimeout(400);
      const live = await audit(p);
      check(live.some((g) => /mode-switch/.test(g.name)) && !live.some((g) => g.problems.length), `${tag} live page team switch: fit (rows ${live.filter((g) => /mode-switch/.test(g.name)).map((g) => g.rows).join('/')})`, live.filter((g) => g.problems.length));
      await p.goto(`${app.url}/events/${E}/operator`);
      await p.waitForSelector('#console:not([hidden])');
      await p.waitForTimeout(400);
      const op = await audit(p);
      check(!op.some((g) => g.problems.length), `${tag} console switches: fit`, op.filter((g) => g.problems.length));
      await p.context().close();
    }
  },
};
