'use strict';

(function () {
  const form = document.getElementById('setup-form');
  const message = document.getElementById('message');
  const done = document.getElementById('done');
  const button = form.querySelector('button[type="submit"]');

  function showError(text) {
    message.textContent = text;
    message.className = 'message error';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.textContent = '';

    const data = Object.fromEntries(new FormData(form));
    if (data.ownerPassword.length < 10) {
      showError('Parola trebuie să aibă cel puțin 10 caractere.');
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
        showError(body.error || 'Configurarea a eșuat.');
        return;
      }
      form.hidden = true;
      done.hidden = false;
    } catch (err) {
      showError('Serverul nu răspunde. Încearcă din nou.');
    } finally {
      button.disabled = false;
    }
  });
})();
