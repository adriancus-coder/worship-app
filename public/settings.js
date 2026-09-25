'use strict';

// Admin settings (/settings, owner only): the default chord notation and the church logo
// shown by the projector.

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

  function renderNotation(notation) {
    for (const button of document.querySelectorAll('[data-notation]')) {
      button.setAttribute('aria-pressed', String(button.dataset.notation === notation));
    }
  }

  async function load() {
    const res = await api('/api/settings');
    if (!res.ok) return message(res.body.error || t('common.networkError'), 'error');
    renderLogo(res.body.logo);
    renderNotation(res.body.chordNotationDefault);
  }

  for (const button of document.querySelectorAll('[data-notation]')) {
    button.addEventListener('click', async () => {
      const res = await api('/api/settings/chord-notation', { method: 'PUT', body: { notation: button.dataset.notation } });
      const out = $('notation-message');
      if (!res.ok) {
        out.className = 'message error';
        out.textContent = res.body.error || t('common.networkError');
        return;
      }
      renderNotation(res.body.chordNotationDefault);
      out.className = 'message success';
      out.textContent = t('settings.notationSaved');
    });
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
    $('notation-message').textContent = '';
  });

  setTitle('settings.pageTitle');
  load().catch(() => message(t('common.networkError'), 'error'));
})();
