'use strict';

// "Mai mult → Profilul meu": the user's own name, phone (optional) and usual positions in the
// team (lib/positions.js), saved with one button. Other profile sections (unavailability)
// mount themselves under #profile-extra.

(function () {
  const { api, el, setTitle } = window.PAGE;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const state = { profile: null, positions: [] };

  function say(text, kind) {
    $('message').className = `message${kind ? ` ${kind}` : ''}`;
    $('message').textContent = text || '';
  }

  function render() {
    setTitle('profile.pageTitle');
    if (!state.profile) return;
    $('p-email').textContent = state.profile.email;
    $('p-positions').replaceChildren(...state.positions.map((p) => el('label', { class: 'checkbox' },
      el('input', { type: 'checkbox', name: 'position', value: String(p.id), checked: state.profile.positionIds.includes(p.id) ? 'checked' : null }),
      el('span', { text: p.name }))));
  }

  $('profile-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const positionIds = [...document.querySelectorAll('#p-positions input:checked')].map((box) => Number(box.value));
    $('submit').disabled = true;
    try {
      const res = await api('/api/me/profile', { method: 'PUT', body: { name: $('p-name').value, phone: $('p-phone').value, positionIds } });
      if (!res.ok) return say(res.body.error || t('common.networkError'), 'error');
      state.profile = res.body.profile;
      say(t('profile.saved'), 'success');
      render();
    } catch (err) {
      say(t('common.networkError'), 'error');
    } finally {
      $('submit').disabled = false;
    }
  });

  document.addEventListener('i18n:change', () => { render(); say(''); });

  (async () => {
    const res = await api('/api/me/profile');
    if (!res.ok) {
      $('status').removeAttribute('data-i18n');
      $('status').textContent = res.body.error || t('common.networkError');
      return;
    }
    state.profile = res.body.profile;
    state.positions = res.body.positions;
    $('p-name').value = state.profile.name;
    $('p-phone').value = state.profile.phone || '';
    render();
    $('status').hidden = true;
    $('profile-form').hidden = false;
  })().catch(() => {
    $('status').removeAttribute('data-i18n');
    $('status').textContent = t('common.networkError');
  });
})();
