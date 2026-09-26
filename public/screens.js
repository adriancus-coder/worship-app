'use strict';

// Projector screens (/screens, owner and operator): the paired screens first (online, last
// seen, rename, revoke, "Adresa proiectorului"), then "Adaugă un ecran" in two ways: from the
// operator console (nothing to do here) or with a code on a PC without an operator (the
// projector address to copy / email / share, then the 6-digit code and a name).

(function () {
  const { api, el, setTitle } = window.PAGE;
  const { t } = window.I18N;
  const $ = (id) => document.getElementById(id);
  const REFRESH_MS = 15000;

  const state = { screens: null, baseUrl: null, renaming: null, revoking: null, addressOpen: new Set() };

  // "Adresa proiectorului": PUBLIC_BASE_URL when set, else this page's origin.
  const screenAddress = () => `${state.baseUrl || window.location.origin}/screen`;

  async function copyText(text, input) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      if (!input) return false;
      input.select();
      return Boolean(document.execCommand && document.execCommand('copy'));
    }
  }

  function setStatus(text) {
    $('status').removeAttribute('data-i18n');
    $('status').textContent = text;
    $('status').hidden = !text;
  }

  function lastSeen(screen) {
    if (screen.online) return t('screens.onlineNow');
    if (!screen.lastSeenAt) return t('screens.neverSeen');
    const when = new Intl.DateTimeFormat(window.I18N.lang === 'en' ? 'en-GB' : 'ro-RO', { dateStyle: 'medium', timeStyle: 'short' })
      .format(new Date(screen.lastSeenAt));
    return t('screens.lastSeen', { when });
  }

  function render() {
    if (!state.screens) return;
    setStatus(state.screens.length ? '' : t('screens.empty'));
    $('screens').replaceChildren(...state.screens.map((screen) => el('li', { class: 'screen-row' },
      el('span', { class: `online-dot${screen.online ? ' on' : ''}`, 'aria-hidden': 'true' }),
      el('span', { class: 'screen-text' },
        el('span', { class: 'screen-name', text: screen.name }),
        el('span', { class: 'screen-meta', text: `${screen.online ? t('screens.online') : t('screens.offline')} · ${lastSeen(screen)}` })),
      el('span', { class: 'screen-tools' },
        el('button', { type: 'button', class: 'secondary', 'data-icon': 'edit', text: t('screens.rename'), 'aria-label': t('screens.renameLabel', { name: screen.name }), onclick: () => openRename(screen) }),
        el('button', { type: 'button', class: 'secondary', 'data-icon': 'link', text: t('screens.rowAddress'), 'aria-expanded': String(state.addressOpen.has(screen.id)), 'aria-label': t('screens.rowAddressLabel', { name: screen.name }), onclick: () => toggleAddress(screen) }),
        el('button', { type: 'button', class: 'secondary', 'data-icon': 'close', text: t('screens.revoke'), 'aria-label': t('screens.revokeLabel', { name: screen.name }), onclick: () => openRevoke(screen) })),
      // "Adresa proiectorului" for this screen: to reopen a PC that lost its window.
      state.addressOpen.has(screen.id) ? addressBox(screen) : null)));
  }

  function addressBox(screen) {
    const input = el('input', { type: 'text', class: 'mono', readonly: 'readonly', value: screenAddress(), 'aria-label': t('screens.addressLabel') });
    const message = el('span', { class: 'message', role: 'status' });
    return el('div', { class: 'screen-address' },
      el('span', { class: 'hint', text: t('screens.rowAddressHint') }),
      el('div', { class: 'address-box' }, input,
        el('button', { type: 'button', class: 'secondary', 'data-icon': 'copy', text: t('screens.copy'), 'aria-label': t('screens.copyLabel', { name: screen.name }),
          onclick: async () => { message.textContent = (await copyText(screenAddress(), input)) ? t('screens.copied') : t('screens.copyFailed'); } })),
      message);
  }

  function toggleAddress(screen) {
    if (state.addressOpen.has(screen.id)) state.addressOpen.delete(screen.id);
    else state.addressOpen.add(screen.id);
    render();
  }

  async function load() {
    const res = await api('/api/screens');
    if (!res.ok) {
      setStatus(res.body.error || t('common.networkError'));
      return;
    }
    state.screens = res.body.screens;
    state.baseUrl = res.body.baseUrl || null;
    render();
    renderAddress();
  }

  // --- "Adaugă un ecran" with a code: the address to hand over, then the code ---------------

  function renderAddress() {
    const url = screenAddress();
    $('screen-address').value = url;
    const appName = document.documentElement.dataset.appName || '';
    const subject = t('screens.emailSubject', { appName });
    const body = t('screens.emailBody', { url });
    $('address-email').href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    $('address-share').hidden = typeof navigator.share !== 'function';
  }

  $('pair-open').addEventListener('click', () => {
    const open = $('code-way').hidden;
    $('code-way').hidden = !open;
    $('pair-open').setAttribute('aria-expanded', String(open));
    if (open) $('screen-address').focus();
  });
  $('address-copy').addEventListener('click', async () => {
    const ok = await copyText(screenAddress(), $('screen-address'));
    $('address-message').className = `message ${ok ? 'success' : 'error'}`;
    $('address-message').textContent = ok ? t('screens.copied') : t('screens.copyFailed');
  });
  $('address-share').addEventListener('click', () => {
    navigator.share({ title: t('screens.addressLabel'), text: t('screens.emailBody', { url: screenAddress() }) }).catch(() => {});
  });

  // --- pairing -----------------------------------------------------------------------

  $('pair-name').value = t('screens.defaultName');
  $('pair-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = $('pair-message');
    message.className = 'message';
    message.textContent = '';
    $('pair-submit').disabled = true;
    try {
      const res = await api('/api/screens/claim', { method: 'POST', body: { code: $('pair-code').value, name: $('pair-name').value } });
      if (res.status === 201) {
        message.className = 'message success';
        message.textContent = t('screens.paired', { name: res.body.screen.name });
        $('pair-code').value = '';
        // The screen collects its token on its next poll (every 3 s); it is listed then.
        [1500, 4000, 8000].forEach((ms) => setTimeout(() => load().catch(() => {}), ms));
      } else {
        message.className = 'message error';
        message.textContent = res.body.error || t('common.networkError');
      }
    } catch (err) {
      message.className = 'message error';
      message.textContent = t('common.networkError');
    } finally {
      $('pair-submit').disabled = false;
    }
  });

  // --- rename / revoke ---------------------------------------------------------------

  function openRename(screen) {
    state.renaming = screen;
    $('rename-name').value = screen.name;
    $('rename-message').textContent = '';
    $('rename-dialog').showModal();
    $('rename-name').focus();
  }

  $('rename-cancel').addEventListener('click', () => $('rename-dialog').close());
  $('rename-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const res = await api(`/api/screens/${state.renaming.id}`, { method: 'PUT', body: { name: $('rename-name').value } });
    if (!res.ok) {
      $('rename-message').textContent = res.body.error || t('common.networkError');
      return;
    }
    $('rename-dialog').close();
    await load();
  });

  function openRevoke(screen) {
    state.revoking = screen;
    $('revoke-text').textContent = t('screens.revokeText', { name: screen.name });
    $('revoke-dialog').returnValue = '';
    $('revoke-dialog').showModal();
  }

  $('revoke-dialog').addEventListener('close', async () => {
    if ($('revoke-dialog').returnValue !== 'revoke' || !state.revoking) return;
    const res = await api(`/api/screens/${state.revoking.id}`, { method: 'DELETE' });
    if (!res.ok) setStatus(res.body.error || t('common.networkError'));
    await load();
  });

  document.addEventListener('i18n:change', () => {
    setTitle('screens.pageTitle');
    render();
    renderAddress();
  });

  setTitle('screens.pageTitle');

  load().catch(() => setStatus(t('common.networkError')));
  setInterval(() => {
    if (!document.hidden) load().catch(() => {});
  }, REFRESH_MS);
})();
