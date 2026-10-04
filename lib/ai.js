'use strict';

// AI for the Ghiduri, through the Claude API (the official SDK). OPTIONAL: without
// ANTHROPIC_API_KEY it is disabled - the AI buttons are hidden and the guides work as before.
// Never in the live path (CLAUDE.md rule 8): only a guide's editor and its reader call it.
//
//   const ai = createAi({ config, db, logger })
//   ai.enabled, ai.status(adminId)              -> { enabled, model, used, limit }
//   await ai.draftGuide(adminId, { lang, title, description, positions, images })
//        -> { summary, steps: [{ title, body }], problems: [{ title, body }] }
//   await ai.askGuide(adminId, { lang, guide, items, question }) -> { answer, covered }
//   throws AiError: aiDisabled | aiLimit | aiKey | aiBusy | aiOffline | aiRefused | aiFailed
//
// Every call counts toward the church's monthly cap (AI_MONTHLY_CALLS, table ai_usage); a log
// line names the church, the kind and the tokens - never the text or the photos. Server-side
// fallbacks ("default") let another model answer when a safety classifier declines.

const MAX_STEPS = 15;
const MAX_PROBLEMS = 10;
const MAX_QUESTION = 500;

class AiError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

const itemSchema = {
  type: 'object',
  properties: { title: { type: 'string' }, body: { type: 'string' } },
  required: ['title', 'body'],
  additionalProperties: false,
};
const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    steps: { type: 'array', items: itemSchema },
    problems: { type: 'array', items: itemSchema },
  },
  required: ['summary', 'steps', 'problems'],
  additionalProperties: false,
};
const ANSWER_SCHEMA = {
  type: 'object',
  properties: { answer: { type: 'string' }, covered: { type: 'boolean' } },
  required: ['answer', 'covered'],
  additionalProperties: false,
};

const LANG_NAME = { ro: 'Romanian', en: 'English' };

const DRAFT_SYSTEM = `You write practical how-to guides for church volunteers who run the technical side of a service (sound, projector, stream, lights) and are often not technical. The guide is read on a phone, standing next to the equipment, sometimes minutes before the service starts.

Write:
- summary: one or two sentences on what the guide covers and when to use it.
- steps: the start-up procedure in the order a volunteer does it. Each title is one short imperative action (under 100 characters). The body adds what to look for, where the control is, and how to tell it worked, on short separate lines. Up to ${MAX_STEPS} steps; fewer is better when it is enough.
- problems: the failures that most often happen with this kind of setup (no sound from a microphone, feedback, projector shows nothing, no internet for the stream, ...). Each title is the symptom as a volunteer would describe it; the body lists the checks in the order to try them, cheapest first, and ends with whom to call if nothing works. Up to ${MAX_PROBLEMS} problems.

Use what the description and the photos show: brand and model names, labels, the order of the devices. Do not invent specifics you cannot see or were not told (channel numbers, passwords, phone numbers): describe the control instead ("the channel of the wireless microphone"), or write a placeholder in square brackets for the church to fill in ("[numărul responsabilului de sunet]"). Plain text only: no Markdown, no numbering in the titles (the app numbers the steps).`;

const ASK_SYSTEM = `You help a church volunteer who is using one of the church's how-to guides, often under time pressure just before or during a service. Answer only from the guide given in the message: its steps and its "if it does not work" section. Be short and concrete: the checks to do, in order, as short lines; point to the step number or problem title the answer comes from. If the guide does not cover the question, say so plainly, suggest asking the person responsible for this equipment, and set covered to false. Never invent settings, numbers or procedures that are not in the guide. Plain text only, no Markdown.`;

function monthKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 7);
}

