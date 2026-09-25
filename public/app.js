'use strict';

(function () {
  const whoami = document.getElementById('whoami');
  const logout = document.getElementById('logout');

  async function load() {
    const res = await fetch('/api/auth/me', { cache: 'no-store' });
    if (res.status === 401) {
      window.location.replace('/login');
      return;
    }
    const { user, admin } = await res.json();
    whoami.textContent = `Conectat ca ${user.name} (${user.role}) — ${admin.name}`;
    whoami.classList.remove('muted');
  }

  logout.addEventListener('click', async () => {
    logout.disabled = true;
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.replace('/login');
    }
  });

  load().catch(() => {
    whoami.textContent = 'Serverul nu răspunde. Reîncarcă pagina.';
  });
})();
