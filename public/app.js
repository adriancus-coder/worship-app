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
      // Admin pages for owner / leader.
      const manager = ['owner', 'leader'].includes(me.user.role);
      document.getElementById('screens-link').hidden = !manager;
      document.getElementById('media-link').hidden = !manager;
      document.getElementById('settings-link').hidden = me.user.role !== 'owner';
      document.getElementById('app-links').hidden = !manager;
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

  // Remember the choice for this user (server also refreshes the wa_lang cookie).
  async function saveLocale(locale) {
    try {
      await fetch('/api/me/locale', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale }),
      });
      if (me) me.user.locale = locale;
    } catch (err) {
      // The cookie already holds the choice; the next switch or login retries.
    }
  }

  document.addEventListener('i18n:change', (event) => {
    render();
    if (me) saveLocale(event.detail.lang);
  });

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