function createAi({ config, db, logger, Client = null, now = Date.now }) {
  const apiKey = config.ANTHROPIC_API_KEY || '';
  const model = config.AI_MODEL || 'claude-opus-5-5';
  const limit = config.AI_MONTHLY_CALLS;
  const enabled = Boolean(apiKey) && limit > 0;
  // the SDK's client class (its typed errors hang off it); tests pass a stand-in
  const Anthropic = enabled ? (Client || require('@anthropic-ai/sdk')) : null;
  const Errors = Anthropic ? (Anthropic.default || Anthropic) : {};
  const client = enabled ? new Errors({ apiKey, ...(config.AI_API_URL ? { baseURL: config.AI_API_URL } : {}), maxRetries: 1, timeout: 120000 }) : null;

  const selectUsage = db.prepare('SELECT calls FROM ai_usage WHERE admin_id = ? AND month = ?').pluck();
  const addUsage = db.prepare(`INSERT INTO ai_usage (admin_id, month, calls, input_tokens, output_tokens) VALUES (?, ?, 1, ?, ?)
    ON CONFLICT (admin_id, month) DO UPDATE SET calls = calls + 1, input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens`);

  const used = (adminId) => selectUsage.get(adminId, monthKey(now())) || 0;
  const status = (adminId) => ({ enabled, model: enabled ? model : null, used: adminId ? used(adminId) : 0, limit });

  // The SDK's typed errors -> our codes (most specific first).
  function mapError(err) {
    if (err instanceof AiError) return err;
    if (Errors.AuthenticationError && err instanceof Errors.AuthenticationError) return new AiError('aiKey', err.message);
    if (Errors.PermissionDeniedError && err instanceof Errors.PermissionDeniedError) return new AiError('aiKey', err.message);
    if (Errors.RateLimitError && err instanceof Errors.RateLimitError) return new AiError('aiBusy', err.message);
    if (Errors.APIConnectionError && err instanceof Errors.APIConnectionError) return new AiError('aiOffline', err.message);
    if (Errors.APIError && err instanceof Errors.APIError) return new AiError(err.status >= 500 ? 'aiBusy' : 'aiFailed', err.message);
    return new AiError('aiFailed', err && err.message);
  }

  // One structured call: the JSON the schema describes, or an AiError.
  async function call(adminId, kind, { system, content, schema, effort, maxTokens }) {
    if (!enabled) throw new AiError('aiDisabled');
    if (used(adminId) >= limit) throw new AiError('aiLimit');
    let res;
    try {
      res = await client.beta.messages.create({
        model,
        max_tokens: maxTokens,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system,
        messages: [{ role: 'user', content }],
        output_config: { effort, format: { type: 'json_schema', schema } },
      });
    } catch (err) {
      const mapped = mapError(err);
      logger.warn(`AI ${kind} failed (admin #${adminId}): ${mapped.code} ${String(mapped.detail || '').slice(0, 160)}`);
      throw mapped;
    }
    const usage = res.usage || {};
    addUsage.run(adminId, monthKey(now()), usage.input_tokens || 0, usage.output_tokens || 0);
    logger.info(`AI ${kind} (admin #${adminId}, ${res.model || model}, in ${usage.input_tokens || 0} / out ${usage.output_tokens || 0} tokens, ${res.stop_reason})`);
    if (res.stop_reason === 'refusal') throw new AiError('aiRefused');
    if (res.stop_reason === 'max_tokens') throw new AiError('aiFailed', 'max_tokens');
    const text = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new AiError('aiFailed', 'not JSON');
    }
  }

  const cleanItems = (list, max) => (Array.isArray(list) ? list : [])
    .map((i) => ({ title: String(i && i.title || '').replace(/\s+/g, ' ').trim().slice(0, 120), body: String(i && i.body || '').trim().slice(0, 4000) }))
    .filter((i) => i.title)
    .slice(0, max);

  // images: [{ mediaType, data (base64) }], already resized by the route
  async function draftGuide(adminId, { lang = 'ro', title, description = '', positions = [], images = [] }) {
    const text = [
      `Write the guide in ${LANG_NAME[lang] || 'Romanian'}.`,
      `Guide title: ${title}`,
      positions.length ? `For the team positions: ${positions.join(', ')}` : '',
      description ? `What the church told us about its setup:\n${description}` : 'No description was given: rely on the title and the photos.',
      images.length ? `${images.length} photo(s) of the equipment are attached.` : 'No photos are attached.',
    ].filter(Boolean).join('\n\n');
    const content = [
      ...images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })),
      { type: 'text', text },
    ];
    const out = await call(adminId, 'draft', { system: DRAFT_SYSTEM, content, schema: DRAFT_SCHEMA, effort: 'medium', maxTokens: 16000 });
    return {
      summary: String(out.summary || '').trim().slice(0, 300),
      steps: cleanItems(out.steps, MAX_STEPS),
      problems: cleanItems(out.problems, MAX_PROBLEMS),
    };
  }

  async function askGuide(adminId, { lang = 'ro', guide, items, question }) {
    const steps = items.filter((i) => i.kind === 'step');
    const problems = items.filter((i) => i.kind === 'problem');
    const text = [
      `Answer in ${LANG_NAME[lang] || 'Romanian'}.`,
      `<guide title="${guide.title.replace(/"/g, "'")}">`,
      guide.summary ? `Summary: ${guide.summary}` : '',
      'Steps:',
      ...steps.map((s, i) => `${i + 1}. ${s.title}${s.body ? `\n${s.body}` : ''}`),
      'If it does not work:',
      ...problems.map((p) => `- ${p.title}${p.body ? `\n${p.body}` : ''}`),
      '</guide>',
      `The volunteer asks: ${String(question).slice(0, MAX_QUESTION)}`,
    ].filter(Boolean).join('\n');
    const out = await call(adminId, 'ask', { system: ASK_SYSTEM, content: [{ type: 'text', text }], schema: ANSWER_SCHEMA, effort: 'low', maxTokens: 4000 });
    return { answer: String(out.answer || '').trim().slice(0, 3000), covered: Boolean(out.covered) };
  }

  return { enabled, status, draftGuide, askGuide };
}

module.exports = { AiError, MAX_QUESTION, monthKey, createAi };
