'use strict';

// AI for the Ghiduri with a test key (fixtures/mock-anthropic.js stands in for the Claude
// API): "Ghid nou" shows "✨ Scrie pașii cu AI"; without a title it asks for one; with a
// description and a photo the draft fills the summary and shows the proposed steps and
// problems; "Creează ghidul" stores them for editing. A member (EN 1024) asks the guide: an
// answer from it, with the note; a question it does not cover says so. Setări counts the uses.
// (Without a key the AI parts stay hidden: checked by guides.test.js.)

const path = require('path');
const sharp = require('sharp');
const { FIXTURES, layoutAudit } = require('./harness');

module.exports = {
  name: 'ai-guides',
  timeout: 240000,
  app: { preload: [path.join(FIXTURES, 'mock-anthropic.js')], env: { ANTHROPIC_API_KEY: 'test-key', AI_API_URL: 'https://api.anthropic.test', AI_MONTHLY_CALLS: '50' } },
  async run({ app, signIn, check }) {
    const photo = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: '#224466' } }).jpeg().toBuffer();

    // the leader drafts with AI (RO 375)
    const l = await signIn('leader', { width: 375, lang: 'ro' });
    await l.goto(`${app.url}/guides`);
    await l.waitForSelector('#guide-add:not([hidden])');
    await l.click('#guide-add');
    await l.waitForSelector('#guide-dialog[open]');
    check(await l.isVisible('#g-ai'), 'Ghid nou: the AI section shows (the server has a key)');
    await l.click('#g-ai-draft');
    check(/titlul/.test(await l.textContent('#g-ai-status')), 'no title yet: it asks for one first');
    await l.fill('#g-title', 'Pornirea sunetului');
    await l.fill('#g-ai-desc', 'Mixer Behringer X32, 4 microfoane wireless, boxe active.');
    await l.setInputFiles('#g-ai-photos', { name: 'mixer.jpg', mimeType: 'image/jpeg', buffer: photo });
    check(/1 poze alese/.test(await l.textContent('#g-ai-count')), 'the photo is counted');
    await l.click('#g-ai-draft');
    await l.waitForSelector('#g-ai-preview:not([hidden]) ol li', { timeout: 30000 });
    const preview = await l.evaluate(() => ({
      steps: document.querySelectorAll('#g-ai-preview ol li').length,
      problems: document.querySelectorAll('#g-ai-preview ul li').length,
      summary: document.getElementById('g-summary').value,
      status: document.getElementById('g-ai-status').textContent,
    }));
    check(preview.steps === 3 && preview.problems === 2 && /30 de minute/.test(preview.summary) && /3 pași și 2 probleme/.test(preview.status), 'the draft: the proposed steps and problems, the summary filled in', preview);
    const a = await layoutAudit(l, '#guide-dialog');
    check(!a.overflow && !a.small.length, 'the dialog with the draft 375: no overflow, targets >= 44 px', a);
    await l.click('#g-create');
    await l.waitForURL(/\/guides\/\d+\?edit=1$/);
    await l.waitForSelector('#steps .guide-edit-item');
    const gid = Number(new URL(l.url()).pathname.split('/').pop());
    const made = (await app.api(app.cookies.leader, 'GET', `/api/guides/${gid}`)).body;
    check(made.items.filter((i) => i.kind === 'step').length === 3 && made.items.filter((i) => i.kind === 'problem').length === 2 && /Behringer X32/.test(made.items[1].title), 'created with the draft, open for editing', made.items.map((i) => i.title));
    await l.context().close();

    // a member asks the guide (EN 1024)
    const m = await signIn('member', { width: 1024, lang: 'en' });
    await m.goto(`${app.url}/guides/${gid}`);
    await m.waitForSelector('#guide-ask:not([hidden])');
    await m.fill('#ask-q', 'The wireless mic is silent');
    await m.click('#ask-go');
    await m.waitForSelector('#ask-answer:not([hidden])', { timeout: 30000 });
    check(/bateria/.test(await m.textContent('#ask-answer')) && await m.isVisible('#ask-note') && !(await m.textContent('#ask-status')), 'an answer from the guide, with the note');
    await m.fill('#ask-q', 'Where do we order pizza?');
    await m.click('#ask-go');
    await m.waitForFunction(() => /does not cover/.test(document.getElementById('ask-status').textContent), null, { timeout: 30000 });
    check(true, 'a question the guide does not cover: it says so');
    const b = await layoutAudit(m, 'main');
    check(!b.overflow && !b.small.length, 'reading with the ask box 1024: no overflow, targets >= 44 px', b);
    await m.context().close();

    // the API: members cannot draft; Setări counts the uses
    check((await app.api(app.cookies.member, 'POST', '/api/guides/ai/draft', { title: 'x' })).status === 403, 'a member cannot draft with AI');
    const settings = (await app.api(app.cookies.owner, 'GET', '/api/settings')).body.ai;
    check(settings.enabled && settings.used === 3 && settings.limit === 50 && settings.model === 'claude-opus-5-5', 'Setări: AI on, 3 uses this month', settings);
    const o = await signIn('owner', { width: 375, lang: 'ro' });
    await o.goto(`${app.url}/settings`);
    await o.waitForFunction(() => /\S/.test(document.getElementById('ai-status').textContent));
    check(/AI: activ \(claude-opus-5-5\) · 3 din 50/.test(await o.textContent('#ai-status')), 'Setări shows "AI: activ … 3 din 50"');
    await o.context().close();
  },
};
