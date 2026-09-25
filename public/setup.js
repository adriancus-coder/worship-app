'use strict';

(function () {
  const form = document.getElementById('setup-form');
  const message = document.getElementById('message');
  const done = document.getElementById('done');
  const button = form.querySelector('button[type="submit"]');
  const { t } = window.I18N;
  const MIN_PASSWORD_LENGTH = 10;

  // Messages from a dictionary key re-translate on a language switch;
  // server messages are cleared because they are in the previous language.
  function showErrorKey(key, vars) {
    message.dataset.i18n = key;
    if (vars) message.dataset.i18nVars = JSON.stringify(vars);
    else delete message.dataset.i18nVars;
    message.textContent = t(key, vars);
    message.className = 'message error';
  }

  function showErrorText(text) {
    clearMessage();
    message.textContent = text;
    message.className = 'message error';
  }

  function clearMessage() {
    delete message.dataset.i18n;
    delete message.dataset.i18nVars;
    message.textContent = '';
  }

  document.addEventListener('i18n:change', () => {
    if (!message.dataset.i18n) clearMessage();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage();

    const data = Object.fromEntries(new FormData(form));
    if (data.ownerPassword.length < MIN_PASSWORD_LENGTH) {
      showErrorKey('errors.passwordTooShort', { min: MIN_PASSWORD_LENGTH });
      return;
    }

    button.disabled = true;
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.error) showErrorText(body.error);
        else showErrorKey('setup.failed');
        return;
      }
      form.hidden = true;
      done.hidden = false;
    } catch (err) {
      showErrorKey('common.networkError');
    } finally {
      button.disabled = false;
    }
  });
})();
