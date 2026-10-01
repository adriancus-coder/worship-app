'use strict';

// /screens made understandable: the screens first, then "Adaugă un ecran" with three clearly
// separated ways (with a name: the screen and its static link; from the operator console:
// text only; with a code: collapsed, step 1 the projector address to copy / email / share,
// step 2 the code + name form), no "/screen" jargon; "Linkul ecranului" per screen (copy /
// email / share). RO 375 / EN 1024.

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
      check(layout.listFirst && layout.ways.length === 3 && layout.codeHidden && !layout.jargon, `${tag} the list first, three ways to add, the code form collapsed, no "/screen" in the text`, layout);
      check(!(await p.isHidden('#create-name')) && (await p.inputValue('#create-name')).length > 0, `${tag} way a) a name and "Creează ecranul", nothing to pair`);
      check(/(consola operatorului|operator console)/i.test(await p.textContent('.add-way:nth-of-type(2) p')), `${tag} way b) explains the console button, no form`);
      // a) creates the screen and opens its link
      await p.fill('#create-name', `Balcon ${lang}`);
      await p.click('#create-submit');
      await p.waitForSelector(`.screen-row:has-text("Balcon ${lang}") .screen-address`, { timeout: 6000 });
      const created = await p.inputValue(`.screen-row:has-text("Balcon ${lang}") .screen-address input`);
      check(new RegExp(`^${app.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/screen/[a-z0-9]{12}$`).test(created), `${tag} the new screen's link opens under its row: ${created}`);
      check(/(creat|created)/i.test(await p.textContent('#create-message')), `${tag} "Creează ecranul" confirms`);
      const sp3 = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
      await sp3.goto(created);
      check(await sp3.waitForSelector('#output:not([hidden])', { timeout: 6000 }).then(() => true, () => false), `${tag} the link shows the output at once`);
      await sp3.context().close();
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
      // per screen: its link box (copy / email / share)
      const row = p.locator('.screen-row:has-text("Proiector sală")');
      await row.locator('button[aria-expanded]').click();
      await row.locator('.screen-address').waitFor();
      const rowLink = await row.locator('.screen-address input').inputValue();
      const rowMail = decodeURIComponent(await row.locator('.screen-address a.button').getAttribute('href'));
      check(/\/screen\/[a-z0-9]{12}$/.test(rowLink) && rowLink !== created && /(fără cod|without a code)/i.test(await row.locator('.screen-address .hint').textContent()) && rowMail.includes(rowLink) && /Proiector sală/.test(rowMail), `${tag} the row's "Linkul ecranului" box: its own link, the hint, a mailto with the link`);
      await row.locator('.screen-address .address-box button').click();
      await wait(200);
      check(/(copiată|copied)/i.test(await row.locator('.screen-address .message').textContent()), `${tag} the row's copy confirms`);
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
