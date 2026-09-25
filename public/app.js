'use strict';

(function () {
  const whoami = document.getElementById('whoami');
  const logout = document.getElementById('logout');
  const { t } = window.I18N;
  let me = null;
  let loadFailed = false;

  function render() {
    if (me) {
      whoami.removeAttribute('data-i18n');
      whoami.textContent = t('app.signedInAs', {
        name: me.user.name,
        role: t(`roles.${me.user.role}`),
        adminName: me.admin.name,
      });
      whoami.classList.remove('muted');
    } else if (loadFailed) {
      whoami.removeAttribute('data-i18n');
      whoami.textContent = t('app.loadFailed');
    }
  }

  async function load() {
    const res = await fetch('/api/auth/me', { cache: 'no-store' });
    if (res.status === 401) {
      window.location.replace('/login');
      return;
    }
    me = await res.json();
    render();
  }

  document.addEventListener('i18n:change', render);

  logout.addEventListener('click', async () => {
    logout.disabled = true;
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.replace('/login');
    }
  });

  load().catch(() => {
    loadFailed = true;
    render();
  });
})();
