'use strict';

// Admin settings (/settings, owner only): the church logo shown by the projector.

(function () {
  const { api, setTitle } = window.PAGE;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const MAX_BYTES = 2 * 1024 * 1024;
  const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

  function message(text, kind) {
    $('logo-message').className = `message${kind ? ` ${kind}` : ''}`;
    $('logo-message').textContent = text || '';
  }

  function renderLogo(logo) {
    $('logo-image').hidden = !logo;
    $('logo-empty').hidden = Boolean(logo);
    $('logo-remove').hidden = !logo;
    if (logo) $('logo-image').src = logo.url;
    else $('logo-image').removeAttribute('src');
  }

  async function load() {
    const res = await api('/api/settings');
    if (!res.ok) return message(res.body.error || t('common.networkError'), 'error');
    renderLogo(res.body.logo);
  }

  $('logo-file').addEventListener('change', async () => {
    const file = $('logo-file').files[0];
    $('logo-file').value = '';
    if (!file) return;
    // Quick checks here; the server checks the real content (magic bytes).
    if (!TYPES.includes(file.type)) return message(t('errors.logoInvalid'), 'error');
    if (file.size > MAX_BYTES) return message(t('errors.logoTooLarge', { max: '2 MB' }), 'error');
    message(t('settings.logoUploading'));
    try {
      const res = await fetch('/api/settings/logo', { method: 'PUT', body: file, headers: { 'Content-Type': file.type }, cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return message(body.error || t('common.networkError'), 'error');
      renderLogo(body.logo);
      message(t('settings.logoSaved'), 'success');
    } catch (err) {
      message(t('common.networkError'), 'error');
    }
  });

  $('logo-remove').addEventListener('click', async () => {
    const res = await api('/api/settings/logo', { method: 'DELETE' });
    if (!res.ok) return message(res.body.error || t('common.networkError'), 'error');
    renderLogo(null);
    message(t('settings.logoRemoved'), 'success');
  });

  document.addEventListener('i18n:change', () => {
    setTitle('settings.pageTitle');
    message('');
  });

  setTitle('settings.pageTitle');
  load().catch(() => message(t('common.networkError'), 'error'));
})();
