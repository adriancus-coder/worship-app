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
    if (!forgotMessage.dataset.i18n) forgotMessage.textContent = '';
  });

  // --- "Ai uitat parola?" (only when the server can send email) ---------------------

  const forgotForm = document.getElementById('forgot-form');
  const forgotMessage = document.getElementById('forgot-message');
  const forgotButton = document.getElementById('forgot-submit');

  function showForgot(on) {
    forgotForm.hidden = !on;
    form.hidden = on;
    delete forgotMessage.dataset.i18n;
    forgotMessage.textContent = '';
    forgotMessage.className = 'message';
    forgotButton.hidden = false;
    if (on) {
      document.getElementById('forgot-email').value = form.elements.email.value.trim();
      document.getElementById('forgot-email').focus();
    } else {
      form.elements.email.focus();
    }
  }

  document.getElementById('forgot-link').addEventListener('click', () => showForgot(true));
  document.getElementById('forgot-back').addEventListener('click', () => showForgot(false));

  forgotForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('forgot-email').value.trim();
    forgotMessage.className = 'message error';
    if (!email) {
      forgotMessage.dataset.i18n = 'login.forgotMissing';
      forgotMessage.textContent = t('login.forgotMissing');
      return;
    }
    forgotButton.disabled = true;
    try {
      const res = await fetch('/api/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        // The same answer whether the account exists or not.
        forgotMessage.className = 'message success';
        forgotMessage.dataset.i18n = 'login.forgotDone';
        forgotMessage.textContent = t('login.forgotDone');
        forgotButton.hidden = true;
        return;
      }
      delete forgotMessage.dataset.i18n;
      forgotMessage.textContent = body.error || t('common.networkError');
    } catch (err) {
      forgotMessage.dataset.i18n = 'common.networkError';
      forgotMessage.textContent = t('common.networkError');
    } finally {
      forgotButton.disabled = false;
    }
  });

  fetch('/api/auth/features', { cache: 'no-store' }).then((res) => (res.ok ? res.json() : {})).then((features) => {
    if (!features.emailEnabled) return;
    document.getElementById('forgot-row').hidden = false;
    if (new URLSearchParams(window.location.search).get('forgot') === '1') showForgot(true);
  }).catch(() => {});

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
