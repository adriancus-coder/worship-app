'use strict';

// "Pe ce ecrane" (the owner's live page, the operator console): with two screens (static
// links) the projector panel shows one option per screen, every one selected at the start;
// taking one out sends that screen to the idle screen while the other keeps the event (the
// preview too); putting it back restores it; no screen chosen = every screen idle; the
// console shows the same choice; with a single screen there is nothing to choose (hidden).

const { layoutAudit, wait } = require('./harness');

module.exports = {
  name: 'screen-targets',
  timeout: 240000,
  async run({ app, browser, signIn, check }) {
    const owner = app.cookies.owner;
    const { eventId: E } = app.seed;
    const hall = (await app.api(owner, 'POST', '/api/screens', { name: 'Sală' })).body.screen;
    const openScreen = async (screen) => {
      const p = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
      p.on('pageerror', (err) => check(false, `screen "${screen.name}" page error`, err.message));
      await p.goto(`${app.url}${screen.link}`);
      await p.waitForSelector('#output:not([hidden])', { timeout: 6000 });
      return p;
    };
    const textOf = (p) => p.evaluate(() => document.querySelector('#output .projector-stage').innerText.replace(/\n+/g, ' / '));
    const hallPage = await openScreen(hall);

    const op = await signIn('owner', { width: 1280 });
    op.on('pageerror', (err) => check(false, 'live page error', err.message));
    await op.goto(`${app.url}/events/${E}/live`);
    await op.waitForSelector('#live:not([hidden])');
    await op.click('#start-button');
    await hallPage.waitForFunction(() => /Ne ridici/.test(document.querySelector('#output .projector-stage').innerText), null, { timeout: 5000 });
    await wait(300);
    check(await op.isHidden('#screen-picker'), 'one screen: nothing to choose, the picker is hidden');

    // a second screen appears: the picker shows both, both selected
    const lobby = (await app.api(owner, 'POST', '/api/screens', { name: 'Hol' })).body.screen;
    const lobbyPage = await openScreen(lobby);
    await lobbyPage.waitForFunction(() => /Ne ridici/.test(document.querySelector('#output .projector-stage').innerText), null, { timeout: 5000 });
    await op.waitForSelector('#screen-picker:not([hidden])', { timeout: 5000 });
    const options = () => op.$$eval('#screen-picker button[data-screen]', (l) => l.map((b) => `${b.textContent.trim()}:${b.getAttribute('aria-pressed')}:${b.disabled ? 'off' : 'on'}`).join(' '));
    check((await options()) === 'Hol:true:on Sală:true:on', 'two screens: "Pe ce ecrane" with both selected', await options());
    check(/(alese arată|chosen screens show)/i.test(await op.textContent('#screen-picker .hint')), 'the hint explains the choice');
    const a = await layoutAudit(op, '#screen-picker');
    check(!a.overflow && !a.small.length, 'the options are 44 px targets', a);

    // take the lobby out: idle there, the event stays in the hall and in the preview
    await op.click(`#screen-picker button[data-screen="${lobby.id}"]`);
    await lobbyPage.waitForFunction(() => document.querySelector('#output .projector-stage').innerText.trim() === '' && !document.querySelector('#output .projector-line'), null, { timeout: 4000 }).catch(() => {});
    await wait(300);
    check((await textOf(lobbyPage)) === '' && /Ne ridici/.test(await textOf(hallPage)), 'the lobby shows the idle screen, the hall keeps the lyrics', { lobby: await textOf(lobbyPage), hall: await textOf(hallPage) });
    check((await options()) === 'Hol:false:on Sală:true:on', 'the option is unselected', await options());
    check(/Ne ridici/.test(await op.evaluate(() => document.querySelector('#projector-preview .projector-stage').innerText)), 'the preview still shows the live frame');
    // a move while it is out: the lobby stays idle
    await op.click('#next-button');
    await hallPage.waitForFunction(() => /Sfânt/.test(document.querySelector('#output .projector-stage').innerText), null, { timeout: 4000 });
    await wait(200);
    check((await textOf(lobbyPage)) === '', 'after a move the lobby is still idle');
    // the console agrees
    const con = await signIn('operator', { width: 1280 });
    await con.goto(`${app.url}/events/${E}/operator`);
    await con.waitForSelector('#console:not([hidden])');
    await con.waitForSelector('#screen-picker:not([hidden])', { timeout: 5000 });
    const conOptions = () => con.$$eval('#screen-picker button[data-screen]', (l) => l.map((b) => `${b.textContent.trim()}:${b.getAttribute('aria-pressed')}`).join(' '));
    check((await conOptions()) === 'Hol:false Sală:true', 'the operator console shows the same choice', await conOptions());
    // nobody, from the console: both idle; the hint says so
    await con.click(`#screen-picker button[data-screen="${hall.id}"]`);
    await hallPage.waitForFunction(() => document.querySelector('#output .projector-stage').innerText.trim() === '', null, { timeout: 4000 }).catch(() => {});
    await wait(200);
    check((await textOf(hallPage)) === '' && /(Niciun ecran|No screen)/.test(await con.textContent('#screen-picker .hint')), 'no screen chosen: every screen idle, the hint says so', await con.textContent('#screen-picker .hint'));
    check((await options()) === 'Hol:false:on Sală:false:on', 'the live page follows', await options());
    // both back, from the live page
    await op.click(`#screen-picker button[data-screen="${lobby.id}"]`);
    await op.click(`#screen-picker button[data-screen="${hall.id}"]`);
    await lobbyPage.waitForFunction(() => /Sfânt/.test(document.querySelector('#output .projector-stage').innerText), null, { timeout: 8000 }).catch(() => {});
    await hallPage.waitForFunction(() => /Sfânt/.test(document.querySelector('#output .projector-stage').innerText), null, { timeout: 8000 }).catch(() => {});
    check(/Sfânt/.test(await textOf(lobbyPage)) && /Sfânt/.test(await textOf(hallPage)) && (await options()) === 'Hol:true:on Sală:true:on', 'both back: both show the current section', await options());
    check((await app.state()).screens === null, 'every screen selected is stored as null (all)');
    // a revoked screen leaves the list; one left: hidden again
    await app.api(owner, 'DELETE', `/api/screens/${lobby.id}`);
    await op.waitForSelector('#screen-picker[hidden]', { timeout: 5000 }).catch(() => {});
    check(await op.isHidden('#screen-picker'), 'one screen again: the picker hides');
    // not live: the options are disabled
    await app.command({ type: 'event.end' });
    await app.api(owner, 'POST', '/api/screens', { name: 'Hol 2' });
    await op.waitForSelector('#screen-picker:not([hidden])', { timeout: 5000 }).catch(() => {});
    await wait(200);
    check(/off/.test(await options()) && /(live, alegi|Once the event is live)/.test(await op.textContent('#screen-picker .hint')), 'not live: the options are disabled, the hint says when', await options());
  },
};
