'use strict';

// The round "i" next to a page title (public/info-tip.js): on Ecrane, Profilul meu and
// Ghiduri the explanation under the title is hidden and opens in a dialog from the "i"
// (the team page: team-nav.test.js). The owner at 375 RO and 1024 EN; the dialog's text is
// the page's intro in the chosen language; no overflow.

const { layoutAudit } = require('./harness');

module.exports = {
  name: 'info-tip',
  timeout: 120000,
  async run({ app, signIn, check }) {
    const PAGES = [
      ['/screens', 'main h1', /(Un ecran este|A screen is)/],
      ['/profile', 'main h1', /(Numele tău|Your name)/],
      ['/guides', '.page-head h1', /(Instrucțiuni pas cu pas|Step-by-step)/],
    ];
    for (const [lang, width] of [['ro', 375], ['en', 1024]]) {
      const tag = `[${lang} ${width}]`;
      const p = await signIn('owner', { width, lang });
      for (const [path, h1, intro] of PAGES) {
        await p.goto(`${app.url}${path}`);
        await p.waitForSelector('.page-title .info-button');
        const head = await p.evaluate((sel) => {
          const h = document.querySelector(sel);
          const b = document.querySelector('.page-title .info-button');
          const para = document.querySelector('[data-info-tip]');
          const hb = h.getBoundingClientRect(); const bb = b.getBoundingClientRect();
          return { hidden: para.hidden, sameRow: Math.abs((hb.top + hb.height / 2) - (bb.top + bb.height / 2)) < 12, size: Math.round(bb.width), label: b.getAttribute('aria-label') };
        }, h1);
        check(head.hidden && head.sameRow && head.size >= 44 && /(Despre|About)/.test(head.label), `${tag} ${path}: the intro hidden, the "i" on the title's row, 44 px, labelled`, head);
        await p.click('.page-title .info-button');
        await p.waitForSelector('#info-dialog[open]');
        check(intro.test(await p.textContent('#info-dialog-text')), `${tag} ${path}: the "i" opens the page's explanation`, await p.textContent('#info-dialog-text'));
        const a = await layoutAudit(p, '#info-dialog');
        check(!a.overflow && !a.small.length, `${tag} ${path}: the dialog: no overflow, targets >= 44 px`, a);
        await p.click('#info-dialog-close');
        await p.waitForSelector('#info-dialog:not([open])', { state: 'attached' });
      }
      await p.context().close();
    }
  },
};
