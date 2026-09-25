'use strict';

(function () {
  const form = document.getElementById('setup-form');
  const message = document.getElementById('message');
  const done = document.getElementById('done');
  const button = form.querySelector('button[type="submit"]');
  const { t } = window.I18N;
  const MIN_PASSWORD_LENGTH = 10;

  function showError(text) {
    message.textContent = text;
    message.className = 'message error';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.textContent = '';

    const data = Object.fromEntries(new FormData(form));
    if (data.ownerPassword.length < MIN_PASSWORD_LENGTH) {
      showError(t('errors.passwordTooShort', { min: MIN_PASSWORD_LENGTH }));
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
        showError(body.error || t('setup.failed'));
        return;
      }
      form.hidden = true;
      done.hidden = false;
    } catch (err) {
      showError(t('common.networkError'));
    } finally {
      button.disabled = false;
    }
  });
})();
