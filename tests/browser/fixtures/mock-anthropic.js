// Browser tests only (preloaded with --require, together with ANTHROPIC_API_KEY=test-key and
// AI_API_URL=https://api.anthropic.test): a stand-in for the Claude Messages API (lib/ai.js).
//   a draft request (its schema has "steps")  -> a guide: 3 steps, 2 problems
//   an ask request (its schema has "covered") -> an answer from the guide; a question with
//                                                "pizza" is not covered
// Each request is kept in global.__aiRequests (model, fallbacks, image count, the text).
global.__aiRequests = [];

const realFetch = global.fetch;
global.fetch = async (input, opts = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  const u = new URL(url);
  if (u.hostname !== 'api.anthropic.test') return realFetch(input, opts);
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } });
  const headers = new Headers(opts.headers || (input.headers || {}));
  if (headers.get('x-api-key') !== 'test-key') return json(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
  const req = JSON.parse(opts.body || '{}');
  const content = req.messages[0].content;
  const text = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  global.__aiRequests.push({ model: req.model, fallbacks: req.fallbacks, images: content.filter((c) => c.type === 'image').length, text });
  const schema = req.output_config.format.schema;
  let out;
  if (schema.properties.steps) {
    out = {
      summary: 'Cum pornești sunetul duminica, cu 30 de minute înainte.',
      steps: [
        { title: 'Pornește prelungitorul de sub masă', body: 'Butonul roșu se aprinde.' },
        { title: 'Pornește mixerul Behringer X32', body: 'Butonul din spate, dreapta.\nAșteaptă să apară ecranul principal.' },
        { title: 'Ridică fader-ul principal', body: 'Până la marcajul 0.' },
      ],
      problems: [
        { title: 'Nu se aude microfonul wireless', body: 'Verifică bateria.\nVerifică dacă e pornit (lumina verde).\nSună pe [responsabilul de sunet].' },
        { title: 'Se aude un fluierat (feedback)', body: 'Coboară volumul monitorului.' },
      ],
    };
  } else {
    out = /pizza/i.test(text)
      ? { answer: 'Ghidul nu spune nimic despre asta. Întreabă responsabilul de sunet.', covered: false }
      : { answer: 'Verifică bateria microfonului, apoi dacă e pornit (lumina verde) - din problema „Nu se aude microfonul wireless”.', covered: true };
  }
  return json(200, {
    id: 'msg_test', type: 'message', role: 'assistant', model: req.model, stop_reason: 'end_turn', stop_sequence: null,
    content: [{ type: 'text', text: JSON.stringify(out) }],
    usage: { input_tokens: 1500, output_tokens: 400 },
  });
};
