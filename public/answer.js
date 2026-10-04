'use strict';

// /answer/<token>?a=<answer> (routes/answer.js): the invitation email's "Vin" / "Poate" / "Nu
// pot" land here, no sign-in needed. The answer from the email is already chosen; one tap on
// "Trimite răspunsul" saves it (a link alone never answers: mail scanners open links). The
// other answers and a note can be chosen here too; after saving the page says so and the
// answer can still be changed.

(function () {
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const token = window.location.pathname.split('/')[2] || '';
  const asked = new URLSearchParams(window.location.search).get('a');
  const ANSWERS = ['accepted', 'maybe', 'declined'];
  const state = { info: null, choice: ANSWERS.includes(asked) ? asked : null, saved: false, problem: null };

  const LOCALES = { ro: 'ro-RO', en: 'en-GB' };
  function when(ev) {
    const [y, m, d] = ev.eventDate.split('-').map(Number);
    const date = new Intl.DateTimeFormat(LOCALES[window.I18N.lang] || LOCALES.ro, { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(Date.UTC(y, m - 1, d)));
    return [date.charAt(0).toLocaleUpperCase() + date.slice(1), ev.startTime].filter(Boolean).join(' · ');
  }

  function render() {
    document.title = t('answerPage.pageTitle', { appName: document.documentElement.dataset.appName || '' });
    if (state.problem) {
      $('heading').textContent = t('answerPage.heading');
      $('problem-text').textContent = state.problem;
      return;
    }
    const info = state.info;
    if (!info) return;
    $('church').textContent = info.church;
    $('heading').textContent = info.event.name;
    $('when').textContent = when(info.event);
    $('event-notes').hidden = !info.event.notes;
    $('event-notes').textContent = info.event.notes || '';
    $('question').textContent = t('answerPage.question', { name: info.name });
    for (const b of $('choices').querySelectorAll('[data-answer]')) {
      b.textContent = t(`attend.answers.${b.dataset.answer}`);
      b.setAttribute('aria-pressed', String(b.dataset.answer === state.choice));
    }
    $('send').textContent = state.choice ? t('answerPage.send', { answer: t(`attend.answers.${state.choice}`) }) : t('answerPage.choose');
    $('send').disabled = !state.choice;
    const now = info.answer && info.answer.status !== 'pending' ? info.answer.status : null;
    $('message').className = `message${state.saved ? ' success' : ''}`;
    $('message').textContent = state.saved ? t('answerPage.saved', { answer: t(`attend.answers.${now}`) }) : (now ? t('answerPage.current', { answer: t(`attend.answers.${now}`) }) : '');
  }

  function problem(text) {
    state.problem = text;
    $('status').hidden = true;
    $('answer-form').hidden = true;
    $('problem').hidden = false;
    render();
  }

  async function call(method, body) {
    const res = await fetch(`/api/answer/${encodeURIComponent(token)}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    return { ok: res.ok, body: await res.json().catch(() => ({})) };
  }

  for (const b of $('choices').querySelectorAll('[data-answer]')) {
    b.addEventListener('click', () => { state.choice = b.dataset.answer; state.saved = false; render(); });
  }

  $('answer-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.choice) return;
    $('send').disabled = true;
    const res = await call('POST', { status: state.choice, note: $('note').value }).catch(() => ({ ok: false, body: {} }));
    if (!res.ok) {
      $('send').disabled = false;
      $('message').className = 'message error';
      $('message').textContent = res.body.error || t('common.networkError');
      return;
    }
    state.info = res.body;
    state.saved = true;
    render();
  });

  document.addEventListener('i18n:change', render);

  call('GET').then((res) => {
    if (!res.ok) return problem(res.body.error || t('errors.tokenInvalid'));
    state.info = res.body;
    if (res.body.answer && res.body.answer.note) $('note').value = res.body.answer.note;
    $('status').hidden = true;
    $('answer-form').hidden = false;
    render();
  }, () => problem(t('common.networkError')));
})();
