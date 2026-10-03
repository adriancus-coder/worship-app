'use strict';

// /change-password. Forced after the owner created the account or reset its password (the
// temporary password): nothing else opens until the user picks their own; there is no menu,
// only the language and Deconectare. Otherwise it is reached from "Mai mult" and has the menu.

(function () {
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const MIN = 10;
  let forced = false;

  function say(text, kind) {
    $('message').className = `message${kind ? ` ${kind}` : ''}`;
    $('message').textContent = text || '';
  }

  function render() {
    $('intro').textContent = t(forced ? 'changePassword.introForced' : 'changePassword.intro');
    $('current-label').textContent = t(forced ? 'changePassword.temporaryLabel' : 'changePassword.currentLabel');
    document.title = t('changePassword.pageTitle', { appName: document.documentElement.dataset.appName || '' });
  }

  $('password-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const current = $('current').value;
    const password = $('password').value;
    if (password.length < MIN) return say(t('errors.passwordTooShort', { min: MIN }), 'error');
    if (password === current) return say(t('errors.passwordSame'), 'error');
    if (password !== $('confirm').value) return say(t('changePassword.mismatch'), 'error');
    $('submit').disabled = true;
    try {
      const res = await fetch('/api/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        say(t('changePassword.done'), 'success');
        window.location.replace('/app');
        return;
      }
      if (res.status === 401) return window.location.replace('/login');
      say(body.error || t('common.networkError'), 'error');
    } catch (err) {
      say(t('common.networkError'), 'error');
    } finally {
      $('submit').disabled = false;
    }
  });

  $('logout').addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.replace('/login');
    }
  });

  document.addEventListener('i18n:change', () => {
    render();
    say('');
  });

  (async () => {
    const res = await fetch('/api/auth/me', { cache: 'no-store' });
    if (res.status === 401) return window.location.replace('/login');
    const me = await res.json();
    forced = Boolean(me.user.mustChangePassword);
    $('username').value = me.user.email; // for password managers
    if (forced) {
      $('pending-bar').hidden = false;
      $('logout').hidden = false;
    } else {
      // The usual menu (under "Mai mult").
      document.body.dataset.shell = 'more';
      const script = document.createElement('script');
      const build = document.documentElement.dataset.build;
      script.src = build ? `/shell.js?v=${encodeURIComponent(build)}` : '/shell.js';
      document.body.append(script);
    }
    render();
    $('password-form').hidden = false;
    $('current').focus();
  })().catch(() => say(t('common.networkError'), 'error'));
})();
