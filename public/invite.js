'use strict';

// /invite/<token> and /reset/<token> (routes/invites.js): the page reads the token, shows
// who it is for, then sets the password (the invitation also confirms the name) and signs
// the person in on this device. An unknown, expired or used token gets a clear message: an
// invitation says to ask the owner, a reset offers "Cere un link nou" (the login page).

(function () {
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const MIN = 10;
  const [, kind, token] = window.location.pathname.split('/'); // 'invite' | 'reset'
  const state = { info: null, problem: null };

  function say(text, kind2) {
    $('message').className = `message${kind2 ? ` ${kind2}` : ''}`;
    $('message').textContent = text || '';
  }

  function render() {
    const appName = document.documentElement.dataset.appName || '';
    document.title = t(`${kind}.pageTitle`, { appName });
    $('heading').textContent = t(`${kind}.heading`);
    if (state.info) {
      $('intro').textContent = t(`${kind}.intro`, { church: state.info.church, email: state.info.email, appName });
      $('submit').textContent = t(`${kind}.submit`);
    } else if (state.problem) {
      $('intro').textContent = '';
      $('problem-text').textContent = t(`errors.${state.problem}`);
      $('problem-hint').textContent = t(`${kind}.${state.problem === 'tokenInvalid' ? 'invalidHint' : 'expiredHint'}`);
    }
  }

  function showProblem(code) {
    state.problem = code || 'tokenInvalid';
    state.info = null;
    $('status').hidden = true;
    $('token-form').hidden = true;
    $('problem').hidden = false;
    $('new-link').hidden = kind !== 'reset';
    render();
  }

  $('token-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = $('password').value;
    const name = $('name').value.trim();
    if (kind === 'invite' && !name) return say(t('invite.nameMissing'), 'error');
    if (password.length < MIN) return say(t('errors.passwordTooShort', { min: MIN }), 'error');
    if (password !== $('confirm').value) return say(t('changePassword.mismatch'), 'error');
    $('submit').disabled = true;
    try {
      const res = await fetch(`/api/${kind}/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kind === 'invite' ? { name, password } : { password }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        say(t(`${kind}.done`), 'success');
        window.location.replace('/app');
        return;
      }
      if (res.status === 404 || res.status === 410) return showProblem(body.code);
      say(body.error || t('common.networkError'), 'error');
    } catch (err) {
      say(t('common.networkError'), 'error');
    } finally {
      $('submit').disabled = false;
    }
  });

  document.addEventListener('i18n:change', () => {
    render();
    say('');
  });

  (async () => {
    if (kind !== 'invite' && kind !== 'reset') return showProblem('tokenInvalid');
    const res = await fetch(`/api/${kind}/${encodeURIComponent(token)}`, { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return showProblem(body.code);
    state.info = body;
    $('username').value = body.email; // for password managers
    $('name').value = body.name || '';
    $('name-field').hidden = kind !== 'invite';
    $('name').required = kind === 'invite';
    $('status').hidden = true;
    render();
    $('token-form').hidden = false;
    (kind === 'invite' ? $('name') : $('password')).focus();
  })().catch(() => {
    $('status').removeAttribute('data-i18n');
    $('status').textContent = t('common.networkError');
  });
})();
