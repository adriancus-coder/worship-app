'use strict';

(function () {
  const form = document.getElementById('login-form');
  const message = document.getElementById('message');
  const button = form.querySelector('button[type="submit"]');

  function showError(text) {
    message.textContent = text;
    message.className = 'message error';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.textContent = '';

    const data = {
      email: form.elements.email.value.trim(),
      password: form.elements.password.value,
      remember: form.elements.remember.checked,
    };
    if (!data.email || !data.password) {
      showError('Completează emailul și parola.');
      return;
    }

    button.disabled = true;
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        window.location.replace('/app');
        return;
      }
      const body = await res.json().catch(() => ({}));
      showError(body.error || 'Autentificarea a eșuat.');
    } catch (err) {
      showError('Serverul nu răspunde. Încearcă din nou.');
    } finally {
      button.disabled = false;
    }
  });
})();
