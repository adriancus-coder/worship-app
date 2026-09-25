'use strict';

(function () {
  const form = document.getElementById('login-form');
  const message = document.getElementById('message');
  const button = form.querySelector('button[type="submit"]');
  const { t } = window.I18N;

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

    const data = {
      email: form.elements.email.value.trim(),
      password: form.elements.password.value,
      remember: form.elements.remember.checked,
    };
    if (!data.email || !data.password) {
      showErrorKey('login.missingFields');
      return;
    }

    button.disabled = true;
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        // Switch to the user's saved language before leaving the page.
        const locale = body.user && body.user.locale;
        if (locale) window.I18N.setLang(locale);
        window.location.replace('/app');
        return;
      }
      if (body.error) showErrorText(body.error);
      else showErrorKey('login.failed');
    } catch (err) {
      showErrorKey('common.networkError');
    } finally {
      button.disabled = false;
    }
  });
})();
