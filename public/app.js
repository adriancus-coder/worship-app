'use strict';

(function () {
  const whoami = document.getElementById('whoami');
  const logout = document.getElementById('logout');
  const { t } = window.I18N;

  async function load() {
    const res = await fetch('/api/auth/me', { cache: 'no-store' });
    if (res.status === 401) {
      window.location.replace('/login');
      return;
    }
    const { user, admin } = await res.json();
    whoami.textContent = t('app.signedInAs', { name: user.name, role: t(`roles.${user.role}`), adminName: admin.name });
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
    whoami.textContent = t('app.loadFailed');
  });
})();
