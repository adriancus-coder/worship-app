'use strict';

// The song editor's "Lipește toată cântarea o dată": the whole text pasted once,
// "Recunoaște secțiunile" splits it (SECTIONS.splitPastedSong) into sections with their
// guessed types (a label, a stanza number, a repeated stanza = chorus), the box folds, the
// first section's type gets focus, the types can be changed and the song saved; on a song
// that already has sections the box is folded and recognising asks before replacing. The
// Sunday school writer has it too. 375 RO / 1024 EN.

const { layoutAudit } = require('./harness');

const TEXT = ['1. Ne ridici din noaptea grea', 'Tu ești lumina mea', '', 'Refren:', 'Sfânt, sfânt, sfânt', 'Domnul Dumnezeu', '', '2. Al doilea rând', 'încă un rând', '', 'Sfânt, sfânt, sfânt', 'Domnul Dumnezeu', '', 'Bridge', 'Punte aici'].join('\n');

module.exports = {
  name: 'editor-paste',
  async run({ app, signIn, check }) {
    const owner = app.cookies.owner;
    for (const [lang, width] of [['ro', 375], ['en', 1024]]) {
      const tag = `[${lang} ${width}]`;
      const p = await signIn('owner', { width, lang });
      await p.goto(`${app.url}/songs/new`);
      await p.waitForSelector('#song-form:not([hidden])');
      const box = await p.evaluate(() => ({ open: document.getElementById('se-paste-box').open, summary: document.querySelector('#se-paste-box summary').textContent, button: document.getElementById('se-paste-recognize').textContent.trim() }));
      check(box.open && (lang === 'ro' ? /Lipește toată cântarea/.test(box.summary) && box.button === 'Recunoaște secțiunile' : /Paste the whole song/.test(box.summary) && box.button === 'Recognise the sections'), `${tag} a new song: the paste box open above the sections`, box);
      await p.click('#se-paste-recognize');
      check(/(Nu am găsit|No text)/.test(await p.textContent('#se-paste-message')), `${tag} nothing pasted: a message`);
      await p.fill('#se-paste', TEXT);
      await p.click('#se-paste-recognize');
      await p.waitForFunction(() => document.querySelectorAll('.section-editor').length === 4);
      const sections = await p.evaluate(() => ({
        types: [...document.querySelectorAll('.section-editor select')].map((s) => s.value),
        firsts: [...document.querySelectorAll('.section-editor textarea')].map((x) => x.value.split('\n')[0]),
        open: document.getElementById('se-paste-box').open, message: document.getElementById('se-paste-message').textContent, focused: document.activeElement.id,
      }));
      check(sections.types.join() === 'verse,chorus,verse,bridge' && sections.firsts.join('|') === 'Ne ridici din noaptea grea|Sfânt, sfânt, sfânt|Al doilea rând|Punte aici' && !sections.open && /4/.test(sections.message) && sections.focused === 'section-0-type',
        `${tag} recognised: 4 sections (verse, chorus, verse, bridge), the labels and numbers gone, the repeat dropped, the box folded, the first type focused`, sections);
      const a = await layoutAudit(p, '#song-editor');
      check(!a.overflow && !a.small.length, `${tag} the editor: no overflow, targets >= 44 px`, a);
      // the type is the writer's to change; then save
      await p.selectOption('#section-3-type', 'outro');
      await p.fill('#song-title', `Lipită ${lang}`);
      await p.click('#save');
      await p.waitForURL(/\/songs\/\d+$/);
      const id = Number(new URL(p.url()).pathname.split('/')[2]);
      const saved = (await app.api(owner, 'GET', `/api/songs/${id}`)).body.song;
      check(saved.sections.map((x) => x.type).join() === 'verse,chorus,verse,outro' && saved.sections[1].content === 'Sfânt, sfânt, sfânt\nDomnul Dumnezeu', `${tag} saved with the types as set`, saved.sections.map((x) => x.type));
      // editing it: the box is folded; recognising asks before replacing
      await p.goto(`${app.url}/songs/${id}/edit`);
      await p.waitForSelector('.section-editor');
      check(!(await p.evaluate(() => document.getElementById('se-paste-box').open)), `${tag} an existing song: the box folded`);
      await p.evaluate(() => { document.getElementById('se-paste-box').open = true; });
      await p.fill('#se-paste', 'Alt text\n\nAlt refren');
      p.once('dialog', (d) => d.dismiss());
      await p.click('#se-paste-recognize');
      check(await p.evaluate(() => document.querySelectorAll('.section-editor').length) === 4, `${tag} "Renunță" at the question: the sections stay`);
      p.once('dialog', (d) => d.accept());
      await p.click('#se-paste-recognize');
      await p.waitForFunction(() => document.querySelectorAll('.section-editor').length === 2);
      check(true, `${tag} confirmed: the sections replaced`);
      await p.context().close();
    }
  },
};
