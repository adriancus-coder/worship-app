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
      el('span', { text: window.PAGE.positionLabel(p) }))));
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

  // --- Face ID / fingerprint: this person's passkeys (public/passkeys.js) ---------------------
  const passkeyState = { list: [], asking: null };
  function sayPasskey(text, kind) {
    $('passkey-message').className = `message${kind ? ` ${kind}` : ''}`;
    $('passkey-message').textContent = text || '';
  }
  const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  function passkeyName(p) {
    const known = ['iphone', 'ipad', 'android', 'mac', 'windows', 'other'];
    return known.includes(p.name) ? t(`passkey.device.${p.name}`) : (p.name || t('passkey.device.other'));
  }
  function renderPasskeys() {
    const year = String(new Date().getFullYear());
    $('passkey-empty').hidden = passkeyState.list.length > 0;
    $('passkey-list').replaceChildren(...passkeyState.list.map((p) => el('li', { class: 'passkey-item' },
      el('span', { class: 'passkey-text' },
        el('span', { class: 'passkey-name', text: passkeyName(p) }),
        el('span', { class: 'muted', text: ` · ${t('passkey.item', { date: window.PAGE.formatDate(dayOf(p.createdAt), year) })}${p.lastUsedAt ? t('passkey.lastUsed', { date: window.PAGE.formatDate(dayOf(p.lastUsedAt), year) }) : ''}` })),
      el('button', {
        type: 'button', class: `secondary passkey-remove${passkeyState.asking === p.id ? ' is-asking' : ''}`, 'data-icon': 'close', 'aria-label': t('passkey.removeFor', { name: passkeyName(p) }),
        text: passkeyState.asking === p.id ? t('passkey.removeAsk') : t('passkey.remove'),
        onclick: async () => {
          if (passkeyState.asking !== p.id) { passkeyState.asking = p.id; renderPasskeys(); setTimeout(() => { if (passkeyState.asking === p.id) { passkeyState.asking = null; renderPasskeys(); } }, 5000); return; }
          passkeyState.asking = null;
          const res = await api(`/api/me/passkeys/${p.id}`, { method: 'DELETE' });
          if (!res.ok) return sayPasskey(res.body.error || t('common.networkError'), 'error');
          passkeyState.list = res.body.passkeys;
          sayPasskey(t('passkey.removed'), 'success');
          renderPasskeys();
        },
      }))));
  }
  $('passkey-add').addEventListener('click', async () => {
    sayPasskey(t('passkey.adding'));
    $('passkey-add').disabled = true;
    try {
      const body = await window.PASSKEYS.register({ name: window.PASSKEYS.deviceName() });
      passkeyState.list = body.passkeys;
      sayPasskey(t('passkey.added'), 'success');
      renderPasskeys();
    } catch (err) {
      sayPasskey(err.code === 'cancelled' ? t('passkey.cancelled') : (err.message || t('passkey.failed')), 'error');
    } finally {
      $('passkey-add').disabled = false;
    }
  });
  (async () => {
    const res = await api('/api/me/passkeys');
    if (!res.ok) return;
    passkeyState.list = res.body.passkeys;
    const ok = window.PASSKEYS.supported();
    $('passkey-add').hidden = !ok;
    $('passkey-unsupported').hidden = ok;
    renderPasskeys();
    $('passkeys').hidden = false;
  })().catch(() => {});
  document.addEventListener('i18n:change', renderPasskeys);

  // --- messages closed with × on this device (public/dismiss.js) ----------------------
  function renderDismissed() {
    const n = window.DISMISS ? window.DISMISS.count() : 0;
    $('dismissed-count').textContent = n ? t('dismiss.count', { n }) : t('dismiss.none');
    $('show-dismissed').disabled = n === 0;
  }
  $('show-dismissed').addEventListener('click', () => {
    window.DISMISS.reset();
    renderDismissed();
    $('dismissed-count').textContent = t('dismiss.shown');
  });
  renderDismissed();
  document.addEventListener('i18n:change', renderDismissed);
})();
