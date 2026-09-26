'use strict';

// /screens made understandable: the paired screens first, then "Adaugă un ecran" with two
// clearly separated ways (from the operator console: text only; with a code: collapsed,
// step 1 the projector address to copy / email / share, step 2 the code + name form), no
// "/screen" jargon; "Adresa proiectorului" per paired screen. RO 375 / EN 1024.

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'screens-page',
  timeout: 180000,
  async run({ app, browser, signIn, check }) {
    // one paired screen
    const sp = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    await sp.goto(`${app.url}/screen`);
    await sp.waitForFunction(() => /\d{3} \d{3}/.test(document.getElementById('pairing-code').textContent));
    await app.api(app.cookies.owner, 'POST', '/api/screens/claim', { code: (await sp.textContent('#pairing-code')).replace(' ', ''), name: 'Proiector sală' });
    await sp.waitForSelector('#output:not([hidden])', { timeout: 6000 });

    for (const [lang, width, role] of [['ro', 375, 'operator'], ['en', 1024, 'owner']]) {
      const tag = `[${lang} ${width}]`;
      const p = await signIn(role, { width, lang });
      await p.goto(`${app.url}/screens`);
      await p.waitForSelector('.screen-row');
      const layout = await p.evaluate(() => {
        const list = document.getElementById('screens').getBoundingClientRect();
        const add = document.querySelector('.add-screen').getBoundingClientRect();
        return {
          listFirst: list.top < add.top,
          ways: [...document.querySelectorAll('.add-way h3')].map((h) => h.textContent),
          codeHidden: document.getElementById('code-way').hidden,
          jargon: /\/screen\b/.test(document.querySelector('main').innerText),
        };
      });
      check(layout.listFirst && layout.ways.length === 2 && layout.codeHidden && !layout.jargon, `${tag} the list first, two ways to add, the code form collapsed, no "/screen" in the text`, layout);
      check(/(consola operatorului|operator console)/i.test(await p.textContent('.add-way:first-of-type p')), `${tag} way a) explains the console button, no form`);
      await p.click('#pair-open');
      await p.waitForSelector('#code-way:not([hidden])');
      const address = await p.inputValue('#screen-address');
      check(address === `${app.url}/screen`, `${tag} step 1: the projector address "${address}"`);
      const mailto = decodeURIComponent(await p.getAttribute('#address-email', 'href'));
      const expected = lang === 'ro' ? /Deschide această adresă pe calculatorul proiectorului, apoi spune-mi codul de 6 cifre/ : /Open this address on the projector PC, then tell me the 6-digit code/;
      check(mailto.startsWith('mailto:?subject=') && expected.test(mailto) && mailto.includes(address), `${tag} "Trimite pe email": a mailto with the ${lang.toUpperCase()} text and the address`, mailto.slice(0, 120));
      const shareHidden = await p.isHidden('#address-share');
      const canShare = await p.evaluate(() => typeof navigator.share === 'function');
      check(shareHidden === !canShare, `${tag} "Trimite…" only where navigator.share exists (${canShare})`);
      await p.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
      await p.click('#address-copy');
      await p.waitForFunction(() => /\S/.test(document.getElementById('address-message').textContent));
      check(/(copiată|copied)/i.test(await p.textContent('#address-message')), `${tag} "Copiază" confirms`, await p.textContent('#address-message'));
      check(!(await p.isHidden('#pair-code')) && !(await p.isHidden('#pair-name')), `${tag} step 2: the code + name form`);
      const a = await layoutAudit(p, '.screens-pane');
      check(!a.overflow && !a.small.length, `${tag} no overflow, targets >= 44 px`, a);
      // per paired screen: the address box
      await p.click('.screen-row button[aria-expanded]');
      await p.waitForSelector('.screen-address');
      check((await p.inputValue('.screen-address input')) === address && /(reconect|reconnects)/i.test(await p.textContent('.screen-address .hint')), `${tag} the row's "Adresa proiectorului" box`);
      await p.click('.screen-address button');
      await wait(200);
      check(/(copiată|copied)/i.test(await p.textContent('.screen-address .message')), `${tag} the row's copy confirms`);
      // pairing with a code still works from here
      const sp2 = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
      await sp2.goto(`${app.url}/screen`);
      await sp2.waitForFunction(() => /\d{3} \d{3}/.test(document.getElementById('pairing-code').textContent));
      await p.fill('#pair-code', (await sp2.textContent('#pairing-code')).replace(' ', ''));
      await p.fill('#pair-name', `Ecran ${lang}`);
      await p.click('#pair-submit');
      check(await sp2.waitForSelector('#output:not([hidden])', { timeout: 6000 }).then(() => true, () => false), `${tag} step 2 pairs the screen`);
      await p.waitForSelector(`.screen-row:has-text("Ecran ${lang}")`, { timeout: 8000 });
      check(true, `${tag} the new screen joins the list`);
      await sp2.context().close();
      await p.context().close();
    }
  },
};
